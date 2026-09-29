# 🏀 Guess My Ten

Pick 10 NBA players, two at each position (PG, SG, SF, PF, C). Tap **+** on a slot, search any NBA player
(current or former), and tap one to add them. The other person has to guess who you picked. The rules of the
actual game are still to be decided.

**Play:** https://kierbob.github.io/fantasyleauge/

Your picks are saved in your browser, so a refresh doesn't lose them. **Clear** empties the board.

## Files

- `docs/`: the whole site (plain HTML/CSS/JS, no build step)
  - `players.js`: every NBA player (about 5,200) with their NBA.com ID, used for search and headshots
- `index.html`: forwards to `docs/` in case GitHub Pages serves the repo root
- `scripts/update-players.py`: refreshes `docs/players.js` from the
  [nba_api](https://github.com/swar/nba_api) player list (run it to pick up new rookies)

## GitHub Pages

Repo **Settings → Pages**: *Source* = **Deploy from a branch**, branch **main**, folder **`/docs`** (or `/`, which
redirects to `docs/`).
