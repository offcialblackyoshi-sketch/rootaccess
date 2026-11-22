# Changelog

Work happens on the `overnight` branch, one focused improvement per commit. Every change is checked with the unit tests and the 3-window end-to-end test before it's committed. To review: `git log main..overnight`. To keep everything: `git checkout main && git merge overnight`.

## Backlog (highest value first)

1. [x] **Players leaving mid-game:** the Heist infiltrator leaving shouldn't stall the crew, solo survivors should get a proper ending, and messages addressed to departed players should be cleaned up.
2. [x] **Bot difficulty** (easy / normal / hard) chosen in the lobby, so Practice suits beginners.
3. [x] **Race puzzle variety:** more cipher types (hex, atbash) and more places the password can hide (bash history, config files).
4. [x] **Heist puzzle variety:** more keypad rule types and different vault and login variants.
5. [x] **Onboarding:** a guided first-run tutorial in Practice, and hints that become more specific the more you ask.
6. [x] **Stats on the results screen:** duel speed (WPM) and accuracy, data stolen, and time per race layer.
7. [x] **Keyboard and focus on Chromebooks:** Esc switches between terminal and chat, the cursor goes back to the terminal after chatting, and Ctrl+L clears the screen.
8. [x] **Accessibility settings:** turn off scanlines, larger text, and reduced motion, all saved per device.
9. [x] **Host tools:** kick a player, and choose the round length in the lobby.
10. [x] **Sound polish:** optional key-click sounds, a countdown beep, and distinct alert sounds per mode.
11. [x] **Duel power-ups:** occasional "bonus" snippets that repair your firewall or shield you.
12. [x] **Rejoining after a reload:** you keep your seat if you refresh during the lobby.

## Done

### Trophies
- 55 permanent trophies in 9 groups: getting started, winning, levels, a champion trophy for every mode, quick hacks, the Daily Challenge, teams, social and habits.
- **A new weekly trophy every Monday (UTC):** a challenge picked from the week number, such as "Win 3 rounds", "Clear 5 quick hacks" or "Win a round of Wire Cut". It's the same for everyone that week. Earn it before Sunday ends to keep it, and past weekly trophies stay in your collection.
- Unlocked trophies pop up on the results screen. The **Trophies** button on the menu shows the collection, this week's progress and a countdown to the next weekly trophy.
- Trophies save to your account when you're signed in (merged across devices), and the All-time leaderboard shows each player's trophy count.


### Username and password accounts
- The menu now offers **Continue with Google**, **Log in** and **Create account**. All of them are optional, and guests still play everything.
- **Create account** asks for a username and password, with email optional. With an email, a verification email is sent and **Forgot password?** works. Without one, the username is the login. (It uses a made-up `@players.rootaccess.invalid` address behind the scenes, and nothing is ever sent to it.)
- Usernames are checked against `handles/` before the account is created. If the claim still fails, the new account is deleted again.
- Password accounts can save progress and post scores just like Google accounts. The rules now accept `sign_in_provider === 'password'` or a verified email.
- **Setup:** enable **Email/Password** in Firebase → Authentication → Sign-in method, and publish the updated rules.


### Google sign-in
- **Sign in with Google** on the menu (when online play is available). The first time, you pick a unique handle (2–14 letters, digits, `_ . -`), claimed at `handles/<handle>` so no two players share one. You can change it later.
- Your XP, rounds, wins and title are saved to `users/<uid>` after every round. The first sign-in uploads this device's progress, and after that the account's progress is used on any device.
- Only signed-in players appear on the All-time and Today boards. The rules require a verified Google account, and the name on the board must match your handle. Guests can still play and view the boards.
- **Verified:** unit tests cover handle validation and suggestions, the progress merge on sign-in, and the rules. Real Google sign-in couldn't be tested from the build container (Google's servers are blocked there), so try it on the live site.


