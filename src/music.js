// BACKGROUND MUSIC, made live with Web Audio (no audio files): a calm menu
// loop, a driving in-game track, and a faster "tense" track for the last 30
// seconds of a round. Volume is its own setting; Mute silences it too.

// Three tracks in A minor. Chords are MIDI root notes (A3 = 57).
export const TRACKS = {
  menu: { bpm: 84, chords: [57, 53, 60, 55], voices: ['pad', 'arp'] }, // Am F C G
  game: { bpm: 112, chords: [57, 57, 53, 55], voices: ['pad', 'arp', 'bass', 'kick', 'hat'] }, // Am Am F G
  tense: { bpm: 136, chords: [57, 53, 50, 52], voices: ['arp', 'bass', 'kick', 'hat'] }, // Am F Dm E
};

// C, E, F and G chords are major (E major gives the tense track its "uh oh"
// lift); A and D are minor.
const MAJOR = new Set([0, 4, 5, 7]); // pitch classes: C, E, F, G
export const triad = (root) => [root, root + (MAJOR.has(root % 12) ? 4 : 3), root + 7];

export const midiToFreq = (m) => 440 * 2 ** ((m - 69) / 12);

// The notes of one bar (4 beats): [{ beat, midi, dur (beats), voice, vol }].
// Pure and repeatable, so it can be tested.
export function patternFor(trackName, bar) {
  const tr = TRACKS[trackName];
  if (!tr) return [];
  const root = tr.chords[bar % tr.chords.length];
  const [a, b, c] = triad(root);
  const out = [];
  const has = (v) => tr.voices.includes(v);
  if (has('pad')) for (const m of [a, b, c]) out.push({ beat: 0, midi: m, dur: 4, voice: 'pad', vol: 0.5 });
  if (has('arp')) {
    // Up-and-down arpeggio an octave up: 8ths on the menu, 16ths in game.
    const steps = trackName === 'menu' ? 8 : 16;
    const shape = [a, b, c, b + 12, c, b, a + 12, c];
    for (let i = 0; i < steps; i++) out.push({ beat: (4 * i) / steps, midi: shape[i % shape.length] + 12, dur: 4 / steps, voice: 'arp', vol: trackName === 'menu' ? 0.45 : 0.35 });
  }
  if (has('bass')) {
    const steps = trackName === 'tense' ? 16 : 8;
    for (let i = 0; i < steps; i++) out.push({ beat: (4 * i) / steps, midi: root - 24 + (i % 4 === 2 ? 12 : 0), dur: 4 / steps, voice: 'bass', vol: 0.6 });
  }
  if (has('kick')) for (let i = 0; i < 4; i++) if (trackName === 'tense' || i % 2 === 0) out.push({ beat: i, midi: 0, dur: 0.25, voice: 'kick', vol: 0.9 });
  if (has('hat')) for (let i = 0; i < 8; i++) if (i % 2 === 1 || trackName === 'tense') out.push({ beat: i / 2, midi: 0, dur: 0.05, voice: 'hat', vol: i % 2 ? 0.35 : 0.2 });
  return out;
}

// Which track fits the moment: the menu track outside games, the tense one
// in the last 30 seconds of a round.
export function trackFor(screen, msLeft = Infinity) {
  if (screen !== 'game') return 'menu';
  return msLeft > 0 && msLeft <= 30000 ? 'tense' : 'game';
}

// getAudio(): the shared AudioContext (or null); volume(): 0..1 (0 = off); muted(): bool.
export function createMusic({ getAudio, volume, muted }) {
  let ctx = null;
  let master = null;
  let noise = null;
  let track = null;
  let bar = 0;
  let nextBar = 0;
  let timer = null;
  let notes = 0;

  const level = () => (muted() ? 0 : Math.max(0, Math.min(1, volume())));

  function ensure() {
    if (ctx) return true;
    ctx = getAudio();
    if (!ctx) return false;
    master = ctx.createGain();
    master.gain.value = 0;
    // A gentle low-pass keeps the music soft behind the sound effects.
    const soft = ctx.createBiquadFilter();
    soft.type = 'lowpass';
    soft.frequency.value = 2400;
    master.connect(soft).connect(ctx.destination);
    noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.1), ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }

  function voice(n, t, beatSec) {
    const dur = Math.max(0.03, n.dur * beatSec);
    const g = ctx.createGain();
    g.connect(master);
    if (n.voice === 'hat') {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 7000;
      g.gain.setValueAtTime(0.06 * n.vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      src.connect(hp).connect(g);
      src.start(t);
      src.stop(t + 0.06);
      return;
    }
    const osc = ctx.createOscillator();
    if (n.voice === 'kick') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(140, t);
      osc.frequency.exponentialRampToValueAtTime(40, t + 0.15);
      g.gain.setValueAtTime(0.35 * n.vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    } else {
      osc.type = n.voice === 'pad' ? 'sine' : n.voice === 'bass' ? 'square' : 'triangle';
      osc.frequency.setValueAtTime(midiToFreq(n.midi), t);
      const peak = (n.voice === 'pad' ? 0.05 : n.voice === 'bass' ? 0.035 : 0.05) * n.vol;
      const attack = n.voice === 'pad' ? Math.min(0.6, dur / 3) : 0.01;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur * (n.voice === 'pad' ? 1 : 0.9));
    }
    osc.connect(g);
    osc.start(t);
    osc.stop(t + dur + 0.05);
    notes++;
  }

  // Look-ahead scheduler: queue each bar a little before it plays.
  function schedule() {
    if (!ctx || !track || level() <= 0) return;
    const beatSec = 60 / TRACKS[track].bpm;
    while (nextBar < ctx.currentTime + 0.4) {
      for (const n of patternFor(track, bar)) voice(n, nextBar + n.beat * beatSec, beatSec);
      nextBar += 4 * beatSec;
      bar++;
    }
  }

  function applyLevel() {
    if (!master) return;
    const v = level() * 0.6;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(v, ctx.currentTime, 0.3);
  }

  return {
    // Switch tracks (null stops the music). Fades over a moment.
    setTrack(name) {
      if (name === track) return;
      track = TRACKS[name] ? name : null;
      if (!track) { clearInterval(timer); timer = null; applyLevel(); return; }
      if (!ensure()) return;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      bar = 0;
      nextBar = ctx.currentTime + 0.1;
      applyLevel();
      if (!timer) timer = setInterval(schedule, 100);
      schedule();
    },
    // Call when the volume or mute changes.
    update() {
      if (!ctx && track && level() > 0) { const t = track; track = null; this.setTrack(t); return; }
      if (ctx && ctx.state === 'suspended' && level() > 0) ctx.resume().catch(() => {});
      if (ctx && track && level() > 0 && nextBar < ctx.currentTime) nextBar = ctx.currentTime + 0.05; // resume cleanly
      applyLevel();
    },
    // For tests and the settings screen.
    state: () => ({ track, bar, notes, level: level(), playing: !!(track && ctx && level() > 0) }),
  };
}
