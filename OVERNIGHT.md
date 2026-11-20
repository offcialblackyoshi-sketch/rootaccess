# Overnight improvements

Work happens on the `overnight` branch, one focused improvement per commit. Every change is checked with the unit tests and the 3-window end-to-end test before it's committed. To review: `git log main..overnight`. To keep everything: `git checkout main && git merge overnight`.

## Backlog (highest value first)

1. [x] **Players leaving mid-game:** the Heist infiltrator leaving shouldn't stall the crew, solo survivors should get a proper ending, and messages addressed to departed players should be cleaned up.
2. [x] **Bot difficulty** (easy / normal / hard) chosen in the lobby, so Practice suits beginners.
3. [x] **Race puzzle variety:** more cipher types (hex, atbash) and more places the password can hide (bash history, config files).
4. [x] **Heist puzzle variety:** more keypad rule types and different vault and login variants.
5. [x] **Onboarding:** a guided first-run tutorial in Practice, and hints that become more specific the more you ask.
6. [x] **Stats on the results screen:** duel speed (WPM) and accuracy, data stolen, and time per race layer.
7. [ ] **Keyboard and focus on Chromebooks:** Esc switches between terminal and chat, the cursor goes back to the terminal after chatting, and Ctrl+L clears the screen.
8. [ ] **Accessibility settings:** turn off scanlines, larger text, and reduced motion, all saved per device.
9. [ ] **Host tools:** kick a player, and choose the round length in the lobby.
10. [ ] **Sound polish:** optional key-click sounds, a countdown beep, and distinct alert sounds per mode.
11. [ ] **Duel power-ups:** occasional "bonus" snippets that repair your firewall or shield you.
12. [ ] **Rejoining after a reload:** you keep your seat if you refresh during the lobby.

## Done

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
