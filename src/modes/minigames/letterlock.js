// LETTER LOCK: columns of letters scroll past a highlighted row. Press Space
// when the right letter of the password sits in the row to lock that column.

import { el } from '../../util.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const STRIP_LEN = 10;

// stage 0..4 → a password of 4..8 letters, scrolling faster each stage.
export function generate(rng, stage) {
  const len = 4 + stage;
  const password = rng.code(len, ALPHABET);
  const strips = [...password].map((letter, i) => {
    const others = rng.shuffle([...ALPHABET].filter((c) => c !== letter)).slice(0, STRIP_LEN - 1);
    const letters = rng.shuffle([letter, ...others]);
    return {
      letters,
      speed: 1.2 + stage * 0.35 + rng.next() * 0.4, // letters per second
      dir: stage >= 2 && i % 2 ? -1 : 1,
      offset: rng.int(0, STRIP_LEN - 1),
    };
  });
  return { password, strips };
}

// Where a strip has scrolled to after `ms` milliseconds (a smooth position, in letters).
export function stripPos(strip, ms, slow = 1) {
  return strip.offset + (ms / 1000) * strip.speed * slow * strip.dir;
}

// A press counts if the wanted letter is within this many letters of the line
// (a little forgiving, since the column keeps moving while you press).
export const LOCK_SLACK = 0.7;

// The strip index of `letter` if it is close enough to the line, else -1.
export function lockable(strip, ms, letter, slow = 1) {
  const p = stripPos(strip, ms, slow);
  const n = strip.letters.length;
  for (const i of [Math.floor(p), Math.ceil(p)]) {
    if (Math.abs(p - i) <= LOCK_SLACK && strip.letters[((i % n) + n) % n] === letter) return ((i % n) + n) % n;
  }
  return -1;
}

// Which letter of a strip is in the highlighted row: the one closest to its center.
export function letterAt(strip, ms, slow = 1) {
  const n = strip.letters.length;
  return ((Math.round(stripPos(strip, ms, slow)) % n) + n) % n;
}

export default {
  id: 'letterlock',
  name: 'Letter Lock',
  blurb: 'Letters scroll past a line. Press Space or Enter to lock each one of the password in place. Easy, no typing.',
  howTo: 'Press Space or Enter (or click the column) when the glowing column shows the next password letter in the middle row.',

  start(box, { data, onSolve, onMistake, onStep, canAct, reduceMotion }) {
    const slow = reduceMotion ? 0.6 : 1;
    const t0 = performance.now();
    let cur = 0;
    let raf = 0;
    const lockedAt = [];

    const target = el('div', { class: 'll-target' }, [...data.password].map((c) => el('span', {}, c)));
    const cols = data.strips.map((strip, i) => {
      // 7 letters on a track that slides smoothly behind a 5-letter window.
      const cells = Array.from({ length: 7 }, () => el('span'));
      const track = el('div', { class: 'll-track' }, cells);
      const col = el('button', { class: 'll-col', tabindex: -1, 'aria-label': `column ${i + 1}`, onclick: () => i === cur && press() },
        el('div', { class: 'll-window' }, track, el('div', { class: 'll-line' })));
      return { strip, col, cells, track };
    });
    box.append(el('div', { class: 'letterlock' }, el('div', { class: 'dim small' }, 'PASSWORD'), target, el('div', { class: 'll-cols' }, cols.map((c) => c.col))));

    function render() {
      const ms = performance.now() - t0;
      cols.forEach(({ strip, col, cells, track }, i) => {
        const n = strip.letters.length;
        const p = i < cur ? lockedAt[i] : stripPos(strip, ms, slow);
        const base = Math.floor(p);
        const frac = p - base;
        const mid = frac < 0.5 ? 3 : 4; // the cell nearest the highlighted line
        cells.forEach((cell, k) => {
          cell.textContent = strip.letters[(((base + k - 3) % n) + n) % n];
          cell.className = k === mid ? 'mid' : '';
        });
        track.style.transform = `translateY(${-(1 + frac) * 1.3}em)`;
        col.className = 'll-col' + (i < cur ? ' locked' : i === cur ? ' active' : '');
      });
      [...target.children].forEach((s, i) => { s.className = i < cur ? 'done' : i === cur ? 'next' : ''; });
      raf = requestAnimationFrame(render);
    }
    render();

    function press() {
      if (!canAct() || cur >= data.password.length) return;
      const strip = data.strips[cur];
      const ms = performance.now() - t0;
      const hit = lockable(strip, ms, data.password[cur], slow);
      const idx = letterAt(strip, ms, slow);
      if (hit >= 0) {
        lockedAt[cur] = hit;
        cur++;
        if (cur >= data.password.length) onSolve();
        else onStep?.();
      } else onMistake(`locked "${strip.letters[idx]}", needed "${data.password[cur]}"`);
    }

    return {
      key(e) {
        if (e.key === ' ' || e.key === 'Enter') { press(); return true; }
        return false;
      },
      destroy() { cancelAnimationFrame(raf); },
    };
  },
};
