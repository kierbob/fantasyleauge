'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadPlayers, buildPool } = require('../server/players');
const { League } = require('../server/league');
const { mulberry32 } = require('../server/engine');
const { makeSchedule } = require('../server/schedule');

const pool = buildPool(loadPlayers());

function makeLeague(settings = {}) {
  let clock = Date.UTC(2026, 9, 1, 12, 0, 0);
  const league = new League({ store: null, pool, now: () => clock, rng: mulberry32(1234) });
  const advance = (ms) => { clock += ms; };
  const owner = league.setup({ leagueName: 'Test League', teamName: 'Home Team', ownerName: 'Alice', password: 'secret', settings: { numTeams: 4, humanSlots: 2, seasonGames: 12, tradeDeadline: 0, ...settings } });
  const friend = league.join({ inviteCode: league.s.inviteCode, teamName: 'Road Warriors', ownerName: 'Bob', password: 'hunter2' });
  const alice = league.team(owner.teamId);
  const bob = league.team(friend.teamId);
  return { league, alice, bob, advance, now: () => clock };
}

function runDraft(ctx) {
  const { league, alice } = ctx;
  league.startDraft(alice);
  let guard = 0;
  while (league.s.phase === 'draft' && guard++ < 1000) {
    ctx.advance(200 * 1000);
    league.tick();
  }
  assert.strictEqual(league.s.phase, 'season');
}

test('schedule gives every team the same number of games, balanced home/away', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const rounds = makeSchedule(ids, 82, mulberry32(9));
  assert.strictEqual(rounds.length, 82);
  const games = Object.fromEntries(ids.map((i) => [i, { g: 0, h: 0 }]));
  for (const r of rounds) {
    const seen = new Set();
    for (const g of r) {
      assert.ok(!seen.has(g.home) && !seen.has(g.away), 'no team twice in a round');
      seen.add(g.home); seen.add(g.away);
      games[g.home].g++; games[g.home].h++; games[g.away].g++;
    }
  }
  for (const id of ids) {
    assert.strictEqual(games[id].g, 82);
    assert.ok(Math.abs(games[id].h - 41) <= 4, `home games ${games[id].h}`);
  }
});

test('setup, join and login', () => {
  const { league, alice, bob } = makeLeague();
  assert.strictEqual(league.s.teams.length, 4);
  assert.strictEqual(alice.kind, 'human');
  assert.strictEqual(bob.kind, 'human');
  assert.throws(() => league.join({ inviteCode: league.s.inviteCode, teamName: 'X', ownerName: 'Y', password: 'pass' }), /full/);
  assert.throws(() => league.login({ name: 'alice', password: 'nope' }), /Wrong/);
  const s = league.login({ name: 'Alice', password: 'secret' });
  assert.strictEqual(league.sessionTeam(s.token).id, alice.id);
});

test('snake draft fills every roster and auto-picks for idle humans', () => {
  const ctx = makeLeague();
  runDraft(ctx);
  const { league } = ctx;
  for (const t of league.s.teams) {
    assert.strictEqual(t.roster.length, league.s.settings.rosterSize);
    assert.strictEqual(t.lineup.starters.length, 5);
  }
  const owned = Object.values(league.s.players).filter((p) => p.owner).length;
  assert.strictEqual(owned, 4 * league.s.settings.rosterSize);
  // Snake: team picking last in round 1 picks first in round 2.
  const d = league.s.draft;
  assert.strictEqual(d.picks[3].teamId, d.picks[4].teamId);
  assert.ok(league.s.nextTickAt > ctx.now());
});

test('manual draft pick validation', () => {
  const ctx = makeLeague();
  const { league, alice, bob } = ctx;
  league.startDraft(alice);
  const current = league.team(league.pickerAt(0));
  const other = current.id === alice.id ? bob : alice;
  if (current.kind === 'human') {
    const pid = [...pool.keys()][0];
    assert.throws(() => league.draftPick(other, pid), /not your pick/);
    league.draftPick(current, pid);
    assert.strictEqual(league.s.players[pid].owner, current.id);
  }
});

