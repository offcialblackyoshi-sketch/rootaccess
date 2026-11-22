// GLOBAL LEADERBOARD: everyone's all-time stats (XP, level, rounds, wins).
// Online through Firebase when it's set up; otherwise just this device.

import { getOnlineNet, onlineConfigured } from './net/index.js';
import { getProgress, levelFor, currentTitle, specialTitle } from './progress.js';
import { load } from './util.js';
import { trophyCount } from './trophies.js';

export const BOARD_SIZE = 50;

// The row this device shows on the board. `profile` is your current { name, color }.
export function myStats(progress = getProgress(), profile = {}) {
  return {
    name: profile.name || load('ra-name', 'anon'),
    color: profile.color || load('ra-color', '#33ff66'),
    level: levelFor(progress.xp).level,
    // Board rows always belong to an account, so a special title can show here.
    title: specialTitle(profile.name) || currentTitle(progress),
    xp: progress.xp,
    rounds: progress.rounds,
    wins: Math.min(progress.wins, progress.rounds),
    trophies: trophyCount(),
  };
}

export const winRate = (s) => (s.rounds ? Math.round((100 * s.wins) / s.rounds) : 0);

async function onlineNet() {
  if (!onlineConfigured()) return null;
  const { net } = await getOnlineNet();
  return net?.submitStats ? net : null;
}

// Sends your stats to the board (only when signed in with Google).
export async function pushMyStats(profile) {
  try {
    const net = await onlineNet();
    if (net?.accountUid?.()) await net.submitStats(myStats(getProgress(), profile));
  } catch (e) {
    console.warn('leaderboard: could not save stats:', e.message);
  }
}

// { where: 'online' | 'local', rows: [...best first], me: id of your row }
export async function globalBoard(profile) {
  try {
    const net = await onlineNet();
    if (net) {
      if (net.accountUid?.()) await net.submitStats(myStats(getProgress(), profile)).catch(() => {});
      const { rows, me } = await net.statsBoard(BOARD_SIZE);
      return { where: 'online', rows, me, signedIn: !!me };
    }
  } catch (e) {
    console.warn('leaderboard: showing this device only:', e.message);
  }
  return { where: 'local', rows: [{ id: 'me', ...myStats(getProgress(), profile) }], me: 'me' };
}
