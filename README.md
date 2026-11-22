# Root Access

A multiplayer hacking game that runs in the browser and installs as an app on Chromebooks. Players type commands into a pretend terminal to race, duel, defend, and pull off heists together.

**Every "hack" is fake.** Commands only work on a made-up filesystem and network inside the game.

## Game modes

| Mode | Players | What you do |
|---|---|---|
| **Terminal Race** | 1–8 (bots OK) | Everyone breaks into the same server through 5 layers: find a password in the logs, decrypt a file, crack a PIN, find the backdoor, then `sudo` with the key. First to root wins. |
| **Typing Duel** | 2–8 (bots OK) | Type the command shown exactly to hit your target's firewall. Streaks hit harder, and <kbd>Tab</kbd> switches target. Last firewall standing wins. Play free-for-all or in **teams: 1v1, 2v2, 3v3 or 4v4**. |
| **Hack & Defend** | 2–6 (bots OK) | You own 3 servers. Use `scan`, `breach`, `trace`, `kill`, and `patch`, all of which cost CPU. Most data when time runs out wins. |
| **Co-op Heist** | 2–4 (humans) | Infiltrator, Analyst, and Lookout each see different clues and must talk in chat to get through the door, the login, and the vault before the alarm goes off. |

### Quick Hacks (easy, no typing)

Eight short visual mini-games for beginners, plus a Gauntlet that mixes them. Each is its own mode (1–8 players, bots OK). You play with the arrow keys, <kbd>Space</kbd>/<kbd>Enter</kbd>, or the mouse. Each has 5 stages that get harder, and everyone gets the same puzzles. A mistake locks you out for 3 seconds, and nobody is knocked out. The first player to clear all 5 stages wins.

| Mode | What you do |
|---|---|
| **Letter Lock** | Press Space or Enter when the glowing column shows the next password letter in its middle row. |
| **Print Match** | Pick the parts that appear in the target print out of a grid of look-alikes. |
| **Signal Tune** | Turn the frequency, height, and shift knobs until your wave sits on the target. |
| **Circuit Path** | Steer a signal through a maze to the exit without bumping the walls. |
| **Code Memory** | Watch cells flash, then repeat the sequence in order. |
| **Wire Cut** | Use the first rule on the card that is true, and cut those wires in order. |
| **Port Sweep** | Close each port while it is lit up. Hitting a dark one is a mistake. |
| **Bit Flip** | Flip switches until their values add up to the target number. |
| **Hack Gauntlet** | A different mini-game every stage, back to back. |

Type `help` in any mode to see its commands. <kbd>Tab</kbd> auto-completes, and <kbd>↑</kbd>/<kbd>↓</kbd> bring back earlier commands. In Race, type `hint` if you get stuck.

## Other features

- **Tutorial:** a 2-minute guided lesson from the main menu, recommended for first-timers.
- **Practice vs bots:** works offline. Bots can be set to easy, normal, or hard in the lobby.
- **Host tools:** pick the round length (short, normal, or long), add or remove bots, and kick players.
- **Settings (⚙):** text size, high contrast, reduced motion, scanlines on/off, volume, and key-click sounds.
- **Keyboard:** <kbd>Esc</kbd> switches between the terminal and chat, <kbd>Ctrl</kbd>+<kbd>L</kbd> clears, <kbd>Ctrl</kbd>+<kbd>C</kbd> cancels a line, and <kbd>PageUp</kbd>/<kbd>PageDown</kbd> scroll.
- **XP and levels:** every round earns XP (more for placing higher and winning). Levels unlock titles shown next to your name, and extra name colors at levels 3, 6, 9 and 12. Saved on this device.
- **Reloading the page** while in a room puts you back in your seat.
- **Results** show stats for each player: race layer times and hints used, duel speed (WPM) and accuracy, data stolen, and heist mistakes.

## Run it on your computer

**On Windows:** double-click **`Play Root Access.bat`**. It starts a small local web server and opens the game in your browser. Keep its window open while you play, and close it to stop.

**Anywhere else:**