### Code Memory rework and a global leaderboard
- **Code Memory** now works like a pattern hack: the code is one lit cell in each column. Decoy patterns flicker first, then the real code flashes 3 times, all at once. You enter it column by column (↑/↓ and Space/Enter, or click). A wrong cell is a mistake and replays the show. Grids grow from 4×3 to 6×6, with 3 to 7 decoys.
- **Leaderboards** (menu): an **All-time** tab ranks everyone by XP and shows level, title, rounds, wins and win %, plus a **Today** tab for the Daily Challenge. Stats are saved after every round to `stats/<uid>`. That uses a separate guest sign-in that this browser remembers, so your row stays yours. The rules only let you write your own row, keep wins ≤ rounds, and let XP rise by at most 500 per save. It shows just your own row when online play isn't available.
- **One-time step:** publish the updated `database.rules.json` again.


### Daily Challenge
- **Daily challenge** on the menu: a solo Hack Gauntlet seeded by the UTC date, so everyone gets the same 5 mini-games that day. Score = time + 5 s per mistake. **Try again** replays the same puzzles, and only your best counts.
- **Today's board** (on the menu and after each run) shows the top 20. It's online through Firebase at `daily/<date>/<uid>`, where each player can only write their own entry, the score must equal time + 5 s × mistakes, and only a better score replaces yours. When online play isn't set up or a request fails, it falls back to this device.
- **One-time step:** publish the updated `database.rules.json` in the Firebase console (Realtime Database → Rules).
- **Verified:** unit tests cover the seed per day, the score, and the rules file. The e2e test plays a daily run, finds it on the board, checks that Try again gives the same puzzles, and opens the board from the menu.


### XP, levels and unlocks
- Every round earns XP: 20 for playing, +10 for each player you beat, and +25 for a win (the tutorial gives 50). Each level costs 50 XP more than the one before.
- The menu shows your level and XP bar, plus a title picker (script kiddie → … → zero-day legend). Extra name colors unlock at levels 3, 6, 9 and 12. The lobby shows each player's level and title.
- The results screen shows "+XP", your level bar, and a LEVEL UP! burst. XP is only awarded once per round.
- **Verified:** unit tests check the level curve, that better results earn more, and that unlocks come in order. A browser run went from 90 XP to level 2 and re-rendered the results without awarding XP twice.


### Team duels (1v1, 2v2, 3v3, 4v4)
- Typing Duel has a **Teams** option in the lobby: FFA, 1v1, 2v2, 3v3 or 4v4. The player list groups by team. You can switch your own team (the host can also move bots), and the host has **Shuffle teams** (humans spread out first) and **Fill with bots**. START waits until both teams are full.
- In game there's no friendly fire: targets, aim buttons and bots only go after the other team. The side panel shows each team's total HP. The last team standing wins together, or the team with more HP when time runs out.
- Letter Lock: a press just past the line still counts, since the columns now keep moving.
- **Verified:** unit tests cover team balancing for every size and mix of humans and bots, start checks, and who wins. The e2e test plays a 2v2 practice duel: it can't start short-handed, Fill with bots works, you never target a teammate, and both winners share 1st place.


