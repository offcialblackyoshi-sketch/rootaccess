// "Local" multiplayer: rooms live in localStorage, so several tabs on the
// same computer can play together. Used for Practice mode, for testing, and
// when online play isn't set up.

import { randomRoomCode, setPath } from './shared.js';

const PREFIX = 'ra-room-';
const HB = 'ra-hb-';
const STALE_MS = 8000;

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

  window.addEventListener('storage', (e) => {
    if (e.key && e.key.startsWith(PREFIX)) notify(e.key.slice(PREFIX.length));
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

    // Best-effort synchronous leave for when the tab is closing.
    leaveNow(code) {
      stopHeartbeat(code);
      const r = read(code);
      if (!r?.players) return;
      delete r.players[uid];
      const humans = Object.values(r.players).filter((p) => !p.bot);
      if (humans.length) store.set(PREFIX + code, JSON.stringify(r));
      else store.del(PREFIX + code);
    },
  };
  return net;
}
