// A pretend shell. Each game mode creates one, registers its own commands,
// and optionally gives it a fake filesystem.
//
// Filesystem format: a directory is a plain object, a file is a string.
//   { home: { 'notes.txt': 'hello' }, etc: { passwd: '...' } }

export function splitArgs(line) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

export class Shell {
  constructor(term, { user = 'guest', host = 'localhost', fs = null, cwd = '/' } = {}) {
    this.term = term;
    this.user = user;
    this.host = host;
    this.fs = fs;
    this.cwd = cwd;
    this.cmds = new Map();
    this.locked = false;          // true while a command is "running"
    term.onCommand = (line) => this.exec(line);
    term.complete = (tokens) => this.complete(tokens);
    registerBase(this);
    if (fs) registerFs(this);
    this.updatePrompt();
  }

  register(name, spec) {
    this.cmds.set(name, spec);
  }

  unregister(name) {
    this.cmds.delete(name);
  }

  updatePrompt() {
    const dir = this.fs ? this.cwd : '~';
    this.term.setPrompt(`${this.user}@${this.host}:${dir}$`);
  }

  print(text, cls) {
    this.term.print(text, cls);
  }

  exec(line) {
    const args = splitArgs(line.trim());
    if (args.length === 0) return;
    if (this.locked) {
      this.print('busy: wait for the current command to finish', 'warn');
      return;
    }
    const name = args.shift().toLowerCase();
    const spec = this.cmds.get(name);
    if (!spec) {
      this.print(`${name}: command not found. Type "help" to see what you can do.`, 'err');
      return;
    }
    try {
      const result = spec.run(args, line.trim());
      if (result && typeof result.then === 'function') {
        this.locked = true;
        result.catch((e) => this.print(String(e), 'err')).finally(() => {
          this.locked = false;
        });
      }
    } catch (e) {
      this.print(String(e.message || e), 'err');
    }
  }

  complete(tokens) {
    if (tokens.length <= 1) {
      const p = (tokens[0] || '').toLowerCase();
      return [...this.cmds.entries()]
        .filter(([n, s]) => !s.hidden && n.startsWith(p))
        .map(([n]) => n)
        .sort();
    }
    const spec = this.cmds.get(tokens[0].toLowerCase());
    if (!spec || !spec.complete) return [];
    const partial = tokens[tokens.length - 1];
    return spec.complete(tokens.length - 2, partial, tokens).filter((o) => o.startsWith(partial));
  }

  // Run something that takes time, printing a progress bar.
  async progress(label, ms, cls = 'dim') {
    const line = this.term.printParts([[label + ' ', cls], ['[', cls], ['', 'bar'], [']', cls]]);
    const bar = line.querySelector('.bar') || { textContent: '' };
    const width = 20;
    const start = performance.now();
    await new Promise((resolve) => {
      const tick = () => {
        const t = Math.min(1, (performance.now() - start) / ms);
        const filled = Math.round(t * width);
        bar.textContent = '#'.repeat(filled) + '.'.repeat(width - filled);
        if (t < 1) setTimeout(tick, 50);
        else resolve();
      };
      tick();
    });
  }

  // ---- Filesystem helpers ----
  resolve(path = '.') {
    const parts = path.startsWith('/') ? [] : this.cwd.split('/').filter(Boolean);
    for (const p of path.split('/')) {
      if (!p || p === '.') continue;
      if (p === '..') parts.pop();
      else if (p === '~') parts.splice(0, parts.length, ...this.home().split('/').filter(Boolean));
      else parts.push(p);
    }
    return '/' + parts.join('/');
  }

  home() {
    return this.homeDir || '/';
  }

  node(absPath) {
    let n = this.fs;
    for (const p of absPath.split('/').filter(Boolean)) {
      if (n === null || typeof n !== 'object' || !(p in n)) return undefined;
      n = n[p];
    }
    return n;
  }

  completePath(partial, { dirsOnly = false } = {}) {
    const slash = partial.lastIndexOf('/');
    const dirPart = slash >= 0 ? partial.slice(0, slash + 1) : '';
    const base = slash >= 0 ? partial.slice(slash + 1) : partial;
    const dir = this.node(this.resolve(dirPart || '.'));
    if (!dir || typeof dir !== 'object') return [];
    return Object.keys(dir)
      .filter((k) => k.startsWith(base) && (!dirsOnly || typeof dir[k] === 'object'))
      .map((k) => dirPart + k + (typeof dir[k] === 'object' ? '/' : ''));
  }
}

