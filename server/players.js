'use strict';
// Loads real NBA per-game stats (Basketball-Reference "Per Game" column layout)
// and derives the per-minute tendencies the game engine uses.
const fs = require('fs');
const path = require('path');

const DEFAULT_CSV = path.join(__dirname, '..', 'data', 'players.csv');

// Column aliases so a raw Basketball-Reference export can be dropped in as-is.
const COLS = {
  name: ['Player', 'Name'],
  team: ['Team', 'Tm'],
  pos: ['Pos'],
  age: ['Age'],
  g: ['G'],
  mp: ['MP'],
  fg: ['FG'],
  fga: ['FGA'],
  tp: ['3P'],
  tpa: ['3PA'],
  ft: ['FT'],
  fta: ['FTA'],
  orb: ['ORB'],
  drb: ['DRB'],
  trb: ['TRB'],
  ast: ['AST'],
  stl: ['STL'],
  blk: ['BLK'],
  tov: ['TOV'],
  pf: ['PF'],
  pts: ['PTS'],
  def: ['DEF'],
};

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function slug(name) {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function parsePlayersCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const header = parseCsvLine(lines[0]);
  const idx = {};
  for (const [key, names] of Object.entries(COLS)) {
    idx[key] = header.findIndex((h) => names.includes(h));
  }
  if (idx.name < 0 || idx.mp < 0 || idx.fga < 0) throw new Error('CSV needs at least Player, MP and FGA columns');
  const byId = new Map();
  for (const line of lines.slice(1)) {
    const row = parseCsvLine(line);
    const get = (k) => (idx[k] >= 0 ? row[idx[k]] : '');
    const num = (k, d = 0) => { const v = parseFloat(get(k)); return Number.isFinite(v) ? v : d; };
    const name = get('name').replace(/\*$/, '');
    if (!name || name === 'Player' || name === 'League Average') continue;
    const p = {
      id: slug(name),
      name,
      team: get('team') || 'FA',
      pos: (get('pos') || 'SF').toUpperCase(),
      age: num('age', 25),
      g: num('g', 1),
      mp: num('mp'),
      fg: num('fg'), fga: num('fga'),
      tp: num('tp'), tpa: num('tpa'),
      ft: num('ft'), fta: num('fta'),
      orb: num('orb'), drb: num('drb'),
      ast: num('ast'), stl: num('stl'), blk: num('blk'),
      tov: num('tov'), pf: num('pf'),
      def: idx.def >= 0 && get('def') !== '' ? num('def', 0) : 0,
    };
    if (idx.orb < 0 && idx.trb >= 0) { const t = num('trb'); p.orb = t * 0.25; p.drb = t * 0.75; }
    p.pts = idx.pts >= 0 && get('pts') !== '' ? num('pts') : 2 * p.fg + p.tp + p.ft;
    if (p.mp < 8 || p.g < 5) continue; // not enough of a sample to be a real rotation player
    // BBRef lists traded players once per team plus a "2TM" total row first — keep the first row.
    if (byId.has(p.id)) continue;
    byId.set(p.id, p);
  }
  return [...byId.values()];
}

function loadPlayers(file = process.env.PLAYERS_CSV || DEFAULT_CSV) {
  return parsePlayersCsv(fs.readFileSync(file, 'utf8'));
}

