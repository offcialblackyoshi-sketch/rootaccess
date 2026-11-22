// CIRCUIT PATH: steer the signal through a maze of firewall walls to the exit.

import { el, svgEl } from '../../util.js';

export const N = 1, E = 2, S = 4, W = 8;
const DIRS = [[N, 0, -1, S], [E, 1, 0, W], [S, 0, 1, N], [W, -1, 0, E]];
const KEY_DIR = { ArrowUp: N, ArrowRight: E, ArrowDown: S, ArrowLeft: W };
const SIZES = [5, 6, 7, 8, 9];

// A perfect maze (exactly one route between any two cells), from the seed.
// open[y][x] is a bitmask of the directions you can move from that cell.
export function generate(rng, stage) {
  const size = SIZES[stage];
  const open = Array.from({ length: size }, () => Array(size).fill(0));
  const seen = Array.from({ length: size }, () => Array(size).fill(false));
  const stack = [[0, 0]];
  seen[0][0] = true;
  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const next = rng.shuffle(DIRS).filter(([, dx, dy]) => {
      const nx = x + dx, ny = y + dy;
      return nx >= 0 && ny >= 0 && nx < size && ny < size && !seen[ny][nx];
    });
    if (!next.length) { stack.pop(); continue; }
    const [d, dx, dy, back] = next[0];
    open[y][x] |= d;
    open[y + dy][x + dx] |= back;
    seen[y + dy][x + dx] = true;
    stack.push([x + dx, y + dy]);
  }
  return { size, open, start: [0, 0], exit: [size - 1, size - 1] };
}

export function canMove(maze, [x, y], dir) {
  return !!(maze.open[y]?.[x] & dir);
}

// Shortest route from start to exit as a list of directions (BFS).
export function solvePath(maze) {
  const key = (x, y) => y * maze.size + x;
  const prev = new Map([[key(...maze.start), null]]);
  const queue = [maze.start];
  while (queue.length) {
    const [x, y] = queue.shift();
    if (x === maze.exit[0] && y === maze.exit[1]) break;
    for (const [d, dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (canMove(maze, [x, y], d) && !prev.has(key(nx, ny))) {
        prev.set(key(nx, ny), [key(x, y), d]);
        queue.push([nx, ny]);
      }
    }
  }
  const path = [];
  let k = key(...maze.exit);
  if (!prev.has(k)) return null;
  while (prev.get(k)) { const [pk, d] = prev.get(k); path.unshift(d); k = pk; }
  return path;
}

export const DIR_KEY = { [N]: 'ArrowUp', [E]: 'ArrowRight', [S]: 'ArrowDown', [W]: 'ArrowLeft' };

export default {
  id: 'circuit',
  name: 'Circuit Path',
  blurb: 'Guide a signal through a maze of firewalls to the exit. Easy, no typing.',
  howTo: 'Use the arrow keys (or click a square next to the signal) to reach the ◎ exit. Bumping a wall counts as a mistake.',

  start(box, { data, onSolve, onMistake, canAct }) {
    const C = 30; // cell size in SVG units
    const sz = data.size * C;
    let pos = [...data.start];
    const trail = [[...pos]];
    const walls = [];
    for (let y = 0; y < data.size; y++) {
      for (let x = 0; x < data.size; x++) {
        const o = data.open[y][x];
        if (!(o & N)) walls.push([x, y, x + 1, y]);
        if (!(o & W)) walls.push([x, y, x, y + 1]);
        if (y === data.size - 1 && !(o & S)) walls.push([x, y + 1, x + 1, y + 1]);
        if (x === data.size - 1 && !(o & E)) walls.push([x + 1, y, x + 1, y + 1]);
      }
    }
    const trailEl = svgEl('polyline', { class: 'cp-trail' });
    const dot = svgEl('circle', { class: 'cp-dot', r: C * 0.28 });
    const svg = svgEl('svg', { class: 'cp-maze', viewBox: `-3 -3 ${sz + 6} ${sz + 6}`, role: 'img', 'aria-label': 'maze' },
      svgEl('rect', { class: 'cp-exit', x: data.exit[0] * C + 4, y: data.exit[1] * C + 4, width: C - 8, height: C - 8, rx: 4 }),
      svgEl('circle', { class: 'cp-exit-ring', cx: data.exit[0] * C + C / 2, cy: data.exit[1] * C + C / 2, r: C * 0.22 }),
      walls.map(([x1, y1, x2, y2]) => svgEl('line', { class: 'cp-wall', x1: x1 * C, y1: y1 * C, x2: x2 * C, y2: y2 * C })),
      trailEl, dot);
    svg.addEventListener('click', (e) => {
      const r = svg.getBoundingClientRect();
      const cx = Math.floor((((e.clientX - r.left) / r.width) * (sz + 6) - 3) / C);
      const cy = Math.floor((((e.clientY - r.top) / r.height) * (sz + 6) - 3) / C);
      const dx = cx - pos[0], dy = cy - pos[1];
      const hit = DIRS.find(([, ddx, ddy]) => ddx === dx && ddy === dy);
      if (hit) move(hit[0]);
    });
    box.append(el('div', { class: 'circuit' }, svg));

    function render() {
      dot.setAttribute('cx', pos[0] * C + C / 2);
      dot.setAttribute('cy', pos[1] * C + C / 2);
      trailEl.setAttribute('points', trail.map(([x, y]) => `${x * C + C / 2},${y * C + C / 2}`).join(' '));
    }
    function move(dir) {
      if (!canAct()) return;
      if (!canMove(data, pos, dir)) {
        svg.classList.remove('bump');
        void svg.getBoundingClientRect();
        svg.classList.add('bump');
        return onMistake('you hit a firewall');
      }
      const [, dx, dy] = DIRS.find(([d]) => d === dir);
      pos = [pos[0] + dx, pos[1] + dy];
      // Stepping back onto the trail rewinds it, so it always shows your route.
      const i = trail.findIndex(([x, y]) => x === pos[0] && y === pos[1]);
      if (i >= 0) trail.length = i + 1; else trail.push([...pos]);
      render();
      if (pos[0] === data.exit[0] && pos[1] === data.exit[1]) onSolve();
    }
    render();

    return {
      key(e) {
        if (KEY_DIR[e.key]) { move(KEY_DIR[e.key]); return true; }
        return false;
      },
      destroy() {},
    };
  },
};
