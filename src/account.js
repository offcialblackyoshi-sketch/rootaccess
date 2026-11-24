// Google accounts: sign in to keep your progress across devices and to get on
// the online leaderboards. Guests can still play everything.

import { getOnlineNet, onlineConfigured } from './net/index.js';
import { getProgress, saveProgress } from './progress.js';
import { save } from './util.js';
import { getTrophyState, saveTrophyState, mergeTrophies } from './trophies.js';

export const HANDLE_RE = /^[A-Za-z0-9_.-]{2,14}$/;
export const MIN_PASSWORD = 6;
// Players who sign up without email log in with a made-up address built from
// their username. Nothing is ever sent to it.
export const LOGIN_DOMAIN = 'players.rootaccess.invalid';
export const loginEmailFor = (username) => `${String(username).toLowerCase()}@${LOGIN_DOMAIN}`;
export const isEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || '').trim());
// What the player typed in "Username or email" → the address to log in with.
export const loginAddress = (id) => (String(id).includes('@') ? String(id).trim() : loginEmailFor(String(id).trim()));

// Friendly messages for Firebase sign-in errors.
export function authMessage(e) {
  const code = e?.code || '';
  if (code.includes('email-already-in-use')) return 'That email already has an account. Log in instead.';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'Wrong username/email or password.';
  if (code.includes('weak-password')) return `Passwords need at least ${MIN_PASSWORD} characters.`;
  if (code.includes('invalid-email')) return 'That email address doesn\'t look right.';
  if (code.includes('too-many-requests')) return 'Too many tries. Wait a minute and try again.';
  if (code.includes('operation-not-allowed')) return 'Password accounts are turned off. Enable Email/Password in Firebase → Authentication → Sign-in method.';
  if (code.includes('network-request-failed')) return 'No connection. Check your internet and try again.';
  if (/permission.denied/i.test(code + ' ' + (e?.message || ''))) return 'The database refused to save your account. Publish the latest database rules in Firebase (Realtime Database → Rules).';
  return e?.message || String(e);
}
export const validHandle = (h) => HANDLE_RE.test(h || '');

