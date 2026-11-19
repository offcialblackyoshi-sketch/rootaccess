// Helpers used by both network backends.

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O (look like 1 and 0)

export function randomRoomCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

export function isRoomCode(code) {
  return /^[A-Z]{4}$/.test(code);
}

// Set a value at a slash path inside an object, like Firebase does.
// A null value deletes the key and removes parents that become empty.
export function setPath(obj, path, value) {
  const parts = path.split('/').filter(Boolean);
  const last = parts.pop();
  const chain = [obj];
  let node = obj;
  for (const p of parts) {
    if (node[p] === null || typeof node[p] !== 'object') {
      if (value === null) return;
      node[p] = {};
    }
    node = node[p];
    chain.push(node);
  }
  if (value === null) {
    delete node[last];
    for (let i = chain.length - 1; i > 0; i--) {
      if (Object.keys(chain[i]).length) break;
      delete chain[i - 1][parts[i - 1]];
    }
  } else {
    node[last] = JSON.parse(JSON.stringify(value));
  }
}
