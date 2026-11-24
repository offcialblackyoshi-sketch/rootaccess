// App entry: menu → lobby → game → results.
import { getLocalNet, getOnlineNet, onlineConfigured } from './net/index.js';
import { isRoomCode } from './net/shared.js';
import { renderLobby, backToLobby, startGame } from './lobby.js';
import { TUTORIAL_DONE_KEY } from './modes/tutorial.js';
import { startSession } from './game.js';
import { createChat } from './chat.js';
import { sfx } from './sfx.js';
import { el, load, save, playerList, COLORS, fmtTime } from './util.js';
import { initSettingsDialog, getSettings, applySettings } from './settings.js';
import { createOwnerTools, toast, describeBan } from './owner.js';
import { createMatrixRain } from './matrix.js';
import { iconEl } from './icons.js';
import { MODES } from './modes/index.js';
import { initAccount, accountState, signIn, signOut, setHandle, syncProgress, suggestHandle, createAccount, logIn, resetPassword, deleteAccount, accountId } from './account.js';
import { globalBoard, pushMyStats } from './stats.js';
import { todayKey, dailySeed, submitDaily, dailyBoard, myBest, PENALTY_MS } from './daily.js';
import { specialTitle, specialKind } from './progress.js';
import { startBadges } from './badges.js';
import { avatarEl } from './avatar.js';
import { confetti } from './fx/confetti.js';
import { scrambleHeadings } from './fx/scramble.js';
import { createSocial } from './social.js';
import { trophyCount as countTrophies } from './trophies.js';
import { TROPHIES, getTrophyState, saveTrophyState, applyRound, roundEvent, weeklyFor, weekEndsAt, trophyInfo, trophyCount, markFlag } from './trophies.js';
import { getProgress, saveProgress, levelFor, titlesFor, currentTitle, awardRound, UNLOCK_COLORS } from './progress.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Owner: decided by the database (roles/<account id> = "owner"). On this
// computer only, ?local=1&owner=1 previews the owner tools (used by the tests).
// ---------------------------------------------------------------------------
const LOCAL_OWNER_TEST = (() => { const q = new URLSearchParams(location.search); return q.has('local') && q.has('owner'); })();
const ownerMode = () => !!accountState().owner || LOCAL_OWNER_TEST;
const ownerTools = createOwnerTools({ isOwner: ownerMode, sfx });
function renderOwner() {
  const on = ownerMode();
  document.documentElement.classList.toggle('is-owner', on);
  $('ownerBtn').hidden = !on;
  applySettings(); // "Owner gold" style only applies for the owner
  updateRain?.();
  ownerTools.attach(roomNet());
}
$('ownerBtn').addEventListener('click', () => ownerTools.open());
// The ids a ban could be on: this tab, and the signed-in account.
const myIds = () => [roomNet().uid, accountId()];
// Turn "permission denied" into a clear message when you're banned.
function friendlyError(e) {
  const ban = ownerTools.banOf(myIds());
  if (ban && /permission|banned/i.test(String(e?.message || e))) return `You're banned from public chat and public rooms ${describeBan(ban)}.`;
  return e?.message || String(e);
}

// Matrix rain background. Off when "reduce motion" is on.
const rain = createMatrixRain(document.getElementById('matrixBg'));
function updateRain() {
  const s = getSettings();
  // The rain takes its color from the current style; cyberpunk rain is multicolor.
  const tint = getComputedStyle(document.documentElement).getPropertyValue('--rain').trim() || '#33ff66';
  rain.set({ on: s.matrixRain && !s.reduceMotion, rainbow: s.rainbowRain || s.style === 'cyber', tint });
}

// Visual effects requested by the game (wins, roots, captures).
window.addEventListener('ra-fx', (e) => {
  if (e.detail?.burst) rain.burst({ color: e.detail.color || null });
});
updateRain();

initSettingsDialog({ onChange: () => { sfx.unlock(); sfx.tick(); updateRain(); } });

// Icons on the menu buttons.
for (const b of document.querySelectorAll('button[data-icon]')) b.prepend(iconEl(b.dataset.icon));

let social = null; // online players panel (created once the menu is ready)
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
  const changed = document.body.dataset.screen !== name;
  for (const s of document.querySelectorAll('.screen')) {
    s.hidden = s.id !== 'screen-' + name;
    // A short fade/slide when switching screens.
    if (changed && !s.hidden) {
      s.classList.remove('enter');
      void s.offsetWidth;
      s.classList.add('enter');
    }
  }
  document.body.dataset.screen = name;
  social?.setScreen(name);
  if (changed) scrambleHeadings(document.getElementById('screen-' + name));
}

const reducedMotion = () => document.documentElement.classList.contains('reduce-motion');

// Type text into an element a few letters at a time (instant with reduced motion).
function typeInto(node, speed = 28) {
  if (reducedMotion()) return;
  const html = node.innerHTML;
  const text = node.textContent;
  const cursor = el('span', { class: 'cursor' }, ' ');
  node.textContent = '';
  let i = 0;
  const tick = () => {
    node.textContent = text.slice(0, ++i);
    node.append(cursor);
    if (i < text.length) setTimeout(tick, speed);
    else setTimeout(() => (node.innerHTML = html), 600);
  };
  tick();
}

