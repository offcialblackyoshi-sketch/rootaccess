// XP, levels, titles and unlocks. Saved in this browser only.

import { load, save } from './util.js';

const KEY = 'ra-progress';

// Titles you can pick once you reach their level.
export const TITLES = [
  [1, 'script kiddie'],
  [3, 'packet pusher'],
  [5, 'shell jockey'],
  [8, 'firewall breaker'],
  [12, 'root whisperer'],
  [16, 'ghost in the wire'],
  [20, 'zero-day legend'],
];

// Extra name colors, unlocked by level.
export const UNLOCK_COLORS = [
  [3, '#ffd23d'],
  [6, '#ff8a00'],
  [9, '#00ffd5'],
  [12, '#ff2e63'],
];

export function getProgress() {
  const p = load(KEY, null);
  return {
    xp: Number.isFinite(p?.xp) && p.xp >= 0 ? p.xp : 0,
    rounds: p?.rounds || 0,
    wins: p?.wins || 0,
    title: typeof p?.title === 'string' ? p.title : '',
  };
}

export function saveProgress(p) {
  save(KEY, p);
}

// XP needed to go from level L to L+1: 100, 150, 200, ...
export const levelCost = (level) => 100 + (level - 1) * 50;

// { level, into: XP into this level, need: XP this level costs }
export function levelFor(xp) {
  let level = 1;
  let left = Math.max(0, Math.floor(xp));
  while (left >= levelCost(level)) {
    left -= levelCost(level);
    level++;
  }
  return { level, into: left, need: levelCost(level) };
}

// XP for one round: 20 for playing, more for placing high against more
// players, and a bonus for winning. The tutorial is a flat 50.
export function xpForRound({ place, players, won, modeId }) {
  if (modeId === 'tutorial') return 50;
  const n = Math.max(1, players || 1);
  const p = Math.min(Math.max(1, place || n), n);
  return 20 + (n - p) * 10 + (won ? 25 : 0);
}

export function titlesFor(level) {
  return TITLES.filter(([l]) => l <= level).map(([, t]) => t);
}

// Special titles for specific accounts (lowercase username → title). They only
// apply when signed in as that account, so a guest can't borrow one.
export const SPECIAL_TITLES = { brisky2swifty: '★ creator' };
export const specialTitle = (name) => SPECIAL_TITLES[String(name || '').toLowerCase()] || null;

// The title shown next to your name: your pick if unlocked, else the best one.
export function currentTitle(progress = getProgress()) {
  const unlocked = titlesFor(levelFor(progress.xp).level);
  return unlocked.includes(progress.title) ? progress.title : unlocked[unlocked.length - 1];
}

// Adds a round's XP. Returns what changed, for the results screen.
export function awardRound(result) {
  const p = getProgress();
  const before = levelFor(p.xp);
  const gained = xpForRound(result);
  p.xp += gained;
  p.rounds++;
  if (result.won) p.wins++;
  saveProgress(p);
  const after = levelFor(p.xp);
  return { gained, before, after, levelUp: after.level > before.level, xp: p.xp };
}
