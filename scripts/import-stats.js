#!/usr/bin/env node
'use strict';
/**
 * Replace the player pool with a fresh stats export.
 *
 *   npm run import-stats -- path/to/per_game.csv
 *
 * Works with Basketball-Reference's "Per Game" table (Share & Export → Get table as CSV).
 * Players are matched by name, so an existing league keeps its rosters; the optional
 * DEF (1-5 defensive reputation) column is carried over from the current file.
 */
const fs = require('fs');
const path = require('path');
const { parsePlayersCsv, buildPool } = require('../server/players');

const src = process.argv[2];
if (!src) {
  console.error('Usage: npm run import-stats -- <per_game.csv>');
  process.exit(1);
}
const dest = path.join(__dirname, '..', 'data', 'players.csv');
const incoming = parsePlayersCsv(fs.readFileSync(src, 'utf8'));
if (incoming.length < 100) {
  console.error(`Only ${incoming.length} usable players found (need 100+ with 8+ MPG and 5+ games). Check the file.`);
  process.exit(1);
}
const old = fs.existsSync(dest) ? parsePlayersCsv(fs.readFileSync(dest, 'utf8')) : [];
const oldDef = new Map(old.map((p) => [p.id, p.def]));

const cols = ['Player', 'Team', 'Pos', 'Age', 'G', 'MP', 'FG', 'FGA', '3P', '3PA', 'FT', 'FTA', 'ORB', 'DRB', 'AST', 'STL', 'BLK', 'TOV', 'PF', 'DEF'];
const q = (v) => (/[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
const lines = [cols.join(',')];
for (const p of incoming) {
  const def = p.def || oldDef.get(p.id) || '';
  lines.push([p.name, p.team, p.pos, p.age, p.g, p.mp, p.fg, p.fga, p.tp, p.tpa, p.ft, p.fta, p.orb, p.drb, p.ast, p.stl, p.blk, p.tov, p.pf, def].map(q).join(','));
}
fs.writeFileSync(dest, `${lines.join('\n')}\n`);

const pool = buildPool(incoming);
const top = [...pool.values()].sort((a, b) => b.value - a.value).slice(0, 10);
const gone = old.filter((p) => !incoming.some((x) => x.id === p.id)).map((p) => p.name);
console.log(`Imported ${incoming.length} players into data/players.csv`);
console.log('Top 10 by value:', top.map((p) => `${p.name} (${p.ovr})`).join(', '));
if (gone.length) console.log(`${gone.length} players from the old file are not in the new one (they stay on rosters but won't play): ${gone.slice(0, 15).join(', ')}${gone.length > 15 ? '…' : ''}`);
console.log('Restart the server to load the new stats.');
