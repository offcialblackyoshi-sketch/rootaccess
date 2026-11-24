// TROPHIES: 50+ permanent trophies, plus a brand-new weekly trophy every
// Monday (UTC). Saved on this device, and in your account when signed in.

import { load, save } from './util.js';
import { hashString } from './rng.js';

const KEY = 'ra-trophies';
const QUICK = ['gauntlet', 'letterlock', 'printmatch', 'signaltune', 'circuit', 'memory', 'wirecut', 'portsweep', 'bitflip'];
const MODE_NAMES = {
  race: 'Terminal Race', duel: 'Typing Duel', defend: 'Hack & Defend', heist: 'Co-op Heist', gauntlet: 'Hack Gauntlet',
  letterlock: 'Letter Lock', printmatch: 'Print Match', signaltune: 'Signal Tune', circuit: 'Circuit Path',
  memory: 'Code Memory', wirecut: 'Wire Cut', portsweep: 'Port Sweep', bitflip: 'Bit Flip',
};

// ---------------------------------------------------------------------------
// The permanent trophies. `test(c, ev, level)`: c = lifetime counters,
// ev = the round just played, level = your level after it.
// ---------------------------------------------------------------------------
const t = (id, cat, icon, name, desc, test) => ({ id, cat, icon, name, desc, test });
const count = (n, field, cat, icon, name, desc) => t(`${field.toLowerCase()}-${n}`, cat, icon, name, desc, (c) => (c[field] || 0) >= n);

export const TROPHIES = [
  // Getting started
  count(1, 'rounds', 'Getting started', '🎮', 'Logged On', 'Play your first round.'),
  count(10, 'rounds', 'Getting started', '💾', 'Regular', 'Play 10 rounds.'),
  count(50, 'rounds', 'Getting started', '🖥️', 'Always Online', 'Play 50 rounds.'),
  count(100, 'rounds', 'Getting started', '🛰️', 'Mainframe', 'Play 100 rounds.'),
  count(250, 'rounds', 'Getting started', '🌐', 'The Network Is You', 'Play 250 rounds.'),
  t('tutorial', 'Getting started', '📘', 'Read the Manual', 'Finish the tutorial.', (c, ev) => ev.mode === 'tutorial' || (c.modePlays?.tutorial || 0) > 0),
  // Winning
  count(1, 'wins', 'Winning', '🥇', 'First Blood', 'Win a round.'),
  count(5, 'wins', 'Winning', '🏅', 'On a Roll', 'Win 5 rounds.'),
  count(25, 'wins', 'Winning', '🏆', 'Elite', 'Win 25 rounds.'),
  count(100, 'wins', 'Winning', '👾', 'Legendary', 'Win 100 rounds.'),
  count(3, 'bestStreak', 'Winning', '🔥', 'Hot Streak', 'Win 3 rounds in a row.'),
  count(5, 'bestStreak', 'Winning', '☄️', 'Unstoppable', 'Win 5 rounds in a row.'),
  t('beat-hard', 'Winning', '🤖', 'Bot Slayer', 'Win against hard bots.', (c) => (c.hardWins || 0) > 0),
  t('big-win', 'Winning', '👑', 'King of the Hill', 'Win a round with 4 or more players.', (c) => (c.bigWins || 0) > 0),
  // Levels
  ...[3, 5, 8, 12, 16, 20].map((l, i) => t(`level-${l}`, 'Levels', ['⭐', '🌟', '✨', '💫', '🌠', '🪐'][i], `Level ${l}`, `Reach level ${l}.`, (c, ev, level) => level >= l)),
  // Every mode
  ...Object.entries(MODE_NAMES).map(([id, name]) => t(`win-${id}`, 'Every mode', '✔️', `${name} Champ`, `Win a round of ${name}.`, (c) => (c.modeWins?.[id] || 0) > 0)),
  // Quick hacks
  count(1, 'quickClears', 'Quick hacks', '⚡', 'Quick Fingers', 'Clear all 5 stages of a quick hack.'),
  count(10, 'quickClears', 'Quick hacks', '⚙️', 'Script Runner', 'Clear 10 quick hacks.'),
  count(50, 'quickClears', 'Quick hacks', '🧠', 'Automation', 'Clear 50 quick hacks.'),
  count(1, 'flawless', 'Quick hacks', '💎', 'Flawless', 'Clear a quick hack with no mistakes.'),
  t('speedrun', 'Quick hacks', '⏱️', 'Speedrunner', 'Clear a quick hack in under 60 seconds.', (c) => (c.fastClears || 0) > 0),
  // Daily Challenge
  count(1, 'dailyRuns', 'Daily Challenge', '📅', 'Daily Driver', 'Finish a Daily Challenge.'),
  count(7, 'dailyRuns', 'Daily Challenge', '🗓️', 'Week of Hacks', 'Finish 7 Daily Challenges.'),
  t('daily-fast', 'Daily Challenge', '🚀', 'Sub-Minute', 'Score under 60 seconds in a Daily Challenge.', (c) => (c.dailyFast || 0) > 0),
  t('daily-flawless', 'Daily Challenge', '🎯', 'Perfect Day', 'Finish a Daily Challenge with no mistakes.', (c) => (c.dailyFlawless || 0) > 0),
  // Teams
  count(1, 'teamWins', 'Teams', '🤝', 'Squad Up', 'Win a team duel.'),
  t('team-1v1', 'Teams', '⚔️', 'Mano a Mano', 'Win a 1v1 duel.', (c) => (c.oneVsOne || 0) > 0),
  t('team-4v4', 'Teams', '🛡️', 'Full Squad', 'Win a 4v4 duel.', (c) => (c.fourVsFour || 0) > 0),
  // Social
  count(1, 'onlineRounds', 'Social', '📡', 'Connected', 'Play a round in an online room.'),
  count(1, 'crowdRounds', 'Social', '🎉', 'LAN Party', 'Play a round with 4 or more people (not bots).'),
  count(1, 'hostRounds', 'Social', '🧑‍💻', 'Sysadmin', 'Host a room that plays a round.'),
  t('account', 'Social', '🔐', 'Registered User', 'Sign in or create an account.', (c) => !!c.account),
  // Habits
  count(3, 'daysCount', 'Habits', '📆', 'Coming Back', 'Play on 3 different days.'),
  count(7, 'daysCount', 'Habits', '📈', 'Dedicated', 'Play on 7 different days.'),
  count(30, 'daysCount', 'Habits', '🏛️', 'Veteran', 'Play on 30 different days.'),
  t('night-owl', 'Habits', '🦉', 'Night Owl', 'Play a round after 10 pm.', (c) => !!c.nightOwl),
  t('early-bird', 'Habits', '🐦', 'Early Bird', 'Play a round before 7 am.', (c) => !!c.earlyBird),
  t('weekend', 'Habits', '🛋️', 'Weekend Warrior', 'Play a round on a weekend.', (c) => !!c.weekend),
];

