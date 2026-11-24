// "How to play" cards for every mode: a few short steps, the controls, and
// a tip. Shown from the ? button on each mode card in the lobby.

import { el } from './util.js';
import { MODES, PUZZLES } from './modes/index.js';

const GUIDES = {
  race: {
    goal: 'Be the first to get "root" on the pretend server.',
    steps: ['Look around with ls and cd, and read files with cat. Type mission to see your goal.', '5 layers: find the password and log in, decrypt the secret file, crack the PIN, find the backdoor, then get root.', 'First to root wins. Your progress shows on the right.'],
    controls: 'Type commands and press Enter. Tab completes names; ↑ ↓ repeats old commands.',
    tip: 'Stuck? Type hint. Each hint costs a little time, and the next one is more exact.',
  },
  duel: {
    goal: 'Knock out everyone else\'s firewall.',
    steps: ['A command appears at the top. Type it exactly and press Enter to fire at your target.', 'A typo drops the packet and resets your streak.', 'Streaks hit harder. BONUS commands repair you or put up a shield.'],
    controls: 'Type, then Enter. Tab switches target.',
    tip: 'Accuracy beats speed: a streak of 6 does almost twice the damage.',
  },
  defend: {
    goal: 'Steal the most data before time runs out.',
    steps: ['You have 3 servers. Breach other players\' servers to steal their data.', 'Watch for attacks on yours: kill breaches and patch your servers.', 'The player with the most data at the end wins.'],
    controls: 'Type commands like scan, breach, trace, kill and patch. Type help for the full list.',
    tip: 'Don\'t only attack: kill breaches fast and patch your servers, or your data walks away.',
  },
  heist: {
    goal: 'Work together to crack the door, the login and the vault before the alarm.',
    steps: ['Everyone gets a different role and sees different clues.', 'Talk in chat: describe what you see, and listen to your crew.', 'Wrong guesses raise the alarm. Reach the vault together to win.'],
    controls: 'Type commands (help lists them). Esc jumps to the chat and back.',
    tip: 'Use the quick-chat buttons: "What do you see?" and "Code is …" save lots of typing.',
  },
  koth: {
    goal: 'Hold THE HILL for the most time.',
    steps: ['Everyone sees the same lock: a sum, a backwards word, a shifted word or scrambled letters.', 'Type the answer first to capture the hill. Each capture puts on a new lock.', 'While you hold it you score every second. Type fortify to block captures for 10 seconds.'],
    controls: 'Type the answer and press Enter. fortify, hill and players are commands too.',
    tip: 'Wrong answers jam your lock for 2 seconds, so think before you guess.',
  },
  gauntlet: {
    goal: 'Clear 5 different quick hacks in a row, fastest wins.',
    steps: ['Each stage is a different mini-game, the same for everyone.', 'A mistake locks you out for a moment.', 'First to clear all 5 stages wins.'],
    controls: 'Arrow keys, Space or Enter, number keys, or the mouse.',
    tip: 'Read the one-line instructions at the top of each stage first.',
  },
};

// The guide for a mode, including the quick-hack mini-games (from their own instructions).
export function guideFor(id) {
  if (GUIDES[id]) return GUIDES[id];
  const p = PUZZLES[id];
  if (p) return { goal: p.blurb, steps: [p.howTo, 'Clear 5 stages; each one is a little harder.', 'A mistake locks you out for a moment. First to clear all 5 wins.'], controls: 'Arrow keys, Space or Enter, number keys, or the mouse. No typing.', tip: 'Go steady: the lockout costs more than a careful second.' };
  return null;
}

let dialog = null;

// Open the card for a mode.
export function showHowTo(id) {
  const g = guideFor(id);
  const m = MODES[id];
  if (!g || !m) return;
  if (!dialog) {
    dialog = el('dialog', { class: 'howto-dialog', 'aria-label': 'How to play' });
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
    document.body.append(dialog);
  }
  dialog.innerHTML = '';
  dialog.append(
    el('div', { class: 'acct-head' }, el('h2', {}, `// HOW TO PLAY: ${m.name.toUpperCase()}`), el('button', { type: 'button', class: 'icon-x', 'aria-label': 'Close', onclick: () => dialog.close() }, '✕')),
    el('p', { class: 'howto-goal' }, '🎯 ', g.goal),
    el('ol', { class: 'howto-steps' }, g.steps.map((s) => el('li', {}, s))),
    el('p', { class: 'small' }, el('strong', {}, '⌨️ Controls: '), g.controls),
    el('p', { class: 'small howto-tip' }, el('strong', {}, '💡 Tip: '), g.tip),
    el('p', { class: 'small dim' }, `${m.min}–${m.max} players${m.bots ? ' · bots OK' : ' · humans only'} · all hacking here is pretend.`),
    el('div', { class: 'actions' }, el('button', { type: 'button', class: 'primary', onclick: () => dialog.close() }, 'Got it!')));
  dialog.showModal();
}
