// CODE MEMORY: the code is one lit cell in each column. Decoy patterns flicker
// first to throw you off, then the real code flashes 3 times all at once.
// Enter it column by column.

import { el } from '../../util.js';

const COLS = [4, 5, 5, 6, 6];
const ROWS = [3, 4, 5, 5, 6];
const DECOYS = [3, 4, 5, 6, 7];
export const REAL_FLASHES = 3;

const randomPattern = (rng, cols, rows) => Array.from({ length: cols }, () => rng.int(0, rows - 1));
const same = (a, b) => a.every((v, i) => v === b[i]);

export function generate(rng, stage) {
  const cols = COLS[stage];
  const rows = ROWS[stage];
  const answer = randomPattern(rng, cols, rows);
  const decoys = [];
  while (decoys.length < DECOYS[stage]) {
    const d = randomPattern(rng, cols, rows);
    if (!same(d, answer)) decoys.push(d);
  }
  return { cols, rows, answer, decoys };
}

export default {
  id: 'memory',
  name: 'Code Memory',
  blurb: 'Fake codes flicker, then the real one flashes 3 times. Enter it. Easy, no typing.',
  howTo: 'Ignore the flickering decoys. The real code flashes 3 times, one cell per column. Then pick it column by column: ↑ ↓ and Space/Enter, or click.',

  start(box, { data, onSolve, onMistake, canAct, reduceMotion, lockMs }) {
    const { cols, rows } = data;
    const slow = reduceMotion ? 1.8 : 1;
    let col = 0;
    let row = 0;
    let watching = true;
    let timers = [];
    const status = el('div', { class: 'mm-status' });
    const pips = el('div', { class: 'mm-pips' }, data.answer.map(() => el('i')));
    // cells[r][c]
    const cells = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) =>
      el('button', { class: 'mm-cell', tabindex: -1, 'aria-label': `column ${c + 1}, row ${r + 1}`, onclick: () => { if (c === col) { row = r; pick(); } } })));
    box.append(el('div', { class: 'memory' },
      el('div', { class: 'mm-grid', style: { gridTemplateColumns: `repeat(${cols}, 1fr)`, width: `min(${(88 * cols / rows).toFixed(1)}cqh, 72cqw)` } }, cells.flat()),
      el('div', {}, status, pips)));

    const all = () => cells.flat();
    function render(text) {
      cells.forEach((line, r) => line.forEach((cell, c) => {
        cell.classList.toggle('cursor', !watching && c === col && r === row);
        cell.classList.toggle('col-active', !watching && c === col);
      }));
      [...pips.children].forEach((p, i) => { p.className = i < col ? 'done' : ''; });
      status.textContent = text ?? (watching ? 'SCANNING…' : `YOUR TURN: column ${col + 1}/${cols}`);
    }
    function show(pattern, cls) {
      all().forEach((cell) => cell.classList.remove('decoy', 'lit'));
      if (pattern) pattern.forEach((r, c) => cells[r][c].classList.add(cls));
    }
    const at = (ms, fn) => timers.push(setTimeout(fn, ms));

    function play(delay = 500) {
      watching = true;
      col = 0;
      all().forEach((cell) => cell.classList.remove('picked', 'bad'));
      render();
      let t = delay;
      const ON = 220 * slow, OFF = 90 * slow;
      for (const d of data.decoys) {
        at(t, () => show(d, 'decoy'));
        at(t + ON, () => show(null));
        t += ON + OFF;
      }
      t += 350 * slow;
      at(t, () => render(`REAL CODE: watch it flash ${REAL_FLASHES}×`));
      t += 250 * slow;
      for (let k = 0; k < REAL_FLASHES; k++) {
        at(t, () => show(data.answer, 'lit'));
        at(t + 450 * slow, () => show(null));
        t += (450 + 300) * slow;
      }
      at(t, () => { watching = false; row = 0; render(); });
    }

    function pick() {
      if (watching || !canAct()) return;
      if (row === data.answer[col]) {
        cells[row][col].classList.add('picked');
        col++;
        if (col >= cols) { render('ACCESS GRANTED'); onSolve(); return; }
        row = 0;
        render();
      } else {
        const bad = cells[row][col];
        bad.classList.add('bad');
        timers.push(setTimeout(() => bad.classList.remove('bad'), 400));
        onMistake(`wrong cell in column ${col + 1}. Watch again`);
        play(lockMs);
      }
    }
    play();

    return {
      key(e) {
        if (e.key === 'ArrowUp') { row = (row + rows - 1) % rows; render(); return true; }
        if (e.key === 'ArrowDown') { row = (row + 1) % rows; render(); return true; }
        if (e.key === ' ' || e.key === 'Enter') { pick(); return true; }
        return e.key === 'ArrowLeft' || e.key === 'ArrowRight';
      },
      destroy() { timers.forEach(clearTimeout); timers = []; },
    };
  },
};