// ---------------------------------------------------------------------------
// Tiers: how special a trophy looks (bronze → silver → gold; weekly is its own).
// Anything not listed is bronze.
// ---------------------------------------------------------------------------
export const TIERS = ['bronze', 'silver', 'gold', 'weekly'];
const SILVER = ['rounds-50', 'wins-5', 'wins-25', 'beststreak-3', 'beat-hard', 'level-3', 'level-5', 'level-8',
  'quickclears-10', 'flawless-1', 'dailyruns-7', 'daily-flawless', 'teamwins-1', 'team-1v1', 'crowdrounds-1', 'hostrounds-1', 'dayscount-7'];
const GOLD = ['rounds-100', 'rounds-250', 'wins-100', 'beststreak-5', 'big-win', 'level-12', 'level-16', 'level-20',
  'quickclears-50', 'speedrun', 'daily-fast', 'team-4v4', 'dayscount-30'];
export function tierOf(trophy) {
  if (!trophy) return 'bronze';
  if (trophy.week || String(trophy.id).startsWith('weekly-')) return 'weekly';
  if (GOLD.includes(trophy.id)) return 'gold';
  if (SILVER.includes(trophy.id)) return 'silver';
  return 'bronze';
}
export const TIER_LABEL = { bronze: '🥉 BRONZE', silver: '🥈 SILVER', gold: '🥇 GOLD', weekly: '🗓️ WEEKLY' };

