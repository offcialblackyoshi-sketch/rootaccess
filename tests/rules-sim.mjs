// A small stand-in for the Firebase Realtime Database rules engine, good
// enough to test our own database.rules.json without the emulator.
// It evaluates the real rule expressions as JavaScript with snapshot objects.
//   const db = createRulesSim(rulesJson, initialData);
//   db.set(uid, 'groups/g1', value) -> true (applied) or false (refused)
//   db.canRead(uid, 'groups/g1')

/* eslint-disable no-extend-native */
// Rule strings use a few methods plain JS strings don't have.
if (!String.prototype.contains) Object.defineProperty(String.prototype, 'contains', { value(s) { return this.includes(s); } });
if (!String.prototype.beginsWith) Object.defineProperty(String.prototype, 'beginsWith', { value(s) { return this.startsWith(s); } });
if (!String.prototype.matches) Object.defineProperty(String.prototype, 'matches', { value(re) { return re.test(String(this)); } });

const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const split = (path) => String(path).split('/').filter(Boolean);

function getAt(tree, parts) {
  let cur = tree;
  for (const p of parts) {
    if (cur === null || typeof cur !== 'object' || !(p in cur)) return null;
    cur = cur[p];
  }
  return cur ?? null;
}

// Returns a new tree with the value at parts replaced (null deletes, and
// empty objects disappear, like Firebase).
function setAt(tree, parts, value) {
  const prune = (v) => {
    if (v === null || typeof v !== 'object') return v;
    for (const k of Object.keys(v)) { v[k] = prune(v[k]); if (v[k] === null) delete v[k]; }
    return Object.keys(v).length ? v : null;
  };
  const out = clone(tree) || {};
  if (!parts.length) return prune(clone(value)) || {};
  let cur = out;
  for (const p of parts.slice(0, -1)) {
    if (cur[p] === null || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = clone(value);
  return prune(out) || {};
}

class Snap {
  constructor(tree, parts) { this.tree = tree; this.parts = parts; }
  val() { return clone(getAt(this.tree, this.parts)); }
  child(path) { return new Snap(this.tree, [...this.parts, ...split(String(path))]); }
  parent() { return new Snap(this.tree, this.parts.slice(0, -1)); }
  exists() { return getAt(this.tree, this.parts) !== null; }
  hasChild(k) { return this.child(k).exists(); }
  hasChildren(keys) {
    const v = getAt(this.tree, this.parts);
    if (v === null || typeof v !== 'object') return false;
    return keys ? keys.every((k) => k in v) : Object.keys(v).length > 0;
  }
  numChildren() { const v = getAt(this.tree, this.parts); return v && typeof v === 'object' ? Object.keys(v).length : 0; }
  isString() { return typeof getAt(this.tree, this.parts) === 'string'; }
  isNumber() { return typeof getAt(this.tree, this.parts) === 'number'; }
  isBoolean() { return typeof getAt(this.tree, this.parts) === 'boolean'; }
}

export function createRulesSim(rulesDoc, initial = {}, { now = 1_000_000 } = {}) {
  const rules = rulesDoc.rules || rulesDoc;
  let data = clone(initial) || {};

  // Rule nodes along a path, with the $variables bound on the way.
  function walk(parts) {
    const out = [{ node: rules, depth: 0, vars: {} }];
    let node = rules;
    let vars = {};
    for (let i = 0; i < parts.length; i++) {
      if (!node) break;
      const p = parts[i];
      let next = node[p];
      if (next === undefined) {
        const v = Object.keys(node).find((k) => k.startsWith('$'));
        if (v) { next = node[v]; vars = { ...vars, [v]: p }; }
      }
      node = next;
      if (node) out.push({ node, depth: i + 1, vars });
    }
    return out;
  }

  function evaluate(expr, ctx) {
    if (typeof expr === 'boolean') return expr;
    const names = Object.keys(ctx.vars);
    const fn = new Function('root', 'data', 'newData', 'auth', 'now', ...names, `return (${expr});`);
    try {
      return !!fn(ctx.root, ctx.data, ctx.newData, ctx.auth, now, ...names.map((n) => ctx.vars[n]));
    } catch (e) {
      throw new Error(`rule failed to run: ${expr}\n${e.message}`);
    }
  }

  // Every .validate under (and above) the written path must pass for what will exist.
  function validates(newTree, parts, auth) {
    const check = (node, at, vars) => {
      if (!node || getAt(newTree, at) === null) return true;
      const ctx = { root: new Snap(data, []), data: new Snap(data, at), newData: new Snap(newTree, at), auth, vars };
      return node['.validate'] === undefined || evaluate(node['.validate'], ctx);
    };
    for (const { node, depth, vars } of walk(parts)) if (!check(node, parts.slice(0, depth), vars)) return false;
    // Below the written path: walk what's being written.
    const down = (node, at, vars) => {
      const v = getAt(newTree, at);
      if (!node || v === null || typeof v !== 'object') return true;
      for (const k of Object.keys(v)) {
        let child = node[k];
        let cv = vars;
        if (child === undefined) {
          const name = Object.keys(node).find((x) => x.startsWith('$'));
          if (name) { child = node[name]; cv = { ...vars, [name]: k }; }
        }
        if (!child) continue;
        if (!check(child, [...at, k], cv) || !down(child, [...at, k], cv)) return false;
      }
      return true;
    };
    const last = walk(parts);
    const deepest = last[last.length - 1];
    return deepest.depth === parts.length ? down(deepest.node, parts, deepest.vars) : true;
  }

  const authFor = (uid) => (uid ? { uid } : null);

  return {
    get data() { return data; },
    get: (path) => clone(getAt(data, split(path))),
    // Write a value (null = delete). Applied only if the rules allow it.
    set(uid, path, value) {
      const parts = split(path);
      const auth = authFor(uid);
      const newTree = setAt(data, parts, value);
      const ok = walk(parts).some(({ node, depth, vars }) => node['.write'] !== undefined && evaluate(node['.write'], {
        root: new Snap(data, []), data: new Snap(data, parts.slice(0, depth)), newData: new Snap(newTree, parts.slice(0, depth)), auth, vars,
      }));
      if (!ok || !validates(newTree, parts, auth)) return false;
      data = newTree;
      return true;
    },
    canRead(uid, path) {
      const parts = split(path);
      return walk(parts).some(({ node, depth, vars }) => node['.read'] !== undefined && evaluate(node['.read'], {
        root: new Snap(data, []), data: new Snap(data, parts.slice(0, depth)), newData: new Snap(data, parts.slice(0, depth)), auth: authFor(uid), vars,
      }));
    },
    // Put data in place directly (as if set up by an admin).
    seed(path, value) { data = setAt(data, split(path), value); },
    now,
  };
}
