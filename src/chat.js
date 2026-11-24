// Room chat panel. One instance, moved between the lobby and game screens.
// Also used for the lobby chat. Has slash commands (/me, /roll, /help…),
// an emoji picker, and quick-chat buttons that change with the game mode.
import { el } from './util.js';
import { cleanText } from './filter.js';
import { EMOJI, parseCommand, messageView } from './emotes.js';

const MAX_SHOWN = 60;

// One chat line: "name: text", or "* name waves" for /me actions.
export function chatBody(m) {
  const view = messageView(cleanText(m.text));
  const name = el('span', { class: 'chat-name', style: { color: m.color || '#33ff66' } }, cleanText(m.name) + (view.action ? '' : ':'));
  return view.action ? [el('span', { class: 'chat-action' }, '* ', name, ' ', view.text)] : [name, ' ', view.text];
}

// canDelete/onDelete: lets the owner remove messages (lobby chat).
// quick(): quick-chat texts for right now ([] for none).
export function createChat({ onSend, sfx, onEscape = null, canDelete = () => false, onDelete = null, quick = () => [] }) {
  const log = el('div', { class: 'chat-log', role: 'log', 'aria-label': 'Chat messages' });
  const input = el('input', { type: 'text', maxlength: 200, placeholder: 'Message… (/help, Esc: back)', 'aria-label': 'Chat message', autocomplete: 'off' });
  const picker = el('div', { class: 'emoji-picker', hidden: true, role: 'listbox', 'aria-label': 'Emoji' },
    EMOJI.map((e) => el('button', { type: 'button', class: 'emoji-btn', 'data-emoji': e, 'aria-label': e, onclick: () => insert(e) }, e)));
  const emojiToggle = el('button', { type: 'button', class: 'emoji-toggle', title: 'Emoji', 'aria-label': 'Emoji', 'aria-expanded': 'false', onclick: () => togglePicker() }, '😀');
  const quickRow = el('div', { class: 'quick-chat', hidden: true });
  const form = el('form', { class: 'chat-form' }, input, emojiToggle);
  const root = el('div', { class: 'chat' }, el('div', { class: 'chat-title' }, '// COMMS'), log, quickRow, picker, form);
  let lastKey = '';
  let lastQuick = '';
  let me = null;
  let lastRoom = null;
  const locals = []; // lines only you see (/help, unknown commands)

  function send(raw) {
    const out = parseCommand(raw);
    if (out.local) {
      locals.push(out.local);
      if (locals.length > 3) locals.shift();
      lastKey = '';
      draw(lastRoom);
      return;
    }
    if (out.text) {
      if (locals.length) { locals.length = 0; lastKey = ''; } // your next message clears /help
      onSend(out.text);
    }
  }

  function insert(text) {
    const at = input.selectionStart ?? input.value.length;
    input.value = (input.value.slice(0, at) + text + input.value.slice(input.selectionEnd ?? at)).slice(0, 200);
    togglePicker(false);
    input.focus();
    const pos = Math.min(at + text.length, input.value.length);
    input.setSelectionRange(pos, pos);
  }

  function togglePicker(open = picker.hidden) {
    picker.hidden = !open;
    emojiToggle.setAttribute('aria-expanded', String(open));
  }

  function renderQuick() {
    const list = quick() || [];
    const sig = list.join('|');
    if (sig === lastQuick) return;
    lastQuick = sig;
    quickRow.innerHTML = '';
    quickRow.hidden = !list.length;
    for (const q of list) {
      quickRow.append(el('button', { type: 'button', class: 'quick-chip', 'data-quick': q, onclick: () => {
        // "Code is …" goes in the box for you to finish; the rest send now.
        if (q.endsWith('…')) { input.value = q.slice(0, -1); input.focus(); } else send(q);
      } }, q));
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    input.value = '';
    togglePicker(false);
    if (text) send(text);
    else if (onEscape) onEscape(); // Enter on an empty box also goes back
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && onEscape) {
      e.preventDefault();
      togglePicker(false);
      onEscape();
    }
  });

  function draw(room) {
    renderQuick();
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
        ...chatBody(m),
        mod ? el('button', { type: 'button', class: 'chat-del', title: 'Delete message', 'aria-label': `Delete message from ${m.name}`, onclick: () => onDelete(key) }, '🗑') : null));
    }
    for (const text of locals) log.append(el('div', { class: 'chat-msg chat-local' }, text));
    if (stick || isNew || locals.length) log.scrollTop = log.scrollHeight;
    const last = entries[entries.length - 1]?.[1];
    if (hadOld && isNew && last && last.uid !== me) sfx.chat();
  }

  return {
    root,
    focus: () => input.focus(),
    mount(slot) {
      if (root.parentElement !== slot) slot.append(root);
    },
    reset() {
      log.innerHTML = '';
      lastKey = '';
      locals.length = 0;
    },
    render(room, myId) {
      me = myId;
      lastRoom = room;
      draw(room);
    },
  };
}
