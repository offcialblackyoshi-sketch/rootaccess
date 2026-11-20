// A small terminal widget: scrolling output, a prompt, command history (↑/↓)
// and Tab completion.

const MAX_LINES = 400;

export class Terminal {
  constructor(root, { prompt = '$', onCommand = null, complete = null } = {}) {
    this.root = root;
    this.onCommand = onCommand;
    this.complete = complete;
    this.onEscape = null;
    this.history = [];
    this.histPos = 0;
    this.echo = true;

    root.classList.add('term');
    root.innerHTML = '';

    this.out = document.createElement('div');
    this.out.className = 'term-out';
    this.out.setAttribute('role', 'log');

    this.form = document.createElement('form');
    this.form.className = 'term-in';
    this.promptEl = document.createElement('span');
    this.promptEl.className = 'prompt';
    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.input.setAttribute('autocapitalize', 'off');
    this.input.setAttribute('aria-label', 'Terminal command');
    this.form.append(this.promptEl, this.input);
    root.append(this.out, this.form);
    this.setPrompt(prompt);

    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      const line = this.input.value;
      this.input.value = '';
      if (this.echo) this.printParts([[this.promptText + ' ', 'prompt'], [line]]);
      if (line.trim()) {
        if (this.history[this.history.length - 1] !== line) this.history.push(line);
        if (this.history.length > 100) this.history.shift();
      }
      this.histPos = this.history.length;
      if (this.onCommand) this.onCommand(line);
    });

    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (this.histPos > 0) this.input.value = this.history[--this.histPos] ?? '';
        this.moveCaretToEnd();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (this.histPos < this.history.length) this.histPos++;
        this.input.value = this.history[this.histPos] ?? '';
        this.moveCaretToEnd();
      } else if (e.key === 'Tab' && this.complete) {
        e.preventDefault();
        this.tabComplete();
      } else if (e.key === 'Escape' && this.onEscape) {
        e.preventDefault();
        this.onEscape();
      } else if (e.ctrlKey && !e.altKey && (e.key === 'l' || e.key === 'L')) {
        // Ctrl+L: clear the screen, like a real terminal.
        e.preventDefault();
        this.clear();
      } else if (e.ctrlKey && !e.altKey && (e.key === 'c' || e.key === 'C') && this.input.selectionStart === this.input.selectionEnd) {
        // Ctrl+C (with nothing selected): cancel the line you're typing.
        e.preventDefault();
        if (this.echo) this.printParts([[this.promptText + ' ', 'prompt'], [this.input.value], ['^C', 'dim']]);
        this.input.value = '';
        this.input.dispatchEvent(new Event('input'));
        this.histPos = this.history.length;
      } else if (e.ctrlKey && !e.altKey && (e.key === 'u' || e.key === 'U')) {
        e.preventDefault();
        this.input.value = '';
        this.input.dispatchEvent(new Event('input'));
      } else if (e.key === 'PageUp' || e.key === 'PageDown') {
        e.preventDefault();
        this.out.scrollTop += (e.key === 'PageUp' ? -1 : 1) * this.out.clientHeight * 0.8;
      }
    });

    // Clicking anywhere in the terminal focuses the input (unless selecting text).
    root.addEventListener('click', () => {
      if (window.getSelection().isCollapsed) this.focus();
    });
  }

  setPrompt(text) {
    this.promptText = text;
    this.promptEl.textContent = text;
  }

  focus() {
    this.input.focus({ preventScroll: true });
  }

  setEnabled(on) {
    this.input.disabled = !on;
    if (on) this.focus();
  }

  moveCaretToEnd() {
    requestAnimationFrame(() => {
      const n = this.input.value.length;
      this.input.setSelectionRange(n, n);
    });
  }

  // Print one or more lines of plain text.
  print(text = '', cls = '') {
    for (const line of String(text).split('\n')) this.printParts([[line, cls]]);
  }

  // Print a single line made of differently styled parts: [[text, cls], ...]
  printParts(parts) {
    const stick = this.isAtBottom();
    const div = document.createElement('div');
    div.className = 'line';
    for (const [text, cls] of parts) {
      if (cls) {
        const span = document.createElement('span');
        span.className = cls;
        span.textContent = text;
        div.append(span);
      } else {
        div.append(document.createTextNode(text));
      }
    }
    if (!div.textContent) div.innerHTML = '&nbsp;';
    this.out.append(div);
    while (this.out.childElementCount > MAX_LINES) this.out.firstElementChild.remove();
    if (stick) this.scrollToBottom();
    return div;
  }

  // Print text a few characters at a time for a "hacker" feel.
  async typeOut(text, cls = '', charsPerSecond = 600) {
    if (document.documentElement.classList.contains('reduce-motion')) return this.print(text, cls);
    for (const line of String(text).split('\n')) {
      const div = this.printParts([['', cls]]);
      const target = div.firstElementChild || div;
      const step = Math.max(1, Math.round(charsPerSecond / 60));
      for (let i = 0; i < line.length; i += step) {
        target.textContent = line.slice(0, i + step);
        this.scrollToBottom();
        await new Promise((r) => setTimeout(r, 16));
      }
      if (!line) div.innerHTML = '&nbsp;';
    }
  }

  clear() {
    this.out.innerHTML = '';
  }

  isAtBottom() {
    return this.out.scrollHeight - this.out.scrollTop - this.out.clientHeight < 40;
  }

  scrollToBottom() {
    this.out.scrollTop = this.out.scrollHeight;
  }

  tabComplete() {
    const value = this.input.value;
    const tokens = value.split(/\s+/);
    const partial = tokens[tokens.length - 1];
    const options = this.complete(tokens) || [];
    if (options.length === 0) return;

    if (options.length === 1) {
      tokens[tokens.length - 1] = options[0];
      this.input.value = tokens.join(' ') + (options[0].endsWith('/') ? '' : ' ');
      return;
    }

    // Several matches: fill in the shared start and list them.
    let prefix = options[0];
    for (const o of options) {
      while (!o.startsWith(prefix)) prefix = prefix.slice(0, -1);
    }
    if (prefix.length > partial.length) {
      tokens[tokens.length - 1] = prefix;
      this.input.value = tokens.join(' ');
    } else {
      this.printParts([[this.promptText + ' ', 'prompt'], [value]]);
      this.print(options.join('   '), 'dim');
    }
  }
}