test('hourly ticks play the season, then playoffs crown a champion', () => {
  const ctx = makeLeague();
  runDraft(ctx);
  const { league } = ctx;
  let guard = 0;
  while (league.s.phase !== 'complete' && guard++ < 200) {
    ctx.advance(league.tickMs());
    league.tick();
  }
  assert.strictEqual(league.s.phase, 'complete');
  assert.ok(league.s.champion);
  for (const t of league.s.teams) assert.strictEqual(t.rec.w + t.rec.l, 12);
  // Stats accumulated and stay realistic.
  const lines = Object.values(league.s.players).filter((P) => P.st.gp > 0);
  assert.ok(lines.length > 30);
  for (const P of lines) {
    assert.ok(P.st.pts / P.st.gp < 45, 'no one averages 45+');
    assert.ok(P.st.sec / P.st.gp / 60 <= 48, 'minutes cap');
  }
  const alice = league.team(league.s.commissioner);
  assert.ok(league.notificationsView(alice).some((n) => n.type === 'game'));
});

test('trades between humans notify the whole league', () => {
  const ctx = makeLeague();
  runDraft(ctx);
  const { league, alice, bob } = ctx;
  const give = [alice.roster[0]];
  const get = [bob.roster[0]];
  const tr = league.proposeTrade(alice, { to: bob.id, give, get, message: 'swap?' });
  assert.ok(league.notificationsView(bob).some((n) => n.type === 'trade' && /offer/i.test(n.text)));
  assert.throws(() => league.respondTrade(alice, tr.id, 'accept'), /not addressed/);
  league.respondTrade(bob, tr.id, 'accept');
  assert.ok(alice.roster.includes(get[0]));
  assert.ok(bob.roster.includes(give[0]));
  assert.strictEqual(league.s.players[get[0]].owner, alice.id);
  for (const t of [alice, bob]) {
    assert.ok(league.notificationsView(t).some((n) => /TRADE COMPLETED/.test(n.text)), `${t.name} notified`);
  }
  assert.ok(league.s.news.some((n) => n.type === 'trade'));
});

test('CPU rejects lopsided trades and accepts good ones', () => {
  const ctx = makeLeague();
  runDraft(ctx);
  const { league, alice } = ctx;
  const cpu = league.s.teams.find((t) => t.kind === 'cpu');
  const byVal = (ids) => [...ids].sort((a, b) => league.tradeValue(b) - league.tradeValue(a));
  const theirBest = byVal(cpu.roster)[0];
  const myWorst = byVal(alice.roster).slice(-1)[0];
  const bad = league.proposeTrade(alice, { to: cpu.id, give: [myWorst], get: [theirBest] });
  assert.strictEqual(bad.status, 'rejected');
  const myBest = byVal(alice.roster)[0];
  const theirWorst = byVal(cpu.roster).slice(-1)[0];
  const good = league.proposeTrade(alice, { to: cpu.id, give: [myBest], get: [theirWorst] });
  assert.strictEqual(good.status, 'accepted');
});

test('free agency add/drop respects roster limits', () => {
  const ctx = makeLeague({ rosterSize: 13, maxRoster: 14 });
  runDraft(ctx);
  const { league, alice } = ctx;
  const fas = [...pool.values()].filter((p) => !league.s.players[p.id].owner);
  league.addFreeAgent(alice, fas[0].id);
  assert.strictEqual(alice.roster.length, 14);
  assert.throws(() => league.addFreeAgent(alice, fas[1].id), /full/);
  league.addFreeAgent(alice, fas[1].id, fas[0].id);
  assert.ok(alice.roster.includes(fas[1].id) && !alice.roster.includes(fas[0].id));
  assert.strictEqual(league.s.players[fas[0].id].owner, null);
});

test('manual lineups and matchups are validated', () => {
  const ctx = makeLeague();
  runDraft(ctx);
  const { league, alice, bob } = ctx;
  assert.throws(() => league.setLineup(alice, { starters: alice.roster.slice(0, 4) }), /exactly 5/);
  const L = league.setLineup(alice, { starters: alice.roster.slice(0, 5), minutes: { [alice.roster[0]]: 40 }, strategy: { pace: 'fast' } });
  assert.strictEqual(L.auto, false);
  assert.strictEqual(alice.strategy.pace, 'fast');
  const plan = league.setMatchups(alice, bob.id, { assign: { [alice.roster[0]]: bob.roster[0] }, doubleTeam: bob.roster[1] });
  assert.strictEqual(plan.doubleTeam, bob.roster[1]);
  assert.throws(() => league.setMatchups(alice, bob.id, { assign: { [bob.roster[0]]: bob.roster[1] } }), /not on your roster/);
});