// Turn any name into a handle suggestion (letters, digits, _ . -; 2 to 14 long).
export function suggestHandle(name) {
  const h = String(name || '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 14);
  return h.length >= 2 ? h : 'hacker' + Math.floor(100 + Math.random() * 900);
}

// Which progress to use after signing in. The first sign-in brings this
// device's progress into the account; after that the account wins.
export function mergeProgress(local, remote) {
  if (!remote || !Number.isFinite(remote.xp)) return { progress: local, upload: true };
  return {
    progress: { ...local, xp: remote.xp, rounds: remote.rounds || 0, wins: Math.min(remote.wins || 0, remote.rounds || 0), title: remote.title || local.title || '' },
    upload: false,
  };
}

let net = null;
// Resolves once the online connection is ready (or has failed), so a click on
// "Log in" in the first seconds waits instead of failing.
let markReady;
const netReady = new Promise((r) => { markReady = r; });
async function waitForNet(ms = 12000) {
  if (!net) await Promise.race([netReady, new Promise((r) => setTimeout(r, ms))]);
  if (!net) throw new Error('Online play is not available right now. Check your internet and try again.');
}
let current = { configured: onlineConfigured(), available: false, connecting: onlineConfigured(), user: null, handle: null };
const listeners = new Set();
const emit = () => listeners.forEach((cb) => cb(current));

export const accountState = () => current;

export async function initAccount(onChange) {
  if (onChange) listeners.add(onChange);
  emit();
  if (!onlineConfigured()) return markReady();
  const res = await getOnlineNet();
  if (!res.net?.account) {
    current = { ...current, connecting: false };
    markReady();
    return emit();
  }
  net = res.net;
  markReady();
  current = { ...current, available: true, connecting: false };
  emit();
  net.account.onUser(async (user) => {
    if (signingUp) return; // createAccount() finishes setting things up
    if (!user) {
      current = { configured: true, available: true, user: null, handle: null };
      return emit();
    }
    try {
      const remote = await net.account.loadProfile();
      const { progress, upload } = mergeProgress(getProgress(), remote);
      saveProgress(progress);
      // Your private-messages setting follows your account.
      if (typeof remote?.dm === 'boolean') save('ra-dm-on', remote.dm);
      // Trophies: keep everything earned here or on any other device.
      const trophies = mergeTrophies(getTrophyState(), remote?.trophies);
      saveTrophyState(trophies);
      net.account.saveProfile({ trophies }).catch(() => {});
      if (upload) await net.account.saveProfile({ xp: progress.xp, rounds: progress.rounds, wins: Math.min(progress.wins, progress.rounds), title: progress.title || '' });
      const owner = await linkAndRole();
      current = { configured: true, available: true, user, handle: remote?.handle || null, provider: net.account.provider(), noEmail: String(user.email || '').endsWith('@' + LOGIN_DOMAIN), owner };
    } catch (e) {
      console.warn('account: could not load profile:', e.message);
      const denied = /permission/i.test(e.message);
      current = { configured: true, available: true, user, handle: null,
        error: denied ? 'Signed in, but the database refused to save your profile. Publish the latest database rules in Firebase (Realtime Database → Rules).' : `Signed in, but your profile didn't load: ${e.message}` };
    }
    emit();
  });
}

export async function signIn() {
  await waitForNet();
  await net.account.signIn();
}

let signingUp = false;

// Create a username/password account. Email is optional: with one you can
// reset a forgotten password; without one, your username is your login.
export async function createAccount({ username, password, email }) {
  await waitForNet();
  username = String(username || '').trim();
  email = String(email || '').trim();
  if (!validHandle(username)) throw new Error('Usernames are 2-14 letters, digits, _ . or -');
  if (String(password || '').length < MIN_PASSWORD) throw new Error(`Passwords need at least ${MIN_PASSWORD} characters.`);
  if (email && !isEmail(email)) throw new Error('That email address doesn\'t look right.');
  if (await net.account.handleTaken(username)) throw new Error(`"${username}" is taken. Try another.`);
  signingUp = true;
  try {
    try {
      await net.account.signUp(email || loginEmailFor(username), password, { verify: !!email });
    } catch (e) {
      if (!email && String(e.code).includes('email-already-in-use')) throw new Error(`"${username}" is taken. Try another.`);
      throw new Error(authMessage(e));
    }
    try {
      await net.account.claimHandle(username, null);
    } catch (e) {
      await net.account.deleteMe().catch(() => {});
      throw new Error(/taken/.test(e.message) ? e.message : authMessage(e));
    }
    const { progress } = mergeProgress(getProgress(), null);
    await net.account.saveProfile({ xp: progress.xp, rounds: progress.rounds, wins: Math.min(progress.wins, progress.rounds), title: progress.title || '' });
    current = { configured: true, available: true, user: { email }, handle: username, provider: 'password', noEmail: !email, owner: await linkAndRole() };
  } finally {
    signingUp = false;
  }
  emit();
}

export async function logIn(id, password) {
  await waitForNet();
  try {
    await net.account.logIn(loginAddress(id), password);
  } catch (e) {
    throw new Error(loginFailMessage(e, id));
  }
}

// Usernames only log in accounts made without an email. Accounts made with an
// email log in with that email, so say so instead of just "wrong password".
export function loginFailMessage(e, id) {
  const code = e?.code || '';
  const wrong = code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found') || code.includes('invalid-login');
  if (!wrong) return authMessage(e);
  const usedUsername = !String(id || '').includes('@');
  return usedUsername
    ? 'That username and password don\'t match. If you signed up with an email, log in with your email address instead. Passwords are case-sensitive, so check Caps Lock (Alt + Search on a Chromebook).'
    : 'That email and password don\'t match. Passwords are case-sensitive, so check Caps Lock (Alt + Search on a Chromebook).';
}

export async function resetPassword(email) {
  if (!isEmail(email)) throw new Error('Enter the email you signed up with.');
  if (email.toLowerCase().endsWith('@' + LOGIN_DOMAIN)) throw new Error('Accounts without email can\'t reset their password.');
  try {
    await net.account.resetPassword(email.trim());
  } catch (e) {
    throw new Error(authMessage(e));
  }
}

export async function signOut() {
  await net?.account.unlinkTab?.();
  await net?.account.signOut();
}

// Link this tab to the account (so the rules trust it), then read the
// account's role. Only an account marked "owner" in the Firebase console
// (roles/<account id> = "owner") gets the owner tools.
async function linkAndRole() {
  try {
    await net.account.linkTab();
  } catch (e) {
    console.warn('account: could not link this tab:', e.message);
  }
  try {
    return (await net.account.role()) === 'owner';
  } catch {
    return false;
  }
}

// The account's id, shown so the owner can copy it into the Firebase console.
export const accountId = () => net?.accountUid?.() || null;

// Delete my account: frees the name, removes my leaderboard rows and saved
// profile, then deletes the login itself. Firebase asks you to confirm who
// you are first (your password, or the Google window).
export async function deleteAccount(password) {
  if (!net || !current.user) throw new Error('You are not signed in.');
  try {
    await net.account.reauth(password);
  } catch (e) {
    throw new Error(authMessage(e));
  }
  const today = new Date().toISOString().slice(0, 10);
  await net.account.deleteData(current.handle, today);
  await net.account.deleteMe();
  current = { configured: true, available: true, user: null, handle: null };
  emit();
}

export async function setHandle(handle) {
  if (!validHandle(handle)) throw new Error('Handles are 2-14 letters, digits, _ . or -');
  await net.account.claimHandle(handle, current.handle);
  current = { ...current, handle };
  emit();
}

// Save progress to the account after a round (does nothing for guests).
export async function syncProgress(extra = {}) {
  if (!net || !current.user || !current.handle) return;
  const p = getProgress();
  try {
    await net.account.saveProfile({ xp: p.xp, rounds: p.rounds, wins: Math.min(p.wins, p.rounds), title: p.title || '', trophies: getTrophyState(), ...extra });
  } catch (e) {
    console.warn('account: could not save progress:', e.message);
  }
}
