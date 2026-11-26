// "What to do now" card shown above the terminal in the typing modes.
// It stays on screen (unlike terminal text, which scrolls away) and has
// "Try" buttons that type a command into the terminal for you. Nothing is
// run until you press Enter, so you still learn what each command does.

import { el } from '../util.js';

// ctx: the game context (uses ctx.term). Returns { root, set(state) }.
// state: {
//   steps: [{ icon, label }], at: index of the current step (or steps.length when done),
//   title, text, tries: [{ cmd, label }], tip, glossary: [[word, meaning]], hint: bool
// }
export function createGuide(ctx, { className = '' } = {}) {
  const { term } = ctx;
  const root = el('div', { class: `stage-box guide ${className}`.trim() });
  let last = '';

  // Put a command in the terminal, ready to finish or run with Enter.
  function fill(cmd, run = false) {
    term.input.value = cmd;
    term.input.focus();
    const end = cmd.length;
    term.input.setSelectionRange?.(end, end);
    if (run) term.form.requestSubmit();
  }

  function set(state) {
    const key = JSON.stringify(state);
    if (key === last) return; // only redraw when something changed
    last = key;
    root.innerHTML = '';
    const { steps = [], at = 0 } = state;
    if (steps.length) {
      root.append(el('ol', { class: 'guide-steps', 'aria-label': 'Progress' }, steps.map((s, i) =>
        el('li', { class: i < at ? 'done' : i === at ? 'now' : '' }, el('span', { 'aria-hidden': 'true' }, i < at ? '✔' : s.icon), ' ', s.label))));
    }
    root.append(el('div', { class: 'guide-title' }, state.title || ''));
    if (state.text) root.append(el('p', { class: 'guide-text' }, state.text));
    if (state.tries?.length || state.hint) {
      root.append(el('div', { class: 'guide-tries' },
        el('span', { class: 'dim small' }, 'Try:'),
        (state.tries || []).map((t) => el('button', { type: 'button', class: 'guide-try', 'data-try': t.cmd, title: `Puts "${t.cmd}" in the terminal. Press Enter to run it.`, onclick: () => fill(t.cmd) },
          el('code', {}, t.cmd.trim() + (t.cmd.endsWith(' ') ? ' …' : '')), el('span', { class: 'small' }, t.label))),
        state.hint ? el('button', { type: 'button', class: 'guide-try guide-hint', 'data-try': 'hint', onclick: () => fill('hint', true) }, '💡 ', el('span', {}, 'Hint')) : null));
    }
    if (state.tip) root.append(el('p', { class: 'small guide-tip' }, state.tip));
    if (state.glossary?.length) {
      root.append(el('p', { class: 'small dim guide-glossary' }, state.glossary.map(([w, m], i) => [i ? ' · ' : '', el('code', {}, w), ` ${m}`]).flat()));
    }
  }

  ctx.stage.append(root);
  return { root, set, fill };
}
