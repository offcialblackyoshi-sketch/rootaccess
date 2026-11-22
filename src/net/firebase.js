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

  // Accounts (Google sign-in) use a second app instance whose sign-in is
  // remembered across visits. Rooms keep their own per-tab guest sign-in.
  let acct = null;
  function account() {
    if (!acct) {
      const aApp = initializeApp(config, 'account');
      const auth = A.getAuth(aApp);
      acct = { auth, db: D.getDatabase(aApp), ready: A.setPersistence(auth, A.browserLocalPersistence) };
    }
    return acct;
  }
  // The signed-in Google user, or null (guests don't count as accounts).
  const signedIn = () => {
    const u = account().auth.currentUser;
    return u && !u.isAnonymous ? u : null;
  };
  const mustSignIn = () => {
    const u = signedIn();
    if (!u) throw new Error('sign in with Google first');
    return u;
  };

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

    // Daily Challenge board: daily/<YYYY-MM-DD>/<uid>. Only a better score replaces yours.
    async submitDaily(date, entry) {
      const u = mustSignIn();
      const ref = D.ref(account().db, `daily/${date}/${u.uid}`);
      const old = (await D.get(ref)).val();
      if (old && old.score <= entry.score) return;
      await D.set(ref, { ...entry, at: D.serverTimestamp() });
    },
    // ---- Accounts ----
    accountUid: () => signedIn()?.uid || null,
    account: {
      // cb({ uid, email, name } | null) now and whenever sign-in changes.
      onUser(cb) {
        const { auth, ready } = account();
        ready.then(() => A.onAuthStateChanged(auth, (u) => cb(u && !u.isAnonymous ? { uid: u.uid, email: u.email, name: u.displayName } : null)));
      },
      async signIn() {
        const { auth, ready } = account();
        await ready;
        await A.signInWithPopup(auth, new A.GoogleAuthProvider());
      },
      signOut: () => A.signOut(account().auth),
      // Username/password accounts. `email` is a real one, or a made-up
      // login address for players who signed up without email.
      async signUp(email, password, { verify = false } = {}) {
        const { auth, ready } = account();
        await ready;
        const cred = await A.createUserWithEmailAndPassword(auth, email, password);
        if (verify) A.sendEmailVerification(cred.user).catch(() => {});
        return cred.user.uid;
      },
      async logIn(email, password) {
        const { auth, ready } = account();
        await ready;
        await A.signInWithEmailAndPassword(auth, email, password);
      },
      resetPassword: (email) => A.sendPasswordResetEmail(account().auth, email),
      // Undo a sign-up whose handle turned out to be taken.
      async deleteMe() {
        const u = account().auth.currentUser;
        if (u) await A.deleteUser(u);
      },
      // Is a handle already claimed? (read with the room connection, which is always signed in)
      async handleTaken(handle) {
        return (await D.get(D.ref(db, `handles/${handle.toLowerCase()}`))).exists();
      },
      provider() {
        const u = signedIn();
        return u ? u.providerData[0]?.providerId || 'password' : null;
      },
      async loadProfile() {
        const u = mustSignIn();
        return (await D.get(D.ref(account().db, `users/${u.uid}`))).val();
      },
      // Claims a unique handle (case-insensitive) and frees the old one.
      async claimHandle(handle, oldHandle) {
        const u = mustSignIn();
        const { db: adb } = account();
        const key = handle.toLowerCase();
        const res = await D.runTransaction(D.ref(adb, `handles/${key}`), (cur) => (cur === null || cur === u.uid ? u.uid : undefined));
        if (!res.committed) throw new Error(`"${handle}" is taken. Try another.`);
        await D.update(D.ref(adb, `users/${u.uid}`), { handle });
        if (oldHandle && oldHandle.toLowerCase() !== key) await D.remove(D.ref(adb, `handles/${oldHandle.toLowerCase()}`)).catch(() => {});
      },
      async saveProfile(p) {
        const u = mustSignIn();
        await D.update(D.ref(account().db, `users/${u.uid}`), p);
      },
    },

    // Global leaderboard: stats/<account uid>, highest XP first (signed-in players only).
    async submitStats(stats) {
      const u = mustSignIn();
      const s = { db: account().db, uid: u.uid };
      const ref = D.ref(s.db, `stats/${s.uid}`);
      // The rules let XP rise by at most 500 per save (catch up over a few saves).
      const old = (await D.get(ref)).val();
      const xp = old ? Math.min(Math.max(stats.xp, old.xp), old.xp + 500) : stats.xp;
      await D.set(ref, { ...stats, xp, updatedAt: D.serverTimestamp() });
      return s.uid;
    },
    async statsBoard(limit = 50) {
      const snap = await D.get(D.query(D.ref(db, 'stats'), D.orderByChild('xp'), D.limitToLast(limit)));
      const rows = [];
      snap.forEach((c) => { rows.push({ id: c.key, ...c.val() }); });
      return { rows: rows.reverse(), me: signedIn()?.uid || null };
    },
    async dailyBoard(date, limit = 20) {
      const snap = await D.get(D.query(D.ref(db, `daily/${date}`), D.orderByChild('score'), D.limitToFirst(limit)));
      const rows = [];
      snap.forEach((c) => { rows.push({ id: c.key, ...c.val() }); });
      return rows;
    },
  };
  return net;
}