// ---------------------------------------------------------------------------
// Weekly trophies: one new challenge each week (Monday 00:00 UTC).
// ---------------------------------------------------------------------------
export function weekKey(d = new Date()) {
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = day.getUTCDay() || 7; // Mon=1 … Sun=7
  day.setUTCDate(day.getUTCDate() + 4 - dow); // Thursday decides the ISO year
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((day - yearStart) / 86400000 + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// When this week's trophy goes away (next Monday, UTC).
export function weekEndsAt(d = new Date()) {
  const dow = d.getUTCDay() || 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + (8 - dow));
}

const WEEKLY = [
  { id: 'wins', icon: '🏆', name: 'Winning Week', desc: 'Win 3 rounds this week.', target: 3, match: (ev) => ev.won },
  { id: 'play', icon: '🎮', name: 'Busy Week', desc: 'Play 10 rounds this week.', target: 10, match: () => true },
  { id: 'quick', icon: '⚡', name: 'Quick Week', desc: 'Clear 5 quick hacks this week.', target: 5, match: (ev) => ev.clear },
  { id: 'flawless', icon: '💎', name: 'Clean Week', desc: 'Clear a quick hack with no mistakes this week.', target: 1, match: (ev) => ev.clear && ev.mistakes === 0 },
  { id: 'daily', icon: '📅', name: 'Daily Week', desc: 'Finish the Daily Challenge twice this week.', target: 2, match: (ev) => ev.daily && ev.clear },
  { id: 'duel', icon: '⌨️', name: 'Duelist Week', desc: 'Win a Typing Duel this week.', target: 1, match: (ev) => ev.mode === 'duel' && ev.won },
  { id: 'race', icon: '🏁', name: 'Racer Week', desc: 'Win a Terminal Race this week.', target: 1, match: (ev) => ev.mode === 'race' && ev.won },
  { id: 'gauntlet', icon: '🗡️', name: 'Gauntlet Week', desc: 'Clear the Hack Gauntlet this week.', target: 1, match: (ev) => ev.mode === 'gauntlet' && ev.clear },
  { id: 'team', icon: '🤝', name: 'Team Week', desc: 'Win a team duel this week.', target: 1, match: (ev) => ev.teamSize > 0 && ev.won },
  { id: 'online', icon: '📡', name: 'Online Week', desc: 'Play 3 rounds in online rooms this week.', target: 3, match: (ev) => ev.online },
  { id: 'hard', icon: '🤖', name: 'Hard Mode Week', desc: 'Beat hard bots this week.', target: 1, match: (ev) => ev.botLevel === 'hard' && ev.won },
  { id: 'mode', icon: '🎯', name: 'Specialist Week', target: 1 }, // a specific quick hack, chosen per week
];

// This week's trophy: the same for everyone, different most weeks.
export function weeklyFor(week = weekKey()) {
  const h = hashString('week:' + week);
  const tpl = WEEKLY[h % WEEKLY.length];
  const base = { ...tpl, id: `weekly-${week}`, week, kind: tpl.id };
  if (tpl.id !== 'mode') return base;
  const mode = QUICK.slice(1)[Math.floor(h / WEEKLY.length) % (QUICK.length - 1)];
  return { ...base, name: `${MODE_NAMES[mode]} Week`, desc: `Win a round of ${MODE_NAMES[mode]} this week.`, match: (ev) => ev.mode === mode && ev.won };
}

// ---------------------------------------------------------------------------
// State: { unlocked: { id: time }, c: counters, w: { week, n } }
// ---------------------------------------------------------------------------
export function emptyState() {
  return { unlocked: {}, c: {}, w: { week: '', n: 0 } };
}

export function getTrophyState() {
  const s = load(KEY, null);
  if (!s || typeof s !== 'object') return emptyState();
  return { unlocked: s.unlocked || {}, c: s.c || {}, w: s.w || { week: '', n: 0 } };
}

export const saveTrophyState = (s) => save(KEY, s);

// Describe the round just played as an "event" for the trophy rules.
export function roundEvent({ room, mine, won, now = new Date() }) {
  const raw = mine?.raw || {};
  const humans = Object.values(room.players || {}).filter((p) => !p.bot).length;
  const clear = (raw.stage || 0) >= 5;
  return {
    mode: room.mode,
    won: !!won,
    players: (room.results || []).length || Object.keys(room.players || {}).length,
    humans,
    host: !!mine && room.hostId === mine.id,
    online: !room.practice,
    daily: !!room.daily,
    botLevel: Object.values(room.players || {}).some((p) => p.bot) ? room.botLevel || 'normal' : null,
    teamSize: room.mode === 'duel' ? room.teamSize || 0 : 0,
    clear,
    mistakes: raw.mistakes || 0,
    ms: raw.ms ?? null,
    hour: now.getHours(),
    day: now.getDay(),
    date: now.toISOString().slice(0, 10),
    week: weekKey(now),
  };
}

// Pure: apply one round to the state. Returns { state, unlocked: [trophy, ...] }.
export function applyRound(state, ev, level, at = Date.now()) {
  const s = { unlocked: { ...state.unlocked }, c: { ...state.c, modePlays: { ...state.c.modePlays }, modeWins: { ...state.c.modeWins } }, w: { ...state.w } };
  const c = s.c;
  const add = (k, n = 1) => { c[k] = (c[k] || 0) + n; };
  add('rounds');
  c.modePlays[ev.mode] = (c.modePlays[ev.mode] || 0) + 1;
  if (ev.won) {
    add('wins');
    c.modeWins[ev.mode] = (c.modeWins[ev.mode] || 0) + 1;
    c.streak = (c.streak || 0) + 1;
    if (ev.botLevel === 'hard') add('hardWins');
    if (ev.players >= 4) add('bigWins');
    if (ev.teamSize > 0) add('teamWins');
    if (ev.teamSize === 1) add('oneVsOne');
    if (ev.teamSize === 4) add('fourVsFour');
  } else c.streak = 0;
  c.bestStreak = Math.max(c.bestStreak || 0, c.streak || 0);
  if (ev.clear) {
    add('quickClears');
    if (ev.mistakes === 0) add('flawless');
    if (ev.ms !== null && ev.ms < 60000) add('fastClears');
    if (ev.daily) {
      add('dailyRuns');
      if (ev.ms + ev.mistakes * 5000 < 60000) add('dailyFast');
      if (ev.mistakes === 0) add('dailyFlawless');
    }
  }
  if (ev.online) add('onlineRounds');
  if (ev.humans >= 4) add('crowdRounds');
  if (ev.host && ev.online) add('hostRounds');
  if (ev.hour >= 22) c.nightOwl = true;
  if (ev.hour < 7) c.earlyBird = true;
  if (ev.day === 0 || ev.day === 6) c.weekend = true;
  const days = new Set(c.days || []);
  days.add(ev.date);
  c.days = [...days].slice(-400);
  c.daysCount = days.size;

  const unlocked = [];
  for (const tr of TROPHIES) {
    if (!s.unlocked[tr.id] && tr.test(c, ev, level)) {
      s.unlocked[tr.id] = at;
      unlocked.push(tr);
    }
  }
  // This week's trophy.
  const wk = weeklyFor(ev.week);
  if (s.w.week !== ev.week) s.w = { week: ev.week, n: 0 };
  if (!s.unlocked[wk.id] && wk.match(ev)) {
    s.w.n++;
    if (s.w.n >= wk.target) {
      s.unlocked[wk.id] = at;
      unlocked.push(wk);
    }
  }
  return { state: s, unlocked };
}

// Unlock a trophy that isn't tied to a round (like signing in).
export function markFlag(flag, level = 1) {
  const s = getTrophyState();
  if (s.c[flag]) return [];
  s.c = { ...s.c, [flag]: true };
  const unlocked = TROPHIES.filter((tr) => !s.unlocked[tr.id] && tr.test(s.c, {}, level));
  for (const tr of unlocked) s.unlocked[tr.id] = Date.now();
  saveTrophyState(s);
  return unlocked;
}

// Combine this device's trophies with an account's (keep everything earned).
export function mergeTrophies(a, b) {
  if (!b) return a;
  const unlocked = { ...(b.unlocked || {}), ...(a.unlocked || {}) };
  const c = { ...(b.c || {}) };
  for (const [k, v] of Object.entries(a.c || {})) {
    if (typeof v === 'number') c[k] = Math.max(v, c[k] || 0);
    else if (typeof v === 'boolean') c[k] = v || !!c[k];
    else if (k === 'days') c.days = [...new Set([...(c.days || []), ...v])].slice(-400);
    else if (v && typeof v === 'object') {
      c[k] = { ...(c[k] || {}) };
      for (const [m, n] of Object.entries(v)) c[k][m] = Math.max(n, c[k][m] || 0);
    }
  }
  if (c.days) c.daysCount = c.days.length;
  const w = (a.w?.week || '') >= (b.w?.week || '') ? a.w : b.w;
  return { unlocked, c, w: w || { week: '', n: 0 } };
}

// Name and icon for any trophy id, including past weekly ones.
export function trophyInfo(id) {
  const tr = TROPHIES.find((x) => x.id === id);
  if (tr) return tr;
  if (id.startsWith('weekly-')) return weeklyFor(id.slice(7));
  return null;
}

export const trophyCount = (s = getTrophyState()) => Object.keys(s.unlocked).length;