// ---------------------------------------------------------------------------
// Commands every mode gets
// ---------------------------------------------------------------------------
function registerBase(sh) {
  sh.register('help', {
    help: 'list commands',
    run() {
      const rows = [...sh.cmds.entries()].filter(([, s]) => !s.hidden).sort(([a], [b]) => a.localeCompare(b));
      const w = Math.max(...rows.map(([n, s]) => (s.usage || n).length));
      sh.print('Available commands:', 'hi');
      for (const [n, s] of rows) sh.term.printParts([['  ' + (s.usage || n).padEnd(w + 2), 'cmd'], [s.help || '', 'dim']]);
      sh.print('Tip: press Tab to auto-complete, ↑/↓ for previous commands.', 'dim');
    },
  });

  sh.register('clear', { help: 'clear the screen', run: () => sh.term.clear() });
  sh.register('whoami', { help: 'show your user name', run: () => sh.print(sh.user) });
  sh.register('echo', { help: 'print text', usage: 'echo <text>', hidden: true, run: (args) => sh.print(args.join(' ')) });
}

function registerFs(sh) {
  const pathComplete = (i, partial) => sh.completePath(partial);

  sh.register('pwd', { help: 'show the current folder', run: () => sh.print(sh.cwd) });

  sh.register('ls', {
    help: 'list files in a folder',
    usage: 'ls [folder]',
    complete: (i, p) => sh.completePath(p, { dirsOnly: true }),
    run(args) {
      const path = sh.resolve(args[0] || '.');
      const n = sh.node(path);
      if (n === undefined) return sh.print(`ls: ${args[0]}: no such file or folder`, 'err');
      if (typeof n !== 'object') return sh.print(args[0]);
      const names = Object.keys(n).sort();
      if (names.length === 0) return sh.print('(empty)', 'dim');
      sh.term.printParts(names.flatMap((k) => (typeof n[k] === 'object' ? [[k + '/', 'dir'], ['  ']] : [[k, ''], ['  ']])));
    },
  });

  sh.register('cd', {
    help: 'change folder',
    usage: 'cd <folder>',
    complete: (i, p) => sh.completePath(p, { dirsOnly: true }),
    run(args) {
      const path = sh.resolve(args[0] || '~');
      const n = sh.node(path);
      if (n === undefined) return sh.print(`cd: ${args[0]}: no such folder`, 'err');
      if (typeof n !== 'object') return sh.print(`cd: ${args[0]}: not a folder`, 'err');
      sh.cwd = path;
      sh.updatePrompt();
    },
  });

  sh.register('cat', {
    help: 'show what is inside a file',
    usage: 'cat <file>',
    complete: pathComplete,
    run(args) {
      if (!args[0]) return sh.print('usage: cat <file>', 'warn');
      const n = sh.node(sh.resolve(args[0]));
      if (n === undefined) return sh.print(`cat: ${args[0]}: no such file`, 'err');
      if (typeof n === 'object') return sh.print(`cat: ${args[0]}: is a folder`, 'err');
      sh.print(n);
    },
  });

  sh.register('grep', {
    help: 'search every file in a folder for some text',
    usage: 'grep <text> [folder]',
    complete: (i, p) => (i === 1 ? sh.completePath(p) : []),
    run(args) {
      if (!args[0]) return sh.print('usage: grep <text> [folder]', 'warn');
      const needle = args[0].toLowerCase();
      const start = sh.resolve(args[1] || '.');
      const root = sh.node(start);
      if (root === undefined) return sh.print(`grep: ${args[1]}: no such file or folder`, 'err');
      let hits = 0;
      const walk = (n, path) => {
        if (typeof n === 'string') {
          n.split('\n').forEach((line, i) => {
            const at = line.toLowerCase().indexOf(needle);
            if (at < 0 || hits >= 40) return;
            hits++;
            sh.term.printParts([
              [path, 'dir'], [`:${i + 1}: `, 'dim'],
              [line.slice(0, at)], [line.slice(at, at + needle.length), 'hit'], [line.slice(at + needle.length)],
            ]);
          });
        } else {
          for (const k of Object.keys(n).sort()) walk(n[k], (path === '/' ? '' : path) + '/' + k);
        }
      };
      walk(root, start);
      if (hits === 0) sh.print('no matches', 'dim');
      else if (hits >= 40) sh.print('(stopped after 40 matches)', 'dim');
    },
  });
}
