// Online multiplayer through Firebase Realtime Database + Anonymous Auth.
// The Firebase SDK is loaded from Google's CDN only when online play is used.

import { randomRoomCode } from './shared.js';

const SDK = 'https://www.gstatic.com/firebasejs/13.4.0/';

export async function createFirebaseNet(config) {
  const [{ initializeApp }, A, D] = await Promise.all([
    import(SDK + 'firebase-app.js'),
    import(SDK + 'firebase-auth.js'),
    import(SDK + 'firebase-database.js'),
  ]);

  const app = initializeApp(config);
  const auth = A.getAuth(app);
  // Each tab is its own player, and a new one after a reload.
  await A.setPersistence(auth, A.browserSessionPersistence);
  const { user } = await A.signInAnonymously(auth);
  const db = D.getDatabase(app);

  let offset = 0;
  D.onValue(D.ref(db, '.info/serverTimeOffset'), (s) => {
    offset = s.val() || 0;
  });

  let connected = true;
  const connListeners = new Set();
  D.onValue(D.ref(db, '.info/connected'), (s) => {
    connected = !!s.val();
    for (const cb of connListeners) cb(connected);
  });

  const roomRef = (code, path = '') => D.ref(db, `rooms/${code}${path ? '/' + path : ''}`);
  const disconnects = new Map();

  async function armDisconnect(code) {
    const od = D.onDisconnect(roomRef(code, `players/${user.uid}`));
    await od.remove();
    disconnects.set(code, od);
  }

  const net = {
    kind: 'online',
    uid: user.uid,
    now: () => Date.now() + offset,
    onConnection(cb) {
      connListeners.add(cb);
      cb(connected);
      return () => connListeners.delete(cb);
    },

    async createRoom(room) {
      for (let i = 0; i < 10; i++) {
        const code = randomRoomCode();
        const snap = await D.get(roomRef(code));
        if (snap.exists()) continue;
        await D.set(roomRef(code), room);
        await armDisconnect(code);
        return code;
      }
      throw new Error('Could not create a room. Please try again.');
    },

    async getRoom(code) {
      const snap = await D.get(roomRef(code));
      return snap.val();
    },

    async joinRoom(code, player) {
      await D.set(roomRef(code, `players/${user.uid}`), player);
      await armDisconnect(code);
    },

    // Get back into a room after a page reload (the tab keeps its sign-in).
    async rejoin(code, player) {
      const room = (await D.get(roomRef(code))).val();
      if (!room) return false;
      if (!room.players?.[user.uid]) {
        if (room.status !== 'lobby' || room.kicked?.[user.uid]) return false;
        await D.set(roomRef(code, `players/${user.uid}`), player);
      }
      await armDisconnect(code);
      return true;
    },

    watch(code, cb) {
      return D.onValue(roomRef(code), (s) => cb(s.val()), () => cb(null));
    },

    update(code, changes) {
      return D.update(roomRef(code), changes);
    },

    async push(code, listPath, value) {
      const r = D.push(roomRef(code, listPath));
      await D.set(r, value);
      return r.key;
    },

    async leave(code) {
      const od = disconnects.get(code);
      if (od) await od.cancel().catch(() => {});
      disconnects.delete(code);
      const snap = await D.get(roomRef(code));
      const room = snap.val();
      const others = Object.entries(room?.players || {}).filter(([id, p]) => id !== user.uid && !p.bot);
      // Last human out closes the room.
      if (others.length === 0) await D.remove(roomRef(code));
      else await D.remove(roomRef(code, `players/${user.uid}`));
    },

    leaveNow(code) {
      // onDisconnect removes us when the tab closes; nothing to do here.
      void code;
    },
  };
  return net;
}
