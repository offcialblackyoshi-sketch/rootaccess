// "Decrypting" text effect: letters cycle through random glyphs, then settle
// left to right on the real text. Used on headings when a screen opens.

const GLYPHS = '!<>-_\\/[]{}=+*^?#01ABCDEF';

// Pure: the text shown at progress t (0 → 1). Settled letters stay real;
// spaces and punctuation-free gaps are kept so the layout doesn't jump.
export function scrambleFrame(text, t, random = Math.random) {
  const settled = Math.floor(text.length * Math.min(1, Math.max(0, t)));
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    out += i < settled || ch === ' ' ? ch : GLYPHS[Math.floor(random() * GLYPHS.length)];
  }
  return out;
}

// Animate one element's own text (elements with child elements are skipped).
export function scramble(el, ms = 450) {
  if (!el || el.children.length || el.dataset.scrambling) return;
  if (document.documentElement.classList.contains('reduce-motion')) return;
  const text = el.textContent;
  if (!text.trim()) return;
  el.dataset.scrambling = '1';
  const start = performance.now();
  const tick = (now) => {
    const t = (now - start) / ms;
    if (t >= 1) {
      el.textContent = text;
      delete el.dataset.scrambling;
      return;
    }
    el.textContent = scrambleFrame(text, t);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Headings that get the effect when their screen or dialog opens.
export function scrambleHeadings(root) {
  root?.querySelectorAll('h2').forEach((h) => {
    // Only the plain text part of headings like "// OPEN ROOMS <span>3 open</span>".
    const node = h.childNodes[0];
    if (h.children.length && node?.nodeType === 3) {
      const span = document.createElement('span');
      span.textContent = node.textContent;
      h.replaceChild(span, node);
      scramble(span);
    } else scramble(h);
  });
}
