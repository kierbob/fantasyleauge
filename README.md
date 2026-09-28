# 🏀 Fantasy Hoops

Head-to-head fantasy basketball against your friends, using **real NBA players and their real stats**.
Draft a team, set your lineup and minutes, plan who guards whom, and make trades. Then every game day (every hour
by default) a full 48-minute game is simulated **possession by possession**, with fouls, free throws, the bonus,
foul-outs, fatigue, substitutions, overtime (2OT, 3OT…), hot nights and cold nights. It runs over an
82-game season, followed by playoffs.

**Play it now:** https://kierbob.github.io/fantasyleauge/ (the GitHub Pages version, see below)

No dependencies: just Node.js 18+.

```bash
npm start            # full online version (server) at http://localhost:3000
npm test             # engine + league + Pages build tests
npm run build:pages  # rebuild the GitHub Pages version into docs/
```

## Play on your phone (GitHub Pages)

The `docs/` folder is a fully static build of the game. The whole league, draft, game engine and every box
score run **inside the browser** and are saved on that device (IndexedDB). No server is needed.

- **Install it like an app (iPhone):** open the link in **Safari**, tap **Share → Add to Home Screen**. It
  launches fullscreen with its own icon and works offline. (Android/Chrome: menu → *Install app*.)
- **You vs. your friend on one device:** create the league, then tap **👥** (top right) to hand the phone over.
  Your friend joins with the invite code, and after that you both just tap 👥 and pick your name to switch. When
  it's the other person's draft pick, the draft room shows a "Hand the phone to…" button. Trade offers and
  results wait in each manager's 🔔 notifications.
- **Game days:** they're simulated on schedule while the app is open. If it was closed, every missed game day is
  played the moment you open it again, so the hourly schedule still holds.
- The league lives only on that device/browser. If you remove the home-screen app or clear Safari's website data,
  the league goes with it. The commissioner can erase it from the League page to start over.