// Position -> number on a 1 (PG) .. 5 (C) scale. Hybrids ("SG-SF") average.
function posNum(pos) {
  const map = { PG: 1, G: 1.5, SG: 2, GF: 2.5, SF: 3, F: 3.5, PF: 4, FC: 4.5, C: 5 };
  const parts = pos.split(/[-/]/).map((s) => map[s] || 3);
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// Hollinger game score per game — used for value/draft ordering.
function gameScore(p) {
  return p.pts + 0.4 * p.fg - 0.7 * p.fga - 0.4 * (p.fta - p.ft) + 0.7 * p.orb + 0.3 * p.drb
    + p.stl + 0.7 * p.ast + 0.7 * p.blk - 0.4 * p.pf - p.tov;
}

/**
 * Per-minute tendencies. Everything the engine needs to reproduce a player's
 * real box score *shape* while the total volume is capped by the possessions
 * and minutes that actually exist in a 48-minute game.
 */
function deriveRatings(p) {
  const mp = Math.max(p.mp, 8);
  const g = Math.max(p.g, 1);
  const twoA = Math.max(p.fga - p.tpa, 0.05);
  const twoM = Math.max(p.fg - p.tp, 0);
  // Regress small samples toward league averages.
  const fg3 = clamp((p.tp * g + 0.35 * 60) / (p.tpa * g + 60), 0.2, 0.47);
  const fg2 = clamp((twoM * g + 0.53 * 50) / (twoA * g + 50), 0.38, 0.72);
  const ftPct = clamp((p.ft * g + 0.76 * 40) / (p.fta * g + 40), 0.4, 0.95);
  // Share of shot attempts that are threes (+ a hint of regression).
  const r3 = clamp((p.tpa + 0.1) / (p.fga + 0.3), 0, 0.85);

  // Shooting foul model. A "shot action" gets fouled with prob f; ~24% of those
  // are and-ones (FGA counted) and the rest go to the line for 2-3 FTs without an FGA.
  const ftr = p.fga > 0 ? (p.fta * 0.85) / p.fga : 0.2;
  const a = 0.24;
  const c = a + 2.1 * (1 - a);
  const foulDrawn = clamp(ftr / (c + ftr * (1 - a)), 0.01, 0.3);
  const shotActions = p.fga / ((1 - foulDrawn) + foulDrawn * a);

  const plays = shotActions + p.tov;
  const posn = posNum(p.pos);
  const perMin = (x) => x / mp;
  const stl = perMin(p.stl);
  const blk = perMin(p.blk);
  const drb = perMin(p.drb);
  // Defensive quality: reputation (1-5, optional) blended with steal/block/rebound activity.
  const activity = stl * 18 + blk * (posn >= 4 ? 10 : 16) + drb * (posn >= 4 ? 2 : 4);
  const rep = p.def > 0 ? (p.def - 3) * 0.9 : 0;
  const defense = activity + rep;
  // Stamina: minutes a player can go before he's really gassed.
  const stamina = clamp(8 + mp * 0.2, 9, 17);

  return {
    usage: perMin(plays),
    tovShare: clamp(p.tov / Math.max(plays, 0.1), 0.03, 0.3),
    r3, fg2, fg3, ftPct, foulDrawn,
    ast: perMin(p.ast) + 0.004,
    orb: perMin(p.orb) + 0.003,
    drb: drb + 0.01,
    stl: stl + 0.002,
    blk: blk + 0.001,
    pf: perMin(p.pf) + 0.01,
    defense,
    posn,
    stamina,
    mpg: p.mp,
  };
}

/**
 * Builds rating objects for the whole pool, plus league-relative values:
 * defPct (0..1 percentile of defense) and a draft/trade value + OVR.
 */
function buildPool(players) {
  const pool = new Map();
  for (const p of players) pool.set(p.id, { ...p, r: deriveRatings(p) });
  const all = [...pool.values()];
  const byDef = [...all].sort((x, y) => x.r.defense - y.r.defense);
  byDef.forEach((p, i) => { p.r.defPct = all.length > 1 ? i / (all.length - 1) : 0.5; });
  for (const p of all) {
    // Value = how good he is, not just how much he played:
    //  - game score per game, leaning toward per-36 production for real rotation minutes
    //  - efficient scoring, shot creation (points/assists per 36) and defense on top
    const gs = gameScore(p);
    const m36 = 36 / Math.max(p.mp, 8);
    const trust = clamp((p.mp - 14) / 16, 0, 1);
    const talent = gs + (gs * m36 - gs) * trust * 0.6;
    const ts = p.pts / (2 * (p.fga + 0.44 * p.fta) || 1);
    const efficiency = (ts - 0.575) * p.pts * 0.35;
    const defense = (p.r.defPct - 0.5) * 3 + (p.def ? (p.def - 3) * 0.9 : 0);
    const creation = (p.pts * m36 - 17) * 0.3 + (p.ast * m36 - 4) * 0.2;
    p.value = Math.max(0.5, talent + efficiency + defense + creation);
  }
  // OVR on a 2K-style curve by rank: MVPs ~97-98, All-NBA 93-95, All-Stars ~89-92,
  // good starters mid-80s, rotation players 70s.
  const anchors = [[1, 98], [3, 97], [6, 95], [12, 93], [25, 89], [50, 84], [100, 78], [150, 73], [250, 67], [450, 58]];
  const ovrAt = (rank) => {
    for (let i = 1; i < anchors.length; i++) {
      const [r0, o0] = anchors[i - 1];
      const [r1, o1] = anchors[i];
      if (rank <= r1) return o0 + ((o1 - o0) * (rank - r0)) / (r1 - r0);
    }
    return 55;
  };
  [...all].sort((x, y) => y.value - x.value).forEach((p, i) => { p.ovr = Math.round(ovrAt(i + 1)); });
  return pool;
}

module.exports = { loadPlayers, parsePlayersCsv, deriveRatings, buildPool, posNum, gameScore, slug, clamp };
