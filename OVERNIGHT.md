# Overnight improvements

Work happens on the `overnight` branch, one focused improvement per commit. Every change is checked with the unit tests and the 3-window end-to-end test before it's committed. To review: `git log main..overnight`. To keep everything: `git checkout main && git merge overnight`.

## Backlog (highest value first)

1. [x] **Players leaving mid-game:** the Heist infiltrator leaving shouldn't stall the crew, solo survivors should get a proper ending, and messages addressed to departed players should be cleaned up.
2. [x] **Bot difficulty** (easy / normal / hard) chosen in the lobby, so Practice suits beginners.
3. [ ] **Race puzzle variety:** more cipher types (hex, atbash) and more places the password can hide (bash history, config files).
4. [ ] **Heist puzzle variety:** more keypad rule types and different vault and login variants.
5. [ ] **Onboarding:** a guided first-run tutorial in Practice, and hints that become more specific the more you ask.
6. [ ] **Stats on the results screen:** duel speed (WPM) and accuracy, data stolen, and time per race layer.
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
