// Kid-safe chat: hides rude words and personal info (emails, phone numbers)
// in everything players type to each other. It runs when messages are shown,
// so even messages sent from an old or modified copy of the game are cleaned.
// The word lists are base64 so this file doesn't show them to kids reading
// the code. To see or edit a list: atob('...') in the browser console, then
// btoa(list.join('|')).

const decode = (b64) => (typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString()).split('|');
// Caught anywhere inside a word, including stretched spellings.
const ROOTS = decode('ZnVja3xzaGl0fGN1bnR8Yml0Y2h8bmlnZ3xmYWdnb3R8d2hvcmV8c2x1dHxiYXN0YXJkfGFzc2hvbGV8ZGlja2hlYWR8d2Fua3x0d2F0fHJldGFyZHxwb3JufG1vdGhlcmZ8ZHVtYmFzc3xqYWNrYXNz');
// Caught only as whole words (they hide inside innocent words like class or cocktail).
const WORDS = decode('YXNzfGFzc2VzfGFyc2V8ZGlja3xkaWNrc3xjb2NrfGNvY2tzfGZhZ3xmYWdzfHBpc3N8cGlzc2VkfHRpdHN8dGl0dHl8Ym9vYnN8Ym9vYnxwZW5pc3x2YWdpbmF8c2V4fHNleHl8bnVkZXxudWRlc3xuYWtlZHxob2V8aG9lc3xyYXBlfHJhcGVkfHJhcGluZ3xreXN8c3RmdXx3dGZ8bWlsZnxkaWxkb3xjdW18aml6enxuYXppfG5hemlzfGhvcm55fHRob3R8c2ltcA==');
// Mean phrases.
const PHRASES = decode('a2lsbCB5b3Vyc2VsZnxraWxsIHVyc2VsZnxraWxsIHlvdXIgc2VsZnxnbyBkaWU=');

// Look-alike characters, one for one so positions line up with the original.
const LEET = { 0: 'o', 1: 'i', '!': 'i', '|': 'i', 3: 'e', 4: 'a', '@': 'a', 5: 's', $: 's', 7: 't' };
function normalize(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i].toLowerCase();
    out += c.length === 1 ? LEET[c] || c : text[i];
  }
  return out;
}

// "word" -> "w+o+r+d+" so "woooord" matches too (all list words are plain letters).
const stretch = (w) => [...w].map((c) => (c === ' ' ? '[\\s._-]*' : `${c}+`)).join('');
const ROOT_RE = new RegExp(`(?:${ROOTS.map(stretch).join('|')})`, 'g');
const WORD_RE = new RegExp(`(?<![a-z])(?:${WORDS.map(stretch).join('|')})(?![a-z])`, 'g');
const PHRASE_RE = new RegExp(`(?<![a-z])(?:${PHRASES.map(stretch).join('|')})(?![a-z])`, 'g');

const SPACED_RE = /(?<![a-z])(?:[a-z][\s._*-]){2,}[a-z](?![a-z])/g;
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE_RE = /\+?\d(?:[\s().-]{0,2}\d){6,}/g;

// The text with rude words turned into *** and personal info hidden.
export function cleanText(text) {
  if (text == null) return '';
  const out = String(text).replace(EMAIL_RE, '[email hidden]').replace(PHONE_RE, '[number hidden]');
  const norm = normalize(out);
  const mask = new Uint8Array(out.length);
  for (const re of [ROOT_RE, WORD_RE, PHRASE_RE]) {
    for (const m of norm.matchAll(re)) mask.fill(1, m.index, m.index + m[0].length);
  }
  // Spelled out with gaps ("b a d", "b.a.d"): join the letters and check again.
  for (const m of norm.matchAll(SPACED_RE)) {
    const joined = m[0].replace(/[^a-z]/g, '');
    if (new RegExp(`^(?:${ROOT_RE.source}|${WORD_RE.source})$`).test(joined) || ROOT_RE.test(joined)) mask.fill(1, m.index, m.index + m[0].length);
    ROOT_RE.lastIndex = 0;
  }
  let res = '';
  for (let i = 0; i < out.length; i++) res += mask[i] && /\S/.test(out[i]) ? '*' : out[i];
  return res;
}

// True if the text has rude words or personal info (used to refuse names).
export function hasBadWords(text) {
  return cleanText(text) !== String(text ?? '');
}

// ---------------------------------------------------------------------------
// Before sending: rude messages and personal info aren't sent at all, and
// someone who keeps trying gets a short chat timeout.
// ---------------------------------------------------------------------------
export const STRIKES_FOR_TIMEOUT = 3;     // blocked messages...
export const STRIKE_WINDOW_MS = 120000;   // ...within 2 minutes...
export const TIMEOUT_MS = 60000;          // ...mean a 60 second chat timeout

// 'personal' (phone number or email), 'rude', or null when the message is fine.
export function outgoingProblem(text) {
  const t = String(text ?? '');
  if (t.replace(EMAIL_RE, '').replace(PHONE_RE, '') !== t) return 'personal';
  if (cleanText(t) !== t) return 'rude';
  return null;
}

// Keeps track of blocked messages (saved, so reloading doesn't reset a timeout).
// check(text) -> { ok: true } or { ok: false, message }.
export function createChatGuard({ now = () => Date.now(), storage = null } = {}) {
  const KEY = 'ra-chat-guard';
  const read = () => { try { return JSON.parse(storage?.getItem(KEY)) || { strikes: [], until: 0 }; } catch { return { strikes: [], until: 0 }; } };
  const write = (s) => { try { storage?.setItem(KEY, JSON.stringify(s)); } catch { /* storage blocked */ } };
  let state = read();
  return {
    check(text) {
      const t = now();
      if (state.until > t) return { ok: false, message: `You're in a chat timeout for ${Math.ceil((state.until - t) / 1000)} more seconds.` };
      const problem = outgoingProblem(text);
      if (!problem) return { ok: true };
      state.strikes = [...state.strikes.filter((s) => t - s < STRIKE_WINDOW_MS), t];
      if (state.strikes.length >= STRIKES_FOR_TIMEOUT) {
        state = { strikes: [], until: t + TIMEOUT_MS };
        write(state);
        return { ok: false, message: `That message wasn't sent. You're in a chat timeout for ${TIMEOUT_MS / 1000} seconds.` };
      }
      write(state);
      return { ok: false, message: problem === 'personal'
        ? "That message wasn't sent: never share phone numbers or emails in chat."
        : "Please keep chat friendly. That message wasn't sent." };
    },
  };
}

// The one guard every chat uses.
export const chatGuard = createChatGuard({ storage: typeof localStorage === 'undefined' ? null : localStorage });
