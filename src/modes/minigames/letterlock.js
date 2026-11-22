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

// Which letter of a strip is in the highlighted row after `ms` milliseconds.
export function letterAt(strip, ms, slow = 1) {
  const p = strip.offset + (ms / 1000) * strip.speed * slow * strip.dir;
  const n = strip.letters.length;
  return ((Math.floor(p) % n) + n) % n;
}

export default {
  id: 'letterlock',
  name: 'Letter Lock',
  blurb: 'Letters scroll past a line. Press Space to lock each one of the password in place. Easy, no typing.',
  howTo: 'Press Space (or click the column) when the glowing column shows the next password letter in the middle row.',

  start(box, { data, onSolve, onMistake, onStep, canAct, reduceMotion }) {
    const slow = reduceMotion ? 0.6 : 1;
    const t0 = performance.now();
    let cur = 0;
    let raf = 0;
    const lockedAt = [];

    const target = el('div', { class: 'll-target' }, [...data.password].map((c) => el('span', {}, c)));
    const cols = data.strips.map((strip, i) => {
      const cells = [0, 1, 2, 3, 4].map((k) => el('span', { class: k === 2 ? 'mid' : '' }));
      const col = el('button', { class: 'll-col', tabindex: -1, 'aria-label': `column ${i + 1}`, onclick: () => i === cur && press() }, cells);
      return { strip, col, cells };
    });
    box.append(el('div', { class: 'letterlock' }, el('div', { class: 'dim small' }, 'PASSWORD'), target, el('div', { class: 'll-cols' }, cols.map((c) => c.col))));

    function render() {
      const ms = performance.now() - t0;
      cols.forEach(({ strip, col, cells }, i) => {
        const n = strip.letters.length;
        const idx = i < cur ? lockedAt[i] : letterAt(strip, ms, slow);
        cells.forEach((cell, k) => { cell.textContent = strip.letters[(((idx + k - 2) % n) + n) % n]; });
        col.className = 'll-col' + (i < cur ? ' locked' : i === cur ? ' active' : '');
      });
      [...target.children].forEach((s, i) => { s.className = i < cur ? 'done' : i === cur ? 'next' : ''; });
      raf = requestAnimationFrame(render);
    }
    render();

    function press() {
      if (!canAct() || cur >= data.password.length) return;
      const strip = data.strips[cur];
      const idx = letterAt(strip, performance.now() - t0, slow);
      if (strip.letters[idx] === data.password[cur]) {
        lockedAt[cur] = idx;
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
