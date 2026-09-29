# 🏀 Blind Bid

A two-player, one-phone NBA blind draft auction (like the TikTok game).

**Play:** https://kierbob.github.io/fantasyleauge/

## How it works

1. Enter both names. Each of you gets **$20** (adjustable) to build a 5-man team: PG, SG, SF, PF, C.
2. A mystery player card pops up showing his position and **one hint**: a jersey number, a fact, a career
   average, or a career high.
3. One player is asked first (this alternates every card). Bid or pass, then the other player can top it or
   pass. The bidding goes back and forth until someone passes, and the highest bid wins. If you both pass, the
   player is skipped.
4. The winner picks which open spot he goes in. You always have to keep at least $1 for each empty spot.
5. When both teams are full, flip the cards to see who you actually got. The team with the higher score wins
   (career points + rebounds + assists per game, added up for all 5 players). You also see who nobody bid on.

The game saves in the browser, so a refresh doesn't lose it.

## Files

Everything is in `docs/` (plain HTML/CSS/JS, no build step):

- `players.js`: the 117 players and their hints (jersey numbers, career averages, career high, facts). Edit
  this to add or change players. Stats were hand-entered and are approximate for active players.
- `app.js`: the game logic
- `style.css`: the look

`index.html` in the root just forwards to `docs/`.

## GitHub Pages

Repo **Settings → Pages**: *Source* = **Deploy from a branch**, branch **main**, folder **`/docs`** (or `/`, which
redirects to `docs/`).