// First visit on this device: a quick "booting" intro (click or key skips it).
function bootIntro() {
  if (load('ra-booted', false) || reducedMotion()) return;
  save('ra-booted', true);
  const box = $('boot');
  const pre = box.querySelector('pre');
  const lines = ['ROOT ACCESS v2.0', '> loading modules ........ OK', '> spoofing coffee machine . OK', '> connecting to the grid .. OK', '', 'welcome, operator.'];
  box.hidden = false;
  let i = 0;
  const finish = () => {
    if (box.classList.contains('done')) return;
    box.classList.add('done');
    setTimeout(() => (box.hidden = true), 450);
  };
  const next = () => {
    pre.textContent = lines.slice(0, ++i).join('\n');
    if (i < lines.length) setTimeout(next, 220);
    else setTimeout(finish, 500);
  };
  next();
  window.addEventListener('pointerdown', finish, { once: true });
  window.addEventListener('keydown', finish, { once: true });
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
  const level = levelFor(getProgress().xp).level;
  // Extra colors unlock as you level up.
  const extra = UNLOCK_COLORS.map(([l, c]) => ({ c, locked: level < l, l }));
  for (const { c, locked, l } of [...COLORS.map((c) => ({ c })), ...extra]) {
    box.append(el('button', {
      class: 'swatch' + (c === myColor ? ' selected' : '') + (locked ? ' locked' : ''),
      style: { background: c },
      'aria-label': locked ? `Color ${c}, unlocks at level ${l}` : 'Color ' + c,
      title: locked ? `Unlocks at level ${l}` : null,
      'aria-pressed': c === myColor ? 'true' : 'false',
      disabled: locked,
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

// Level, XP bar and title picker on the menu.
function renderLevel() {
  const p = getProgress();
  const { level, into, need } = levelFor(p.xp);
  $('levelText').textContent = `LEVEL ${level}`;
  $('levelFill').style.width = `${(100 * into) / need}%`;
  $('levelXp').textContent = `${into}/${need} XP`;
  const pick = $('titlePick');
  pick.innerHTML = '';
  const now = currentTitle(p);
  // A special account title replaces the picker.
  const special = accountState().handle && specialTitle(accountState().handle);
  pick.hidden = !!special;
  $('specialTitle').hidden = !special;
  $('specialTitle').textContent = special || '';
  for (const t of titlesFor(level)) pick.append(el('option', { value: t, selected: t === now }, t));
}
$('titlePick').addEventListener('change', (e) => {
  saveProgress({ ...getProgress(), title: e.target.value });
});
renderLevel();

// ---------------------------------------------------------------------------
// Google account
// ---------------------------------------------------------------------------
function acctMsg(text, kind = 'info') {
  const m = $('accountMsg');
  m.textContent = text || '';
  m.className = `acct-msg small ${kind}`;
}

function renderAccount(a) {
  $('accountCard').hidden = !a.configured;
  const box = $('accountBox');
  box.innerHTML = '';
  const nameInput = $('nameInput');
  nameInput.readOnly = !!(a.user && a.handle);
  if (a.user && a.handle) {
    // Your account handle is your name everywhere.
    nameInput.value = a.handle;
    nameInput.title = 'Your account name.';
    save('ra-name', a.handle);
    box.append(
      el('div', { class: 'acct-who' },
        avatarEl(a.handle, myColor, 40),
        el('div', {}, el('strong', { class: 'acct-name' }, a.handle),
          el('div', { class: 'dim small' }, a.provider === 'google.com' ? 'Signed in with Google' : a.noEmail ? 'Username account · log in with your username' : 'Email account · log in with your email, not your username'))),
      el('div', { class: 'acct-actions' },
        // Username-only accounts log in with their username, so it can't change.
        a.noEmail ? null : el('button', { class: 'mini-btn', type: 'button', onclick: () => openHandleDialog() }, 'Change name'),
        el('button', { class: 'mini-btn', type: 'button', id: 'signOutBtn', onclick: () => { signOut(); acctMsg(''); } }, 'Sign out')),
      el('div', { class: 'acct-id small dim' }, 'Account ID: ', el('code', {}, accountId() || '?'),
        el('button', { class: 'mini-btn', type: 'button', title: 'Copy your account ID', onclick: () => navigator.clipboard?.writeText(accountId() || '').then(() => toast('Account ID copied.', 'ok')).catch(() => {}) }, 'Copy')),
      el('button', { class: 'link-btn danger', type: 'button', id: 'deleteAcctBtn', onclick: () => openDeleteDialog(a) }, 'Delete my account'));
    if (!a.error) acctMsg('Your progress saves to your account.', 'ok');
    const got = markFlag('account', levelFor(getProgress().xp).level);
    if (got.length) acctMsg(`🏆 Trophy unlocked: ${got.map((tr) => tr.name).join(', ')}`, 'ok');
  } else if (a.user) {
    box.append(el('div', { class: 'acct-who' }, el('strong', {}, 'Almost done: pick your name')),
      el('div', { class: 'acct-actions' },
        el('button', { class: 'mini-btn primary', type: 'button', onclick: () => openHandleDialog() }, 'Pick a name'),
        el('button', { class: 'mini-btn', type: 'button', onclick: () => signOut() }, 'Sign out')));
    if (!$('handleDialog').open && !a.error) openHandleDialog();
  } else if (!a.available) {
    box.append(el('p', { class: 'dim small' }, a.connecting ? 'Connecting…' : 'Accounts need an internet connection. You can still play as a guest.'));
  } else {
    nameInput.title = '';
    box.append(
      el('button', { class: 'google-btn wide', type: 'button', id: 'signInBtn', onclick: doSignIn }, 'Continue with Google'),
      el('div', { class: 'or' }, el('span', {}, 'or')),
      el('div', { class: 'acct-pair' },
        el('button', { class: 'mini-btn', type: 'button', id: 'loginOpenBtn', onclick: () => openAuth('login') }, 'Log in'),
        el('button', { class: 'mini-btn primary', type: 'button', id: 'signupOpenBtn', onclick: () => openAuth('signup') }, 'Create account')),
      el('p', { class: 'dim small' }, 'Save your progress on any device and get on the leaderboards. Or just play as a guest.'));
  }
  if (a.error) acctMsg(a.error, 'err');
  renderOwner();
  social?.touch(); // saved chats follow your account
  renderLevel();
  renderColors();
}

// Plain-English help for Google sign-in problems.
function googleError(e) {
  const code = e?.code || '';
  if (code.includes('unauthorized-domain')) return `This website (${location.hostname}) isn't allowed to sign in yet. In Firebase: Authentication → Settings → Authorized domains → add "${location.hostname}".`;
  if (code.includes('operation-not-allowed')) return 'Google sign-in is turned off. In Firebase: Authentication → Sign-in method → Google → Enable, then Save.';
  if (code.includes('popup-blocked')) return 'Your browser blocked the Google window. Allow pop-ups for this site, then try again.';
  if (code.includes('popup-closed') || code.includes('cancelled-popup')) return 'Google sign-in didn\'t finish. School Google accounts are often blocked from signing in to games ("request access"). Use "Create account" instead, or a personal Gmail.';
  if (code.includes('network-request-failed')) return 'No connection to Google. Check your internet (some school networks block it).';
  if (code.includes('internal-error')) return 'Google sign-in hit an error. Check that Google is enabled in Firebase → Authentication → Sign-in method, with a support email set.';
  return `Could not sign in (${code || e?.message || e}).`;
}

async function doSignIn() {
  acctMsg('Opening Google sign-in…');
  try {
    await signIn();
    acctMsg('Signed in! Loading your profile…', 'ok');
  } catch (e) {
    console.warn('google sign-in:', e);
    acctMsg(googleError(e), 'err');
  }
}

// ---- Log in / create account dialog ----
function openAuth(which) {
  showAuthTab(which);
  for (const id of ['loginMsg', 'signupMsg']) $(id).textContent = '';
  $('authDialog').showModal();
  $(which === 'login' ? 'loginId' : 'signupUser').focus();
}
function showAuthTab(which) {
  const login = which === 'login';
  $('loginForm').hidden = !login;
  $('signupForm').hidden = login;
  $('tabLogin').classList.toggle('selected', login);
  $('tabSignup').classList.toggle('selected', !login);
  $('tabLogin').setAttribute('aria-selected', String(login));
  $('tabSignup').setAttribute('aria-selected', String(!login));
}
// Warn when Caps Lock is on (passwords are case-sensitive; on a Chromebook,
// Alt + Search turns Caps Lock on by accident).
function capsWarning(input) {
  const warn = el('p', { class: 'small warn caps-warn', hidden: true }, '⚠ Caps Lock is on');
  input.after(warn);
  const check = (e) => { if (e.getModifierState) warn.hidden = !e.getModifierState('CapsLock'); };
  input.addEventListener('keydown', check);
  input.addEventListener('keyup', check);
  input.addEventListener('blur', () => { warn.hidden = true; });
}
capsWarning($('loginPw'));
capsWarning($('signupPw'));
$('tabLogin').addEventListener('click', () => showAuthTab('login'));
$('tabSignup').addEventListener('click', () => showAuthTab('signup'));
$('authClose').addEventListener('click', () => $('authDialog').close());
$('googleAuthBtn').addEventListener('click', async () => { $('authDialog').close(); await doSignIn(); });
$('authDialog').addEventListener('click', (e) => { if (e.target === $('authDialog')) $('authDialog').close(); });

async function busy(btn, msgEl, fn) {
  btn.disabled = true;
  msgEl.className = 'err small';
  msgEl.textContent = '';
  try {
    await fn();
  } catch (e) {
    msgEl.textContent = e.message;
  } finally {
    btn.disabled = false;
  }
}
$('loginForm').addEventListener('submit', (e) => {
  e.preventDefault();
  busy($('loginBtn'), $('loginMsg'), async () => {
    await logIn($('loginId').value, $('loginPw').value);
    $('loginPw').value = '';
    $('authDialog').close();
  });
});
$('forgotBtn').addEventListener('click', () => busy($('forgotBtn'), $('loginMsg'), async () => {
  await resetPassword($('loginId').value);
  $('loginMsg').className = 'ok small';
  $('loginMsg').textContent = 'Check your email for a link to reset your password.';
}));
$('signupForm').addEventListener('submit', (e) => {
  e.preventDefault();
  busy($('signupBtn'), $('signupMsg'), async () => {
    await createAccount({ username: $('signupUser').value, password: $('signupPw').value, email: $('signupEmail').value });
    $('signupPw').value = '';
    $('authDialog').close();
    pushMyStats({ name: accountState().handle, color: myColor });
    menuMessage(`Welcome, ${accountState().handle}! Your progress now saves to your account.`, 'ok');
  });
});

function openHandleDialog() {
  const a = accountState();
  $('handleInput').value = a.handle || suggestHandle($('nameInput').value || a.user?.name);
  $('handleError').textContent = '';
  $('handleDialog').showModal();
  $('handleInput').select();
}
$('handleForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('handleSave').disabled = true;
  try {
    await setHandle($('handleInput').value.trim());
    await syncProgress({ color: myColor });
    $('handleDialog').close();
    pushMyStats({ name: accountState().handle, color: myColor });
  } catch (err) {
    $('handleError').textContent = err.message;
  } finally {
    $('handleSave').disabled = false;
  }
});
$('handleCancel').addEventListener('click', () => $('handleDialog').close());

function myName() {
  let n = $('nameInput').value.trim().replace(/[^\w.\-]/g, '').slice(0, 14) || 'anon';
  // Names with a special title are only for whoever is signed in as them.
  if (specialTitle(n) && accountState().handle?.toLowerCase() !== n.toLowerCase() && !(LOCAL_OWNER_TEST && specialKind(n) === 'owner')) n = n.slice(0, 10) + '_fan';
  save('ra-name', n);
  return n;
}
// Your title: an account's special title, or the one you picked.
const myTitle = () => (accountState().handle && specialTitle(accountState().handle)) || currentTitle();

function makePlayer(net, room) {
  let name = myName();
  const taken = new Set(Object.values(room?.players || {}).map((p) => p.name));
  for (let i = 2; taken.has(name); i++) name = myName().slice(0, 12) + i;
  // Keep colors unique in the room.
  const usedColors = new Set(Object.values(room?.players || {}).map((p) => p.color));
  const color = usedColors.has(myColor) ? COLORS.find((c) => !usedColors.has(c)) || myColor : myColor;
  return { name, color, ready: false, joinedAt: net.now(), level: levelFor(getProgress().xp).level, title: myTitle(), special: !!(accountState().handle && specialTitle(accountState().handle)) };
}

// When the owner shows up in a room: a gold celebration for everyone.
function ownerArrives(p) {
  if (specialKind(p.name) !== 'owner') return;
  toast(`👑 ${p.name}, the owner, has entered the room!`, 'owner', 4500);
  rain.burst({ color: '#ffd23d' });
  confetti({ from: 'center', amount: 70, colors: ['#ffd23d', '#ffb000', '#fff3b0'] });
  sfx.win();
}

// ---------------------------------------------------------------------------
// Delete my account
// ---------------------------------------------------------------------------
const delPw = el('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Your password', 'aria-label': 'Your password' });
const delConfirm = el('input', { type: 'text', autocomplete: 'off', placeholder: 'Type DELETE', 'aria-label': 'Type DELETE to confirm' });
const delMsg = el('p', { class: 'small err' });
const delGo = el('button', { type: 'button', class: 'danger-btn', id: 'deleteGo' }, 'Delete forever');
const delDialog = el('dialog', { class: 'owner-dialog', id: 'deleteDialog', 'aria-label': 'Delete my account' },
  el('h2', {}, '// DELETE ACCOUNT'),
  el('p', {}, 'This permanently deletes your account: your name becomes free for anyone, and your saved XP, trophies and leaderboard rows are removed. Progress saved on this device stays.'),
  delPw, delConfirm,
  el('div', { class: 'actions' }, delGo, el('button', { type: 'button', onclick: () => delDialog.close() }, 'Cancel')),
  delMsg);
document.body.append(delDialog);
function openDeleteDialog(a) {
  // Google accounts confirm in the Google window instead of a password.
  delPw.hidden = a.provider === 'google.com';
  delPw.value = '';
  delConfirm.value = '';
  delMsg.textContent = '';
  delDialog.showModal();
}
delGo.addEventListener('click', async () => {
  if (delConfirm.value.trim().toUpperCase() !== 'DELETE') { delMsg.textContent = 'Type DELETE to confirm.'; return; }
  delGo.disabled = true;
  delMsg.textContent = '';
  try {
    await deleteAccount(delPw.value);
    delDialog.close();
    menuMessage('Your account was deleted. You can keep playing as a guest.', 'ok');
  } catch (e) {
    delMsg.textContent = e.message;
  } finally {
    delGo.disabled = false;
  }
});

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
    social?.touch(); // move the online-players panel onto the real network
    status.innerHTML = '';
    status.append(el('span', { class: 'ok' }, '● ONLINE'), ' Ready to create or join rooms.');
  } else {
    state.onlineError = res.error;
    status.innerHTML = '';
    status.append(el('span', { class: 'err' }, '● CAN’T CONNECT'), ` ${String(res.error).replace(/\.+$/, '')}. Rooms will only work between tabs on this computer.`);
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
    menuMessage(friendlyError(e));
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

async function createRoom(isPublic = false) {
  const net = roomNet();
  const room = { hostId: net.uid, mode: 'race', status: 'lobby', createdAt: net.now(), round: 0, public: isPublic };
  room.players = { [net.uid]: { ...makePlayer(net, room), ready: true } };
  const code = await net.createRoom(room);
  closeBrowse();
  enterRoom(net, code);
}
$('createBtn').addEventListener('click', (e) => withBusy(e.target, () => createRoom(false)));

// ---------------------------------------------------------------------------
// Multiplayer lobby: open public rooms + lobby chat
// ---------------------------------------------------------------------------
const LISTING_STALE_MS = 90000; // hide rooms whose host stopped refreshing
const browse = { net: null, off: null, data: { rooms: {}, chat: {} } };
const lobbyChat = createChat({
  sfx,
  onSend: (text) => browse.net?.lobbySay({ name: myName(), color: myColor, text: text.slice(0, 200) }).catch((e) => toast(friendlyError(e), 'err')),
  canDelete: () => ownerMode(),
  onDelete: (key) => ownerTools.deleteLobbyMsg(key).catch((e) => toast(`Couldn't delete: ${e.message}`, 'err')),
});
lobbyChat.root.querySelector('.chat-title').textContent = '// LOBBY CHAT';

function openBrowse() {
  closeBrowse();
  browse.net = roomNet();
  $('browseNet').textContent = browse.net.kind === 'online'
    ? 'Online lobby: everyone playing Root Access right now.'
    : 'Local lobby: only tabs on this computer (online play is not connected).';
  lobbyChat.reset();
  lobbyChat.mount($('browseChat'));
  show('browse');
  browse.off = browse.net.lobbyWatch((d) => { browse.data = d; renderBrowse(); });
  browse.tick = setInterval(renderBrowse, 10000);
}
function closeBrowse() {
  browse.off?.();
  browse.off = null;
  clearInterval(browse.tick);
}
function renderBrowse() {
  const { rooms, chat } = browse.data;
  lobbyChat.render({ chat }, browse.net?.uid);
  const now = browse.net?.now() ?? Date.now();
  const open = Object.entries(rooms || {})
    .filter(([, r]) => r && now - (r.at || 0) < LISTING_STALE_MS && (r.players || 0) < (r.max || 8))
    .sort(([, a], [, b]) => (b.players || 0) - (a.players || 0) || (b.at || 0) - (a.at || 0));
  const list = $('browseRooms');
  list.innerHTML = '';
  $('browseCount').textContent = `${open.length} open`;
  if (!open.length) list.append(el('li', { class: 'browse-empty dim' }, 'No public rooms right now. Create one and others can join from here!'));
  for (const [code, r] of open) {
    const mode = MODES[r.mode];
    list.append(el('li', { class: 'browse-room', style: { '--mode': r.color || 'var(--accent)' } },
      el('span', { class: 'browse-icon' }, iconEl(r.mode)),
      el('div', { class: 'browse-info' },
        el('strong', {}, r.name),
        el('div', { class: 'dim small' }, `${mode?.name || r.mode} · ${r.players}/${r.max || 8} players`)),
      el('button', { class: 'primary mini-btn', 'data-join': code, onclick: (e) => withBusy(e.target, async () => { await joinCode(code); if (state.code) closeBrowse(); }) }, 'Join'),
      ownerMode() ? el('button', { class: 'mini-btn danger', 'data-close': code, title: 'Close this room for everyone', onclick: () => { if (confirm(`Close ${r.name} for everyone in it?`)) ownerTools.closeRoom(code).then(() => toast('Room closed.', 'ok')).catch((e) => toast(`Couldn't close it: ${e.message}`, 'err')); } }, 'Close') : null));
  }
}
$('browseBtn').addEventListener('click', () => { sfx.unlock(); menuMessage(''); openBrowse(); });
$('browseBack').addEventListener('click', () => { closeBrowse(); show('menu'); });
$('browseCreate').addEventListener('click', (e) => withBusy(e.target, () => createRoom(true)));

// The host keeps a public room's listing up to date (and removes it when the
// game starts, the room fills up, or the room goes private).
let lastListing = '';
function syncListing(room) {
  const net = state.net;
  if (!net?.lobbyList || room.hostId !== net.uid) return;
  const players = Object.keys(room.players || {}).length;
  const host = room.players?.[room.hostId];
  const want = room.public && !room.practice && room.status === 'lobby' && players < 8
    ? { name: `${host?.name || 'someone'}'s room`, mode: room.mode, players, max: 8 }
    : null;
  const key = `${state.code}:${JSON.stringify(want)}`;
  if (key === lastListing && (!want || Date.now() - (syncListing.at || 0) < 30000)) return;
  lastListing = key;
  syncListing.at = Date.now();
  net.lobbyList(state.code, want).catch(() => {});
}
setInterval(() => { if (state.room) syncListing(state.room); }, 30000);

async function join() {
  return joinCode($('codeInput').value.trim().toUpperCase());
}
async function joinCode(code) {
  if (!isRoomCode(code)) return menuMessage('Room codes are 4 letters, like QXFT.');
  const net = roomNet();
  const room = await net.getRoom(code);
  if (!room || !room.players) return menuMessage(`No room called ${code}. Check the code${net.kind === 'local' ? ' (local mode only sees rooms in this browser)' : ''}.`);
  if (room.kicked?.[net.uid]) return menuMessage('The host removed you from that room.');
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
  const me = { ...makePlayer(net, room), ready: true };
  // Bots get colors different from yours.
  const [c1, c2] = COLORS.filter((c) => c !== me.color);
  room.players = {
    [net.uid]: me,
    'bot-a': { name: 'n3m0', color: c1, bot: true, ready: true, joinedAt: now + 1 },
    'bot-b': { name: 'gh0st', color: c2, bot: true, ready: true, joinedAt: now + 2 },
  };
  return room;
}

$('practiceBtn').addEventListener('click', (e) => withBusy(e.target, async () => {
  const net = getLocalNet();
  const code = await net.createRoom(practiceRoom(net, 'race'));
  enterRoom(net, code);
}));

// Daily Challenge: today's Hack Gauntlet, solo, same puzzles for everyone.
async function startDaily() {
  const net = getLocalNet();
  const date = todayKey();
  const now = net.now();
  const room = {
    hostId: net.uid, mode: 'gauntlet', status: 'lobby', createdAt: now, round: 0, practice: true,
    daily: date, fixedSeed: dailySeed(date),
    players: { [net.uid]: { ...makePlayer(net, {}), ready: true } },
  };
  const code = await net.createRoom(room);
  await startGame(room, net, code);
  enterRoom(net, code);
}
$('dailyBtn').addEventListener('click', (e) => withBusy(e.target, startDaily));

// Draws today's board into a list element.
async function renderBoard(listEl, noteEl) {
  listEl.innerHTML = '';
  listEl.append(el('li', { class: 'dim' }, 'Loading…'));
  const date = todayKey();
  const { rows, where, me } = await dailyBoard(date);
  listEl.innerHTML = '';
  if (!rows.length) listEl.append(el('li', { class: 'dim' }, 'No runs yet today. Be the first!'));
  rows.forEach((r, i) => listEl.append(el('li', { class: r.id === me ? 'me' : '' },
    el('span', { class: 'place' }, `#${i + 1}`),
    el('span', { class: 'pname' }, r.name),
    el('span', { class: 'dim' }, r.mistakes ? `${fmtTime(r.ms)} + ${r.mistakes}×${PENALTY_MS / 1000}s` : fmtTime(r.ms)),
    el('strong', {}, fmtScore(r.score)))));
  const best = myBest(date);
  noteEl.textContent = `${date} (UTC) · ${where === 'online' ? 'everyone online' : 'this device only'}${best !== null ? ` · your best ${fmtScore(best)}` : ''}${where === 'online' && !accountState().handle ? ' · sign in with Google to get on the board' : ''}`;
}
const fmtScore = (ms) => `${(ms / 1000).toFixed(1)}s`;

// All-time leaderboard: everyone's XP, level, rounds and wins.
async function renderStatsBoard() {
  const list = $('statsList');
  list.innerHTML = '';
  list.append(el('li', { class: 'dim' }, 'Loading…'));
  const { rows, where, me } = await globalBoard({ name: myName(), color: myColor });
  list.innerHTML = '';
  list.append(el('li', { class: 'board-head dim' }, el('span', {}, '#'), el('span', {}, 'player'), el('span', {}, 'level'), el('span', {}, 'XP'), el('span', {}, 'wins'), el('span', {}, '🏆')));
  rows.forEach((r, i) => list.append(el('li', { class: r.id === me ? 'me' : '' },
    el('span', { class: 'place' }, `#${i + 1}`),
    el('span', { class: 'board-name' }, avatarEl(r.name, r.color, 18), ' ', el('span', { class: 'pname' }, r.name), !specialTitle(r.name) && r.title ? el('span', { class: 'dim small' }, ` · ${r.title}`) : null),
    el('span', {}, `LV${r.level}`),
    el('strong', {}, String(r.xp)),
    el('span', {}, `${r.wins}/${r.rounds}`),
    el('span', {}, String(r.trophies ?? '–')))));
  $('statsNote').textContent = where !== 'online' ? 'This device only (online play is not set up or not reachable).'
    : accountState().handle ? 'Everyone online · top 50' : 'Everyone online · top 50 · sign in with Google to get on the board';
}
function showTab(which) {
  for (const [t, pane] of [['tabAll', 'paneAll'], ['tabToday', 'paneToday']]) {
    const on = t === which;
    $(t).classList.toggle('selected', on);
    $(t).setAttribute('aria-selected', String(on));
    $(pane).hidden = !on;
  }
  if (which === 'tabAll') renderStatsBoard();
  else renderBoard($('boardList'), $('boardNote'));
}
$('tabAll').addEventListener('click', () => showTab('tabAll'));
$('tabToday').addEventListener('click', () => showTab('tabToday'));
$('boardBtn').addEventListener('click', () => {
  $('boardDialog').showModal();
  showTab('tabAll');
});
$('boardClose').addEventListener('click', () => $('boardDialog').close());

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
  onEscape: () => (document.querySelector('#term .term-in input:not(:disabled)') || document.querySelector('.quick-box'))?.focus(),
});

// ---------------------------------------------------------------------------
// Room lifecycle
// ---------------------------------------------------------------------------
// Remember the room in this tab, so a reload puts you back in your seat.
const SEAT_KEY = 'ra-seat';
function rememberSeat(seat) {
  try {
    if (seat) sessionStorage.setItem(SEAT_KEY, JSON.stringify(seat));
    else sessionStorage.removeItem(SEAT_KEY);
  } catch { /* storage blocked: reloads just go to the menu */ }
}

async function resumeSeat() {
  let seat = null;
  try { seat = JSON.parse(sessionStorage.getItem(SEAT_KEY)); } catch { seat = null; }
  if (!seat?.code) return false;
  const net = seat.kind === 'online' ? (await getOnlineNet()).net : getLocalNet();
  if (!net) return false;
  const room = await net.getRoom(seat.code).catch(() => null);
  const ok = room && await net.rejoin(seat.code, room.players?.[net.uid] || makePlayer(net, room)).catch(() => false);
  if (!ok) {
    rememberSeat(null);
    menuMessage(`Couldn't get back into room ${seat.code}. The game may have started or the room closed.`, 'warn');
    return false;
  }
  enterRoom(net, seat.code);
  return true;
}

function enterRoom(net, code) {
  state.net = net;
  state.code = code;
  rememberSeat({ code, kind: net.kind });
  state.room = null;
  state.shownResultsFor = null;
  chat.reset();
  state.unwatch = net.watch(code, onRoom);
  if (net.kind === 'online') history.replaceState(null, '', '?room=' + code);
}

async function leaveRoom(message = '') {
  const { net, code } = state;
  // A host leaving takes the room off the public list (the next host re-lists it).
  if (net?.lobbyList && state.room?.public && state.room.hostId === net.uid) net.lobbyList(code, null).catch(() => {});
  lastListing = '';
  rememberSeat(null);
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
    leaveRoom(!room ? 'The room was closed.' : room.kicked?.[me] ? 'The host removed you from the room.' : 'You left the room.');
    return;
  }
  state.room = room;
  syncListing(room);

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
    renderLobby({ room, net: state.net, code: state.code, onLeave: () => leaveRoom(), canModerate: ownerMode(), onArrive: ownerArrives });
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
  renderPodium(results);
  for (const [i, r] of results.entries()) {
    list.append(el('li', { class: r.id === me ? 'me' : '', style: { '--i': i } },
      el('span', { class: 'place' }, r.place ? `#${r.place}` : ''),
      avatarEl(r.name.replace(/ \[[AB-]\]$/, ''), r.color, 26),
      el('div', { class: 'who' },
        el('span', { class: 'pname' }, r.name + (r.id === me ? ' (you)' : '')),
        r.stats ? el('div', { class: 'stats' }, r.stats) : null),
      el('span', { class: 'detail' }, r.detail || '')));
  }
  const actions = $('resultsActions');
  actions.innerHTML = '';
  $('dailyResults').hidden = !room.daily;
  if (room.daily) {
    // Daily Challenge: retry the same puzzles, or leave.
    actions.append(el('button', { class: 'primary', id: 'dailyAgainBtn', onclick: () => startGame(state.room, state.net, state.code) }, '↻ Try again'));
    actions.append(el('button', { onclick: () => leaveRoom() }, 'Leave'));
    if (state.boardFor !== room.round) {
      state.boardFor = room.round;
      const mine = (room.results || []).find((r) => r.id === me);
      const run = mine?.raw;
      const finished = run && run.ms !== null && run.stage >= 5;
      $('dailyScore').textContent = finished
        ? `Score ${fmtScore(run.ms + run.mistakes * PENALTY_MS)} (${fmtTime(run.ms)} + ${run.mistakes} mistake${run.mistakes === 1 ? '' : 's'} × ${PENALTY_MS / 1000}s)`
        : 'Clear all 5 stages to get on the board.';
      (finished ? submitDaily(room.daily, { name: mine.name, ms: run.ms, mistakes: run.mistakes }) : Promise.resolve())
        .then(() => renderBoard($('dailyList'), $('dailyNote')));
    }
    return finishResults(room, results, me);
  }
  if (isHost) actions.append(el('button', { class: 'primary', id: 'againBtn', onclick: () => backToLobby(state.room, state.net, state.code) }, '↻ Back to lobby'));
  else actions.append(el('p', { class: 'dim' }, 'Waiting for the host…'));
  actions.append(el('button', { onclick: () => leaveRoom() }, 'Leave'));
  finishResults(room, results, me);
}

