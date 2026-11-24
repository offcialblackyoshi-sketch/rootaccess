// Lobby screen: player list, mode picker, ready/start, bots.
import { MODES, MODE_ORDER } from './modes/index.js';
import { el, playerList, COLORS, BOT_NAMES, ROUND_LENGTHS, roundTime, fmtTime } from './util.js';
import { randomSeed } from './rng.js';
import { BOT_LEVELS } from './bots.js';
import { iconEl } from './icons.js';
import { avatarEl } from './avatar.js';
import { TEAMS, TEAM_SIZES, TEAM_COLORS, teamLabel, teamProblem, balanceTeams } from './teams.js';

const $ = (id) => document.getElementById(id);

// Accent color per mode (mode cards, icons).
const MODE_ACCENT = {
  race: '#4dd9ff', duel: '#ff5a5a', defend: '#39ff6a', heist: '#ffb000', koth: '#e879f9',
  gauntlet: '#ff6b4d', wirecut: '#ff5a5a', portsweep: '#39ff6a', bitflip: '#4dd9ff',
  letterlock: '#c6ff4d', printmatch: '#ff4dd2', signaltune: '#4dd9ff', circuit: '#ffb000', memory: '#b388ff',
};

// Remember who we've already shown, so only new arrivals slide in and only
// players who just readied up pulse (the lobby redraws on every change).
let seenRoom = null;
const seenPlayers = new Set();
const wasReady = new Map();

