// CO-OP HEIST: the team breaks into a vault together. Each role sees
// different information, so players must talk in chat.
//   Infiltrator: at the door/terminal/vault, types the answers.
//   Analyst:     has the files (manuals, staff records, guard roster).
//   Lookout:     keeps the alarm down by looping cameras in time.

import { Shell } from '../commands.js';
import { makeRng, WORDS, PETS, FIRST, LAST, caesar } from '../rng.js';
import { el, fmtTime, playerList } from '../util.js';

const TIME_LIMIT = 7 * 60 * 1000;
const STAGES = ['DOOR', 'LOGIN', 'VAULT'];
const ROLES = ['infiltrator', 'analyst', 'lookout', 'lookout'];
const ROLE_INFO = {
  infiltrator: 'You are inside the building. You can see the door, terminal and vault, but you have no files. Describe what you see in chat; the Analyst will tell you what to type.',
  analyst: 'You have all the files (manuals, staff records, roster) but you can\'t see the building. Ask the Infiltrator what they see, look it up, and tell them the answer.',
  lookout: 'You watch the cameras. When a guard is coming, loop the camera with the code shown before time runs out, or the alarm jumps. Keep the team calm!',
};
const ALARM_START = 10;
const ALARM_RATE = 0.5;     // per second
const MISTAKE = 15;

export function buildHeist(seed) {
  const r = makeRng('heist:' + seed);

  // ---- Stage 1: keypad ----
  const LIGHTS = ['RED', 'GREEN', 'BLUE', 'AMBER'];
  const models = r.shuffle(['KX-7', 'VR-2', 'ZT-9']);
  const model = models[0];
  const lit = r.shuffle(LIGHTS).slice(0, r.int(1, 2));
  const serialDigit = r.int(0, 9);
  const serial = r.code(4, 'ABCDEFGHJKLMNPQRSTUVWXYZ') + '-' + r.int(1, 9) + serialDigit;
  const pin4 = () => String(r.int(1000, 9999));
  const manual = {};
  for (const m of models) {
    manual[m] = { light: r.pick(LIGHTS), parity: r.pick(['even', 'odd']), codes: [pin4(), pin4(), pin4()] };
  }
  const rule = manual[model];
  const parityMatch = (serialDigit % 2 === 0) === (rule.parity === 'even');
  const doorCode = lit.includes(rule.light) ? rule.codes[0] : parityMatch ? rule.codes[1] : rule.codes[2];
  const manualText = ['KEYPAD OVERRIDE MANUAL (internal use only)', ''];
  for (const m of [...models].sort()) {
    const x = manual[m];
    manualText.push(`MODEL ${m}`,
      `  1. If the ${x.light} light is on, the override code is ${x.codes[0]}.`,
      `  2. Otherwise, if the serial number ends in an ${x.parity.toUpperCase()} digit, the code is ${x.codes[1]}.`,
      `  3. Otherwise, the code is ${x.codes[2]}.`, '');
  }

  // ---- Stage 2: staff login ----
  const firsts = r.shuffle(FIRST);
  const lasts = r.shuffle(LAST);
  const pets = r.shuffle(PETS);
  const colorsList = ['teal', 'orange', 'purple', 'crimson', 'gold', 'navy', 'lime', 'silver'];
  const depts = ['Security', 'Finance', 'IT', 'Facilities', 'Legal', 'Research'];
  const staff = Array.from({ length: 8 }, (_, i) => ({
    first: firsts[i], last: lasts[i], dept: r.pick(depts), born: r.int(1970, 2001),
    pet: pets[i], petType: r.pick(['dog', 'cat', 'hamster', 'parrot', 'lizard']), color: r.pick(colorsList),
  }));
  const victim = r.pick(staff);
  const user = `${victim.first[0]}.${victim.last}`;
  const hintType = r.pick(['petyear', 'yearpet', 'colorpet']);
  const loginHint = { petyear: "pet's name + year of birth", yearpet: "year of birth + pet's name", colorpet: "favorite color + pet's name" }[hintType];
  const password = { petyear: victim.pet + victim.born, yearpet: victim.born + victim.pet, colorpet: victim.color + victim.pet }[hintType];

  // ---- Stage 3: vault dial ----
  const guardNames = r.shuffle(FIRST.map((f, i) => `${f[0].toUpperCase() + f.slice(1)} ${LAST[(i * 5) % LAST.length][0].toUpperCase()}.`)).slice(0, 9);
  const nightCount = r.int(2, 6);
  const shifts = r.shuffle([...Array(nightCount).fill('NIGHT'), ...Array(9 - nightCount).fill(null).map(() => r.pick(['DAY', 'SWING']))]);
  const roster = guardNames.map((g, i) => `${g.padEnd(12)} ${shifts[i]}`);
  const word = r.pick(WORDS).toUpperCase();
  const display = caesar(word, nightCount);

  const fs = {
    'readme.txt': 'ANALYST TERMINAL\nThe Infiltrator will tell you what they see. Find the answer in these files and send it back in chat.\nTry: ls, cd, cat, grep',
    manuals: { 'keypads.txt': manualText.join('\n') },
    staff: Object.fromEntries(staff.map((s) => [`${s.first}_${s.last}.txt`,
      `Name: ${s.first[0].toUpperCase() + s.first.slice(1)} ${s.last[0].toUpperCase() + s.last.slice(1)}\nUsername: ${s.first[0]}.${s.last}\nDept: ${s.dept}\nBorn: ${s.born}\nPet: ${s.pet[0].toUpperCase() + s.pet.slice(1)} (${s.petType})\nFavorite color: ${s.color}`])),
    security: {
      'vault.txt': 'VAULT PROCEDURE\nSet the vault dial to the number of guards on the NIGHT shift (see roster.txt).\nThe display will then show the code word. Say it to open the vault.',
      'roster.txt': 'GUARD ROSTER -- THIS WEEK\n' + roster.join('\n'),
    },
  };

  return { model, lit, serial, doorCode, user, loginHint, password, display, nightCount, word, fs };
}

