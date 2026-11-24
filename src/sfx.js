// Sound effects generated with Web Audio (no audio files needed).
import { load, save } from './util.js';
import { getSettings } from './settings.js';

let audio = null;
let muted = load('ra-muted', false);

function unlock() {
  if (!audio) {
    try {
      audio = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      audio = null;
    }
  }
  if (audio && audio.state === 'suspended') audio.resume();
}

function tone(freq, dur, { type = 'square', to = freq, vol = 0.04, delay = 0 } = {}) {
  if (muted || !audio) return;
  const volume = getSettings().volume;
  if (volume <= 0) return;
  const t0 = audio.currentTime + delay;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  gain.gain.setValueAtTime(vol * volume * 1.5, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(audio.destination);
  osc.start(t0);
  osc.stop(t0 + dur);
}

// Which whole seconds (from `from` down to 1) were crossed between two
// "time left" readings. Used for countdown and last-seconds beeps.
export function secondsCrossed(prevLeftMs, leftMs, from = 10) {
  const out = [];
  const a = Math.ceil(prevLeftMs / 1000);
  const b = Math.ceil(leftMs / 1000);
  for (let s = Math.min(a - 1, from); s >= Math.max(b, 1); s--) out.push(s);
  return out;
}

const SOUNDS = {
  ok: () => { tone(660, 0.08); tone(990, 0.12, { delay: 0.08 }); },
  err: () => tone(180, 0.18, { type: 'sawtooth', to: 120 }),
  alert: () => { tone(880, 0.1, { type: 'triangle', vol: 0.06 }); tone(880, 0.1, { type: 'triangle', vol: 0.06, delay: 0.15 }); },
  siren: () => { tone(600, 0.25, { type: 'triangle', to: 1000, vol: 0.05 }); tone(1000, 0.25, { type: 'triangle', to: 600, vol: 0.05, delay: 0.25 }); },
  alarm: () => [0, 0.18, 0.36].forEach((d) => tone(1400, 0.12, { type: 'square', vol: 0.05, delay: d })),
  fire: () => tone(1200, 0.08, { to: 300 }),
  hit: () => tone(140, 0.2, { type: 'sawtooth', to: 70, vol: 0.06 }),
  chat: () => tone(1320, 0.05, { type: 'sine', vol: 0.03 }),
  key: () => tone(2400 + Math.random() * 600, 0.015, { type: 'square', vol: 0.012 }),
  tick: () => tone(1000, 0.05, { type: 'sine', vol: 0.05 }),
  go: () => tone(1500, 0.25, { type: 'sine', vol: 0.06 }),
  win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.15, { delay: i * 0.12 })),
  lose: () => [392, 330, 262].forEach((f, i) => tone(f, 0.2, { type: 'triangle', delay: i * 0.15 })),
};

// How many times each sound was requested (used by the automated tests).
const played = {};

export const sfx = {
  unlock,
  // The shared AudioContext (made on first use), for the music.
  audioContext() { unlock(); return audio; },
  played,
  isMuted: () => muted,
  toggleMute() {
    muted = !muted;
    save('ra-muted', muted);
    return muted;
  },
};
for (const [name, play] of Object.entries(SOUNDS)) {
  sfx[name] = () => {
    played[name] = (played[name] || 0) + 1;
    try { play(); } catch { /* audio problems never break the game */ }
  };
}
