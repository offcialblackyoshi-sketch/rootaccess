// A small banner when the internet or the game server drops out, so players
// know why nothing is happening (Firebase reconnects by itself and sends
// your moves when it's back). Short blips are ignored.

import { el } from './util.js';

export const SHOW_AFTER_MS = 1500; // ignore blips shorter than this
export const BACK_MS = 3000;       // how long "Back online" stays

// What to tell the player, or null when all is well.
// online: the browser has internet; serverUp: the game server connection (null = not using it);
// inOnlineRoom: in a room that lives on the server.
export function connectionMessage({ online, serverUp, inOnlineRoom }) {
  if (!online) {
    return inOnlineRoom
      ? { kind: 'down', text: '📡 You\'re offline. Your game will catch up when your internet is back.' }
      : { kind: 'down', text: '📡 You\'re offline. Practice and the tutorial still work.' };
  }
  if (serverUp === false && inOnlineRoom) return { kind: 'down', text: '📡 Lost the connection to the game. Reconnecting…' };
  return null;
}

export function createConnBanner({ now = () => Date.now() } = {}) {
  const box = el('div', { class: 'conn-banner', role: 'status', 'aria-live': 'polite', hidden: true });
  document.body.append(box);
  let downSince = 0;
  let shown = false;
  let timer = null;

  function render(msg) {
    clearTimeout(timer);
    if (msg) {
      downSince ||= now();
      const wait = SHOW_AFTER_MS - (now() - downSince);
      if (wait > 0) { timer = setTimeout(() => render(msg), wait); return; }
      shown = true;
      box.className = 'conn-banner down';
      box.textContent = msg.text;
      box.hidden = false;
      return;
    }
    downSince = 0;
    if (!shown) { box.hidden = true; return; }
    shown = false;
    box.className = 'conn-banner up';
    box.textContent = '✓ Back online!';
    box.hidden = false;
    timer = setTimeout(() => { box.hidden = true; }, BACK_MS);
  }

  return {
    // Call whenever anything changes: update({ online, serverUp, inOnlineRoom }).
    update(state) { render(connectionMessage(state)); },
    get visible() { return !box.hidden; },
    get text() { return box.hidden ? '' : box.textContent; },
  };
}
