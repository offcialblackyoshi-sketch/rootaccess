// CrazyGames: when the game runs on CrazyGames, use their SDK. Saves go to
// their Data Module (synced to the player's CrazyGames account), gameplay
// start/stop is reported, and their "mute audio" and "disable chat" settings
// are respected. Everywhere else (GitHub Pages, local tests) this does
// nothing and loads nothing.
//
// util.js imports this first, so the SDK is ready before the game reads any
// saved data.

const SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';

export const cg = { active: false, sdk: null };

// Only try where CrazyGames could be hosting us: inside a frame (game sites
// embed games), on a CrazyGames address, or their local test switch.
function maybeCrazyGames() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  let framed = false;
  try { framed = window.self !== window.top; } catch { framed = true; }
  const q = new URLSearchParams(location.search);
  // Other sites that frame games (itch.io) aren't CrazyGames: don't load their SDK there.
  if (/(^|\.)(itch\.zone|itch\.io|github\.io)$/i.test(location.hostname)) return q.has('useLocalSdk');
  return framed || /(^|\.)crazygames\./i.test(location.hostname) || q.has('useLocalSdk');
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('could not load the CrazyGames SDK'));
    document.head.append(s);
  });
}

async function init() {
  if (!maybeCrazyGames()) return;
  try {
    await loadScript(SDK_URL);
    const sdk = window.CrazyGames?.SDK;
    if (!sdk) return;
    await sdk.init();
    // 'disabled' means not on CrazyGames (every SDK call would throw).
    if (sdk.environment === 'disabled') return;
    cg.sdk = sdk;
    cg.active = true;
    // Saves go to the Data Module (same getItem/setItem shape as localStorage).
    globalThis.__raStore = sdk.data;
    document.documentElement.classList.add('on-crazygames');
    try { sdk.game.loadingStart(); } catch { /* not important */ }
  } catch (e) {
    console.warn('CrazyGames SDK not available:', e.message);
  }
}

await init();

let playing = false;
const safe = (fn) => { if (!cg.active) return; try { fn(cg.sdk); } catch (e) { console.warn('CrazyGames SDK:', e.message); } };

// Tell CrazyGames when real play starts and stops (menus, lobby and results are breaks).
export function setPlaying(on) {
  if (on === playing) return;
  playing = on;
  safe((sdk) => (on ? sdk.game.gameplayStart() : sdk.game.gameplayStop()));
}
export const loadingDone = () => safe((sdk) => sdk.game.loadingStop());
export const happyTime = () => safe((sdk) => sdk.game.happytime());

// CrazyGames' own settings: { muteAudio, disableChat }. onChange is called now and on every change.
export function watchSettings(onChange) {
  if (!cg.active) return;
  const read = () => ({ muteAudio: !!cg.sdk.game.settings?.muteAudio, disableChat: !!cg.sdk.game.settings?.disableChat });
  onChange(read());
  safe((sdk) => sdk.game.addSettingsChangeListener(() => onChange(read())));
}

// ---- Multiplayer: instant multiplayer, invites and room status ----
// Test switches for their local test mode only: ?cgInstant=1 and ?roomId=ABCD.
const localTest = () => cg.active && cg.sdk.environment === 'local';
const query = () => new URLSearchParams(typeof location === 'undefined' ? '' : location.search);

// Started from CrazyGames' multiplayer button: go straight into a new private room.
export function instantMultiplayer() {
  if (!cg.active) return false;
  try { if (cg.sdk.game.isInstantMultiplayer) return true; } catch { /* older SDK */ }
  return localTest() && query().has('cgInstant');
}

// The room code from a CrazyGames invite link (or null).
export function invitedRoom() {
  if (!cg.active) return null;
  let code = null;
  try { code = cg.sdk.game.inviteParams?.roomId || cg.sdk.game.getInviteParam('roomId'); } catch { code = null; }
  if (!code && localTest()) code = query().get('roomId');
  return code ? String(code).toUpperCase() : null;
}

// A friend's invite clicked while the game is already open.
export function onJoinRoom(cb) {
  safe((sdk) => sdk.game.addJoinRoomListener((params) => { if (params?.roomId) cb(String(params.roomId).toUpperCase()); }));
}

// Tell CrazyGames which room you're in, so friends can join from their UI.
let shared = '';
export function shareRoom(code, joinable) {
  const key = `${code}:${joinable}`;
  if (!cg.active || key === shared) return;
  shared = key;
  safe((sdk) => sdk.game.updateRoom({ roomId: code, isJoinable: !!joinable, inviteParams: { roomId: code } }));
}
export function leftRoom() {
  if (!cg.active || !shared) return;
  shared = '';
  safe((sdk) => sdk.game.leftRoom());
}

// A CrazyGames invite link for a room (null when not on CrazyGames).
export function inviteLinkFor(code) {
  if (!cg.active) return null;
  try { return cg.sdk.game.inviteLink({ roomId: code }); } catch { return null; }
}
