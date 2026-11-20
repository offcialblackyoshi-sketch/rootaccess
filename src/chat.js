// Room chat panel. One instance, moved between the lobby and game screens.
import { el } from './util.js';

const MAX_SHOWN = 60;

export function createChat({ onSend, sfx, onEscape = null }) {
  const log = el('div', { class: 'chat-log', role: 'log', 'aria-label': 'Chat messages' });
  const input = el('input', { type: 'text', maxlength: 200, placeholder: 'Message… (Esc: back)', 'aria-label': 'Chat message', autocomplete: 'off' });
  const form = el('form', { class: 'chat-form' }, input);
  const root = el('div', { class: 'chat' }, el('div', { class: 'chat-title' }, '// COMMS'), log, form);
  let lastKey = '';
  let me = null;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    input.value = '';
    if (text) onSend(text);
    else if (onEscape) onEscape(); // Enter on an empty box also goes back
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && onEscape) {
      e.preventDefault();
      onEscape();
    }
  });

  return {
    root,
    focus: () => input.focus(),
    mount(slot) {
      if (root.parentElement !== slot) slot.append(root);
    },
    reset() {
      log.innerHTML = '';
      lastKey = '';
    },
    render(room, myId) {
      me = myId;
      const entries = Object.entries(room?.chat || {}).sort(([a], [b]) => (a < b ? -1 : 1)).slice(-MAX_SHOWN);
      const newest = entries.length ? entries[entries.length - 1][0] : '';
      if (newest === lastKey) return;
      const hadOld = lastKey !== '';
      lastKey = newest;
      log.innerHTML = '';
      for (const [, m] of entries) {
        log.append(el('div', { class: 'chat-msg' },
          el('span', { class: 'chat-name', style: { color: m.color || '#33ff66' } }, m.name + ':'), ' ', m.text));
      }
      log.scrollTop = log.scrollHeight;
      const last = entries[entries.length - 1]?.[1];
      if (hadOld && last && last.uid !== me) sfx.chat();
    },
  };
}
