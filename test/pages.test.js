'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');

test('GitHub Pages build bundles a working league into the browser', () => {
  execFileSync(process.execPath, [path.join(root, 'scripts', 'build-pages.js')], { stdio: 'pipe' });
  const docs = path.join(root, 'docs');
  for (const f of ['index.html', 'core.js', 'local.js', 'app.js', 'sw.js', 'manifest.webmanifest', 'icons/apple-touch-icon.png']) {
    assert.ok(fs.existsSync(path.join(docs, f)), `${f} built`);
  }
  const html = fs.readFileSync(path.join(docs, 'index.html'), 'utf8');
  assert.ok(!/(src|href)="\//.test(html), 'only relative URLs (Pages serves from /<repo>/)');
  assert.ok(html.indexOf('core.js') < html.indexOf('local.js') && html.indexOf('local.js') < html.indexOf('app.js'));

  // Evaluate the bundle with no Node globals, like a browser would.
  const sandbox = { window: {}, Math, Date, JSON, console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(docs, 'core.js'), 'utf8'), sandbox);
  const { FHCore } = sandbox;
  const pool = FHCore.players.buildPool(FHCore.players.parsePlayersCsv(sandbox.FH_PLAYERS_CSV));
  assert.ok(pool.size > 150);
  let n = 0;
  const secure = { randomHex: (b) => String(++n).padStart(b * 2, '0'), hash: (pw, salt) => `${salt}${pw}`, equal: (a, b) => a === b };
  const league = new FHCore.league.League({ store: null, pool, secure });
  const s = league.setup({ leagueName: 'Phone League', teamName: 'Home Team', ownerName: 'Alice', password: 'pass', settings: { numTeams: 2, humanSlots: 1, seasonGames: 2, pickSeconds: 0 } });
  assert.ok(league.checkPassword('pass', league.team(s.teamId).pass));
  league.startDraft(league.team(s.teamId));
  let guard = 0;
  while (league.s.phase === 'draft' && guard++ < 100) {
    const cur = league.team(league.pickerAt(league.s.draft.pickNo));
    league.doPick(cur, league.bestAvailableFor(cur), true);
  }
  league.simNow(league.team(s.teamId), 1);
  assert.strictEqual(league.s.round, 1);
});