export default {
  id: 'heist',
  name: 'Co-op Heist',
  min: 2,
  max: 4,
  bots: false,
  blurb: 'Team up! Each player sees different clues. Talk in chat to crack the door, the login and the vault before the alarm.',

  setup({ players }) {
    const out = {};
    players.filter((p) => !p.bot).forEach((p, i) => (out[p.id] = { role: ROLES[i] || 'lookout' }));
    return { players: out, game: { stage: 0, alarm: ALARM_START } };
  },

  mount(ctx) {
    const P = buildHeist(ctx.seed);
    const { term, me } = ctx;
    const role = ctx.myState().role || 'lookout';
    const humans = playerList(ctx.room).filter((p) => !p.bot);
    const lookoutDuty = role === 'lookout' || (role === 'analyst' && humans.length === 2);
    const game = () => ctx.room.game || { stage: 0, alarm: ALARM_START };
    const stage = () => game().stage || 0;

    const sh = new Shell(term, {
      user: role,
      host: { infiltrator: 'vault-floor', analyst: 'hq', lookout: 'cctv' }[role],
      fs: role === 'analyst' ? P.fs : null,
      cwd: '/',
    });
    sh.homeDir = '/';
    ctx.addCommon(sh);

    const alarm = (delta) => ctx.push('actions', { type: 'alarm', delta, from: me });
    const mistake = (text) => {
      ctx.sfx.err();
      sh.print(text + `  (alarm +${MISTAKE})`, 'err');
      alarm(MISTAKE);
    };

    sh.register('status', {
      help: 'show the team\'s progress',
      run() {
        const g = game();
        sh.print(`ROLE: ${role.toUpperCase()}   STAGE: ${Math.min(stage() + 1, 3)}/3 ${STAGES[Math.min(stage(), 2)]}   ALARM: ${Math.round(g.alarm)}%`, 'hi');
        for (const p of playerList(ctx.room).filter((x) => !x.bot)) sh.print(`  ${p.name}: ${p.s?.role || '?'}`, 'dim');
      },
    });

    // ---- Infiltrator ----
    if (role === 'infiltrator') {
      let dialed = false;
      sh.register('inspect', {
        help: 'look at the door, terminal or vault',
        usage: 'inspect <door|terminal|vault>',
        complete: (i) => (i === 0 ? ['door', 'terminal', 'vault'] : []),
        run(args) {
          const what = (args[0] || STAGES[stage()].toLowerCase()).toLowerCase();
          if (what === 'door') {
            if (stage() > 0) return sh.print('the door is already open.', 'dim');
            sh.print('A heavy security door with a keypad.', 'hi');
            sh.print(`  Keypad model:  ${P.model}`);
            sh.print(`  Serial number: ${P.serial}`);
            sh.print(`  Lights on:     ${P.lit.join(', ')}`);
            sh.print('Tell the Analyst what you see. Then:  enter <code>', 'dim');
          } else if (what === 'terminal' || what === 'login') {
            if (stage() < 1) return sh.print('you can\'t reach the terminal yet. Open the door first.', 'err');
            if (stage() > 1) return sh.print('the terminal is already unlocked.', 'dim');
            sh.print('A locked workstation.', 'hi');
            sh.print(`  User:          ${P.user}`);
            sh.print(`  Password hint: ${P.loginHint}`);
            sh.print('The Analyst has staff records. Then:  login <password>', 'dim');
          } else if (what === 'vault') {
            if (stage() < 2) return sh.print('you can\'t reach the vault yet.', 'err');
            sh.print('The vault. A dial (0–25) and a scrambled display.', 'hi');
            sh.print(`  Display: ${P.display}`);
            sh.print('The Analyst knows the vault procedure. Then:  dial <number>   and   open <word>', 'dim');
          } else {
            sh.print('usage: inspect <door|terminal|vault>', 'warn');
          }
        },
      });
      sh.register('enter', {
        help: 'type a code into the door keypad',
        usage: 'enter <code>',
        async run(args) {
          if (stage() !== 0) return sh.print('there is no keypad here.', 'dim');
          if (!args[0]) return sh.print('usage: enter <code>', 'warn');
          await sh.progress('keypad', 600);
          if (args[0] === P.doorCode) {
            sh.print('*click* The door swings open. Next: inspect terminal', 'ok');
            ctx.sfx.ok();
            ctx.push('actions', { type: 'stage', stage: 1 });
          } else mistake('BZZT. Wrong code.');
        },
      });
      sh.register('login', {
        help: 'log in to the workstation',
        usage: 'login <password>',
        async run(args) {
          if (stage() !== 1) return sh.print('no login screen here.', 'dim');
          if (!args[0]) return sh.print('usage: login <password>', 'warn');
          await sh.progress('authenticating', 700);
          if (args.join('').toLowerCase() === P.password.toLowerCase()) {
            sh.print('Access granted. The vault room unlocks. Next: inspect vault', 'ok');
            ctx.sfx.ok();
            ctx.push('actions', { type: 'stage', stage: 2 });
          } else mistake('ACCESS DENIED.');
        },
      });
      sh.register('dial', {
        help: 'turn the vault dial',
        usage: 'dial <0-25>',
        async run(args) {
          if (stage() !== 2) return sh.print('there is no dial here.', 'dim');
          const n = parseInt(args[0], 10);
          if (Number.isNaN(n) || n < 0 || n > 25) return sh.print('usage: dial <0-25>', 'warn');
          await sh.progress('turning dial', 600);
          const shown = caesar(P.display, -n);
          sh.print(`Display: ${shown}`, n === P.nightCount ? 'ok' : 'warn');
          if (n === P.nightCount) {
            dialed = true;
            sh.print('That looks like a word! Now:  open <word>', 'dim');
          } else {
            sh.print('Still scrambled. A guard heard the dial click… (alarm +8)', 'err');
            alarm(8);
          }
        },
      });
      sh.register('open', {
        help: 'say the code word to open the vault',
        usage: 'open <word>',
        async run(args) {
          if (stage() !== 2) return sh.print('nothing to open yet.', 'dim');
          if (!args[0]) return sh.print('usage: open <word>', 'warn');
          await sh.progress('voice check', 800);
          if (args[0].toUpperCase() === P.word) {
            sh.print('THE VAULT IS OPEN. 💰', 'banner');
            ctx.push('actions', { type: 'stage', stage: 3 });
          } else mistake(dialed ? 'Wrong word.' : 'Wrong word. (Did you dial first?)');
        },
      });
    }

    // ---- Lookout duty (lookout, or the analyst in a 2-player game) ----
    let pending = null; // { cam, code, deadline }
    let nextEvent = ctx.now() + 8000;
    if (lookoutDuty) {
      sh.register('loop', {
        help: 'loop a camera feed so a guard isn\'t spotted',
        usage: 'loop <code>',
        run(args) {
          if (!pending) return sh.print('no guard is near a camera right now.', 'dim');
          if (args[0] === pending.code) {
            sh.print(`CAM ${pending.cam} looped. The guard walks past. (alarm -12)`, 'ok');
            ctx.sfx.ok();
            alarm(-12);
            pending = null;
          } else mistake('Wrong code. The feed glitched.');
        },
      });
      sh.register('cams', {
        help: 'check the security cameras',
        run() {
          for (let c = 1; c <= 6; c++) {
            const hot = pending && pending.cam === c;
            sh.term.printParts([[`  CAM ${c}  `, 'dir'], [hot ? `GUARD APPROACHING. loop ${pending.code}` : 'clear', hot ? 'alert' : 'dim']]);
          }
        },
      });
    }

    function lookoutTick() {
      if (!lookoutDuty || game().outcome) return;
      const now = ctx.now();
      if (pending && now > pending.deadline) {
        sh.print(`CAM ${pending.cam}: the guard spotted something! (alarm +${MISTAKE})`, 'err');
        ctx.sfx.err();
        alarm(MISTAKE);
        pending = null;
      }
      if (!pending && now >= nextEvent) {
        const gap = role === 'lookout' ? 14000 + Math.random() * 8000 : 20000 + Math.random() * 10000;
        nextEvent = now + gap;
        pending = { cam: 1 + Math.floor(Math.random() * 6), code: String(1000 + Math.floor(Math.random() * 9000)), deadline: now + 12000 };
        term.printParts([[' GUARD ', 'alert'], [` heading toward CAM ${pending.cam}! Type:  `], [`loop ${pending.code}`, 'cmd'], ['  (12s)', 'warn']]);
        ctx.sfx.alert();
      }
    }

    // ---- Stage area: alarm meter + progress ----
    const alarmFill = el('div', { class: 'fill' });
    const alarmText = el('span');
    const progressEl = el('div', { style: { marginTop: '6px', fontSize: '13px' } });
    const pendingEl = el('div', { style: { marginTop: '6px' } });
    ctx.stage.append(el('div', { class: 'stage-box' },
      el('div', { class: 'meter' }, el('span', {}, 'ALARM'), el('div', { class: 'track' }, alarmFill), alarmText),
      progressEl, pendingEl));

    function renderStage() {
      const g = game();
      const a = Math.min(100, Math.max(0, g.alarm || 0));
      alarmFill.style.width = a + '%';
      alarmFill.className = 'fill ' + (a >= 75 ? 'danger' : a >= 45 ? 'warn' : '');
      alarmText.textContent = Math.round(a) + '%';
      progressEl.innerHTML = '';
      progressEl.append(`YOU: ${role.toUpperCase()}   `, ...STAGES.map((s, i) => el('span', { class: i < stage() ? 'ok' : i === stage() ? 'warn' : 'dim' }, (i < stage() ? '✔ ' : i === stage() ? '▶ ' : '· ') + s + '   ')));
      pendingEl.innerHTML = '';
      if (pending) {
        const left = Math.max(0, Math.ceil((pending.deadline - ctx.now()) / 1000));
        pendingEl.append(el('span', { class: 'alert' }, ` CAM ${pending.cam} `), ` type `, el('code', {}, `loop ${pending.code}`), ` within ${left}s`);
      }
    }

    function renderSide() {
      ctx.side.innerHTML = '';
      ctx.side.append(el('h2', {}, '// CREW'));
      for (const p of playerList(ctx.room).filter((x) => !x.bot)) {
        ctx.side.append(el('div', { class: 'side-row' },
          el('span', { class: 'dot', style: { background: p.color } }),
          el('span', { class: 'pname', style: { color: p.color } }, p.name + (p.id === me ? ' (you)' : '')),
          el('span', { class: 'progress-text' }, (p.s?.role || '?').toUpperCase())));
      }
    }

    // ---- Host: alarm, stages and outcome ----
    const processed = new Set();
    let lastTick = ctx.now();
    function hostTick() {
      if (!ctx.isHost()) { lastTick = ctx.now(); return; }
      const g = { ...game() };
      if (g.outcome) return;
      const now = ctx.now();
      let alarmVal = g.alarm ?? ALARM_START;
      alarmVal += (ALARM_RATE * (now - lastTick)) / 1000;
      lastTick = now;
      let st = g.stage || 0;
      const changes = {};
      for (const [key, a] of Object.entries(ctx.room.actions || {})) {
        if (processed.has(key)) continue;
        processed.add(key);
        changes[`actions/${key}`] = null;
        if (a.type === 'alarm') alarmVal += a.delta;
        if (a.type === 'stage') st = Math.max(st, a.stage);
      }
      alarmVal = Math.max(0, Math.min(100, alarmVal));
      changes['game/alarm'] = Math.round(alarmVal * 10) / 10;
      changes['game/stage'] = st;
      const elapsed = now - ctx.startedAt;
      let outcome = null;
      if (st >= 3) outcome = 'win';
      else if (alarmVal >= 100) outcome = 'alarm';
      else if (elapsed >= TIME_LIMIT) outcome = 'time';
      if (outcome) {
        changes['game/outcome'] = outcome;
        ctx.update(changes);
        const crew = playerList(ctx.room).filter((p) => !p.bot);
        const summary = {
          win: `HEIST COMPLETE! Vault cracked in ${fmtTime(elapsed)} with the alarm at ${Math.round(alarmVal)}%.`,
          alarm: `BUSTED! The alarm went off at stage ${st + 1} (${STAGES[Math.min(st, 2)]}).`,
          time: `OUT OF TIME! The crew reached stage ${st + 1} (${STAGES[Math.min(st, 2)]}).`,
        }[outcome];
        ctx.end(crew.map((p) => ({ id: p.id, name: p.name, color: p.color, place: 0, detail: (p.s?.role || '').toUpperCase() })), summary, outcome === 'win');
      } else {
        ctx.update(changes);
      }
    }

    ctx.every(1000, hostTick);
    ctx.every(250, () => {
      lookoutTick();
      renderStage();
      const left = ctx.startedAt + TIME_LIMIT - ctx.now();
      ctx.setTimer(fmtTime(left), left < 60000 ? 'danger' : '');
    });

    // ---- Intro ----
    term.print(`CO-OP HEIST. Your role: ${role.toUpperCase()}${lookoutDuty && role !== 'lookout' ? ' (+ lookout duty)' : ''}`, 'banner');
    term.print(ROLE_INFO[role]);
    if (lookoutDuty && role !== 'lookout') term.print(ROLE_INFO.lookout, 'dim');
    term.print('Use the COMMS chat on the right (or "say <msg>") to talk. Type "help" for your commands.', 'dim');
    if (role === 'infiltrator') term.print('Start with:  inspect door', 'hi');
    if (role === 'analyst') term.print('Start with:  ls   and   cat readme.txt', 'hi');

    let lastStage = stage();
    return {
      onRoom() {
        renderSide();
        renderStage();
        if (stage() !== lastStage) {
          lastStage = stage();
          if (lastStage < 3) {
            term.print(`>> STAGE ${lastStage} CLEARED. Now: ${STAGES[lastStage]}`, 'ok');
            ctx.sfx.ok();
          }
        }
      },
    };
  },
};
