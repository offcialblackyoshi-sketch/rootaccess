// BIT FLIP: flip switches so their values add up to the target number.

import { el } from '../../util.js';

const BITS = [4, 5, 6, 7, 8];

export function generate(rng, stage) {
  const bits = BITS[stage];
  const values = Array.from({ length: bits }, (_, i) => 2 ** (bits - 1 - i)); // left switch is the biggest
  return { bits, values, target: rng.int(1, 2 ** bits - 1), hex: stage >= 3 };
}

export const show = (n, hex) => (hex ? '0x' + n.toString(16).toUpperCase() : String(n));

export default {
  id: 'bitflip',
  name: 'Bit Flip',
  blurb: 'Flip switches until they add up to the target number. Easy, no typing.',
  howTo: 'Each switch adds its value when ON. Flip with number keys 1-8, arrows + Space, or a click. Press Enter when the total matches.',

  start(box, { data, onSolve, onMistake, canAct }) {
    const on = Array(data.bits).fill(false);
    let cursor = 0;
    const totalEl = el('span', { class: 'bf-total' });
    const sws = data.values.map((v, i) => el('button', {
      class: 'bf-switch', tabindex: -1, 'aria-label': `switch ${i + 1}, worth ${v}`,
      onclick: () => { cursor = i; flip(); },
    }, el('span', { class: 'bf-key' }, String(i + 1)), el('span', { class: 'bf-knob' }), el('span', { class: 'bf-val' }, show(v, data.hex))));
    box.append(el('div', { class: 'bitflip' },
      el('div', { class: 'bf-target' }, el('span', { class: 'dim small' }, 'TARGET'), el('strong', {}, show(data.target, data.hex))),
      el('div', { class: 'bf-row' }, sws),
      el('div', { class: 'bf-foot' }, el('span', { class: 'dim' }, 'TOTAL '), totalEl,
        el('button', { class: 'mini-btn primary', tabindex: -1, onclick: () => submit() }, 'Submit (Enter)'))));

    const total = () => data.values.reduce((s, v, i) => s + (on[i] ? v : 0), 0);
    function render() {
      sws.forEach((s, i) => { s.classList.toggle('on', on[i]); s.classList.toggle('cursor', i === cursor); });
      totalEl.textContent = show(total(), data.hex);
      totalEl.classList.toggle('match', total() === data.target);
    }
    function flip() {
      if (!canAct()) return;
      on[cursor] = !on[cursor];
      render();
    }
    function submit() {
      if (!canAct()) return;
      if (total() === data.target) onSolve();
      else onMistake(`total is ${show(total(), data.hex)}, target is ${show(data.target, data.hex)}`);
    }
    render();

    return {
      key(e) {
        if (/^[1-9]$/.test(e.key) && Number(e.key) <= data.bits) { cursor = Number(e.key) - 1; flip(); return true; }
        if (e.key === 'ArrowLeft') { cursor = Math.max(0, cursor - 1); render(); return true; }
        if (e.key === 'ArrowRight') { cursor = Math.min(data.bits - 1, cursor + 1); render(); return true; }
        if (e.key === ' ') { flip(); return true; }
        if (e.key === 'Enter') { submit(); return true; }
        return false;
      },
      destroy() {},
    };
  },
};