// XP, sounds and effects: once per round.
function finishResults(room, results, me) {
  if (state.shownResultsFor !== room.round) {
    state.shownResultsFor = room.round;
    // XP for this round (once per round, spectators and quitters get none).
    const mineR = results.find((r) => r.id === me);
    // Team games mark each player's result as won or not; co-op uses summaryWin.
    const won = mineR && typeof mineR.won === 'boolean' ? mineR.won : room.summaryWin ?? results[0]?.id === me;
    $('xpGain').hidden = !mineR;
    $('trophyGain').hidden = true;
    if (mineR) {
      const humansAndBots = results.length;
      const award = awardRound({ place: mineR.place, players: humansAndBots, won: mineR.won ?? mineR.place === 1, modeId: room.mode });
      // Trophies earned this round.
      const tr = applyRound(getTrophyState(), roundEvent({ room, mine: mineR, won }), award.after.level);
      saveTrophyState(tr.state);
      showNewTrophies(tr.unlocked);
      $('xpGain').innerHTML = '';
      $('xpGain').append(...[
        el('span', { class: 'xp-plus' }, `+${award.gained} XP`),
        el('span', { class: 'xp-level' }, `LEVEL ${award.after.level}`),
        el('span', { class: 'xp-bar' }, el('span', { style: { width: `${(100 * award.after.into) / award.after.need}%` } })),
        award.levelUp ? el('strong', { class: 'xp-up' }, '▲ LEVEL UP!') : null].filter(Boolean));
      if (award.levelUp) setTimeout(() => { rain.burst({ color: '#39ff6a' }); confetti({ from: 'center', amount: 90 }); }, 600);
      renderLevel();
      renderColors();
      pushMyStats({ name: myName(), color: myColor }); // update the global leaderboard
      social?.touch(); // and what others see in the online-players panel
      syncProgress({ color: myColor }); // and your Google account, if signed in
    }
    if (won) {
      confetti({ amount: 160 });
      sfx.win();
      rain.burst({ color: '#ffd23d' });
    } else sfx.lose();
  }
}

