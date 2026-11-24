// Room chat panel. One instance, moved between the lobby and game screens.
import { el } from './util.js';

const MAX_SHOWN = 60;

// canDelete/onDelete: lets the owner remove messages (lobby chat).
export function createChat({ onSend, sfx, onEscape = null, canDelete = () => false, onDelete = null }) {
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
      // Redraw when anything changed (a new message, or one was deleted).
      const sig = `${canDelete() ? 'mod:' : ''}${entries.map(([k]) => k).join(',')}`;
      if (sig === lastKey) return;
      const hadOld = lastKey !== '';
      const isNew = !lastKey.endsWith(newest);
      lastKey = sig;
      const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
      log.innerHTML = '';
      const mod = canDelete() && onDelete;
      for (const [key, m] of entries) {
        log.append(el('div', { class: 'chat-msg', 'data-key': key },
          el('span', { class: 'chat-name', style: { color: m.color || '#33ff66' } }, m.name + ':'), ' ', m.text,
          mod ? el('button', { type: 'button', class: 'chat-del', title: 'Delete message', 'aria-label': `Delete message from ${m.name}`, onclick: () => onDelete(key) }, '🗑') : null));
      }
      if (stick || isNew) log.scrollTop = log.scrollHeight;
      const last = entries[entries.length - 1]?.[1];
      if (hadOld && isNew && last && last.uid !== me) sfx.chat();
    },
  };
}
