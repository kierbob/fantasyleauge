'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadPlayers, buildPool } = require('../server/players');
const { simulateGame, mulberry32 } = require('../server/engine');

const pool = buildPool(loadPlayers());
const ranked = [...pool.values()].sort((a, b) => b.value - a.value);

function teams(n = 8) {
  const out = Array.from({ length: n }, (_, i) => ({ id: `t${i}`, name: `Team ${i}`, players: [] }));
  let k = 0;
  for (let r = 0; r < 13; r++) for (const t of r % 2 ? [...out].reverse() : out) t.players.push(ranked[k++]);
  const slots = [34, 33, 32, 31, 30, 24, 20, 17, 13, 6, 0, 0, 0];
  for (const t of out) t.lineup = { starters: t.players.slice(0, 5).map((p) => p.id), minutes: Object.fromEntries(t.players.map((p, i) => [p.id, slots[i]])) };
  return out;
}

test('box scores are internally consistent', () => {
  const T = teams();
  const rng = mulberry32(99);
  let ot = 0;
  for (let g = 0; g < 150; g++) {
    const res = simulateGame({ home: T[g % 8], away: T[(g + 3) % 8], rng });
    if (res.ot) ot++;
    const periodSecs = (4 * 720 + res.ot * 300) * 5;
    for (const side of [res.home, res.away]) {
      const pts = side.players.reduce((a, p) => a + p.pts, 0);
      assert.strictEqual(pts, side.score, 'player points sum to team score');
      assert.strictEqual(side.periods.reduce((a, b) => a + b, 0), side.score, 'periods sum to score');
      const secs = side.players.reduce((a, p) => a + p.sec, 0);
      assert.ok(Math.abs(secs - periodSecs) <= 5, `minutes add up: ${secs} vs ${periodSecs}`);
      for (const p of side.players) {
        assert.strictEqual(p.pts, 2 * p.fgm + p.tpm + p.ftm, 'points formula');
        assert.ok(p.fgm <= p.fga && p.tpm <= p.tpa && p.ftm <= p.fta && p.tpa <= p.fga);
        assert.ok(p.pf <= 6, 'max six fouls');
        if (p.fouledOut) assert.strictEqual(p.pf, 6);
        assert.ok(p.sec <= (48 + res.ot * 5) * 60);
      }
    }
    assert.notStrictEqual(res.home.score, res.away.score, 'no ties');
  }
  assert.ok(ot >= 1, 'overtime happens');
});

test('league-wide numbers look like the NBA', () => {
  const T = teams();
  const rng = mulberry32(7);
  const tot = { pts: 0, fga: 0, fgm: 0, tpa: 0, fta: 0, tov: 0, orb: 0, n: 0 };
  let best = 0;
  for (let g = 0; g < 200; g++) {
    const res = simulateGame({ home: T[g % 8], away: T[(g + 1) % 8], rng });
    for (const side of [res.home, res.away]) {
      for (const k of ['pts', 'fga', 'fgm', 'tpa', 'fta', 'tov', 'orb']) tot[k] += side.totals[k];
      tot.n++;
      for (const p of side.players) best = Math.max(best, p.pts);
    }
  }
  const per = (k) => tot[k] / tot.n;
  const poss = per('fga') + 0.44 * per('fta') + per('tov') - per('orb');
  assert.ok(per('pts') > 100 && per('pts') < 125, `points ${per('pts')}`);
  assert.ok(poss > 93 && poss < 105, `possessions ${poss}`);
  assert.ok(per('tpa') > 25 && per('tpa') < 45, `3PA ${per('tpa')}`);
  assert.ok(best < 85, `single game high ${best}`);
});

test('a double team slows down the star', () => {
  const T = teams();
  const star = T[0].players[0];
  let normal = 0;
  let doubled = 0;
  for (let i = 0; i < 120; i++) {
    const a = simulateGame({ home: T[0], away: T[1], rng: mulberry32(1000 + i) });
    const b = simulateGame({ home: T[0], away: { ...T[1], matchups: { doubleTeam: star.id } }, rng: mulberry32(1000 + i) });
    normal += a.home.players.find((p) => p.id === star.id).pts;
    doubled += b.home.players.find((p) => p.id === star.id).pts;
  }
  assert.ok(doubled < normal, `doubled ${doubled} vs normal ${normal}`);
});
