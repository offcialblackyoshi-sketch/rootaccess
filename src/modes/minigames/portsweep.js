// PORT SWEEP: ports blink open for a moment. Close them before they shut by
// themselves. Hitting a port that is not open counts as a mistake.

import { el } from '../../util.js';
import { makeRng } from '../../rng.js';

const GRIDS = [3, 3, 3, 4, 4];
const NEED = [5, 7, 9, 10, 12];
const OPEN_MS = [1700, 1500, 1300, 1150, 1000];
const GAP_MS = [900, 800, 700, 600, 550];

export function generate(rng, stage) {
  return { size: GRIDS[stage], need: NEED[stage], openMs: OPEN_MS[stage], gapMs: GAP_MS[stage], seed: rng.int(1, 2 ** 30) };
}

// The order ports open in: never the same port twice in a row.
export function openSequence(data, count) {
  const rng = makeRng(data.seed);
  const seq = [];
  while (seq.length < count) {
    const p = rng.int(0, data.size * data.size - 1);
    if (p !== seq[seq.length - 1]) seq.push(p);
  }
  return seq;
}

export default {
  id: 'portsweep',
  name: 'Port Sweep',
  blurb: 'Ports blink open: close each one before it shuts. Easy, no typing.',
  howTo: 'When a port lights up, close it: click it, press its number (1-9), or use the arrow keys + Space/Enter. Don\'t hit dark ports.',

  start(box, { data, onSolve, onMistake, onStep, canAct, reduceMotion }) {
    const n = data.size;
    const slow = reduceMotion ? 1.3 : 1;
    const seq = openSequence(data, 400);
    let next = 0;
    let closed = 0;
    let cursor = Math.floor((n * n) / 2);
    const open = new Map(); // port -> timeout id
    const timers = [];
    const count = el('div', { class: 'ps-count' });
    const cells = Array.from({ length: n * n }, (_, i) => el('button', {
      class: 'ps-port', tabindex: -1, 'aria-label': `port ${i + 1}`,
      onclick: () => { cursor = i; hit(); },
    }, n === 3 ? el('span', { class: 'ps-num' }, String(i + 1)) : null));
    box.append(el('div', { class: 'portsweep' },
      el('div', { class: 'ps-grid', style: { gridTemplateColumns: `repeat(${n}, 1fr)` } }, cells), count));

    function render() {
      cells.forEach((c, i) => {
        c.classList.toggle('open', open.has(i));
        c.classList.toggle('cursor', i === cursor);
      });
      count.textContent = `CLOSED ${closed}/${data.need}`;
    }
    function openOne() {
      const p = seq[next++ % seq.length];
      if (open.has(p)) return;
      open.set(p, setTimeout(() => { open.delete(p); render(); }, data.openMs * slow));
      render();
    }
    function schedule() {
      openOne();
      // Later stages sometimes open two at once.
      if (data.size === 4 && next % 3 === 0) openOne();
      timers.push(setTimeout(schedule, (data.openMs * 0.6 + data.gapMs) * slow));
    }
    timers.push(setTimeout(schedule, 700));
    function hit() {
      if (!canAct()) return;
      if (open.has(cursor)) {
        clearTimeout(open.get(cursor));
        open.delete(cursor);
        closed++;
        render();
        if (closed >= data.need) onSolve();
        else onStep?.();
      } else {
        onMistake(`port ${cursor + 1} was not open`);
      }
    }
    render();

    return {
      key(e) {
        if (n === 3 && /^[1-9]$/.test(e.key)) { cursor = Number(e.key) - 1; hit(); return true; }
        const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        if (moves[e.key]) {
          const [dx, dy] = moves[e.key];
          const x = (cursor % n) + dx, y = Math.floor(cursor / n) + dy;
          if (x >= 0 && y >= 0 && x < n && y < n) cursor = y * n + x;
          render();
          return true;
        }
        if (e.key === ' ' || e.key === 'Enter') { hit(); return true; }
        return false;
      },
      destroy() {
        timers.forEach(clearTimeout);
        open.forEach(clearTimeout);
      },
    };
  },
};
