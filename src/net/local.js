// "Local" multiplayer: rooms live in localStorage, so several tabs on the
// same computer can play together. Used for Practice mode, for testing, and
// when online play isn't set up.

import { randomRoomCode, setPath } from './shared.js';

const PREFIX = 'ra-room-';
const HB = 'ra-hb-';
const STALE_MS = 8000;
const ABANDONED_MS = 60000;

// Memory fallback if localStorage is blocked (Practice still works).
const memory = new Map();
const store = {
  get(k) {
    try { return localStorage.getItem(k); } catch { return memory.get(k) ?? null; }
  },
  set(k, v) {
    try { localStorage.setItem(k, v); } catch { memory.set(k, v); }
  },
  del(k) {
    try { localStorage.removeItem(k); } catch { memory.delete(k); }
  },
};

function makeUid() {
  try {
    let id = sessionStorage.getItem('ra-local-uid');
    if (!id) {
      id = 'L' + Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem('ra-local-uid', id);
    }
    return id;
  } catch {
    return 'L' + Math.random().toString(36).slice(2, 10);
  }
}

export function createLocalNet() {
  const uid = makeUid();
  const listeners = new Map(); // code -> Set<cb>
  const heartbeats = new Map(); // code -> interval id
  let pushCounter = 0;

  const read = (code) => {
    try { return JSON.parse(store.get(PREFIX + code)); } catch { return null; }
  };

  const notify = (code) => {
    const set = listeners.get(code);
    if (!set) return;
    const room = read(code);
    for (const cb of set) queueMicrotask(() => cb(room));
  };

  // Tidy up rooms nobody has touched for a minute (e.g. a closed practice tab).
  function collectGarbage() {
    let keys = [];
    try { keys = Object.keys(localStorage); } catch { return; }
    const now = Date.now();
    for (const k of keys.filter((x) => x.startsWith(PREFIX))) {
      const code = k.slice(PREFIX.length);
      const room = read(code);
      const humans = Object.entries(room?.players || {}).filter(([, p]) => !p.bot);
      const alive = humans.some(([id]) => now - Number(store.get(`${HB}${code}-${id}`) || 0) < ABANDONED_MS);
      if (alive) continue;
      store.del(k);
      for (const hb of keys.filter((x) => x.startsWith(`${HB}${code}-`))) store.del(hb);
    }
  }
  collectGarbage();

  // Public lobby (open rooms + chat) shared by tabs on this computer.
  const LOBBY = 'ra-lobby';
  const lobbyListeners = new Set();
  const readLobby = () => {
    try { return { rooms: {}, chat: {}, ...JSON.parse(store.get(LOBBY)) }; } catch { return { rooms: {}, chat: {} }; }
  };
  const notifyLobby = () => { const l = readLobby(); for (const cb of lobbyListeners) queueMicrotask(() => cb(l)); };
  async function mutateLobby(fn) {
    const run = () => { const l = readLobby(); fn(l); store.set(LOBBY, JSON.stringify(l)); };
    if (navigator.locks) await navigator.locks.request(LOBBY, run);
    else run();
    notifyLobby();
  }

  window.addEventListener('storage', (e) => {
    if (e.key && e.key.startsWith(PREFIX)) notify(e.key.slice(PREFIX.length));
    if (e.key === LOBBY) notifyLobby();
  });

  // Read-modify-write under a cross-tab lock so tabs don't overwrite each other.
  async function mutate(code, fn) {
    const run = () => {
      const room = read(code);
      const next = fn(room);
      if (next === undefined) return;
      if (next === null) store.del(PREFIX + code);
      else store.set(PREFIX + code, JSON.stringify(next));
    };
    if (navigator.locks) await navigator.locks.request(PREFIX + code, run);
    else run();
    notify(code);
  }

  function startHeartbeat(code) {
    stopHeartbeat(code);
    const beat = () => {
      store.set(`${HB}${code}-${uid}`, String(Date.now()));
      // Remove players whose tab has gone away.
      const room = read(code);
      if (!room?.players) return;
      const stale = Object.entries(room.players)
        .filter(([id, p]) => !p.bot && id !== uid)
        .filter(([id]) => Date.now() - Number(store.get(`${HB}${code}-${id}`) || 0) > STALE_MS)
        .map(([id]) => id);
      if (stale.length) {
        mutate(code, (r) => {
          if (!r?.players) return undefined;
          for (const id of stale) delete r.players[id];
          return r;
        });
      }
    };
    beat();
    heartbeats.set(code, setInterval(beat, 2000));
  }

  function stopHeartbeat(code) {
    clearInterval(heartbeats.get(code));
    heartbeats.delete(code);
    store.del(`${HB}${code}-${uid}`);
  }

  const net = {
    lobbyWatch(cb) {
      lobbyListeners.add(cb);
      cb(readLobby());
      return () => lobbyListeners.delete(cb);
    },
    lobbySay(msg) {
      return mutateLobby((l) => {
        l.chat[Date.now().toString(36) + Math.random().toString(36).slice(2, 6)] = { ...msg, uid, at: Date.now() };
        const keys = Object.keys(l.chat).sort();
        for (const k of keys.slice(0, -50)) delete l.chat[k];
      });
    },
    lobbyList(code, info) {
      return mutateLobby((l) => {
        if (info) l.rooms[code] = { ...info, host: uid, at: Date.now() };
        else delete l.rooms[code];
      });
    },
    kind: 'local',
    uid,
    now: () => Date.now(),

    async createRoom(room) {
      let code;
      do code = randomRoomCode(); while (read(code));
      store.set(PREFIX + code, JSON.stringify(room));
      startHeartbeat(code);
      return code;
    },

    async getRoom(code) {
      return read(code);
    },

    async joinRoom(code, player) {
      await mutate(code, (r) => {
        if (!r) return undefined;
        r.players = r.players || {};
        r.players[uid] = player;
        return r;
      });
      startHeartbeat(code);
    },

    // Get back into a room after a page reload. Returns true if it worked.
    async rejoin(code, player) {
      let ok = false;
      await mutate(code, (r) => {
        if (!r) return undefined;
        r.players = r.players || {};
        if (r.players[uid]) { ok = true; return undefined; }
        if (r.status !== 'lobby' || r.kicked?.[uid]) return undefined;
        r.players[uid] = player;
        ok = true;
        return r;
      });
      if (ok) startHeartbeat(code);
      return ok;
    },

    watch(code, cb) {
      if (!listeners.has(code)) listeners.set(code, new Set());
      listeners.get(code).add(cb);
      queueMicrotask(() => cb(read(code)));
      return () => listeners.get(code)?.delete(cb);
    },

    // changes: { 'players/abc/ready': true, status: 'playing', 'actions/x': null }
    update(code, changes) {
      return mutate(code, (r) => {
        if (!r) return undefined;
        for (const [path, value] of Object.entries(changes)) setPath(r, path, value);
        return r;
      });
    },

    async push(code, listPath, value) {
      const key = Date.now().toString(36) + (pushCounter++).toString(36).padStart(3, '0') + uid.slice(-3);
      await net.update(code, { [`${listPath}/${key}`]: value });
      return key;
    },

    async leave(code) {
      stopHeartbeat(code);
      await mutate(code, (r) => {
        if (!r?.players) return undefined;
        delete r.players[uid];
        const humans = Object.values(r.players).filter((p) => !p.bot);
        return humans.length ? r : null;
      });
    },

    // When the tab closes or reloads we keep the seat: other tabs remove us
    // once our heartbeat goes quiet, and a reload can take the seat back.
    leaveNow(code) {
      clearInterval(heartbeats.get(code));
      heartbeats.delete(code);
    },
  };
  return net;
}