- If each of you wants to play **from your own phone**, run the Node server version instead (see "Hosting the
  online version" below). Both versions share the exact same engine code.

### Turning on GitHub Pages (one time)

Repo **Settings → Pages → Build and deployment**: *Source* = **Deploy from a branch**, pick the branch that has
the `docs/` folder and the folder **`/docs`**, then Save. After a minute the game is live at
`https://<user>.github.io/<repo>/`. When you change the code, run `npm run build:pages` and commit `docs/`.

## How a league works

1. **Create the league.** Open the site. The first person to do so becomes the commissioner and picks the
   settings: number of teams, number of human managers, games per season, minutes between game days, pick clock,
   playoff format, trade deadline and injuries.
2. **Invite your friend.** Share the URL and the 6-character invite code. Your friend joins from the same page.
3. **Draft.** The commissioner starts a snake draft. Any open slots become CPU teams. You get a pick clock, and a
   CPU autopicks for you if it runs out. You can also switch on *Autodraft*.
4. **Play the season.** Every `tickMinutes` (60 by default) a full slate of games is simulated, so everyone plays
   once per game day. 82 game days at one per hour is about 3½ days of real time. The commissioner can pause the
   season or sim ahead.
5. **Playoffs.** The top 2, 4 or 8 teams play best-of-N series with 2-2-1-1-1 home court. Once there's a champion,
   the commissioner can start the next season with the same rosters, dynasty style.

### Managing your team
- **Lineup & rotation:** pick 5 starters and a target minutes number for everyone. Auto-manage is on by default and
  rebuilds your lineup around injuries every game day.
- **Coaching strategy:** pace (slow/normal/fast), shot focus (paint/balanced/threes), defensive pressure
  (conservative/normal/aggressive), and how to handle foul trouble.
- **Defensive game plan (per opponent):** choose which of your players guards which of theirs, and optionally
  double-team their star. That costs him touches and efficiency, but his teammates get more open looks.
- **Trades:** offer any players to any team. Humans get notified and accept or reject. CPU teams answer
  instantly and sometimes pitch offers to you. When a trade goes through, **every manager in the league is
  notified** (in-app, as a live toast and, if enabled, as a desktop alert).
- **Free agency:** add or drop undrafted players during the regular season (max 15 on a roster, min 8).
- **Notifications:** you get pinged for trade offers, completed trades, your final scores, foul-outs, injuries,
  the draft clock and playoff results.

## Why nobody scores 3,000 points (the sim)

The engine (`server/engine.js`) doesn't generate stat lines. It plays the game:

- **Real time budget.** Four 12-minute quarters, 5-minute overtimes and a 24-second shot clock give about 100
  possessions per team. There's only one ball, and five players on the floor share 240 minutes.
- **Real tendencies.** Each player's per-minute usage, 3-point rate, 2P%/3P%/FT%, free throw drawing, assists,
  rebounds, steals, blocks, turnovers and fouls come from real per-game stats (`server/players.js`). On a team of
  stars the ball gets *shared*, so everyone's volume drops like it does on a real super-team, while efficiency and
  style stay recognisable.
- **Matchups.** The assigned defender and the team's overall defence shift shooting percentages. Defenders pick
  up fouls, steals and blocks.
- **Fouls.** Shooting fouls (2 or 3 shots, and-ones), the team bonus (5th foul, 4th in OT, 2 in the last two
  minutes), offensive fouls, six fouls and you're out, and coaches sitting players in foul trouble.
- **Fatigue & rotations.** Energy drains on the floor and recovers on the bench. The coach AI subs at dead balls to
  hit your minutes targets, plays closers in crunch time and empties the bench in blowouts.
- **End of game.** Trailing teams foul intentionally, leading teams milk the clock, teams down 3 hunt threes,
  there are heaves at the buzzer, and ties go to overtime.
- **Randomness that looks real.** Each night a player can be hot (🔥), cold (🧊) or normal, which produces
  breakout games. Big leads shrink a little (the "rubber band").

Calibration against NBA norms (over thousands of simulated games): about 99 possessions per team, 35% from three,
79% from the line, around 19 fouls per team, a foul-out in about 7% of team-games, a margin SD of about 13 points
between equal teams, 10–12% of games decided by 3 or fewer, overtime in about 3–5% of games, and 50-point games at
roughly real-life frequency. Players' simulated minutes track their targets to within about a minute.

## Player data

`data/players.csv` holds about 200 real NBA rotation players with their **2024-25 per-game averages**. The values
are approximate, and teams reflect 2025 offseason moves; the optional `DEF` column is a 1–5 defensive reputation.
2025 rookies aren't included because they have no NBA stats yet.

To use newer or exact numbers, export the **Per Game** table from Basketball-Reference as CSV and run:

```bash
npm run import-stats -- ~/Downloads/per_game.csv
```

Players are matched by name, so an existing league keeps its rosters. Restart the server afterwards.

## Hosting the online version (each player on their own device)

The server is one Node process that keeps its state in `data/save/` (set `DATA_DIR` to move it, and `PORT` to
change the port). Options:

- **Same network:** run `npm start` and have your friend open `http://<your-computer's-LAN-IP>:3000`.
- **Quick tunnel from your machine:** `npx cloudflared tunnel --url http://localhost:3000` or
  `ngrok http 3000`, then share the URL it prints. Games only get simulated while the server is running. If it was
  off, missed game days are caught up (one per second) when it starts again.
- **Always-on hosting:** any Node host with a persistent disk, e.g. Render, Railway or Fly.io. Start command
  `npm start`, with `DATA_DIR` pointing at the mounted volume.

## Project layout

```
server/
  engine.js     possession-by-possession game simulator
  players.js    CSV loader + per-minute ratings, OVR/value
  league.js     accounts, draft, schedule, game days, stats, injuries, trades, FA, CPU GMs, playoffs, notifications
  schedule.js   balanced round-robin (every team plays every game day)
  store.js      JSON persistence (league.json + one file per game with box score & play-by-play)
  routes.js     API routes, shared by the server and the in-browser build
  index.js      zero-dependency HTTP API + Server-Sent Events + static files
public/         single-page app (vanilla JS/CSS), PWA manifest + icons
pages/local.js  in-browser runtime for GitHub Pages (answers /api calls locally, IndexedDB storage)
docs/           generated GitHub Pages build (npm run build:pages)
scripts/        stats importer, Pages build, icon generator
test/           node:test suites
```