// "🏆 Trophy unlocked" cards on the results screen.
function showNewTrophies(list) {
  const box = $('trophyGain');
  box.innerHTML = '';
  box.hidden = !list.length;
  for (const [i, tr] of list.entries()) {
    box.append(el('div', { class: 'trophy-pop' + (tr.week ? ' weekly' : ''), style: { '--i': i } },
      el('span', { class: 'trophy-icon' }, tr.icon),
      el('div', {}, el('div', { class: 'small dim' }, tr.week ? 'WEEKLY TROPHY UNLOCKED' : 'TROPHY UNLOCKED'), el('strong', {}, tr.name))));
  }
  if (list.length) setTimeout(() => { sfx.ok(); rain.burst({ color: '#ffd23d' }); confetti({ from: 'center', amount: 60, colors: ['#ffd23d', '#ffb000', '#fff3b0'] }); }, 900);
}

// ---------------------------------------------------------------------------
// Trophy case (menu)
// ---------------------------------------------------------------------------
function fmtLeft(ms) {
  const h = Math.max(0, Math.floor(ms / 3600000));
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${Math.max(0, Math.floor((ms % 3600000) / 60000))}m`;
}
function trophyCard(tr, got, extra = null) {
  return el('div', { class: 'trophy' + (got ? ' got' : ''), title: tr.desc },
    el('span', { class: 'trophy-icon' }, got ? tr.icon : '🔒'),
    el('div', {}, el('strong', {}, tr.name), el('div', { class: 'small dim' }, tr.desc), extra));
}
function renderTrophies() {
  const s = getTrophyState();
  const box = $('trophyList');
  box.innerHTML = '';
  const total = TROPHIES.length;
  const have = TROPHIES.filter((tr) => s.unlocked[tr.id]).length;
  const weeklies = Object.keys(s.unlocked).filter((id) => id.startsWith('weekly-')).sort().reverse();
  $('trophyCount').textContent = `${have}/${total} trophies · ${weeklies.length} weekly`;
  // This week's trophy first.
  const wk = weeklyFor();
  const got = !!s.unlocked[wk.id];
  const n = s.w?.week === wk.week ? s.w.n : 0;
  box.append(el('h3', {}, `// THIS WEEK · new one in ${fmtLeft(weekEndsAt() - Date.now())}`),
    el('div', { class: 'trophy-grid' }, trophyCard(wk, got, el('div', { class: 'small trophy-progress' }, got ? 'Earned!' : `${Math.min(n, wk.target)}/${wk.target}`))));
  if (weeklies.length) {
    box.append(el('h3', {}, '// PAST WEEKLY TROPHIES'),
      el('div', { class: 'trophy-grid' }, weeklies.filter((id) => id !== wk.id).map((id) => trophyCard(trophyInfo(id), true, el('div', { class: 'small dim' }, id.slice(7))))));
  }
  const cats = [...new Set(TROPHIES.map((tr) => tr.cat))];
  for (const cat of cats) {
    const list = TROPHIES.filter((tr) => tr.cat === cat);
    box.append(el('h3', {}, `// ${cat.toUpperCase()} · ${list.filter((tr) => s.unlocked[tr.id]).length}/${list.length}`),
      el('div', { class: 'trophy-grid' }, list.map((tr) => trophyCard(tr, !!s.unlocked[tr.id]))));
  }
}
$('trophyBtn').addEventListener('click', () => {
  renderTrophies();
  $('trophyDialog').showModal();
});
$('trophyClose').addEventListener('click', () => $('trophyDialog').close());
$('trophyDialog').addEventListener('click', (e) => { if (e.target === $('trophyDialog')) $('trophyDialog').close(); });

