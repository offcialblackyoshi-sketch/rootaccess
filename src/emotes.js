// Chat fun: slash commands (/me, /shrug, /gg, /roll, /flip, /help), text
// smileys turned into emoji, an emoji picker, and quick-chat buttons that
// change with the game mode. All of it is plain text, so it works with every
// chat and needs no database changes.

export const EMOJI = ['😀', '😂', '😎', '🤔', '😮', '😅', '😭', '😡', '👍', '👎', '👏', '🙌', '🔥', '💯', '🎉', '❤️', '💀', '🤖', '👾', '🔒', '🔓', '💻', '⚡', '🏆'];

// Typed smileys -> emoji (only as separate words, so URLs and code stay as typed).
const SMILEYS = [[':)', '🙂'], [':-)', '🙂'], [':D', '😄'], [';)', '😉'], [':(', '🙁'], [':P', '😛'], [':p', '😛'], [':O', '😮'], [':o', '😮'], ['<3', '❤️'], ['B)', '😎'], [':|', '😐'], ["D:", '😧'], ['xD', '😆'], ['XD', '😆']];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SMILEY_RE = new RegExp(`(^|\\s)(${SMILEYS.map(([k]) => esc(k)).join('|')})(?=\\s|$)`, 'g');
const SMILEY_MAP = Object.fromEntries(SMILEYS);

export function emojify(text) {
  return String(text ?? '').replace(SMILEY_RE, (_, pre, s) => pre + SMILEY_MAP[s]);
}

export const COMMANDS = [
  ['/me <action>', 'say what you\'re doing: /me waves'],
  ['/shrug', '¯\\_(ツ)_/¯'],
  ['/gg', 'good game!'],
  ['/roll', 'roll a dice from 1 to 100'],
  ['/flip', 'flip a coin'],
  ['/help', 'show these commands'],
];

// What a typed chat line becomes. Returns { text } to send, { local } to show
// only to you, or { text: original } for normal messages. rand(): 0..1.
export function parseCommand(input, rand = Math.random) {
  const text = String(input ?? '').trim();
  if (!text.startsWith('/')) return { text };
  const [cmd, ...rest] = text.split(/\s+/);
  const arg = rest.join(' ');
  switch (cmd.toLowerCase()) {
    case '/me':
      return arg ? { text: `/me ${arg}` } : { local: 'Try: /me waves' };
    case '/shrug':
      return { text: `${arg ? arg + ' ' : ''}¯\\_(ツ)_/¯` };
    case '/gg':
      return { text: 'GG! 🎉 good game' };
    case '/roll':
      return { text: `🎲 rolled ${1 + Math.floor(rand() * 100)} (1-100)` };
    case '/flip':
      return { text: `🪙 flipped ${rand() < 0.5 ? 'heads' : 'tails'}` };
    case '/help':
    case '/?':
      return { local: `Chat commands: ${COMMANDS.map(([c, d]) => `${c} (${d})`).join(' · ')}` };
    default:
      return { local: `Unknown command ${cmd}. Type /help for the list.` };
  }
}

// How a received message shows: "/me waves" is an action ("* neo waves").
export function messageView(text) {
  const t = String(text ?? '');
  if (/^\/me\s+\S/.test(t)) return { action: true, text: emojify(t.replace(/^\/me\s+/, '')) };
  return { action: false, text: emojify(t) };
}

// Quick-chat buttons for each game mode. A text ending in "…" is put in the
// box for you to finish (like "Code is …"); the rest send straight away.
const QUICK = {
  any: ['gl hf!', 'gg', 'nice! 👏', 'brb', 'ready! 👍'],
  race: ['Which layer are you on?', 'Found the password! 🔓', 'Stuck on the PIN 😅', 'So close!'],
  duel: ['Bring it! ⚡', 'Too fast 😮', 'Shields up!', 'Rematch?'],
  defend: ['Guard your servers!', 'I\'m being breached! 🚨', 'Nice steal 😎', 'Firewall up!'],
  heist: ['What do you see?', 'Code is …', 'Alarm rising! 🚨', 'Which wire?'],
  quick: ['Too easy 😎', 'Locked out 😅', 'Which stage?', 'Speed run! ⚡'],
};

export function quickChats(mode, family = '') {
  const own = QUICK[mode] || QUICK[family] || [];
  return [...own.slice(0, 4), ...QUICK.any].slice(0, 6); // the mode's own, plus gl hf & gg
}
