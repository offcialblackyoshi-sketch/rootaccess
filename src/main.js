// App entry: menu → lobby → game → results.
import { getLocalNet, getOnlineNet, onlineConfigured } from './net/index.js';
import { isRoomCode } from './net/shared.js';
import { renderLobby, backToLobby, startGame } from './lobby.js';
import { TUTORIAL_DONE_KEY } from './modes/tutorial.js';
import { startSession } from './game.js';
import { createChat } from './chat.js';
import { sfx } from './sfx.js';
import { el, load, save, playerList, COLORS } from './util.js';
import { initSettingsDialog } from './settings.js';

initSettingsDialog();

const $ = (id) => document.getElementById(id);

const state = {
  net: null,
  code: null,
  room: null,
  unwatch: null,
  session: null,
  online: null,       // the online net once connected
  onlineError: null,
  shownResultsFor: null,
};

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------
function show(name) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== 'screen-' + name;
  document.body.dataset.screen = name;
}

function menuMessage(text, cls = 'err') {
  const m = $('menuMsg');
  m.textContent = text;
  m.className = cls;
}

// ---------------------------------------------------------------------------
// Player profile
// ---------------------------------------------------------------------------
let myColor = load('ra-color', COLORS[Math.floor(Math.random() * COLORS.length)]);
$('nameInput').value = load('ra-name', 'user' + Math.floor(100 + Math.random() * 900));

function renderColors() {
  const box = $('colorPick');
  box.innerHTML = '';
  for (const c of COLORS) {
    box.append(el('button', {
      class: 'swatch' + (c === myColor ? ' selected' : ''),
      style: { background: c },
      'aria-label': 'Color ' + c,
      'aria-pressed': c === myColor ? 'true' : 'false',
      type: 'button',
      onclick: () => {
        myColor = c;
        save('ra-color', c);
        renderColors();
      },
    }));
  }
}
renderColors();

function myName() {
  const n = $('nameInput').value.trim().replace(/[^\w.\-]/g, '').slice(0, 14) || 'anon';
  save('ra-name', n);
  return n;
}

function makePlayer(net, room) {
  let name = myName();
  const taken = new Set(Object.values(room?.players || {}).map((p) => p.name));
  for (let i = 2; taken.has(name); i++) name = myName().slice(0, 12) + i;
  // Keep colors unique in the room.
  const usedColors = new Set(Object.values(room?.players || {}).map((p) => p.color));
  const color = usedColors.has(myColor) ? COLORS.find((c) => !usedColors.has(c)) || myColor : myColor;
  return { name, color, ready: false, joinedAt: net.now() };
}

// ---------------------------------------------------------------------------
// Online status
// ---------------------------------------------------------------------------
async function connectOnline() {
  const status = $('netStatus');
  if (!onlineConfigured()) {
    status.innerHTML = '';
    status.append(el('span', { class: 'warn' }, '● LOCAL MODE'), ' Online play is not set up yet (see README). Rooms work between tabs on this computer.');
    return;
  }
  if (!navigator.onLine) {
    status.innerHTML = '';
    status.append(el('span', { class: 'warn' }, '● OFFLINE'), ' No internet. Practice mode still works.');
    return;
  }
  status.textContent = 'Connecting to the network…';
  const res = await getOnlineNet();
  if (res.net) {
    state.online = res.net;
    status.innerHTML = '';
    status.append(el('span', { class: 'ok' }, '● ONLINE'), ' Ready to create or join rooms.');
  } else {
    state.onlineError = res.error;
    status.innerHTML = '';
    status.append(el('span', { class: 'err' }, '● CAN’T CONNECT'), ` ${res.error}. Rooms will only work between tabs on this computer.`);
  }
}
window.addEventListener('online', connectOnline);
window.addEventListener('offline', connectOnline);

function roomNet() {
  return state.online || getLocalNet();
}

