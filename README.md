# Root Access

A multiplayer hacking game that runs in the browser and installs as an app on Chromebooks. Players type commands into a pretend terminal to race, duel, defend, and pull off heists together.

**Every "hack" is fake.** Commands only work on a made-up filesystem and network inside the game.

## Game modes

| Mode | Players | What you do |
|---|---|---|
| **Terminal Race** | 1–8 (bots OK) | Everyone breaks into the same server through 5 layers: find a password in the logs, decrypt a file, crack a PIN, find the backdoor, then `sudo` with the key. First to root wins. |
| **Typing Duel** | 2–8 (bots OK) | Type the command shown exactly to hit your target's firewall. Streaks hit harder, and <kbd>Tab</kbd> switches target. Last firewall standing wins. |
| **Hack & Defend** | 2–6 (bots OK) | You own 3 servers. Use `scan`, `breach`, `trace`, `kill`, and `patch`, all of which cost CPU. Most data after 5 minutes wins. |
| **Co-op Heist** | 2–4 (humans) | Infiltrator, Analyst, and Lookout each see different clues and must talk in chat to get through the door, the login, and the vault before the alarm goes off. |

Type `help` in any mode to see its commands. <kbd>Tab</kbd> auto-completes, and <kbd>↑</kbd>/<kbd>↓</kbd> bring back earlier commands. In Race, type `hint` if you get stuck.

## Run it on your computer

```sh
cd my-game
python -m http.server 8000
```

Open <http://localhost:8000> in Chrome. Opening `index.html` directly from disk won't work, because the game uses JavaScript modules and a service worker.

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
| `src/net/` | Multiplayer. `firebase.js` handles online play, and `local.js` handles same-computer tabs and practice. |
| `src/rng.js` | Seeded random numbers, so every player gets the same puzzle |
| `firebase-config.js`, `database.rules.json` | Online setup |
| `sw.js`, `manifest.webmanifest`, `icons/` | Installable app and offline support |

Rooms are stored at `rooms/<CODE>` in the database. The host's browser runs the bots and decides when a round ends. If the host leaves, the next player takes over.