// canModerate: the owner can kick anyone. onArrive(player): called once for
// each player who shows up (used for the owner's entrance).
export function renderLobby({ room, net, code, onLeave, canModerate = false, onArrive = null }) {
  const me = net.uid;
  const isHost = room.hostId === me;
  const players = playerList(room);
  const humans = players.filter((p) => !p.bot);
  const bots = players.filter((p) => p.bot);
  const mode = MODES[room.mode] || MODES.race;

  $('lobbyCode').textContent = room.practice ? 'PRACTICE' : code;
  $('lobbyCodeLabel').hidden = !!room.practice;
  $('inviteBtn').hidden = !!room.practice;
  $('lobbyNet').textContent = room.practice
    ? 'Offline practice against bots.'
    : net.kind === 'online'
      ? 'Online room. Friends can join from any device with the code.'
      : 'Local room. Only other tabs on this computer can join (online play is not set up).';

  // ---- Players ----
  if (seenRoom !== code) {
    seenRoom = code;
    seenPlayers.clear();
    wasReady.clear();
  }
  const list = $('lobbyPlayers');
  list.innerHTML = '';
  // Team duels: list players grouped by team, each with a team switch.
  const teamSize = room.mode === 'duel' ? room.teamSize || 0 : 0;
  const ordered = teamSize ? [...TEAMS, null].flatMap((t) => players.filter((p) => (TEAMS.includes(p.team) ? p.team : null) === t)) : players;
  let lastTeam;
  for (const p of ordered) {
    const team = TEAMS.includes(p.team) ? p.team : null;
    if (teamSize && team !== lastTeam) {
      lastTeam = team;
      const n = players.filter((q) => (TEAMS.includes(q.team) ? q.team : null) === team).length;
      list.append(el('li', { class: 'team-head', style: { '--tc': TEAM_COLORS[team] || 'var(--dim)' } }, team ? `TEAM ${team}  ${n}/${teamSize}` : 'NO TEAM'));
    }
    const tags = [];
    // You can switch your own team; the host can also move bots.
    if (teamSize && (p.id === me || (isHost && p.bot))) {
      for (const t of TEAMS) {
        if (t === team) continue;
        tags.push(el('button', {
          class: 'mini-btn team-btn', 'data-team': t, style: { '--tc': TEAM_COLORS[t] },
          onclick: () => net.update(code, { [`players/${p.id}/team`]: t }),
        }, `→ ${t}`));
      }
    }
    if (p.id === room.hostId) tags.push(el('span', { class: 'tag host' }, 'HOST'));
    if (p.bot) tags.push(el('span', { class: 'tag' }, 'BOT'));
    else if (p.id !== room.hostId) tags.push(el('span', { class: 'tag ' + (p.ready ? 'ready' : 'wait') }, p.ready ? 'READY' : 'NOT READY'));
    if (p.id === me) tags.push(el('span', { class: 'tag you' }, 'YOU'));
    if (!p.bot && p.level) tags.push(el('span', { class: 'tag rank' + (p.special ? ' special' : ''), title: p.title || '' }, `LV${p.level}${p.title && !p.special ? ' · ' + p.title : ''}`));
    // The host can remove bots, and kick other players (they can't rejoin this room).
    // The owner can kick anyone, in any room.
    const remove = (isHost || (canModerate && !p.bot)) && p.id !== me
      ? el('button', {
        class: 'mini kick',
        title: p.bot ? 'Remove bot' : 'Kick player',
        'aria-label': `${p.bot ? 'Remove' : 'Kick'} ${p.name}`,
        onclick: () => {
          if (p.bot) return net.update(code, { [`players/${p.id}`]: null });
          if (confirm(`Kick ${p.name} from the room?`)) net.update(code, { [`players/${p.id}`]: null, [`kicked/${p.id}`]: true });
        },
      }, '✕')
      : null;
    const cls = [!seenPlayers.has(p.id) ? 'enter' : '', p.ready && wasReady.get(p.id) === false ? 'just-ready' : ''].join(' ').trim();
    if (!seenPlayers.has(p.id) && onArrive) onArrive(p);
    seenPlayers.add(p.id);
    wasReady.set(p.id, !!p.ready);
    list.append(el('li', { class: cls || null, style: { '--pc': p.color }, 'data-team': team || null },
      avatarEl(p.name, p.color, 24), el('span', { class: 'pname' }, p.name), ...tags, remove));
  }
  $('lobbyCount').textContent = `${players.length}/8`;

  // ---- Modes ----
  const modesEl = $('lobbyModes');
  modesEl.innerHTML = '';
  for (const id of MODE_ORDER) {
    const m = MODES[id];
    if (m.quick && !modesEl.querySelector('.mode-group')) {
      modesEl.append(el('div', { class: 'mode-group' }, 'QUICK HACKS', el('span', { class: 'dim' }, ' · easy · no typing, just arrow keys, Space or clicks')));
    }
    const selected = room.mode === id;
    const unavailable = room.practice && !m.bots; // needs other humans
    const card = el('button', {
      class: 'mode-card' + (selected ? ' selected' : ''),
      'data-mode': id,
      style: { '--mode': MODE_ACCENT[id] || 'var(--accent)' },
      disabled: (!isHost && !selected) || unavailable,
      'aria-pressed': selected ? 'true' : 'false',
      onclick: () => {
        if (!isHost || selected || unavailable) return;
        const changes = { mode: id };
        if (!m.bots) for (const b of bots) changes[`players/${b.id}`] = null;
        net.update(code, changes);
      },
    },
    el('div', { class: 'mode-icon' }, iconEl(id)),
    el('div', { class: 'mode-name' }, m.name),
    el('div', { class: 'mode-players' }, `${m.min}–${m.max} players${m.bots ? ' · bots OK' : ' · humans only'}${unavailable ? ' · create a room to play' : ''}`),
    el('div', { class: 'mode-blurb' }, m.blurb));
    modesEl.append(card);
  }

  // ---- Actions ----
  const actions = $('lobbyActions');
  actions.innerHTML = '';
  const meP = room.players[me];

  let problem = '';
  if (players.length < mode.min) problem = `${mode.name} needs at least ${mode.min} players${mode.bots ? ' (add a bot or invite friends)' : ''}.`;
  else if (players.length > mode.max) problem = `${mode.name} allows at most ${mode.max} players.`;
  else if (teamProblem(players, teamSize)) problem = teamProblem(players, teamSize);
  else if (humans.some((p) => p.id !== room.hostId && !p.ready)) problem = 'Waiting for everyone to be ready…';

  if (isHost) {
    actions.append(el('button', { class: 'primary', id: 'startBtn', disabled: !!problem, onclick: () => startGame(room, net, code) }, '▶ START'));
    if (mode.bots && players.length < Math.min(8, mode.max)) {
      actions.append(el('button', { id: 'addBotBtn', onclick: () => addBot(room, net, code) }, '+ Add bot'));
    }
    if (teamSize) {
      actions.append(el('button', { id: 'shuffleBtn', onclick: () => setTeams(room, net, code, teamSize) }, '⇄ Shuffle teams'));
      if (players.length < teamSize * 2) actions.append(el('button', { id: 'fillBtn', onclick: () => fillBots(room, net, code, teamSize) }, '+ Fill with bots'));
    }
  } else {
    actions.append(el('button', {
      class: meP?.ready ? '' : 'primary', id: 'readyBtn',
      onclick: () => net.update(code, { [`players/${me}/ready`]: !meP?.ready }),
    }, meP?.ready ? 'Not ready' : '✔ Ready'));
  }
  actions.append(el('button', { id: 'leaveBtn', onclick: onLeave }, 'Leave'));

  // Round length (for modes with a timer).
  if (mode.timeLimit) {
    const len = room.roundLength || 'normal';
    actions.append(el('div', { class: 'option-row', role: 'group', 'aria-label': 'Round length' },
      el('span', { class: 'dim' }, 'Round:'),
      ...Object.keys(ROUND_LENGTHS).map((l) => el('button', {
        class: 'mini-btn' + (l === len ? ' selected' : ''),
        'data-length': l,
        'aria-pressed': l === len ? 'true' : 'false',
        disabled: !isHost && l !== len,
        onclick: () => isHost && l !== len && net.update(code, { roundLength: l }),
      }, `${l} ${fmtTime(roundTime(mode, l))}`))));
  }

  // Public rooms are listed in the Multiplayer lobby; private ones need the code.
  if (!room.practice) {
    actions.append(el('div', { class: 'option-row', role: 'group', 'aria-label': 'Who can join' },
      el('span', { class: 'dim' }, 'Room:'),
      ...[[false, 'private (code)'], [true, 'public (listed)']].map(([pub, label]) => el('button', {
        class: 'mini-btn' + (!!room.public === pub ? ' selected' : ''),
        'data-public': String(pub),
        'aria-pressed': !!room.public === pub ? 'true' : 'false',
        disabled: !isHost && !!room.public !== pub,
        onclick: () => isHost && !!room.public !== pub && net.update(code, { public: pub }),
      }, label))));
  }

  // Teams (Typing Duel only).
  if (room.mode === 'duel') {
    actions.append(el('div', { class: 'option-row', role: 'group', 'aria-label': 'Teams' },
      el('span', { class: 'dim' }, 'Teams:'),
      ...TEAM_SIZES.map((n) => el('button', {
        class: 'mini-btn' + (n === teamSize ? ' selected' : ''),
        'data-teams': n,
        'aria-pressed': n === teamSize ? 'true' : 'false',
        disabled: !isHost && n !== teamSize,
        onclick: () => isHost && n !== teamSize && setTeams(room, net, code, n),
      }, n ? teamLabel(n) : 'FFA'))));
  }

  // Bot difficulty (only matters when there are bots).
  if (mode.bots && bots.length) {
    const level = room.botLevel || 'normal';
    actions.append(el('div', { class: 'option-row', role: 'group', 'aria-label': 'Bot difficulty' },
      el('span', { class: 'dim' }, 'Bots:'),
      ...BOT_LEVELS.map((l) => el('button', {
        class: 'mini-btn' + (l === level ? ' selected' : ''),
        'data-level': l,
        'aria-pressed': l === level ? 'true' : 'false',
        disabled: !isHost && l !== level,
        onclick: () => isHost && l !== level && net.update(code, { botLevel: l }),
      }, l))));
  }
  $('lobbyStatus').textContent = problem || (isHost ? 'Everyone is ready. Press START!' : 'Waiting for the host to start…');
}

