// Google accounts: sign in to keep your progress across devices and to get on
// the online leaderboards. Guests can still play everything.

import { getOnlineNet, onlineConfigured } from './net/index.js';
import { getProgress, saveProgress } from './progress.js';

export const HANDLE_RE = /^[A-Za-z0-9_.-]{2,14}$/;
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
    if (!user) {
      current = { available: true, user: null, handle: null };
      return emit();
    }
    try {
      const remote = await net.account.loadProfile();
      const { progress, upload } = mergeProgress(getProgress(), remote);
      saveProgress(progress);
      if (upload) await net.account.saveProfile({ xp: progress.xp, rounds: progress.rounds, wins: Math.min(progress.wins, progress.rounds), title: progress.title || '' });
      current = { available: true, user, handle: remote?.handle || null };
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
