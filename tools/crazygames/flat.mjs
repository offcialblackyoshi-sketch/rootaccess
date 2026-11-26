// Makes a folder-free copy of the game for portals whose uploader flattens
// folders (like CrazyGames): every file sits next to index.html, and the
// import paths are rewritten to match. src/modes/race.js -> modes-race.js.
// Usage: node tools/crazygames/flat.mjs   (writes dist/crazygames-flat/)
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { join, relative, dirname, resolve, posix } from 'node:path';

const ROOT = resolve('.');
const OUT = resolve('dist/crazygames-flat');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// Every game script under src/.
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js')) files.push(relative(ROOT, p).split('\\').join('/'));
  }
})(join(ROOT, 'src'));

// src/main.js -> main.js, src/modes/race.js -> modes-race.js
const flatName = (srcPath) => srcPath.replace(/^src\//, '').split('/').join('-');
const names = new Map(files.map((f) => [f, flatName(f)]));
if (new Set(names.values()).size !== names.size) throw new Error('two files would get the same flat name');
// The Firebase settings file sits next to index.html in both versions.
names.set('firebase-config.js', 'firebase-config.js');

// Rewrite relative import specifiers: from './x.js', import './x.js', import('./x.js').
const SPEC = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+)\2/g;
let rewritten = 0;
for (const f of files) {
  const code = readFileSync(join(ROOT, f), 'utf8').replace(SPEC, (all, pre, q, spec) => {
    const target = posix.normalize(posix.join(posix.dirname(f), spec));
    if (!names.has(target)) throw new Error(`${f}: import "${spec}" -> ${target} is not a game file`);
    rewritten++;
    return `${pre}${q}./${names.get(target)}${q}`;
  });
  writeFileSync(join(OUT, names.get(f)), code);
}

// The page: same file, pointing at the flat names. (No install manifest or
// offline cache on portals: they host the files themselves.)
let html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const swap = (a, b) => { if (!html.includes(a)) throw new Error('index.html missing ' + a); html = html.split(a).join(b); };
swap('<script type="module" src="src/main.js"></script>', '<script type="module" src="main.js"></script>');
swap('  <link rel="manifest" href="manifest.webmanifest">\n', '');
swap('href="icons/icon-192.png"', 'href="icon-192.png"');
writeFileSync(join(OUT, 'index.html'), html);
copyFileSync(join(ROOT, 'style.css'), join(OUT, 'style.css'));
copyFileSync(join(ROOT, 'icons/icon-192.png'), join(OUT, 'icon-192.png'));
copyFileSync(join(ROOT, 'firebase-config.js'), join(OUT, 'firebase-config.js'));

console.log(`${files.length} scripts flattened, ${rewritten} imports rewritten -> ${OUT}`);
console.log(readdirSync(OUT).length + ' files: ' + readdirSync(OUT).join(', '));
