// CODE MEMORY: watch cells flash in order, then repeat the sequence.

import { el } from '../../util.js';

const GRIDS = [3, 3, 4, 4, 5];
const LENGTHS = [3, 4, 5, 6, 7];

export function generate(rng, stage) {
  const size = GRIDS[stage];
  const seq = [];
  while (seq.length < LENGTHS[stage]) {
    const c = rng.int(0, size * size - 1);
    if (c !== seq[seq.length - 1]) seq.push(c); // never the same cell twice in a row
  }
  return { size, seq };
}

export default {
  id: 'memory',
  name: 'Code Memory',
  blurb: 'Watch the cells flash, then repeat the sequence. Easy, no typing.',
  howTo: 'Watch the cells light up. Then repeat them in the same order: click them, or use the arrow keys and Space.',

  start(box, { data, onSolve, onMistake, canAct, reduceMotion, lockMs }) {
    const ON = reduceMotion ? 900 : 550;
    const GAP = reduceMotion ? 350 : 200;
    let cursor = Math.floor((data.size * data.size) / 2);
    let progress = 0;
    let watching = true;
    let timers = [];
    const status = el('div', { class: 'mm-status' });
    const pips = el('div', { class: 'mm-pips' }, data.seq.map(() => el('i')));
    const cells = Array.from({ length: data.size * data.size }, (_, i) =>
      el('button', { class: 'mm-cell', tabindex: -1, 'aria-label': `cell ${i + 1}`, onclick: () => { cursor = i; pick(); } }));
    box.append(el('div', { class: 'memory' },
      el('div', { class: 'mm-grid', style: { gridTemplateColumns: `repeat(${data.size}, 1fr)` } }, cells),
      el('div', {}, status, pips)));

    function render() {
      cells.forEach((c, i) => c.classList.toggle('cursor', !watching && i === cursor));
      [...pips.children].forEach((p, i) => { p.className = i < progress ? 'done' : ''; });
      status.textContent = watching ? 'WATCH THE SEQUENCE…' : `YOUR TURN: ${progress}/${data.seq.length}`;
    }
    function flash(i, ms, cls = 'lit') {
      cells[i].classList.add(cls);
      timers.push(setTimeout(() => cells[i].classList.remove(cls), ms));
    }
    function play(delay = 500) {
      watching = true;
      progress = 0;
      render();
      data.seq.forEach((c, k) => timers.push(setTimeout(() => flash(c, ON), delay + k * (ON + GAP))));
      timers.push(setTimeout(() => { watching = false; render(); }, delay + data.seq.length * (ON + GAP)));
    }
    function pick() {
      if (watching || !canAct()) return;
      if (cursor === data.seq[progress]) {
        flash(cursor, 250, 'good');
        progress++;
        render();
        if (progress >= data.seq.length) onSolve();
      } else {
        flash(cursor, 400, 'bad');
        onMistake('wrong cell. Watch again');
        play(lockMs);
      }
    }
    play();

    return {
      key(e) {
        const n = data.size;
        const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        if (moves[e.key]) {
          const [dx, dy] = moves[e.key];
          const x = (cursor % n) + dx, y = Math.floor(cursor / n) + dy;
          if (x >= 0 && y >= 0 && x < n && y < n) cursor = y * n + x;
          render();
          return true;
        }
        if (e.key === ' ' || e.key === 'Enter') { pick(); return true; }
        return false;
      },
      destroy() { timers.forEach(clearTimeout); timers = []; },
    };
  },
};
