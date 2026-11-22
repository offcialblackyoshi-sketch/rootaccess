// Pixel-art avatars: a symmetric 5x5 pattern made from a player's name, in
// their color. The same name always gets the same avatar, on every device.

import { hashString } from './rng.js';
import { svgEl } from './util.js';

// Pure: which cells are filled, as 25 booleans (row by row, mirrored left-right).
export function avatarCells(name) {
  let h = hashString('avatar:' + String(name || '').toLowerCase());
  const cells = Array(25).fill(false);
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      const on = (h & 1) === 1;
      h = (h >>> 1) || hashString(String(h) + y + x);
      cells[y * 5 + x] = on;
      cells[y * 5 + (4 - x)] = on;
    }
  }
  // Never empty: light the center column if nothing else.
  if (!cells.some(Boolean)) for (let y = 1; y < 4; y++) cells[y * 5 + 2] = true;
  return cells;
}

export function avatarEl(name, color = '#33ff66', size = 22) {
  const cells = avatarCells(name);
  return svgEl('svg', { class: 'avatar', width: size, height: size, viewBox: '-1 -1 7 7', role: 'img', 'aria-hidden': 'true' },
    svgEl('rect', { x: -1, y: -1, width: 7, height: 7, rx: 1.4, class: 'avatar-bg' }),
    cells.map((on, i) => (on ? svgEl('rect', { x: i % 5, y: Math.floor(i / 5), width: 1.02, height: 1.02, fill: color }) : null)));
}
