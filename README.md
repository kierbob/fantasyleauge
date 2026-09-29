# 🏀 Hoop Games

NBA party games for one phone.

**Play:** https://kierbob.github.io/fantasyleauge/

## Blind Bid

A two-player blind draft auction (like the TikTok game).

1. Enter both names. Each of you gets **$20** (adjustable) to build a 5-man team: PG, SG, SF, PF, C.
2. A mystery player card pops up showing his position and **one hint**: a jersey number, a fact, a career
   average, or a career high.
3. One player is asked first (this alternates every card). Bid or pass, then the other player can top it or
   pass. The bidding goes back and forth until someone passes, and the highest bid wins. If you both pass, the
   player is skipped.
4. The winner picks which open spot he goes in. You always have to keep at least $1 for each empty spot.
5. When both teams are full, flip the cards to see who you actually got. The team with the higher score wins
   (career points + rebounds + assists per game, added up for all 5 players). You also see who nobody bid on.

## Guess the Stat Line

You see a player's career points, rebounds and assists per game and pick who it is from 4 choices (two of the
wrong answers play the same position). Play solo for a high score, or with 2 players taking turns. Choose 5, 10
or 20 questions.

Both games save in the browser, so a refresh doesn't lose them.

## Files

Everything is in `docs/` (plain HTML/CSS/JS, no build step):

- `players.js`: the 117 players and their hints (jersey numbers, career averages, career high, facts). Edit
  this to add or change players. Stats were hand-entered and are approximate for active players.
- `index.html`: the game menu
- `blind-bid.html` / `blind-bid.js`: Blind Bid
- `statline.html` / `statline.js`: Guess the Stat Line
- `style.css`: the look, shared by every page

When you change a file, bump the `?v=` number on the script and stylesheet links in the HTML pages so browsers
don't keep an old cached copy.

`index.html` in the root just forwards to `docs/`.

## GitHub Pages

Repo **Settings → Pages**: *Source* = **Deploy from a branch**, branch **main**, folder **`/docs`** (or `/`, which
redirects to `docs/`).
