// DAILY CHALLENGE: the same Hack Gauntlet for everyone each day (UTC), with a
// best-time board. Online when Firebase is set up, otherwise on this device.

import { getLocalNet, getOnlineNet, onlineConfigured } from './net/index.js';
import { hashString } from './rng.js';
import { load, save } from './util.js';

export const PENALTY_MS = 5000; // each mistake adds 5 seconds
export const BOARD_SIZE = 20;

export const todayKey = (d = new Date()) => d.toISOString().slice(0, 10);
export const dailySeed = (date) => hashString('daily:' + date) % 2 ** 31;
export const dailyScore = ({ ms, mistakes }) => Math.round(ms) + (mistakes || 0) * PENALTY_MS;

const localKey = (date) => 'ra-daily-' + date;

// This device's best score for a day (or null).
export function myBest(date) {
  return load(localKey(date) + '-best', null);
}

function saveLocal(date, id, entry) {
  const board = load(localKey(date), {});
  if (!board[id] || entry.score < board[id].score) board[id] = entry;
  save(localKey(date), board);
  const best = myBest(date);
  if (best === null || entry.score < best) save(localKey(date) + '-best', entry.score);
}

function sortBoard(entries) {
  return entries.filter((e) => Number.isFinite(e?.score)).sort((a, b) => a.score - b.score).slice(0, BOARD_SIZE);
}

async function onlineNet() {
  if (!onlineConfigured()) return null;
  const { net } = await getOnlineNet();
  return net?.submitDaily ? net : null;
}

// Saves a finished run. Returns where it was saved: 'online' or 'local'.
export async function submitDaily(date, { name, ms, mistakes }) {
  const entry = { name, ms: Math.round(ms), mistakes: mistakes || 0, score: dailyScore({ ms, mistakes }) };
  saveLocal(date, getLocalNet().uid, { ...entry, id: getLocalNet().uid, at: Date.now() });
  try {
    const net = await onlineNet();
    if (net) {
      await net.submitDaily(date, entry);
      return { where: 'online', entry };
    }
  } catch (e) {
    console.warn('daily board: saved on this device only:', e.message);
  }
  return { where: 'local', entry };
}

// Today's top scores: [{ id, name, score, ms, mistakes }], best first.
export async function dailyBoard(date) {
  try {
    const net = await onlineNet();
    if (net) return { where: 'online', rows: sortBoard(await net.dailyBoard(date, BOARD_SIZE)), me: net.uid };
  } catch (e) {
    console.warn('daily board: showing this device only:', e.message);
  }
  const board = load(localKey(date), {});
  return { where: 'local', rows: sortBoard(Object.entries(board).map(([id, e]) => ({ ...e, id }))), me: getLocalNet().uid };
}
