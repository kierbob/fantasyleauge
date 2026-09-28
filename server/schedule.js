'use strict';

/**
 * Round-robin (circle method) repeated until every team has `games` games.
 * Every round each team plays exactly once, so one round = one "game night".
 * Home/away flips each cycle so everybody ends up close to 41/41.
 */
function makeSchedule(teamIds, games, rng = Math.random) {
  const ids = [...teamIds];
  if (ids.length % 2) throw new Error('Need an even number of teams');
  // Shuffle so the commissioner's team isn't always first.
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const n = ids.length;
  const base = [];
  const arr = [...ids];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      // Alternate who hosts so a single cycle is already roughly balanced.
      pairs.push((r + i) % 2 === 0 ? [a, b] : [b, a]);
    }
    base.push(pairs);
    arr.splice(1, 0, arr.pop());
  }
  const rounds = [];
  for (let r = 0; r < games; r++) {
    const cycle = Math.floor(r / base.length);
    const pairs = base[r % base.length];
    rounds.push(pairs.map(([h, a]) => (cycle % 2 === 0 ? { home: h, away: a } : { home: a, away: h })));
  }
  return rounds;
}

module.exports = { makeSchedule };
