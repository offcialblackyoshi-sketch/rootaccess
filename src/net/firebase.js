// Online multiplayer through Firebase Realtime Database + Anonymous Auth.
// The Firebase SDK is loaded from Google's CDN only when online play is used.

import { randomRoomCode, convId } from './shared.js';

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

  let presenceArmed = false;
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
    // ---- Online players, profiles and private messages ----
    // presence/<uid>: who's online (removed automatically when the tab closes).
    async presenceSet(info) {
      const ref = D.ref(db, `presence/${user.uid}`);
      if (!presenceArmed) { presenceArmed = true; D.onDisconnect(ref).remove().catch(() => { presenceArmed = false; }); }
      await D.set(ref, { ...info, at: D.serverTimestamp() });
    },
    presenceClear: () => D.remove(D.ref(db, `presence/${user.uid}`)).catch(() => {}),
    presenceWatch(cb) {
      return D.onValue(D.ref(db, 'presence'), (s) => cb(s.val() || {}));
    },
    // Private chats: dms/<uidA_uidB>/<msg>, plus inbox/<uid>/<conv> to notify.
    async dmSend(other, msg) {
      const conv = convId(user.uid, other);
      const m = { ...msg, from: user.uid, at: D.serverTimestamp() };
      await D.push(D.ref(db, `dms/${conv}`), m);
      await D.set(D.ref(db, `inbox/${other}/${conv}`), { from: user.uid, name: msg.name, color: msg.color || '', text: msg.text, at: D.serverTimestamp() });
    },
    dmWatch(other, cb) {
      return D.onValue(D.query(D.ref(db, `dms/${convId(user.uid, other)}`), D.limitToLast(100)), (s) => cb(s.val() || {}));
    },
    inboxWatch(cb) {
      return D.onValue(D.ref(db, `inbox/${user.uid}`), (s) => cb(s.val() || {}));
    },

    // Saved chats between signed-in accounts: adms/<acctA_acctB>/<msg>, and
    // ainbox/<acct>/<conv> = { with, withName, last message, readAt } for each side.
    acctChat: {
      async send(otherAcct, otherName, msg) {
        const u = mustSignIn();
        const { db: adb } = account();
        const conv = convId(u.uid, otherAcct);
        const at = D.serverTimestamp();
        await D.push(D.ref(adb, `adms/${conv}`), { from: u.uid, name: msg.name, color: msg.color || '', text: msg.text, at });
        const last = { from: u.uid, name: msg.name, color: msg.color || '', text: msg.text, at };
        await D.set(D.ref(adb, `ainbox/${otherAcct}/${conv}`), { ...last, with: u.uid, withName: msg.name });
        await D.set(D.ref(adb, `ainbox/${u.uid}/${conv}`), { ...last, with: otherAcct, withName: otherName, readAt: at });
      },
      watch(otherAcct, cb) {
        const u = mustSignIn();
        return D.onValue(D.query(D.ref(account().db, `adms/${convId(u.uid, otherAcct)}`), D.limitToLast(200)), (s) => cb(s.val() || {}));
      },
      inbox(cb) {
        const u = mustSignIn();
        return D.onValue(D.ref(account().db, `ainbox/${u.uid}`), (s) => cb(s.val() || {}));
      },
      markRead(otherAcct) {
        const u = signedIn();
        if (!u) return Promise.resolve();
        return D.update(D.ref(account().db, `ainbox/${u.uid}/${convId(u.uid, otherAcct)}`), { readAt: D.serverTimestamp() }).catch(() => {});
      },
    },

    // ---- Public lobby: open rooms + lobby chat ----
    lobbyWatch(cb) {
      let rooms = {};
      let chat = {};
      const emit = () => cb({ rooms, chat });
      const off1 = D.onValue(D.ref(db, 'lobby/rooms'), (s) => { rooms = s.val() || {}; emit(); });
      const off2 = D.onValue(D.query(D.ref(db, 'lobby/chat'), D.limitToLast(50)), (s) => { chat = s.val() || {}; emit(); });
      return () => { off1(); off2(); };
    },
    async lobbySay(msg) {
      await D.push(D.ref(db, 'lobby/chat'), { ...msg, uid: user.uid, at: D.serverTimestamp() });
    },
    // List (info) or unlist (null) a public room. The listing goes away if the host disconnects.
    async lobbyList(code, info) {
      const ref = D.ref(db, `lobby/rooms/${code}`);
      if (!info) return D.remove(ref).catch(() => {});
      await D.set(ref, { ...info, host: user.uid, at: D.serverTimestamp() });
      D.onDisconnect(ref).remove().catch(() => {});
    },

    // ---- Owner tools ----
    // Everyone watches announcements and bans with the room connection; only
    // the owner account can write them (checked by the database rules).
    mod: {
      announceWatch: (cb) => D.onValue(D.ref(db, 'announce'), (s) => cb(s.val()), () => cb(null)),
      bansWatch: (cb) => D.onValue(D.ref(db, 'bans'), (s) => cb(s.val() || {}), () => cb({})),
      announce: (text, by = '') => {
        const ref = D.ref(account().db, 'announce');
        return text ? D.set(ref, { text, by: String(by).slice(0, 16), at: D.serverTimestamp() }) : D.remove(ref);
      },
      ban: (ids, until, name) => D.update(D.ref(account().db, 'bans'),
        Object.fromEntries(ids.map((id) => [id, { until, name: String(name || '').slice(0, 16), at: D.serverTimestamp() }]))),
      unban: (ids) => D.update(D.ref(account().db, 'bans'), Object.fromEntries(ids.map((id) => [id, null]))),
      deleteLobbyMsg: (key) => D.remove(D.ref(account().db, `lobby/chat/${key}`)),
      async closeRoom(code) {
        await D.remove(D.ref(account().db, `lobby/rooms/${code}`)).catch(() => {});
        await D.remove(D.ref(account().db, `rooms/${code}`));
      },
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
      // "owner" or null. Roles are set by hand in the Firebase console.
      async role() {
        const u = signedIn();
        if (!u) return null;
        return (await D.get(D.ref(db, `roles/${u.uid}`))).val();
      },
      // Link this tab's guest sign-in to the account from both sides, so the
      // rules know this tab speaks for the account (owner name, bans).
      async linkTab() {
        const u = mustSignIn();
        const tabRef = D.ref(db, `sessions/${user.uid}`);
        const acctRef = D.ref(account().db, `acctSessions/${u.uid}/${user.uid}`);
        await D.set(acctRef, true);
        await D.set(tabRef, u.uid);
        D.onDisconnect(tabRef).remove().catch(() => {});
        D.onDisconnect(acctRef).remove().catch(() => {});
      },
      async unlinkTab() {
        const u = signedIn();
        await D.remove(D.ref(db, `sessions/${user.uid}`)).catch(() => {});
        if (u) await D.remove(D.ref(account().db, `acctSessions/${u.uid}/${user.uid}`)).catch(() => {});
      },
      // Firebase wants a fresh sign-in before deleting an account.
      async reauth(password) {
        const u = mustSignIn();
        const isGoogle = u.providerData.some((p) => p.providerId === 'google.com');
        if (isGoogle) await A.reauthenticateWithPopup(u, new A.GoogleAuthProvider());
        else await A.reauthenticateWithCredential(u, A.EmailAuthProvider.credential(u.email, password));
      },
      // Removes your saved data and frees your name (before the login itself is deleted).
      async deleteData(handle, today) {
        const u = mustSignIn();
        const adb = account().db;
        const gone = [`stats/${u.uid}`, `daily/${today}/${u.uid}`, `acctSessions/${u.uid}`, `users/${u.uid}`];
        if (handle) gone.push(`handles/${handle.toLowerCase()}`);
        for (const path of gone) await D.remove(D.ref(adb, path)).catch((e) => console.warn('delete', path, e.message));
        await D.remove(D.ref(db, `sessions/${user.uid}`)).catch(() => {});
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
