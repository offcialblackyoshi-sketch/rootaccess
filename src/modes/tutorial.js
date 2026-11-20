// TUTORIAL: a short, guided lesson in the terminal for first-time players.
// It isn't shown in the lobby; it starts from the menu's "Tutorial" button.

import { Shell, splitArgs } from '../commands.js';
import { makeRng } from '../rng.js';
import { save } from '../util.js';

export const TUTORIAL_DONE_KEY = 'ra-tutorial-done';

export function buildTutorial(seed) {
  const r = makeRng('tutorial:' + seed);
  const code = r.code(4, 'ABCDEFGHJKLMNPQRSTUVWXYZ');
  const fs = {
    home: {
      you: {
        'start-here.txt': 'Nice! You just read a file with "cat".\nFiles are where the clues are in this game.',
        docs: {
          'welcome.txt': 'Welcome to the docs folder.\nEverything in Root Access is pretend -- no real computers are touched.',
          'shopping.txt': 'milk\neggs\nkeyboard with a working space bar',
        },
        logs: {
          'today.log': `09:00 coffee machine online\n10:15 backup finished\n11:30 the secret door code is ${code}\n12:00 lunch`,
        },
      },
    },
  };
  // Each step: what to tell the player, and a check on the command they typed.
  const steps = [
    { say: 'Type  help  and press Enter. It lists every command you can use.', check: (c) => c.cmd === 'help' },
    { say: 'Type  ls  to list the files and folders where you are.', check: (c) => c.cmd === 'ls' },
    { say: 'Read a file with cat. Type  cat start-here.txt\n(Tip: type "cat st" and press Tab to finish the name for you!)', check: (c) => c.cmd === 'cat' && c.file === '/home/you/start-here.txt' },
    { say: 'Folders end with /. Move into one with cd. Type  cd docs', check: (c) => c.cwd === '/home/you/docs' },
    { say: 'Now type  ls  again to see what is in docs, then  cat welcome.txt', check: (c) => c.cmd === 'cat' && c.file === '/home/you/docs/welcome.txt' },
    { say: 'Go back up a folder with  cd ..', check: (c) => c.cwd === '/home/you' },
    { say: 'grep searches every file at once. Type  grep secret', check: (c) => c.cmd === 'grep' && /secret/i.test(c.args[0] || '') },
    { say: 'grep found a door code! Type  unlock <code>  using the code you found.', check: (c) => c.cmd === 'unlock' && (c.args[0] || '').toUpperCase() === code },
    { say: 'Press the ↑ key to bring back an earlier command, then press Enter to run it again.', check: (c) => c.repeat },
    { say: 'Last one: talk to other players. Type  say hello', check: (c) => c.cmd === 'say' },
  ];
  return { code, fs, steps };
}

export default {
  id: 'tutorial',
  name: 'Tutorial',
  min: 1,
  max: 8,
  bots: true,
  hidden: true,
  blurb: 'Learn the basics of the terminal.',

  mount(ctx) {
    const T = buildTutorial(ctx.seed);
    const { term } = ctx;
    const sh = new Shell(term, { user: 'you', host: 'training', fs: T.fs, cwd: '/home/you' });
    sh.homeDir = '/home/you';
    ctx.addCommon(sh);
    sh.register('unlock', {
      help: 'open a door with a code',
      usage: 'unlock <code>',
      run(args) {
        if ((args[0] || '').toUpperCase() === T.code) sh.print('*click* Door unlocked!', 'ok');
        else sh.print('Wrong code. Look at what grep found.', 'err');
      },
    });

    let step = 0;
    let last = '';
    const show = () => {
      term.print('');
      term.printParts([[`STEP ${step + 1}/${T.steps.length}  `, 'hi'], [T.steps[step].say]]);
    };

    term.onCommand = (line) => {
      sh.exec(line);
      const args = splitArgs(line.trim());
      const cmd = (args.shift() || '').toLowerCase();
      const file = args[0] ? sh.resolve(args[0]) : null;
      const info = { cmd, args, file, cwd: sh.cwd, repeat: !!line.trim() && line === last };
      last = line;
      if (step >= T.steps.length || !T.steps[step].check(info)) return;
      ctx.sfx.ok();
      step++;
      if (step < T.steps.length) {
        term.print('✔ Nice!', 'ok');
        show();
        return;
      }
      term.print('');
      term.print('#########################################', 'banner');
      term.print('#   TUTORIAL COMPLETE. You\'re ready.    #', 'banner');
      term.print('#########################################', 'banner');
      save(TUTORIAL_DONE_KEY, true);
      ctx.later(1500, () => {
        const me = ctx.player(ctx.me);
        ctx.update({ mode: 'race' });
        ctx.end([{ id: ctx.me, name: me?.name || 'you', color: me?.color, place: 0, detail: 'tutorial complete' }],
          'TUTORIAL COMPLETE! Try a Practice race next. Type "hint" there if you get stuck.', true);
      });
    };

    term.print('WELCOME, ROOKIE. This quick tutorial teaches the commands you need.', 'banner');
    term.print('Everything here is a game. Nothing touches real computers.', 'dim');
    show();
    ctx.setTimer('');
    return {};
  },
};
