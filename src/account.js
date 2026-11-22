// Google accounts: sign in to keep your progress across devices and to get on
// the online leaderboards. Guests can still play everything.

import { getOnlineNet, onlineConfigured } from './net/index.js';
import { getProgress, saveProgress } from './progress.js';

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
let current = { available: false, user: null, handle: null };
const listeners = new Set();
const emit = () => listeners.forEach((cb) => cb(current));

export const accountState = () => current;

export async function initAccount(onChange) {
  if (onChange) listeners.add(onChange);
  if (!onlineConfigured()) return emit();
  const res = await getOnlineNet();
  if (!res.net?.account) return emit();
  net = res.net;
  current = { ...current, available: true };
  emit();
  net.account.onUser(async (user) => {
    if (signingUp) return; // createAccount() finishes setting things up
    if (!user) {
      current = { available: true, user: null, handle: null };
      return emit();
    }
    try {
      const remote = await net.account.loadProfile();
      const { progress, upload } = mergeProgress(getProgress(), remote);
      saveProgress(progress);
      if (upload) await net.account.saveProfile({ xp: progress.xp, rounds: progress.rounds, wins: Math.min(progress.wins, progress.rounds), title: progress.title || '' });
      current = { available: true, user, handle: remote?.handle || null, provider: net.account.provider(), noEmail: String(user.email || '').endsWith('@' + LOGIN_DOMAIN) };
    } catch (e) {
      console.warn('account: could not load profile:', e.message);
      current = { available: true, user, handle: null, error: e.message };
    }
    emit();
  });
}

export async function signIn() {
  if (!net) throw new Error('Online play is not available right now.');
  await net.account.signIn();
}

let signingUp = false;

// Create a username/password account. Email is optional: with one you can
// reset a forgotten password; without one, your username is your login.
export async function createAccount({ username, password, email }) {
  if (!net) throw new Error('Online play is not available right now.');
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
      throw e;
    }
    const { progress } = mergeProgress(getProgress(), null);
    await net.account.saveProfile({ xp: progress.xp, rounds: progress.rounds, wins: Math.min(progress.wins, progress.rounds), title: progress.title || '' });
    current = { available: true, user: { email }, handle: username, provider: 'password', noEmail: !email };
  } finally {
    signingUp = false;
  }
  emit();
}

export async function logIn(id, password) {
  if (!net) throw new Error('Online play is not available right now.');
  try {
    await net.account.logIn(loginAddress(id), password);
  } catch (e) {
    throw new Error(authMessage(e));
  }
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
  await net?.account.signOut();
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
    await net.account.saveProfile({ xp: p.xp, rounds: p.rounds, wins: Math.min(p.wins, p.rounds), title: p.title || '', ...extra });
  } catch (e) {
    console.warn('account: could not save progress:', e.message);
  }
}