### More Quick Hacks and the Hack Gauntlet
- 3 new mini-game modes: **Wire Cut** (rule card, cut wires in order), **Port Sweep** (close ports while they're lit), and **Bit Flip** (switches that add up to a target, shown in hex in later stages).
- **Hack Gauntlet:** a different mini-game every stage, chosen from the room seed so everyone gets the same order. It has a 4-minute round.
- **Verified:** unit tests re-solve Wire Cut from the card text for 200 seeds, check that every Bit Flip target is reachable, that Port Sweep gets harder by stage, and that the Gauntlet never repeats a game and uses all of them. The e2e test plays each new game with real key presses.


### Quick Hacks: 5 easy mini-game modes
- New lobby group **QUICK HACKS · easy · no typing** with 5 separate modes: Letter Lock, Print Match, Signal Tune, Circuit Path, and Code Memory. You play with the arrow keys, Space/Enter, or the mouse.
- Shared rules (`src/modes/quickhack.js`): 1–8 players with bots, a 3-minute round, and 5 stages that get harder. Everyone gets the same puzzle per stage from the room seed. A mistake means a 3 s lockout, never a knock-out. The first to clear 5 stages wins. Results show stages, mistakes, and fastest stage.
- Bots clear a stage every 40–70 s on easy, 22–40 s on normal, and 12–22 s on hard.
- **Verified:** new unit tests check that every puzzle is deterministic and solvable for 200 seeds, and that it gets harder by stage. They cover letters present, decoys never exact copies, reachable waves, a route through every maze, and valid memory sequences. The e2e test plays stage 1 of each mode with real key presses, checks the lockout, and finishes each round.


### 1. Players leaving mid-game
- **Heist:** if the Infiltrator or Analyst leaves, a Lookout takes over that role. Their terminal shows **CREW CHANGE** and they get the new commands. When there's no Lookout left, the Analyst picks up lookout duty. If fewer than 2 players are left, the heist is called off.
- **Hack & Defend:** if everyone else disconnects, the round ends and the last player wins by default, instead of sitting through the 5-minute timer alone.
- **All modes:** the host removes leftover attacks aimed at players who have gone.
- **Verified:** a new unit test covers the role reassignment rules. A new end-to-end step has the host, who is also the Infiltrator, leave mid-heist and checks that hosting moves to the next player, roles are reassigned, and the game continues. Another new step checks the "wins by default" ending. 30/30 end-to-end checks pass.

### 2. Bot difficulty
- The lobby now has **Bots: easy / normal / hard** whenever there are bots. Only the host can change it; everyone else sees the current setting.
  - Race bots take 60–100 s per layer on easy, 30–65 s on normal, and 18–35 s on hard.
  - Duel bots type at 16–26 WPM on easy, 28–48 on normal, and 48–66 on hard. Their typo rate drops from 20% to 5%.
  - Hack & Defend bots attack, kill breaches, and patch more often as the level rises. Hard bots go after whoever is winning.
- Practice starts on **easy** so new players aren't crushed. Regular rooms default to normal.
- Practice no longer lets you pick Co-op Heist, which needs other humans. Its card says "create a room to play". The header now reads "PRACTICE" instead of "ROOM PRACTICE".
- All tuning numbers live in one new file, `src/bots.js`, which is also cached for offline play.
- **Verified:** a unit test checks that every mode gets harder with each level. End-to-end checks cover Practice starting on easy, the host switching to hard, and Heist being disabled. 33/33 pass, and I reviewed the lobby screenshot.

### 3. Race puzzle variety
- **Where the password hides (3 options):** the auth logs (as before), a service config file in `/etc/<service>/` with a `.bak` backup holding the old password, or IT emails in `/var/mail/<account>` where the newest email has the current password. Each spot has an older "trap" password nearby, so players still have to compare dates. The mission brief and `hint` point to the right place for each.
- **Two new ciphers:** `hex` and `atbash` (the mirror alphabet), on top of caesar, base64, and reverse. Each has its own note explaining it. `decrypt` also accepts `rot`, `b64`, `rev`, and `mirror` as shortcuts, and gives a clear error when a file isn't valid for the chosen method.
- That makes 15 possible combinations for the first two layers, so repeat games feel different.
- **Verified:** the unit tests now check that, for 300 seeds, the current and old passwords are where the hint says, with the newer one dated later. They also check that every hiding place and cipher appears, and that no wrong method ever reveals the fragment by accident. Cipher round-trip tests now cover hex and atbash. The end-to-end race now finds the password with `grep <password> /`, so it works for any hiding place, and this run happened to solve a hex vault in the browser. 12/12 unit tests and 33/33 end-to-end checks pass.

### 4. Heist puzzle variety
- **Door:** rule 2 of each keypad model is now one of four checks: the serial ends in an even digit, ends in an odd digit, contains a vowel, or two or more lights are on. Up to 3 lights can be lit, and the manual now says "Use the FIRST rule that matches" to avoid arguments.
- **Login:** 5 password formats instead of 3, adding "department + year of birth" and "pet's name + favorite color".
- **Vault:** the dial number comes from one of three counts: guards on the NIGHT shift, guards on the DAY shift, or OFFLINE cameras in the new `security/cameras.txt`. The files that aren't the clue are always there too, so the Analyst has to read the procedure carefully.
- **Verified:** the heist unit test now re-solves every puzzle for 300 seeds by reading the Analyst's files the way a player would: parsing the manual text, the staff record, and whichever count the procedure names. A new test checks that every variant actually comes up. This also caught a bug in my first draft, where the number of offline cameras could differ from the dial, and I fixed it before committing. 13/13 unit tests and 33/33 end-to-end checks pass, including a full heist in the browser.

### 5. Onboarding: tutorial and step-by-step hints
- **Tutorial:** a new button on the main menu with a **START HERE** badge for first-timers. It runs a 10-step guided lesson in the terminal: `help`, `ls`, `cat` with Tab completion, `cd`, `cd ..`, `grep`, using a found code, bringing back a command with ↑, and `say`. It advances automatically as each step is done, then marks itself complete so the badge disappears. Afterwards you land in a Practice lobby ready for a race. It doesn't appear in the lobby's mode list.
- **Race hints that get more specific:** each layer now has 3 hints, from a nudge, to the method, to almost the answer, such as the exact command or the PIN's first and last digits. The first hint is free, the second costs 10 s, and the third costs 20 s (a cooldown bar), so hints help beginners without becoming a shortcut in competitive games.
- The How to Play dialog mentions both.
- **Verified:** unit tests check that the most specific hint really solves each layer for 100 seeds. That means the named file holds the password, the exact decrypt command reveals fragment A, the port and key are right, and the PIN digits match. Another unit test walks all 10 tutorial steps. New end-to-end checks cover the badge, completing the tutorial in the browser, the badge hiding afterwards, and hint 2 costing time. 15/15 unit tests and 36/36 end-to-end checks pass. I also fixed my own test edit, which had first landed in the wrong place.

### 6. Stats on the results screen
Each player on the Mission Report now has a stats line under their name:
- **Race:** fastest layer and its time, plus how many hints they used.
- **Duel:** typing speed (WPM), accuracy, and hits. Bots report stats too.
- **Hack & Defend:** data stolen, breaches started, and attacks stopped. Total data stays on the right.
- **Heist:** mistakes made and cameras looped, next to each player's role.
- Stats are saved with each player's progress while playing. Hack & Defend writes stats every time it saves a player's state, so a breach resolving can't wipe them.
- **Verified:** a new unit test checks the stats text for each mode, including the WPM and accuracy math. New end-to-end checks read the real results screen after a race (fastest layer, and "2 hints" for the player who asked twice), a duel (WPM and accuracy), and a heist (1 mistake for the Infiltrator, 1 camera looped for the Lookout). 16/16 unit tests and 39/39 end-to-end checks pass, and I reviewed the results screenshot. The huge WPM numbers in the test run come from the script typing instantly.

### 7. Keyboard and focus on Chromebooks
- **Esc** in the terminal jumps to the chat box. **Esc** in chat, or **Enter** on an empty chat box, jumps back. That makes Heist conversations quick without reaching for the touchpad.
- Real-terminal shortcuts: **Ctrl+L** clears the screen, **Ctrl+C** cancels the line you're typing (shown as `^C`, and copying still works when text is selected), **Ctrl+U** clears the line, and **PageUp/PageDown** scroll the terminal output.
- A small shortcut reminder sits under the terminal. It's hidden on narrow screens.
- The chat placeholder is now short enough to fit ("Message… (Esc: back)").
- **Verified:** new end-to-end checks press real keys through Chrome's input system during a practice duel. Esc moves focus to chat and back, Ctrl+C empties a half-typed line, and Ctrl+L clears the output. 42/42 end-to-end checks and 16/16 unit tests pass. The screenshot review is what caught the cut-off placeholder.

### 8. Accessibility settings
- A new **⚙** button in the top corner opens **Display settings**:
  - **Text size:** normal, large, or extra large. This scales the whole page, so nothing gets cut off.
  - **CRT scanlines:** on or off.
  - **High contrast:** brighter grey text and borders.
  - **Reduce motion:** no glow or animations.
- Settings are saved on the device and applied before anything draws. If the system asks for reduced motion, that and "no scanlines" are the defaults. Broken or old saved settings fall back to defaults.
- The header made room for the extra corner button. All settings code is in a new `src/settings.js`, which is cached for offline play.
- **Verified:** a unit test covers defaults, invalid saves, and the system reduced-motion preference. End-to-end checks open the dialog, turn off scanlines, pick extra-large text and high contrast, reload, and confirm all three stuck. They also check there's no sideways scrolling at extra-large text. 17/17 unit tests and 45/45 end-to-end checks pass, and I reviewed screenshots of the dialog, the extra-large menu, and the in-game header.

### 9. Host tools: kick players and pick round length
- **Kick:** in the lobby, the host now has ✕ next to every other player (bots already had it), with a confirmation. A kicked player goes back to the menu and sees "The host removed you from the room." Trying to rejoin with the code is refused. This is also enforced in `database.rules.json` for online rooms, so re-paste the rules when you set up Firebase.
- **Round length:** the lobby shows **Round: short / normal / long** with the actual time for the chosen mode, for example Hack & Defend 3:00 / 5:00 / 8:00, or Race 7:00 / 12:00 / 19:00. Times are rounded to whole half-minutes. Every mode's timer now follows this setting.
- Descriptions that said "5 minutes" for Hack & Defend now say "when time runs out".
- **Verified:** a unit test covers the round times for each mode. New end-to-end checks have a 4th player join, get kicked, get the message, and fail to rejoin, and a "short" Hack & Defend starting at 3:00. This also caught my own test bug: the new row reused the difficulty row's CSS class, which confused the bot-difficulty check. Both rows now share a generic `option-row` class, and the tests target the buttons by data attribute. 18/18 unit tests and 47/47 end-to-end checks pass, and I reviewed both lobby screenshots.

### 10. Sound polish (+ a color bug fix)
- **Settings → Sound:** a **volume** slider that plays a preview beep as you move it, and an optional **key click sounds while typing** toggle, off by default. Saved per device like the other settings. The dialog is now just called "Settings".
- **Countdown:** a beep on 3, 2, 1, then a higher "go" tone when the round starts.
- **Last 10 seconds:** a tick each second before any round's timer runs out.
- **Heist:** guard alerts now use a two-tone siren, and when the alarm passes 75% an alarm sound plays with a warning line. It re-arms once the alarm drops below 65%.
- A sound error can never break the game. Each sound is counted, which lets the tests confirm sounds really play.
- **Bug fix found in a screenshot:** in Practice, your color could match a bot's. Bots now always get different colors.
- **Verified:** unit tests cover the countdown math (exactly one beep per second shown, nothing before the last 10 s) and volume clamping. New end-to-end checks confirm 3 countdown beeps plus "go" at the start of a practice duel, key clicks only after turning them on in Settings, and that practice bots never share your color. 19/19 unit tests and 50/50 end-to-end checks pass.

### 11. Typing Duel power-ups
- After at least 4 normal commands, each new one has a 1-in-4 chance to be a yellow **★ BONUS** command. Typing it gives a power-up **instead of attacking**, so there's a choice to make:
  - **REPAIR:** +15 HP, up to 100.
  - **SHIELD:** for 8 s, incoming packets are blocked ("🛡 shield blocked X's packet"). Opponents see 🛡 next to your HP.
- Bonus commands are longer than normal ones and match their effect: repair commands read like patches and rebuilds, shield commands like shields and decoys.
- Bots sometimes repair when below 50 HP.
- **Verified:** a unit test checks there are no bonuses in the first 4 commands and about a 25% rate after that (measured over 4,000 draws), with both kinds appearing and all bonus commands unique. New end-to-end checks: Bob damages Alice, Alice types a forced REPAIR bonus and goes from 87 to the 100 HP cap, then types a SHIELD and Bob's next hit is blocked with her HP unchanged. A screenshot showed a REPAIR label over a shield-sounding command, so I split the commands by power-up before committing. 20/20 unit tests and 53/53 end-to-end checks pass.

### 12. Rejoining after a reload (+ a Duel balance fix)
- **Reload keeps your seat:** the tab remembers which room it's in. If you refresh, or Chrome reloads the tab, you go straight back to the same room as the same player with the same name and color, instead of landing on the menu.
  - Same-computer rooms no longer remove you the moment the page unloads. Other tabs remove you only if your heartbeat stays quiet for 8 s, so a quick refresh mid-game also resumes your progress.
  - Online rooms (Firebase) re-add you to the lobby after a reload. Mid-game you get a clear "couldn't get back in" message, because the game has moved on.
  - Leaving on purpose forgets the room, so a reload after leaving goes to the menu.
  - Same-computer rooms that nobody has touched for a minute, such as a closed Practice tab, are cleaned up automatically.
- **Duel balance fix, found by testing:** with last round's power-ups, two fast typists could chain 8-second shields plus repairs forever, so a duel never ended. The earlier run had passed by luck. A shield now **absorbs one hit within 8 s and then breaks**. A debug dump in the end-to-end test showed the stalemate.
- The README has a new "Other features" section covering everything added tonight.
- **Verified:** new end-to-end checks reload Bob's tab in the lobby (same player, same room, no duplicate) and confirm that a reload after leaving goes to the menu. With the shield fix, the full 3-player duel finishes in about 11 s. 20/20 unit tests, and 55/55 end-to-end checks passing on two runs in a row.

---

## Visual makeover: 3 styles to choose from
- **Settings → Style:** pick **Hacker green** (the default), **Neon cyberpunk**, or **Retro amber**. The choice previews live and is saved on the device. Each style changes the colors, fonts, glow, panel look, and rain color everywhere:
  - **Hacker green:** a glowing ROOT//ACCESS title, see-through blurred panels over the rain, and the JetBrains Mono font.
  - **Neon cyberpunk:** a pink-to-cyan gradient title, a synthwave grid horizon, multicolor rain, and the Orbitron and Share Tech Mono fonts.
  - **Retro amber:** a chunky pixel-font title (VT323, adjusted so it reads at normal sizes), a curved CRT glass edge with vignette and gentle flicker, and amber rain.
- **Polish in every style:**
  - **Menu:** icons on the buttons, a typing tagline, and a short "booting…" intro the first time the game opens on a device. Clicking or pressing a key skips it.
  - **Lobby:** mode cards with icons and their own accent colors, a lift on hover, and a clear "✔ SELECTED". Player cards slide in, with a color stripe and a pulse when someone readies up. Click the room code to copy it.
  - **In game:** a typed "secure link" boot sequence, countdown numbers that pop in, a red flash and shake when you're hit or breached (or make a Heist mistake), a glow when you clear a Race layer, and a rain burst when you get root or crack the vault.
  - **Results:** a podium (gold, silver, and bronze) with rows that slide in, and a gold rain burst when you win.
  - Smooth fade and slide transitions between screens.
- **Reduce motion** turns all of it off. Fonts are cached by the service worker, so every style works offline.
- **Bugs caught by testing:**
  - A broken line break inside a string stopped the whole game from starting. The usual `node --check` doesn't catch that kind of error in browser modules, so a new unit test now checks every file the strict way.
  - The amber ASCII logo was unreadable over the rain, so amber got a pixel-font title instead.
  - The results panel was too see-through during the rain burst, so it's now solid.
- **Verified:**
  - **Unit tests (24/24),** including a new **contrast check** that reads each style's colors from `style.css`. Every text color passes the WCAG AA readability standard, at least 4.5:1, against both the background and the panels.
  - **End-to-end checks (62/62):**
    - Each style is applied after a reload with its font loaded.
    - Fonts work offline.
    - The boot intro plays once.
    - Reduce motion stops animations and the rain.
  - I reviewed screenshots of the menu, lobby, and a game in all 3 styles, plus results and phone width.
