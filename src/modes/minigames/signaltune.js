// SIGNAL TUNE: turn the knobs until your wave sits on top of the target wave.

import { el, svgEl } from '../../util.js';

export const KNOBS = {
  freq: { label: 'FREQ', min: 1, max: 6, keys: ['ArrowLeft', 'ArrowRight'] },
  amp: { label: 'HEIGHT', min: 1, max: 5, keys: ['ArrowDown', 'ArrowUp'] },
  phase: { label: 'SHIFT', min: 0, max: 7, keys: ['q', 'e'] },
};
// Which knobs each stage uses (the rest are fixed and already match).
export const STAGE_KNOBS = [['freq'], ['freq', 'amp'], ['freq', 'amp'], ['freq', 'amp', 'phase'], ['freq', 'amp', 'phase']];

export function generate(rng, stage) {
  const knobs = STAGE_KNOBS[stage];
  const target = {};
  const start = {};
  for (const [k, K] of Object.entries(KNOBS)) target[k] = rng.int(K.min, K.max);
  for (const k of Object.keys(KNOBS)) start[k] = target[k];
  // Every used knob starts at least 2 steps away from the answer.
  for (const k of knobs) {
    const K = KNOBS[k];
    const choices = [];
    for (let v = K.min; v <= K.max; v++) if (Math.abs(v - target[k]) >= 2) choices.push(v);
    start[k] = rng.pick(choices);
  }
  return { knobs, target, start };
}

const W = 320;
const H = 110;
function wavePath({ freq, amp, phase }) {
  let d = '';
  for (let x = 0; x <= W; x += 4) {
    const y = H / 2 - amp * 9 * Math.sin((2 * Math.PI * freq * x) / W + (phase * Math.PI) / 4);
    d += `${x ? 'L' : 'M'}${x} ${y.toFixed(1)} `;
  }
  return d;
}

export default {
  id: 'signaltune',
  name: 'Signal Tune',
  blurb: 'Tune your wave to match the target signal. Easy, no typing.',
  howTo: '← → change frequency, ↑ ↓ change height, Q / E shift it (later stages). When the waves line up, press Enter.',

  start(box, { data, onSolve, onMistake, canAct }) {
    const v = { ...data.start };
    const targetPath = svgEl('path', { class: 'st-target', d: wavePath(data.target) });
    const minePath = svgEl('path', { class: 'st-mine' });
    const svg = svgEl('svg', { class: 'st-wave', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': 'signal waves' },
      svgEl('line', { class: 'st-axis', x1: 0, y1: H / 2, x2: W, y2: H / 2 }), targetPath, minePath);
    const status = el('div', { class: 'st-status' });
    const knobEls = {};
    const knobRow = el('div', { class: 'st-knobs' }, data.knobs.map((k) => {
      const K = KNOBS[k];
      const val = el('span', { class: 'st-val' });
      knobEls[k] = val;
      const keyName = k === 'phase' ? 'Q/E' : k === 'freq' ? '←/→' : '↓/↑';
      return el('div', { class: 'st-knob' },
        el('span', { class: 'dim' }, `${K.label} (${keyName})`),
        el('button', { class: 'mini-btn', tabindex: -1, onclick: () => turn(k, -1) }, '−'),
        val,
        el('button', { class: 'mini-btn', tabindex: -1, onclick: () => turn(k, 1) }, '+'));
    }), el('button', { class: 'mini-btn primary', tabindex: -1, onclick: () => lock() }, 'Lock in (Enter)'));
    box.append(el('div', { class: 'signaltune' }, svg, status, knobRow));

    const matched = () => data.knobs.every((k) => v[k] === data.target[k]);
    function render() {
      minePath.setAttribute('d', wavePath(v));
      const m = matched();
      svg.classList.toggle('match', m);
      status.textContent = m ? '◆ SIGNAL LOCKED ON. Press Enter.' : 'Line your wave up with the dashed target.';
      for (const k of data.knobs) knobEls[k].textContent = String(v[k]);
    }
    function turn(k, d) {
      if (!canAct()) return;
      const K = KNOBS[k];
      v[k] = Math.max(K.min, Math.min(K.max, v[k] + d));
      render();
    }
    function lock() {
      if (!canAct()) return;
      if (matched()) onSolve();
      else onMistake('the waves do not line up yet');
    }
    render();

    return {
      key(e) {
        const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        for (const k of data.knobs) {
          const i = KNOBS[k].keys.indexOf(key);
          if (i >= 0) { turn(k, i ? 1 : -1); return true; }
        }
        if (e.key === 'Enter' || e.key === ' ') { lock(); return true; }
        return false;
      },
      destroy() {},
    };
  },
};
