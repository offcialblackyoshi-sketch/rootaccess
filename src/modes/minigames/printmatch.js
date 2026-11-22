// PRINT MATCH: a target print is split into parts. Pick the real parts out of
// a grid of look-alikes, then submit.

import { el } from '../../util.js';

const SIZE = 5; // each part is a 5x5 pattern
const PARTS = [2, 2, 3, 3, 4];
const TOTAL = [6, 6, 8, 8, 10];
const FLIPS = [8, 6, 5, 4, 3]; // how different a look-alike is from a real part

export const distance = (a, b) => a.reduce((n, v, i) => n + (v !== b[i] ? 1 : 0), 0);

function randomPattern(rng) {
  return Array.from({ length: SIZE * SIZE }, () => (rng.next() < 0.48 ? 1 : 0));
}

export function generate(rng, stage) {
  const parts = [];
  while (parts.length < PARTS[stage]) {
    const p = randomPattern(rng);
    if (parts.every((q) => distance(p, q) >= 8)) parts.push(p);
  }
  const options = parts.map((bits) => ({ bits, real: true }));
  while (options.length < TOTAL[stage]) {
    const bits = rng.pick(parts).slice();
    const cells = rng.shuffle([...bits.keys()]).slice(0, FLIPS[stage]);
    for (const c of cells) bits[c] ^= 1;
    if (options.every((o) => distance(o.bits, bits) > 0)) options.push({ bits, real: false });
  }
  return { parts, options: rng.shuffle(options), cols: TOTAL[stage] / 2 };
}

function pattern(bits, cls = '') {
  return el('div', { class: 'pm-pattern ' + cls }, bits.map((b) => el('i', { class: b ? 'on' : '' })));
}

export default {
  id: 'printmatch',
  name: 'Print Match',
  blurb: 'Spot the real parts of a print among look-alikes. Easy, no typing.',
  howTo: 'Arrow keys move, Space picks a part, Enter submits. Pick every part that appears in the target print.',

  start(box, { data, onSolve, onMistake, canAct }) {
    let cursor = 0;
    const picked = new Set();
    const need = data.parts.length;

    const count = el('span', { class: 'dim' });
    const cells = data.options.map((o, i) => el('button', {
      class: 'pm-option', tabindex: -1, 'aria-label': `part ${i + 1}`,
      onclick: () => { cursor = i; toggle(); },
    }, pattern(o.bits)));
    const submitBtn = el('button', { class: 'mini-btn', tabindex: -1, onclick: () => submit() }, 'Submit (Enter)');
    box.append(el('div', { class: 'printmatch' },
      el('div', { class: 'pm-target-wrap' }, el('div', { class: 'dim small' }, 'TARGET PRINT'),
        el('div', { class: 'pm-target' }, data.parts.map((p) => pattern(p, 'big')))),
      el('div', {},
        el('div', { class: 'pm-grid', style: { gridTemplateColumns: `repeat(${data.cols}, auto)` } }, cells),
        el('div', { class: 'pm-foot' }, count, submitBtn))));

    function render() {
      cells.forEach((c, i) => { c.className = 'pm-option' + (i === cursor ? ' cursor' : '') + (picked.has(i) ? ' picked' : ''); });
      count.textContent = `picked ${picked.size}/${need}`;
    }
    function toggle() {
      if (!canAct()) return;
      if (picked.has(cursor)) picked.delete(cursor);
      else if (picked.size < need) picked.add(cursor);
      render();
    }
    function submit() {
      if (!canAct()) return;
      if (picked.size !== need) return onMistake(`pick ${need} parts before submitting`, { free: true });
      if ([...picked].every((i) => data.options[i].real)) return onSolve();
      picked.clear();
      render();
      onMistake('that is not the target print');
    }
    render();

    return {
      key(e) {
        const n = data.options.length;
        const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -data.cols, ArrowDown: data.cols };
        if (moves[e.key] !== undefined) {
          const next = cursor + moves[e.key];
          if (next >= 0 && next < n) cursor = next;
          render();
          return true;
        }
        if (e.key === ' ') { toggle(); return true; }
        if (e.key === 'Enter') { submit(); return true; }
        return false;
      },
      destroy() {},
    };
  },
};