// ---------------------------------------------------------------------------
// Create / join / practice
// ---------------------------------------------------------------------------
async function withBusy(btn, fn) {
  sfx.unlock();
  menuMessage('');
  const buttons = document.querySelectorAll('#screen-menu button');
  buttons.forEach((b) => (b.disabled = true));
  try {
    await fn();
  } catch (e) {
    console.error(e);
    menuMessage(e.message || String(e));
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

$('createBtn').addEventListener('click', (e) => withBusy(e.target, async () => {
  const net = roomNet();
  const room = { hostId: net.uid, mode: 'race', status: 'lobby', createdAt: net.now(), round: 0 };
  room.players = { [net.uid]: { ...makePlayer(net, room), ready: true } };
  const code = await net.createRoom(room);
  enterRoom(net, code);
}));

async function join() {
  const code = $('codeInput').value.trim().toUpperCase();
  if (!isRoomCode(code)) return menuMessage('Room codes are 4 letters, like QXFT.');
  const net = roomNet();
  const room = await net.getRoom(code);
  if (!room || !room.players) return menuMessage(`No room called ${code}. Check the code${net.kind === 'local' ? ' (local mode only sees rooms in this browser)' : ''}.`);
  if (room.status !== 'lobby') return menuMessage('That game has already started. Ask the host to go back to the lobby.');
  if (Object.keys(room.players).length >= 8) return menuMessage('That room is full (8 players).');
  await net.joinRoom(code, makePlayer(net, room));
  enterRoom(net, code);
}
$('joinBtn').addEventListener('click', (e) => withBusy(e.target, join));
$('codeInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') withBusy(null, join);
});
$('codeInput').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
});

function practiceRoom(net, mode) {
  const now = net.now();
  const room = { hostId: net.uid, mode, status: 'lobby', createdAt: now, round: 0, practice: true, botLevel: 'easy' };
  room.players = {
    [net.uid]: { ...makePlayer(net, room), ready: true },
    'bot-a': { name: 'n3m0', color: '#ff4dd2', bot: true, ready: true, joinedAt: now + 1 },
    'bot-b': { name: 'gh0st', color: '#4dd9ff', bot: true, ready: true, joinedAt: now + 2 },
  };
  return room;
}

$('practiceBtn').addEventListener('click', (e) => withBusy(e.target, async () => {
  const net = getLocalNet();
  const code = await net.createRoom(practiceRoom(net, 'race'));
  enterRoom(net, code);
}));

$('tutorialBtn').addEventListener('click', (e) => withBusy(e.target, async () => {
  const net = getLocalNet();
  const room = practiceRoom(net, 'tutorial');
  const code = await net.createRoom(room);
  await startGame(room, net, code);
  enterRoom(net, code);
}));

// Point first-timers at the tutorial.
$('tutorialBadge').hidden = !!load(TUTORIAL_DONE_KEY, false);

$('howBtn').addEventListener('click', () => $('howDialog').showModal());
$('howClose').addEventListener('click', () => $('howDialog').close());

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------
function sendChat(text) {
  if (!state.net || !state.room) return;
  const p = state.room.players?.[state.net.uid];
  state.net.push(state.code, 'chat', { uid: state.net.uid, name: p?.name || '?', color: p?.color || '#33ff66', text: text.slice(0, 200), at: state.net.now() });
  // Keep the chat history short.
  const keys = Object.keys(state.room.chat || {}).sort();
  if (keys.length > 80) {
    const changes = {};
    for (const k of keys.slice(0, keys.length - 80)) changes[`chat/${k}`] = null;
    state.net.update(state.code, changes);
  }
}

// Esc in the chat box jumps back to the terminal (in a game).
const chat = createChat({
  sfx,
  onSend: sendChat,
  onEscape: () => document.querySelector('#term .term-in input:not(:disabled)')?.focus(),
});

// ---------------------------------------------------------------------------
// Room lifecycle
// ---------------------------------------------------------------------------
function enterRoom(net, code) {
  state.net = net;
  state.code = code;
  state.room = null;
  state.shownResultsFor = null;
  chat.reset();
  state.unwatch = net.watch(code, onRoom);
  if (net.kind === 'online') history.replaceState(null, '', '?room=' + code);
}

async function leaveRoom(message = '') {
  const { net, code } = state;
  if (state.unwatch) state.unwatch();
  state.unwatch = null;
  stopSession();
  state.net = null;
  state.code = null;
  state.room = null;
  history.replaceState(null, '', location.pathname);
  show('menu');
  menuMessage(message, 'warn');
  $('tutorialBadge').hidden = !!load(TUTORIAL_DONE_KEY, false);
  if (net && code) await net.leave(code).catch(() => {});
}

window.addEventListener('pagehide', () => {
  if (state.net && state.code) state.net.leaveNow(state.code);
});

function stopSession() {
  if (state.session) state.session.destroy();
  state.session = null;
}

