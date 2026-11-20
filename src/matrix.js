// "Digital rain" background: columns of falling characters with fading trails.
// Drawn on a canvas behind the whole game. Capped at 20 frames per second and
// paused when the tab is hidden, so it stays light on slower Chromebooks.

const GLYPHS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789';
const FONT_PX = 16;
const FRAME_MS = 50;

// How many columns fit across the screen.
export function columnCount(width, fontPx = FONT_PX) {
  return Math.max(1, Math.ceil(width / fontPx));
}

// Rainbow color for a moment in time (smoothly cycling hue).
export function rainbowColor(t) {
  const hue = Math.floor((t / 40) % 360);
  return `hsl(${hue}, 100%, 60%)`;
}

export function createMatrixRain(canvas) {
  const ctx = canvas.getContext('2d');
  let drops = [];
  let running = false;
  let rainbow = false;
  let color = '#33ff66';
  let last = 0;
  let raf = 0;
  let w = 0;
  let h = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cols = columnCount(w);
    // Keep existing drops where possible; start new columns at random heights.
    drops = Array.from({ length: cols }, (_, i) => drops[i] ?? Math.floor(Math.random() * -(h / FONT_PX)));
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
  }

  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (now - last < FRAME_MS) return;
    last = now;

    // A translucent black layer makes older characters fade into trails.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
    ctx.fillRect(0, 0, w, h);
    ctx.font = `${FONT_PX}px monospace`;
    ctx.textBaseline = 'top';

    for (let i = 0; i < drops.length; i++) {
      const y = drops[i] * FONT_PX;
      if (y >= 0) {
        const ch = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        // The leading character is brighter than the trail behind it.
        ctx.fillStyle = Math.random() < 0.1 ? '#d8ffe4' : rainbow ? rainbowColor(now + i * 25) : color;
        ctx.fillText(ch, i * FONT_PX, y);
      }
      // After falling off the bottom, restart at a random moment.
      if (y > h && Math.random() > 0.975) drops[i] = 0;
      else drops[i]++;
    }
  }

  function start() {
    if (running) return;
    running = true;
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else if (canvas.dataset.on === 'true') start();
  });
  resize();

  return {
    // on: show and animate; rainbow: cycle colors; tint: the theme color.
    set({ on, rainbow: rb = false, tint = '#33ff66' }) {
      rainbow = rb;
      color = tint;
      canvas.dataset.on = String(!!on);
      canvas.hidden = !on;
      if (on && !document.hidden) start();
      else stop();
    },
    get running() { return running; },
  };
}