function addBot(room, net, code) {
  const players = playerList(room);
  const used = new Set(players.map((p) => p.name));
  const name = BOT_NAMES.find((n) => !used.has(n)) || 'bot' + players.length;
  const usedColors = new Set(players.map((p) => p.color));
  const color = COLORS.find((c) => !usedColors.has(c)) || COLORS[players.length % COLORS.length];
  const id = 'bot-' + Math.random().toString(36).slice(2, 8);
  const bot = { name, color, bot: true, ready: true, joinedAt: net.now() };
  // In team duels a new bot joins the smaller team.
  const size = room.mode === 'duel' ? room.teamSize || 0 : 0;
  if (size) {
    const [a, b] = TEAMS.map((t) => players.filter((p) => p.team === t).length);
    bot.team = a <= b ? 'A' : 'B';
  }
  return net.update(code, { [`players/${id}`]: bot });
}

// Switch team size (0 = free-for-all) and deal everyone onto balanced teams.
function setTeams(room, net, code, size) {
  const changes = { teamSize: size };
  if (size) for (const [id, t] of Object.entries(balanceTeams(playerList(room), size))) changes[`players/${id}/team`] = t;
  return net.update(code, changes);
}

// Add bots until both teams are full.
async function fillBots(room, net, code, size) {
  let r = room;
  while (playerList(r).length < size * 2) {
    await addBot(r, net, code);
    r = await net.getRoom(code);
  }
}

export function startGame(room, net, code) {
  const mode = MODES[room.mode];
  const players = playerList(room);
  const seed = room.fixedSeed ?? randomSeed(); // the Daily Challenge uses the day's seed
  const setup = mode.setup ? mode.setup({ room, players, seed }) : {};
  const changes = {
    status: 'playing',
    seed,
    round: (room.round || 0) + 1,
    startedAt: net.now() + 3500,
    game: setup.game ?? null,
    actions: null,
    results: null,
    summary: null,
    summaryWin: null,
  };
  for (const p of players) changes[`players/${p.id}/s`] = setup.players?.[p.id] ?? { v: 1 };
  return net.update(code, changes);
}

export function backToLobby(room, net, code) {
  const changes = { status: 'lobby', game: null, actions: null, results: null, summary: null, summaryWin: null };
  for (const p of playerList(room)) {
    changes[`players/${p.id}/s`] = null;
    if (!p.bot && p.id !== room.hostId) changes[`players/${p.id}/ready`] = false;
  }
  return net.update(code, changes);
}
