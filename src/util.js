// Small helpers shared by the whole game.

export function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked: the game still works, it just won't remember.
  }
}

// el('div', { class: 'x', onclick: fn }, 'text', childNode, ...)
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') {
      // setProperty also handles CSS variables like '--i', which Object.assign can't.
      for (const [prop, val] of Object.entries(v)) {
        if (prop.startsWith('--')) node.style.setProperty(prop, String(val));
        else node.style[prop] = val;
      }
    }
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function fmtTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function bar(fraction, width = 10) {
  const f = Math.max(0, Math.min(width, Math.round(fraction * width)));
  return '█'.repeat(f) + '░'.repeat(width - f);
}

// Round length: the host picks one in the lobby; it scales each mode's timer.
export const ROUND_LENGTHS = { short: 0.6, normal: 1, long: 1.6 };

export function roundTime(mode, lengthName) {
  if (!mode?.timeLimit) return 0;
  const mult = ROUND_LENGTHS[lengthName] ?? 1;
  return Math.round((mode.timeLimit * mult) / 30000) * 30000; // whole half-minutes
}

export const COLORS = ['#33ff66', '#4dd9ff', '#ffb000', '#ff4dd2', '#ff6b4d', '#b388ff', '#f2f2f2', '#c6ff4d'];

export const BOT_NAMES = ['n3m0', 'gh0st', 'cr4sh', 'b1tl0rd', 'r00tkit', 'sp00f', 'z3r0day', 'gl1tch'];

// Players sorted by when they joined (stable order for every client).
export function playerList(room) {
  return Object.entries(room?.players || {})
    .map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0) || a.id.localeCompare(b.id));
}

// Like el(), for SVG elements: svgEl('line', { x1: 0, y1: 0, x2: 5, y2: 5 }).
export function svgEl(tag, attrs = {}, ...children) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, String(v));
  }
  for (const c of children.flat()) if (c) node.append(c);
  return node;
}
