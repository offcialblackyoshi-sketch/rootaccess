import race from './race.js';
import duel from './duel.js';
import defend from './defend.js';
import heist from './heist.js';
import tutorial from './tutorial.js';
import { makeQuickMode } from './quickhack.js';
import * as letterlock from './minigames/letterlock.js';
import * as printmatch from './minigames/printmatch.js';
import * as signaltune from './minigames/signaltune.js';
import * as circuit from './minigames/circuit.js';
import * as memory from './minigames/memory.js';

// Easy "quick hack" mini-games, each its own mode.
export const PUZZLES = Object.fromEntries([letterlock, printmatch, signaltune, circuit, memory]
  .map((m) => [m.default.id, { ...m.default, generate: m.generate }]));
const quick = Object.fromEntries(Object.entries(PUZZLES).map(([id, p]) => [id, makeQuickMode(p)]));

export const MODES = { race, duel, defend, heist, tutorial, ...quick };
export const MODE_ORDER = ['race', 'duel', 'defend', 'heist', ...Object.keys(PUZZLES)];
