// Confetti: a short burst of falling pieces for wins, level-ups and trophies.
// Drawn on its own canvas above everything; skipped when Reduce motion is on.

const COLORS = ['#39ff6a', '#4dd9ff', '#ffd23d', '#ff4dd2', '#ff6b4d', '#b388ff', '#ffffff'];
let canvas = null;
let pieces = [];
let raf = 0;

function ensureCanvas() {
  if (canvas) return canvas;
  canvas = document.createElement('canvas');
  canvas.className = 'confetti-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.append(canvas);
  return canvas;
}

// Pure: a new piece starting at (x, y) with a random spread.
export function makePiece(x, y, random = Math.random, colors = COLORS) {
  const angle = -Math.PI / 2 + (random() - 0.5) * Math.PI * 0.9;
  const speed = 6 + random() * 9;
  return {
    x, y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    size: 5 + random() * 6,
    color: colors[Math.floor(random() * colors.length)],
    spin: (random() - 0.5) * 0.4,
    rot: random() * Math.PI,
    life: 1,
    shape: random() < 0.3 ? 'circle' : 'rect',
  };
}

// Pure: move a piece one frame (gravity, drag, fade). Returns false when done.
export function stepPiece(p, h) {
  p.vy += 0.35;
  p.vx *= 0.985;
  p.vy *= 0.985;
  p.x += p.vx;
  p.y += p.vy;
  p.rot += p.spin;
  if (p.vy > 0) p.life -= 0.006;
  return p.life > 0 && p.y < h + 40;
}

function frame() {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  pieces = pieces.filter((p) => stepPiece(p, canvas.height));
  for (const p of pieces) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.5));
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    if (p.shape === 'circle') { ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2); ctx.fill(); }
    else ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
    ctx.restore();
  }
  if (pieces.length) raf = requestAnimationFrame(frame);
  else { raf = 0; ctx.clearRect(0, 0, canvas.width, canvas.height); }
}

// Fire a burst. `amount` ~ number of pieces; `from` is 'center' or 'sides'.
export function confetti({ amount = 120, from = 'sides', colors } = {}) {
  if (document.documentElement.classList.contains('reduce-motion')) return;
  const c = ensureCanvas();
  c.width = innerWidth;
  c.height = innerHeight;
  const spots = from === 'center' ? [[c.width / 2, c.height * 0.45]] : [[c.width * 0.15, c.height * 0.9], [c.width * 0.85, c.height * 0.9]];
  for (let i = 0; i < amount; i++) {
    const [x, y] = spots[i % spots.length];
    pieces.push(makePiece(x, y, Math.random, colors));
  }
  pieces = pieces.slice(-400);
  if (!raf) raf = requestAnimationFrame(frame);
}
