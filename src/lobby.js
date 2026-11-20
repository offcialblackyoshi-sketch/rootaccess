// Lobby screen: player list, mode picker, ready/start, bots.
import { MODES, MODE_ORDER } from './modes/index.js';
import { el, playerList, COLORS, BOT_NAMES } from './util.js';
import { randomSeed } from './rng.js';
import { BOT_LEVELS } from './bots.js';

const $ = (id) => document.getElementById(id);

export function renderLobby({ room, net, code, onLeave }) {
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
  const list = $('lobbyPlayers');
  list.innerHTML = '';
  for (const p of players) {
    const tags = [];
    if (p.id === room.hostId) tags.push(el('span', { class: 'tag host' }, 'HOST'));
    if (p.bot) tags.push(el('span', { class: 'tag' }, 'BOT'));
    else if (p.id !== room.hostId) tags.push(el('span', { class: 'tag ' + (p.ready ? 'ready' : 'wait') }, p.ready ? 'READY' : 'NOT READY'));
    if (p.id === me) tags.push(el('span', { class: 'tag you' }, 'YOU'));
    const remove = isHost && p.bot
      ? el('button', { class: 'mini', title: 'Remove bot', 'aria-label': `Remove ${p.name}`, onclick: () => net.update(code, { [`players/${p.id}`]: null }) }, '✕')
      : null;
    list.append(el('li', {}, el('span', { class: 'dot', style: { background: p.color } }), el('span', { class: 'pname' }, p.name), ...tags, remove));
  }
  $('lobbyCount').textContent = `${players.length}/8`;

  // ---- Modes ----
  const modesEl = $('lobbyModes');
  modesEl.innerHTML = '';
  for (const id of MODE_ORDER) {
    const m = MODES[id];
    const selected = room.mode === id;
    const unavailable = room.practice && !m.bots; // needs other humans
    const card = el('button', {
      class: 'mode-card' + (selected ? ' selected' : ''),
      disabled: (!isHost && !selected) || unavailable,
      'aria-pressed': selected ? 'true' : 'false',
      onclick: () => {
        if (!isHost || selected || unavailable) return;
        const changes = { mode: id };
        if (!m.bots) for (const b of bots) changes[`players/${b.id}`] = null;
        net.update(code, changes);
      },
    },
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
  else if (humans.some((p) => p.id !== room.hostId && !p.ready)) problem = 'Waiting for everyone to be ready…';

  if (isHost) {
    actions.append(el('button', { class: 'primary', id: 'startBtn', disabled: !!problem, onclick: () => startGame(room, net, code) }, '▶ START'));
    if (mode.bots && players.length < Math.min(8, mode.max)) {
      actions.append(el('button', { id: 'addBotBtn', onclick: () => addBot(room, net, code) }, '+ Add bot'));
    }
  } else {
    actions.append(el('button', {
      class: meP?.ready ? '' : 'primary', id: 'readyBtn',
      onclick: () => net.update(code, { [`players/${me}/ready`]: !meP?.ready }),
    }, meP?.ready ? 'Not ready' : '✔ Ready'));
  }
  actions.append(el('button', { id: 'leaveBtn', onclick: onLeave }, 'Leave'));

  // Bot difficulty (only matters when there are bots).
  if (mode.bots && bots.length) {
    const level = room.botLevel || 'normal';
    actions.append(el('div', { class: 'bot-level', role: 'group', 'aria-label': 'Bot difficulty' },
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
  net.update(code, { [`players/${id}`]: { name, color, bot: true, ready: true, joinedAt: net.now() } });
}

export function startGame(room, net, code) {
  const mode = MODES[room.mode];
  const players = playerList(room);
  const seed = randomSeed();
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
