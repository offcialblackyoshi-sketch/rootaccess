// TROPHIES: 50+ permanent trophies, plus a brand-new weekly trophy every
// Monday (UTC). Saved on this device, and in your account when signed in.

import { load, save } from './util.js';
import { hashString } from './rng.js';

const KEY = 'ra-trophies';
const QUICK = ['gauntlet', 'letterlock', 'printmatch', 'signaltune', 'circuit', 'memory', 'wirecut', 'portsweep', 'bitflip'];
const MODE_NAMES = {
  race: 'Terminal Race', duel: 'Typing Duel', defend: 'Hack & Defend', heist: 'Co-op Heist', koth: 'King of the Hill', gauntlet: 'Hack Gauntlet',
  letterlock: 'Letter Lock', printmatch: 'Print Match', signaltune: 'Signal Tune', circuit: 'Circuit Path',
  memory: 'Code Memory', wirecut: 'Wire Cut', portsweep: 'Port Sweep', bitflip: 'Bit Flip',
};

// ---------------------------------------------------------------------------
// The permanent trophies. `test(c, ev, level)`: c = lifetime counters,
// ev = the round just played, level = your level after it.
// ---------------------------------------------------------------------------
const t = (id, cat, icon, name, desc, test, secret = false) => ({ id, cat, icon, name, desc, test, secret });
// Secret trophies show as "???" until you earn them.
const secret = (id, icon, name, desc, test) => t(id, 'Secret', icon, name, desc, test, true);
const count = (n, field, cat, icon, name, desc) => ({ ...t(`${field.toLowerCase()}-${n}`, cat, icon, name, desc, (c) => (c[field] || 0) >= n), goal: (c) => [c[field] || 0, n] });
// A trophy with a progress bar: goal(counters, level) -> [have, need].
const withGoal = (tr, goal) => ({ ...tr, goal });

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
  ...[3, 5, 8, 12, 16, 20].map((l, i) => withGoal(t(`level-${l}`, 'Levels', ['⭐', '🌟', '✨', '💫', '🌠', '🪐'][i], `Level ${l}`, `Reach level ${l}.`, (c, ev, level) => level >= l), (c, level) => [level, l])),
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

  // ---- More milestones ----
  count(500, 'rounds', 'Getting started', '🧬', 'Kernel Panic', 'Play 500 rounds.'),
  count(1000, 'rounds', 'Getting started', '♾️', 'Infinite Loop', 'Play 1,000 rounds.'),
  count(50, 'wins', 'Winning', '🎖️', 'Decorated', 'Win 50 rounds.'),
  count(250, 'wins', 'Winning', '🗿', 'Untouchable', 'Win 250 rounds.'),
  count(10, 'bestStreak', 'Winning', '🌋', 'Meltdown', 'Win 10 rounds in a row.'),
  count(5, 'seconds', 'Winning', '🥈', 'So Close', 'Finish 2nd five times.'),
  t('underdog', 'Winning', '🐺', 'Underdog', 'Win against 3 or more hard bots at once.', (c) => (c.underdog || 0) > 0),
  ...[25, 30, 40, 50].map((l, i) => withGoal(t(`level-${l}`, 'Levels', ['🔱', '💠', '🌌', '🧿'][i], `Level ${l}`, `Reach level ${l}.`, (c, ev, level) => level >= l), (c, level) => [level, l])),

  // ---- Explorer: every mode ----
  withGoal(t('all-modes', 'Explorer', '🧭', 'Tourist', 'Play every mode at least once.', (c) => Object.keys(MODE_NAMES).every((m) => (c.modePlays?.[m] || 0) > 0)), (c) => [Object.keys(MODE_NAMES).filter((m) => (c.modePlays?.[m] || 0) > 0).length, Object.keys(MODE_NAMES).length]),
  withGoal(t('all-wins', 'Explorer', '🗺️', 'Jack of All Hacks', 'Win every mode at least once.', (c) => Object.keys(MODE_NAMES).every((m) => (c.modeWins?.[m] || 0) > 0)), (c) => [Object.keys(MODE_NAMES).filter((m) => (c.modeWins?.[m] || 0) > 0).length, Object.keys(MODE_NAMES).length]),
  ...Object.entries(MODE_NAMES).map(([id, name]) => withGoal(t(`play10-${id}`, 'Explorer', '🔁', `${name} Regular`, `Play 10 rounds of ${name}.`, (c) => (c.modePlays?.[id] || 0) >= 10), (c) => [c.modePlays?.[id] || 0, 10])),
  ...Object.entries(MODE_NAMES).map(([id, name]) => withGoal(t(`win10-${id}`, 'Explorer', '🏵️', `${name} Expert`, `Win 10 rounds of ${name}.`, (c) => (c.modeWins?.[id] || 0) >= 10), (c) => [c.modeWins?.[id] || 0, 10])),

  // ---- Skill: one group per classic mode ----
  t('race-nohint', 'Skill', '🧠', 'No Hints Needed', 'Win a Terminal Race without using a hint.', (c) => (c.raceNoHint || 0) > 0),
  t('race-3min', 'Skill', '🏎️', 'Speed Demon', 'Get root in a Terminal Race in under 3 minutes.', (c) => (c.race3 || 0) > 0),
  t('race-2min', 'Skill', '🚀', 'Zero-Day', 'Get root in a Terminal Race in under 2 minutes.', (c) => (c.race2 || 0) > 0),
  t('duel-60', 'Skill', '⌨️', 'Keyboard Warrior', 'Type at 60+ WPM in a Typing Duel.', (c) => (c.bestWpm || 0) >= 60),
  t('duel-90', 'Skill', '🎹', 'Machine Gun Keys', 'Type at 90+ WPM in a Typing Duel.', (c) => (c.bestWpm || 0) >= 90),
  t('duel-perfect', 'Skill', '🎯', 'Surgical', 'Land 10+ hits with no typos in one Typing Duel.', (c) => (c.duelPerfect || 0) > 0),
  t('duel-untouched', 'Skill', '🛡️', 'Untouched', 'Win a Typing Duel with your firewall at 100.', (c) => (c.duelUntouched || 0) > 0),
  t('defend-thief', 'Skill', '💰', 'Data Thief', 'Steal 300+ data in one round of Hack & Defend.', (c) => (c.bestLoot || 0) >= 300),
  t('defend-wall', 'Skill', '🧱', 'The Wall', 'Stop 5 attacks in one round of Hack & Defend.', (c) => (c.bestKills || 0) >= 5),
  t('defend-fortress', 'Skill', '🏰', 'Fortress', 'Win Hack & Defend without any firewall falling to 0.', (c) => (c.fortress || 0) > 0),
  t('heist-clean', 'Skill', '🕶️', 'Clean Job', 'Crack the vault with no mistakes from anyone.', (c) => (c.heistClean || 0) > 0),
  t('heist-quiet', 'Skill', '🤫', 'Silent Running', 'Crack the vault with the alarm under 30%.', (c) => (c.heistQuiet || 0) > 0),
  t('heist-lookout', 'Skill', '📹', 'Eagle Eye', 'Loop 5 cameras in one heist.', (c) => (c.bestLoops || 0) >= 5),
  count(100, 'quickClears', 'Quick hacks', '🦾', 'Fully Automated', 'Clear 100 quick hacks.'),
  count(10, 'flawless', 'Quick hacks', '💍', 'Spotless', 'Clear 10 quick hacks with no mistakes.'),
  t('speedrun-30', 'Quick hacks', '⚡', 'Lightning', 'Clear a quick hack in under 30 seconds.', (c) => (c.blitzClears || 0) > 0),
  count(30, 'dailyRuns', 'Daily Challenge', '📆', 'Month of Hacks', 'Finish 30 Daily Challenges.'),
  count(3, 'dailyStreak', 'Daily Challenge', '🔗', 'Daily Chain', 'Finish the Daily Challenge 3 days in a row.'),

  // ---- More social and habits ----
  count(25, 'onlineRounds', 'Social', '🌍', 'Netizen', 'Play 25 rounds in online rooms.'),
  count(100, 'onlineRounds', 'Social', '🛰️', 'Always Connected', 'Play 100 rounds in online rooms.'),
  count(1, 'fullHouse', 'Social', '🏟️', 'Full House', 'Play a round with 6 or more people (not bots).'),
  count(10, 'hostRounds', 'Social', '🎛️', 'Root Admin', 'Host 10 rounds in online rooms.'),
  t('chat', 'Social', '💬', 'Hello, World', 'Send a chat message.', (c) => !!c.chatSent),
  t('group-made', 'Social', '👥', 'Squad Up', 'Create a group chat.', (c) => !!c.groupMade),
  t('group-joined', 'Social', '🤝', 'Plus One', 'Join someone else\'s group chat.', (c) => !!c.groupJoined),
  t('friend-made', 'Social', '🫂', 'Best Buds', 'Make a friend.', (c) => !!c.friendMade),
  t('friend-invite', 'Social', '💌', 'Party Starter', 'Invite a friend to your room.', (c) => !!c.friendInvite),
  t('group-chat', 'Social', '📣', 'Group Text', 'Send a message in a group chat.', (c) => !!c.groupChat),
  count(3, 'bestDayStreak', 'Habits', '🔥', 'Three in a Row', 'Play on 3 days in a row.'),
  count(7, 'bestDayStreak', 'Habits', '📅', 'Full Week', 'Play on 7 days in a row.'),
  count(100, 'daysCount', 'Habits', '🗓️', 'Centurion', 'Play on 100 different days.'),

  // ---- Secret trophies ----
  secret('royal', '👑', 'Royal Encounter', 'Play a round in the same room as the owner.', (c) => !!c.withOwner),
  secret('comeback', '🔄', 'Comeback Kid', 'Win right after losing 3 or more in a row.', (c) => (c.comebacks || 0) > 0),
  secret('persistence', '🪨', 'Never Give Up', 'Play 25 rounds without winning... then keep going.', (c) => (c.losses || 0) >= 25),
  secret('nocturnal', '🌙', 'Up Way Too Late', 'Play a round between midnight and 4 am.', (c) => !!c.nocturnal),
  secret('halloween', '🎃', 'Spooky Hacker', 'Play a round on October 31.', (c) => !!c.halloween),
  secret('new-year', '🎆', 'Happy New Hack', 'Play a round on January 1.', (c) => !!c.newYear),
  secret('friday13', '🐈‍⬛', 'Unlucky Number', 'Play a round on a Friday the 13th.', (c) => !!c.friday13),
  secret('style-hopper', '🎨', 'Fashion Hacker', 'Try all three styles in Settings.', (c) => !!(c.styleGreen && c.styleCyber && c.styleAmber)),
  secret('rainbow', '🌈', 'Taste the Rainbow', 'Turn on rainbow rain.', (c) => !!c.rainbowRain),
  secret('trophy-hunter', '🔍', 'Trophy Hunter', 'Open the trophy case 10 times.', (c) => (c.caseOpens || 0) >= 10),
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
export function roundEvent({ room, mine, won, now = new Date(), withOwner = false }) {
  const raw = mine?.raw || {};
  const st = room.players?.[mine?.id]?.s || {}; // your state in the mode (stats, hints...)
  const minutes = (end) => Math.max(1000, (end || room.endedAt || now.getTime()) - (room.startedAt || 0)) / 60000;
  const duelStats = room.mode === 'duel' ? st.stats || {} : {};
  const crew = Object.values(room.players || {}).filter((p) => !p.bot);
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
    month: now.getMonth() + 1,
    dom: now.getDate(),
    place: mine?.place || 0,
    hardBots: Object.values(room.players || {}).filter((p) => p.bot).length >= 3 && room.botLevel === 'hard',
    withOwner: !!withOwner,
    // Terminal Race
    raceHints: room.mode === 'race' ? st.hints || 0 : null,
    raceMs: room.mode === 'race' && (st.layer || 0) >= 5 ? st.at - room.startedAt : null,
    // Typing Duel
    wpm: room.mode === 'duel' && duelStats.chars ? Math.round(duelStats.chars / 5 / minutes(st.out ? st.outAt : null)) : 0,
    duelHits: duelStats.hits || 0,
    duelMisses: duelStats.misses || 0,
    duelHp: room.mode === 'duel' ? st.hp ?? null : null,
    // Hack & Defend
    loot: room.mode === 'defend' ? st.loot || 0 : 0,
    kills: room.mode === 'defend' ? st.stats?.kills || 0 : 0,
    fortress: room.mode === 'defend' && !!st.nodes && Object.values(st.nodes).every((n) => (n.fw || 0) > 0),
    // Co-op Heist
    heistMistakes: room.mode === 'heist' ? crew.reduce((sum, p) => sum + (p.s?.stats?.mistakes || 0), 0) : null,
    alarm: room.mode === 'heist' ? room.game?.alarm ?? null : null,
    loops: room.mode === 'heist' ? st.stats?.loops || 0 : 0,
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
    if ((c.lossRun || 0) >= 3) add('comebacks');
    c.lossRun = 0;
    if (ev.hardBots) add('underdog');
    if (ev.mode === 'race' && ev.raceHints === 0) add('raceNoHint');
    if (ev.mode === 'duel' && ev.duelHp === 100) add('duelUntouched');
    if (ev.mode === 'defend' && ev.fortress) add('fortress');
    if (ev.mode === 'heist' && ev.heistMistakes === 0) add('heistClean');
    if (ev.mode === 'heist' && ev.alarm !== null && ev.alarm < 30) add('heistQuiet');
  } else {
    c.streak = 0;
    add('losses');
    c.lossRun = (c.lossRun || 0) + 1;
  }
  c.bestStreak = Math.max(c.bestStreak || 0, c.streak || 0);
  if (ev.place === 2) add('seconds');
  if (ev.raceMs !== null && ev.raceMs !== undefined) {
    if (ev.raceMs < 180000) add('race3');
    if (ev.raceMs < 120000) add('race2');
  }
  if (ev.wpm) c.bestWpm = Math.max(c.bestWpm || 0, ev.wpm);
  if (ev.duelHits >= 10 && ev.duelMisses === 0) add('duelPerfect');
  if (ev.loot) c.bestLoot = Math.max(c.bestLoot || 0, ev.loot);
  if (ev.kills) c.bestKills = Math.max(c.bestKills || 0, ev.kills);
  if (ev.loops) c.bestLoops = Math.max(c.bestLoops || 0, ev.loops);
  if (ev.humans >= 6) add('fullHouse');
  if (ev.withOwner) c.withOwner = true;
  if (ev.hour < 4) c.nocturnal = true;
  if (ev.month === 10 && ev.dom === 31) c.halloween = true;
  if (ev.month === 1 && ev.dom === 1) c.newYear = true;
  if (ev.day === 5 && ev.dom === 13) c.friday13 = true;
  if (ev.clear) {
    add('quickClears');
    if (ev.mistakes === 0) add('flawless');
    if (ev.ms !== null && ev.ms < 60000) add('fastClears');
    if (ev.ms !== null && ev.ms < 30000) add('blitzClears');
    if (ev.daily) {
      add('dailyRuns');
      if (ev.ms + ev.mistakes * 5000 < 60000) add('dailyFast');
      if (ev.mistakes === 0) add('dailyFlawless');
      const dd = new Set(c.dailyDays || []);
      dd.add(ev.date);
      c.dailyDays = [...dd].sort().slice(-60);
      c.dailyStreak = Math.max(c.dailyStreak || 0, runEnding(c.dailyDays, ev.date));
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
  c.bestDayStreak = Math.max(c.bestDayStreak || 0, runEnding(c.days, ev.date));

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

// How many days in a row (ending on `date`) appear in a list of YYYY-MM-DD dates.
export function runEnding(dates, date) {
  const set = new Set(dates);
  let n = 0;
  const d = new Date(date + 'T00:00:00Z');
  while (set.has(d.toISOString().slice(0, 10))) {
    n++;
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return n;
}

// Add 1 to a counter that isn't tied to a round (like opening the trophy case).
export function bumpCounter(name, level = 1) {
  const s = getTrophyState();
  s.c = { ...s.c, [name]: (s.c[name] || 0) + 1 };
  const unlocked = TROPHIES.filter((tr) => !s.unlocked[tr.id] && tr.test(s.c, {}, level));
  for (const tr of unlocked) s.unlocked[tr.id] = Date.now();
  saveTrophyState(s);
  return unlocked;
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

// How close you are to a locked trophy: { have, need, pct } (null if it isn't a count).
export function trophyProgress(tr, counters = {}, level = 1) {
  if (!tr?.goal) return null;
  const [have, need] = tr.goal(counters, level);
  const h = Math.max(0, Math.min(Number(have) || 0, need));
  return { have: h, need, pct: Math.round((100 * h) / need) };
}