```sh
cd my-game
python -m http.server 8000
```

Then open <http://localhost:8000> in Chrome.

> **Don't double-click `index.html`.** Chrome blocks the game's code when a page is opened straight from disk, so none of the buttons work. The page shows a warning if you do this. On GitHub Pages, and anywhere else served over the web, this isn't an issue.

Before online play is set up, you can still play:

- **Practice vs bots**, which also works offline.
- **Multiplayer between tabs on the same computer.** Create a room in one tab, then join it from another tab using the code.

## Set up online play (one time, about 10 minutes)

Online rooms use Firebase, which is free for this game's size and allows up to 100 players connected at once.

1. Go to <https://console.firebase.google.com> and click **Create a project**. Analytics can be turned off.
2. In the project, click the **Web** icon (`</>`) to add a web app. Any nickname works, and you don't need Firebase Hosting. Firebase then shows a `firebaseConfig = { ... }` block.
3. Open `firebase-config.js` in this folder and replace `null` with that block. It should look like the example in the file's comments.
   - This config is **not a secret**, so it is safe to commit to GitHub. The database rules are what protect your data.
4. In Firebase, go to **Build → Authentication → Get started → Sign-in method**, then enable **Anonymous**.
5. Go to **Build → Realtime Database → Create database**, pick a location, and start in **locked mode**.
6. In the database, open the **Rules** tab, paste the contents of `database.rules.json`, and click **Publish**.
7. Reload the game. The menu should now say **● ONLINE**.

> Some school networks block Firebase (`*.firebaseio.com`). If the menu says it can't connect on a school network, that is the likely reason.

## Put it on the web (GitHub Pages)

1. Create a new **public** repository on <https://github.com/new>, for example `my-game`. Don't add a README.
2. Push this folder to it:
   ```sh
   git remote add origin https://github.com/<your-username>/my-game.git
   git push -u origin main
   ```
3. On GitHub, go to **Settings → Pages** and choose **Deploy from a branch**, then **main** and **/ (root)**, and click Save.
4. After a minute or two, the game is live at `https://<your-username>.github.io/my-game/`.

Share that link to invite people. The **Copy invite link** button in the lobby gives a link that fills in the room code for them.

## Install on a Chromebook

Open the game's link in Chrome, then click **Install** in the top-right corner or the install icon in the address bar. Root Access then appears in the launcher and opens in its own window. Practice mode works offline. Online rooms need internet.

## Updating the game

Edit the files, then commit and push. Players get the new version the next time they open the game while online.

If you **add a new file**, also add it to the `ASSETS` list in `sw.js` so it works offline.

## Tests

```sh
node --test tests/unit.test.mjs      # puzzle generation, ciphers, shell commands
python -m http.server 8765           # in another terminal, then:
node tests/e2e.mjs                   # plays every mode with 3 browser windows (needs Chrome)
```

## How it's built

There is no build step. It is plain HTML, CSS, and JavaScript modules.

| File | What it does |
|---|---|
| `index.html`, `style.css` | Screens and the terminal look |
| `src/main.js` | Menu, joining rooms, switching screens, results |
| `src/lobby.js` | Lobby: players, ready, picking a mode, bots |
| `src/game.js` | Runs a round and gives each mode its terminal, timer, and network helpers |
| `src/terminal.js`, `src/commands.js` | The terminal widget, shell, and fake filesystem |
| `src/modes/*.js` | One file per game mode |
| `src/modes/quickhack.js`, `src/modes/minigames/` | The Quick Hack mini-games: one shared mode runner, one file per mini-game |
| `src/net/` | Multiplayer. `firebase.js` handles online play, and `local.js` handles same-computer tabs and practice. |
| `src/rng.js` | Seeded random numbers, so every player gets the same puzzle |
| `firebase-config.js`, `database.rules.json` | Online setup |
| `sw.js`, `manifest.webmanifest`, `icons/` | Installable app and offline support |

Rooms are stored at `rooms/<CODE>` in the database. The host's browser runs the bots and decides when a round ends. If the host leaves, the next player takes over.
