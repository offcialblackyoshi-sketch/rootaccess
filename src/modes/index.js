import race from './race.js';
import duel from './duel.js';
import defend from './defend.js';
import heist from './heist.js';
import tutorial from './tutorial.js';
import { makeQuickMode, STAGES } from './quickhack.js';
import { makeRng } from '../rng.js';
import * as letterlock from './minigames/letterlock.js';
import * as printmatch from './minigames/printmatch.js';
import * as signaltune from './minigames/signaltune.js';
import * as circuit from './minigames/circuit.js';
import * as memory from './minigames/memory.js';
import * as wirecut from './minigames/wirecut.js';
import * as portsweep from './minigames/portsweep.js';
import * as bitflip from './minigames/bitflip.js';

// Easy "quick hack" mini-games, each its own mode.
export const PUZZLES = Object.fromEntries([letterlock, printmatch, signaltune, circuit, memory, wirecut, portsweep, bitflip]
  .map((m) => [m.default.id, { ...m.default, generate: m.generate }]));
// HACK GAUNTLET: a different mini-game every stage, the same order for everyone.
export function gauntletOrder(seed) {
  return makeRng(`gauntlet:${seed}`).shuffle(Object.keys(PUZZLES)).slice(0, STAGES);
}
export const GAUNTLET = {
  id: 'gauntlet',
  name: 'Hack Gauntlet',
  blurb: 'A different mini-game every stage, back to back. Easy, no typing.',
  howTo: 'A different mini-game every stage.',
  timeLimit: 4 * 60 * 1000,
  pick: (seed, stage) => PUZZLES[gauntletOrder(seed)[Math.min(stage, STAGES - 1)]],
};

const quick = Object.fromEntries([['gauntlet', GAUNTLET], ...Object.entries(PUZZLES)].map(([id, p]) => [id, makeQuickMode(p)]));

export const MODES = { race, duel, defend, heist, tutorial, ...quick };
export const MODE_ORDER = ['race', 'duel', 'defend', 'heist', 'gauntlet', ...Object.keys(PUZZLES)];
