// Sound effects generated with Web Audio (no audio files needed).
import { load, save } from './util.js';

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
  const t0 = audio.currentTime + delay;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(audio.destination);
  osc.start(t0);
  osc.stop(t0 + dur);
}

export const sfx = {
  unlock,
  isMuted: () => muted,
  toggleMute() {
    muted = !muted;
    save('ra-muted', muted);
    return muted;
  },
  ok: () => { tone(660, 0.08); tone(990, 0.12, { delay: 0.08 }); },
  err: () => tone(180, 0.18, { type: 'sawtooth', to: 120 }),
  alert: () => { tone(880, 0.1, { type: 'triangle', vol: 0.06 }); tone(880, 0.1, { type: 'triangle', vol: 0.06, delay: 0.15 }); },
  fire: () => tone(1200, 0.08, { to: 300 }),
  hit: () => tone(140, 0.2, { type: 'sawtooth', to: 70, vol: 0.06 }),
  chat: () => tone(1320, 0.05, { type: 'sine', vol: 0.03 }),
  win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.15, { delay: i * 0.12 })),
  lose: () => [392, 330, 262].forEach((f, i) => tone(f, 0.2, { type: 'triangle', delay: i * 0.15 })),
};
