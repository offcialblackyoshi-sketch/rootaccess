// Seeded random numbers, so every player builds the exact same puzzles
// from the room's seed without needing a server.

export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function makeRng(seed) {
  let a = (typeof seed === 'string' ? hashString(seed) : seed) >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    shuffle(arr) {
      const a2 = arr.slice();
      for (let i = a2.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a2[i], a2[j]] = [a2[j], a2[i]];
      }
      return a2;
    },
    code(len, chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789') {
      let s = '';
      for (let i = 0; i < len; i++) s += chars[Math.floor(next() * chars.length)];
      return s;
    },
  };
}

export function randomSeed() {
  return Math.floor(Math.random() * 2 ** 31);
}

// ---------------------------------------------------------------------------
// Word lists
// ---------------------------------------------------------------------------
export const WORDS = [
  'falcon', 'cipher', 'neon', 'vortex', 'quasar', 'raven', 'pixel', 'nebula',
  'cobalt', 'ember', 'glitch', 'onyx', 'phantom', 'zenith', 'static', 'matrix',
  'comet', 'shadow', 'titan', 'vector', 'echo', 'nova', 'pulse', 'saber',
  'kernel', 'socket', 'binary', 'photon', 'spectre', 'tundra', 'aurora', 'helix',
];

export const PETS = ['biscuit', 'pepper', 'mochi', 'rocket', 'waffles', 'luna', 'ziggy', 'noodle', 'pickles', 'tofu'];
export const FIRST = ['alex', 'sam', 'jordan', 'riley', 'casey', 'morgan', 'taylor', 'jamie', 'quinn', 'avery', 'rowan', 'skyler'];
export const LAST = ['chen', 'patel', 'garcia', 'novak', 'okafor', 'silva', 'kim', 'larsen', 'moreau', 'tanaka', 'reyes', 'walsh'];
export const HOSTS = ['atlas', 'hydra', 'orion', 'kraken', 'nimbus', 'cerberus', 'pegasus', 'chimera'];

// ---------------------------------------------------------------------------
// Ciphers (all reversible)
// ---------------------------------------------------------------------------
export function caesar(text, shift) {
  const s = ((shift % 26) + 26) % 26;
  return text.replace(/[a-z]/gi, (ch) => {
    const base = ch <= 'Z' ? 65 : 97;
    return String.fromCharCode(((ch.charCodeAt(0) - base + s) % 26) + base);
  });
}

export function b64encode(text) {
  return btoa(text);
}

export function b64decode(text) {
  try {
    return atob(text.trim());
  } catch {
    return null;
  }
}

export function reverse(text) {
  return [...text].reverse().join('');
}
