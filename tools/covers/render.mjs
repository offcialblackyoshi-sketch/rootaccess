// Renders the cover art in tools/covers/cover.html to PNGs at the sizes game
// portals ask for (CrazyGames: 1920x1080, 800x1200, 800x800).
// Needs the local server running:  python -m http.server 8765
// Usage:  node tools/covers/render.mjs   (writes to dist/covers/)
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.URL || 'http://127.0.0.1:8765/tools/covers/cover.html';
const OUT = resolve('dist/covers');
mkdirSync(OUT, { recursive: true });

const sizes = [['landscape', 1920, 1080], ['portrait', 800, 1200], ['square', 800, 800]];
for (const [layout, w, h] of sizes) {
  const file = resolve(OUT, `root-access-${layout}-${w}x${h}.png`);
  const r = spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    `--window-size=${w},${h}`, '--virtual-time-budget=5000', `--screenshot=${file}`, `${BASE}?layout=${layout}`], { encoding: 'utf8' });
  console.log(r.status === 0 ? `wrote ${file}` : `failed ${layout}: ${r.stderr}`);
}