function onRoom(room) {
  if (!state.net) return;
  const me = state.net.uid;
  if (!room || !room.players || !room.players[me]) {
    leaveRoom(room ? 'You left the room.' : 'The room was closed.');
    return;
  }
  state.room = room;

  // If the host left, the longest-waiting human takes over.
  if (!room.players[room.hostId]) {
    const next = playerList(room).find((p) => !p.bot);
    if (next?.id === me) state.net.update(state.code, { hostId: me });
  }

  chat.render(room, me);

  if (room.status === 'lobby') {
    stopSession();
    state.shownResultsFor = null;
    chat.mount($('lobbyChat'));
    renderLobby({ room, net: state.net, code: state.code, onLeave: () => leaveRoom() });
    show('lobby');
  } else if (room.status === 'playing') {
    if (!state.session || state.session.round !== room.round) {
      stopSession();
      state.session = startSession({ net: state.net, code: state.code, room, sfx, sendChat, focusChat: chat.focus });
    }
    chat.mount($('gameChat'));
    state.session.update(room);
    show('game');
  } else if (room.status === 'done') {
    if (state.session) state.session.update(room);
    stopSession();
    renderResults(room);
    show('results');
  }
}

function renderResults(room) {
  const me = state.net.uid;
  const isHost = room.hostId === me;
  const results = room.results || [];
  $('resultsSummary').textContent = room.summary || '';
  const list = $('resultsList');
  list.innerHTML = '';
  for (const r of results) {
    list.append(el('li', { class: r.id === me ? 'me' : '' },
      el('span', { class: 'place' }, r.place ? `#${r.place}` : ''),
      el('span', { class: 'dot', style: { background: r.color } }),
      el('div', { class: 'who' },
        el('span', { class: 'pname' }, r.name + (r.id === me ? ' (you)' : '')),
        r.stats ? el('div', { class: 'stats' }, r.stats) : null),
      el('span', { class: 'detail' }, r.detail || '')));
  }
  const actions = $('resultsActions');
  actions.innerHTML = '';
  if (isHost) actions.append(el('button', { class: 'primary', id: 'againBtn', onclick: () => backToLobby(state.room, state.net, state.code) }, '↻ Back to lobby'));
  else actions.append(el('p', { class: 'dim' }, 'Waiting for the host…'));
  actions.append(el('button', { onclick: () => leaveRoom() }, 'Leave'));

  if (state.shownResultsFor !== room.round) {
    state.shownResultsFor = room.round;
    const won = room.summaryWin ?? results[0]?.id === me;
    if (won) sfx.win();
    else sfx.lose();
  }
}

// In-game header buttons
$('gameLeave').addEventListener('click', () => {
  if (confirm('Leave this game?')) leaveRoom();
});
$('gameAbort').addEventListener('click', () => {
  if (state.room && state.room.hostId === state.net.uid && confirm('End this round for everyone and go back to the lobby?')) {
    backToLobby(state.room, state.net, state.code);
  }
});
$('inviteBtn').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}?room=${state.code}`;
  try {
    await navigator.clipboard.writeText(url);
    $('inviteBtn').textContent = 'Copied!';
  } catch {
    prompt('Copy this invite link:', url);
  }
  setTimeout(() => ($('inviteBtn').textContent = 'Copy invite link'), 1500);
});

// Show the host-only "End round" button.
const observer = new MutationObserver(() => {
  $('gameAbort').hidden = !(state.room && state.net && state.room.hostId === state.net.uid);
});
observer.observe(document.body, { attributes: true, attributeFilter: ['data-screen'] });

// ---------------------------------------------------------------------------
// Corner buttons: install + mute
// ---------------------------------------------------------------------------
const muteBtn = $('muteBtn');
const installBtn = $('installBtn');
const renderMute = () => {
  muteBtn.textContent = sfx.isMuted() ? '🔇' : '🔊';
  muteBtn.setAttribute('aria-label', sfx.isMuted() ? 'Unmute' : 'Mute');
};
renderMute();
muteBtn.addEventListener('click', () => {
  sfx.unlock();
  sfx.toggleMute();
  renderMute();
  muteBtn.blur();
});

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  installBtn.hidden = false;
});
installBtn.addEventListener('click', async () => {
  installBtn.blur();
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  installBtn.hidden = true;
});
window.addEventListener('appinstalled', () => (installBtn.hidden = true));

document.addEventListener('pointerdown', () => sfx.unlock(), { once: true });
document.addEventListener('keydown', () => sfx.unlock(), { once: true });

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
show('menu');
const invited = new URLSearchParams(location.search).get('room');
if (invited && isRoomCode(invited.toUpperCase())) {
  $('codeInput').value = invited.toUpperCase();
  menuMessage(`You've been invited to room ${invited.toUpperCase()}. Pick a name and press Join.`, 'ok');
}
connectOnline();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

// Exposed for automated tests.
window.__ra = { state };