// Top-3 podium on the results screen (only when there are places).
function renderPodium(results) {
  const box = $('podium');
  box.innerHTML = '';
  const top = results.filter((r) => r.place >= 1 && r.place <= 3);
  box.hidden = top.length < 2;
  for (const r of top) {
    box.append(el('div', { class: `step p${r.place}` },
      el('div', { class: 'name podium-name', style: { color: r.color } }, r.name),
      el('div', { class: 'block' }, String(r.place))));
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
// Click the big room code to copy it.
$('lobbyCode').addEventListener('click', async () => {
  if (!state.code || state.room?.practice) return;
  try {
    await navigator.clipboard.writeText(state.code);
    $('lobbyNet').textContent = `Room code ${state.code} copied!`;
  } catch { /* clipboard blocked: the code is on screen anyway */ }
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
bootIntro();
typeInto($('tagline'));
const invited = new URLSearchParams(location.search).get('room');
if (invited && isRoomCode(invited.toUpperCase())) {
  $('codeInput').value = invited.toUpperCase();
  menuMessage(`You've been invited to room ${invited.toUpperCase()}. Pick a name and press Join.`, 'ok');
}
connectOnline().then(() => { renderOwner(); return invited ? false : resumeSeat(); });
renderOwner();
initAccount(renderAccount).catch((e) => console.warn('account:', e.message));

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

// Exposed for automated tests.
window.__ra = { state, sfx, rain, renderAccount };
startBadges(); // special titles next to names everywhere
// Dialogs "decrypt" their headings as they open.
const showModal = HTMLDialogElement.prototype.showModal;
HTMLDialogElement.prototype.showModal = function () { showModal.call(this); scrambleHeadings(this); };

// Online players panel: what others see about you, and what you're doing.
social = createSocial({
  sfx,
  owner: {
    isOwner: ownerMode,
    banOf: (ids) => ownerTools.banOf(ids),
    ban: (ids, length, name) => ownerTools.ban(ids, length, name),
    unban: (ids) => ownerTools.unban(ids),
  },
  getNet: roomNet,
  profile: () => {
    const p = getProgress();
    const a = accountState();
    return {
      name: myName(), color: myColor, level: levelFor(p.xp).level, title: myTitle(), xp: p.xp,
      rounds: p.rounds, wins: Math.min(p.wins, p.rounds), trophies: countTrophies(), signedIn: !!(a.user && a.handle),
    };
  },
  status: () => {
    const scr = document.body.dataset.screen;
    const room = state.room;
    if (scr === 'game' && room) return `playing ${MODES[room.mode]?.name || 'a game'}`;
    if (scr === 'results') return 'finishing a round';
    if (scr === 'lobby') return room?.practice ? 'practicing' : 'in a room';
    if (scr === 'browse') return 'in the multiplayer lobby';
    return 'on the menu';
  },
});
social.setScreen(document.body.dataset.screen || 'menu'); // renderAccount: lets tests preview the account card
