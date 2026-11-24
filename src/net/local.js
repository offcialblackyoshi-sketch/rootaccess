// "Local" multiplayer: rooms live in localStorage, so several tabs on the
// same computer can play together. Used for Practice mode, for testing, and
// when online play isn't set up.

import { randomRoomCode, setPath, convId } from './shared.js';

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

  // Small shared key/value store (presence, private chats, inboxes) for tabs.
  const kvWatchers = new Map(); // key -> Set<cb>
  const kvGet = (k) => { try { return JSON.parse(store.get(k)) || {}; } catch { return {}; } };
  const kvNotify = (k) => { const v = kvGet(k); for (const cb of kvWatchers.get(k) || []) queueMicrotask(() => cb(v)); };
  async function kvMutate(k, fn) {
    const run = () => { const v = kvGet(k); fn(v); store.set(k, JSON.stringify(v)); };
    if (navigator.locks) await navigator.locks.request(k, run);
    else run();
    kvNotify(k);
  }
  function kvWatch(k, cb, map = (v) => v) {
    const wrapped = (v) => cb(map(v));
    if (!kvWatchers.has(k)) kvWatchers.set(k, new Set());
    kvWatchers.get(k).add(wrapped);
    wrapped(kvGet(k));
    return () => kvWatchers.get(k)?.delete(wrapped);
  }
  const PRESENCE = 'ra-presence';
  // Owner tools on this computer (used by the tests): announcement + bans.
  const ANNOUNCE = 'ra-announce';
  const BANS = 'ra-bans';
  const GROUPS = 'ra-groups';
  const REPORTS = 'ra-reports';
  const REPORTS_BY = 'ra-reports-by';
  const banned = () => (kvGet(BANS)[uid]?.until || 0) > Date.now();
  const refuseIfBanned = () => { if (banned()) throw new Error('PERMISSION_DENIED: banned'); };
  const bannedError = () => Promise.reject(new Error('PERMISSION_DENIED: banned'));
  const freshPresence = (all) => Object.fromEntries(Object.entries(all).filter(([, p]) => Date.now() - (p.at || 0) < 15000));
  window.addEventListener('beforeunload', () => { try { const all = kvGet(PRESENCE); delete all[uid]; store.set(PRESENCE, JSON.stringify(all)); } catch { /* ignore */ } });

  window.addEventListener('storage', (e) => {
    if (e.key && e.key.startsWith(PREFIX)) notify(e.key.slice(PREFIX.length));
    if (e.key === LOBBY) notifyLobby();
    if (e.key && kvWatchers.has(e.key)) kvNotify(e.key);
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
    presenceSet(info) {
      return kvMutate(PRESENCE, (all) => { all[uid] = { ...info, at: Date.now() }; });
    },
    presenceClear() {
      return kvMutate(PRESENCE, (all) => { delete all[uid]; });
    },
    presenceWatch(cb) {
      const off = kvWatch(PRESENCE, cb, freshPresence);
      const t = setInterval(() => cb(freshPresence(kvGet(PRESENCE))), 5000);
      return () => { off(); clearInterval(t); };
    },
    async dmSend(other, msg) {
      const conv = convId(uid, other);
      const at = Date.now();
      await kvMutate('ra-dm-' + conv, (m) => {
        m[at.toString(36) + Math.random().toString(36).slice(2, 5)] = { ...msg, from: uid, at };
        const keys = Object.keys(m).sort();
        for (const k of keys.slice(0, -100)) delete m[k];
      });
      await kvMutate('ra-inbox-' + other, (box) => { box[conv] = { from: uid, name: msg.name, color: msg.color || '', text: msg.text, at }; });
    },
    dmWatch(other, cb) {
      return kvWatch('ra-dm-' + convId(uid, other), cb);
    },
    inboxWatch(cb) {
      return kvWatch('ra-inbox-' + uid, cb);
    },
    lobbyWatch(cb) {
      lobbyListeners.add(cb);
      cb(readLobby());
      return () => lobbyListeners.delete(cb);
    },
    lobbySay(msg) {
      if (banned()) return bannedError();
      return mutateLobby((l) => {
        l.chat[Date.now().toString(36) + Math.random().toString(36).slice(2, 6)] = { ...msg, uid, at: Date.now() };
        const keys = Object.keys(l.chat).sort();
        for (const k of keys.slice(0, -50)) delete l.chat[k];
      });
    },
    lobbyList(code, info) {
      if (info && banned()) return bannedError();
      return mutateLobby((l) => {
        if (info) l.rooms[code] = { ...info, host: uid, at: Date.now() };
        else delete l.rooms[code];
      });
    },
    // Group chats between tabs on this computer (same shape as online).
    groups: {
      me: () => uid,
      async create(name, myName) {
        if (banned()) throw new Error('PERMISSION_DENIED: banned');
        const gid = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const at = Date.now();
        await kvMutate(GROUPS, (all) => { all[gid] = { name, owner: uid, at, members: { [uid]: { name: myName, at } } }; });
        await kvMutate('ra-ginbox-' + uid, (box) => { box[gid] = { name, text: '', by: '', from: uid, at }; });
        return gid;
      },
      // null once you're not a member (left, removed, or the group was deleted).
      watch: (gid, cb) => kvWatch(GROUPS, cb, (all) => (all[gid]?.members?.[uid] ? all[gid] : null)),
      msgs(gid, cb) {
        if (!kvGet(GROUPS)[gid]?.members?.[uid]) { cb({}); return () => {}; }
        return kvWatch('ra-gmsg-' + gid, cb);
      },
      inbox: (cb) => kvWatch('ra-ginbox-' + uid, cb),
      async send(gid, group, msg) {
        if (banned()) throw new Error('PERMISSION_DENIED: banned');
        if (!kvGet(GROUPS)[gid]?.members?.[uid]) throw new Error('PERMISSION_DENIED: not in this group');
        const at = Date.now();
        await kvMutate('ra-gmsg-' + gid, (m) => {
          m[at.toString(36) + Math.random().toString(36).slice(2, 5)] = { from: uid, name: msg.name, color: msg.color || '', text: msg.text, at };
          for (const k of Object.keys(m).sort().slice(0, -100)) delete m[k];
        });
        for (const id of Object.keys(group.members || {})) await kvMutate('ra-ginbox-' + id, (box) => { box[gid] = { name: group.name, text: msg.text, by: msg.name, from: uid, at }; });
      },
      async invite(gid, groupName, id, byName) {
        if (banned()) throw new Error('PERMISSION_DENIED: banned');
        const g = kvGet(GROUPS)[gid];
        if (!g?.members?.[uid] || g.members[id]) throw new Error('PERMISSION_DENIED');
        await kvMutate('ra-ginbox-' + id, (box) => { box[gid] = { name: groupName, text: '', by: byName, from: uid, invite: true, at: Date.now() }; });
      },
      async accept(gid, invite, myName) {
        const g = kvGet(GROUPS)[gid];
        if (!g || !kvGet('ra-ginbox-' + uid)[gid]?.invite || Object.keys(g.members || {}).length >= 12) throw new Error('PERMISSION_DENIED');
        const at = Date.now();
        await kvMutate(GROUPS, (all) => { if (all[gid]) all[gid].members[uid] = { name: myName, at }; });
        await kvMutate('ra-ginbox-' + uid, (box) => { box[gid] = { name: invite.name, text: '', by: '', from: uid, at }; });
      },
      dismiss: (gid) => kvMutate('ra-ginbox-' + uid, (box) => { delete box[gid]; }),
      async leave(gid) {
        await kvMutate(GROUPS, (all) => { delete all[gid]?.members?.[uid]; });
        await kvMutate('ra-ginbox-' + uid, (box) => { delete box[gid]; });
      },
      async kick(gid, id) {
        if (kvGet(GROUPS)[gid]?.owner !== uid) throw new Error('PERMISSION_DENIED');
        await kvMutate('ra-ginbox-' + id, (box) => { delete box[gid]; });
        await kvMutate(GROUPS, (all) => { delete all[gid]?.members?.[id]; });
      },
      async remove(gid, group) {
        if (kvGet(GROUPS)[gid]?.owner !== uid) throw new Error('PERMISSION_DENIED');
        store.del('ra-gmsg-' + gid);
        kvNotify('ra-gmsg-' + gid);
        for (const id of Object.keys(group.members || {})) await kvMutate('ra-ginbox-' + id, (box) => { delete box[gid]; });
        await kvMutate(GROUPS, (all) => { delete all[gid]; });
      },
    },
    // Friends between tabs on this computer. Handles are looked up among the
    // players online here (local play has no accounts).
    friends: {
      me: () => uid,
      available: () => true,
      async lookup(handle) {
        const want = String(handle).toLowerCase();
        const hit = Object.entries(freshPresence(kvGet(PRESENCE))).find(([id, p]) => id !== uid && String(p.name || '').toLowerCase() === want);
        return hit ? { id: hit[0], name: hit[1].name } : null;
      },
      async request(id, myName) {
        if (banned()) throw new Error('PERMISSION_DENIED: banned');
        if (id === uid || kvGet('ra-friends-' + uid)[id]) throw new Error('PERMISSION_DENIED');
        await kvMutate('ra-freq-' + id, (r) => { r[uid] = { name: myName, at: Date.now() }; });
      },
      requests: (cb) => kvWatch('ra-freq-' + uid, cb),
      async accept(id, theirName, myName) {
        if (!kvGet('ra-freq-' + uid)[id]) throw new Error('PERMISSION_DENIED');
        await kvMutate('ra-friends-' + id, (f) => { f[uid] = { name: myName, at: Date.now() }; });
        await kvMutate('ra-friends-' + uid, (f) => { f[id] = { name: theirName, at: Date.now() }; });
        await kvMutate('ra-freq-' + uid, (r) => { delete r[id]; });
      },
      decline: (id) => kvMutate('ra-freq-' + uid, (r) => { delete r[id]; }),
      list: (cb) => kvWatch('ra-friends-' + uid, cb),
      async remove(id) {
        await kvMutate('ra-friends-' + uid, (f) => { delete f[id]; });
        await kvMutate('ra-friends-' + id, (f) => { delete f[uid]; });
      },
      async invite(id, info) {
        if (banned()) throw new Error('PERMISSION_DENIED: banned');
        if (!kvGet('ra-friends-' + id)[uid]) throw new Error('PERMISSION_DENIED');
        await kvMutate('ra-finv-' + id, (v) => { v[uid] = { ...info, at: Date.now() }; });
      },
      invites: (cb) => kvWatch('ra-finv-' + uid, cb),
      clearInvite: (from) => kvMutate('ra-finv-' + uid, (v) => { delete v[from]; }),
    },
    // Reports on this computer (same 30 second limit as online).
    reports: {
      async send(r) {
        if (banned()) throw new Error('PERMISSION_DENIED: banned');
        if (Date.now() - (kvGet(REPORTS_BY)[uid] || 0) < 30000) throw new Error('PERMISSION_DENIED: too soon');
        await kvMutate(REPORTS_BY, (b) => { b[uid] = Date.now(); });
        await kvMutate(REPORTS, (all) => { all['r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)] = { ...r, by: uid, at: Date.now() }; });
      },
      watch: (cb) => kvWatch(REPORTS, cb),
      remove: (id) => kvMutate(REPORTS, (all) => { delete all[id]; }),
    },
    mod: {
      announceWatch: (cb) => kvWatch(ANNOUNCE, (v) => cb(v && v.text ? v : null)),
      bansWatch: (cb) => kvWatch(BANS, cb),
      announce: (text, by = '') => kvMutate(ANNOUNCE, (a) => {
        for (const k of Object.keys(a)) delete a[k];
        if (text) Object.assign(a, { text, by: String(by).slice(0, 16), at: Date.now() });
      }),
      ban: (ids, until, name) => kvMutate(BANS, (b) => { for (const id of ids) b[id] = { until, name: String(name || '').slice(0, 16), at: Date.now() }; }),
      unban: (ids) => kvMutate(BANS, (b) => { for (const id of ids) delete b[id]; }),
      deleteLobbyMsg: (key) => mutateLobby((l) => { delete l.chat[key]; }),
      async closeRoom(code) {
        await mutateLobby((l) => { delete l.rooms[code]; });
        await mutate(code, () => null);
      },
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
      refuseIfBanned();
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
