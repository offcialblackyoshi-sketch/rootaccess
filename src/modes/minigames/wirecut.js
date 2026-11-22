// WIRE CUT: read the rule card, then cut the right wires in the right order.

import { el } from '../../util.js';

export const COLORS = ['red', 'blue', 'yellow', 'green', 'white'];
const WIRES = [3, 4, 4, 5, 6];
const CUTS = [1, 1, 2, 2, 3];

const count = (wires, c) => wires.filter((w) => w === c).length;
const plural = (n, c) => `${n} ${c} wire${n === 1 ? '' : 's'}`;

// A random condition about the wires, as text plus whether it is true.
function condition(rng, wires) {
  const c = rng.pick(COLORS);
  const kind = rng.int(0, 4);
  if (kind === 0) {
    const n = rng.int(0, 2);
    return { text: `there are more than ${plural(n, c)}`, val: count(wires, c) > n };
  }
  if (kind === 1) return { text: `there are no ${c} wires`, val: count(wires, c) === 0 };
  if (kind === 2) return { text: `the last wire is ${c}`, val: wires[wires.length - 1] === c };
  if (kind === 3) return { text: `the first wire is ${c}`, val: wires[0] === c };
  return { text: `there is an ${wires.length % 2 ? 'odd' : 'even'} number of wires`, val: true, fixed: true };
}

function conditionWith(rng, wires, want) {
  for (let i = 0; i < 200; i++) {
    const c = condition(rng, wires);
    if (c.val === want && !(c.fixed && !want)) return c;
  }
  return want ? { text: 'there is at least 1 wire', val: true } : { text: 'there are more than 9 wires', val: false };
}

// How to describe wire i so a player can find it.
function describe(wires, i) {
  const c = wires[i];
  if (wires.indexOf(c) === i) return `the first ${c} wire`;
  if (wires.lastIndexOf(c) === i) return `the last ${c} wire`;
  return `wire ${i + 1}`;
}

export function generate(rng, stage) {
  const wires = Array.from({ length: WIRES[stage] }, () => rng.pick(COLORS));
  const order = rng.shuffle([...wires.keys()]).slice(0, CUTS[stage]);
  const action = 'cut ' + order.map((i) => describe(wires, i)).join(', then ');
  const decoys = Array.from({ length: rng.int(0, Math.min(stage, 2)) + (stage ? 1 : 0) }, () => conditionWith(rng, wires, false));
  const rules = decoys.map((d) => ({ text: `If ${d.text}: cut ${describe(wires, rng.int(0, wires.length - 1))}.` }));
  if (rng.next() < 0.5 || !rules.length) {
    rules.push({ text: `If ${conditionWith(rng, wires, true).text}: ${action}.`, real: true });
    rules.push({ text: `Otherwise: cut ${describe(wires, rng.int(0, wires.length - 1))}.` });
  } else {
    rules.push({ text: `Otherwise: ${action}.`, real: true });
  }
  return { wires, order, rules };
}

export default {
  id: 'wirecut',
  name: 'Wire Cut',
  blurb: 'Read the rule card and cut the right wires in the right order. Easy, no typing.',
  howTo: 'Use the FIRST rule on the card that is true. Cut wires with number keys 1-6, arrows + Space/Enter, or a click.',

  start(box, { data, onSolve, onMistake, onStep, canAct }) {
    let cursor = 0;
    let done = 0;
    const cut = new Set();
    const wireEls = data.wires.map((c, i) => el('button', {
      class: `wc-wire wc-${c}`, tabindex: -1, 'aria-label': `wire ${i + 1}, ${c}`,
      onclick: () => { cursor = i; snip(); },
    }, el('span', { class: 'wc-num' }, String(i + 1)), el('span', { class: 'wc-line' })));
    box.append(el('div', { class: 'wirecut' },
      el('div', { class: 'wc-card' }, el('div', { class: 'dim small' }, 'RULE CARD · use the first rule that is true'),
        el('ol', {}, data.rules.map((r) => el('li', {}, r.text)))),
      el('div', { class: 'wc-board' }, wireEls)));

    function render() {
      wireEls.forEach((w, i) => {
        w.classList.toggle('cursor', i === cursor);
        w.classList.toggle('cut', cut.has(i));
      });
    }
    function snip() {
      if (!canAct() || cut.has(cursor)) return render();
      if (cursor === data.order[done]) {
        cut.add(cursor);
        done++;
        render();
        if (done >= data.order.length) onSolve();
        else onStep?.();
      } else {
        render();
        onMistake(`wire ${cursor + 1} was the wrong one`);
      }
    }
    render();

    return {
      key(e) {
        const n = data.wires.length;
        if (/^[1-9]$/.test(e.key) && Number(e.key) <= n) { cursor = Number(e.key) - 1; snip(); return true; }
        if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { cursor = (cursor + n - 1) % n; render(); return true; }
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { cursor = (cursor + 1) % n; render(); return true; }
        if (e.key === ' ' || e.key === 'Enter') { snip(); return true; }
        return false;
      },
      destroy() {},
    };
  },
};
