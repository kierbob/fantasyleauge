'use strict';
/**
 * Possession-by-possession basketball simulator.
 *
 * Realism comes from the structure, not from caps: there are ~100 possessions
 * per team in 48 minutes, only one ball, 5 players on the floor and 240 player
 * minutes. Each player's real per-minute tendencies decide *how* those
 * possessions get split, so a lineup of five 25-ppg scorers shares the ball the
 * way real All-Star teams do instead of everyone scoring 25.
 */

const REG_PERIOD = 720;
const OT_PERIOD = 300;
const REG_SECONDS = REG_PERIOD * 4;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

const PACE = { slow: 1.08, normal: 1.0, fast: 0.91 };
const THREES = { inside: 0.8, balanced: 1.0, perimeter: 1.2 };
const DEF_AGGR = { conservative: 0.85, normal: 1.0, aggressive: 1.15 };

// League-typical on-court sums, used to normalise team-level effects.
const AVG = { stl5: 0.175, blk5: 0.115, ast4: 0.45, pf5: 0.49 };

function emptyStats() {
  return { sec: 0, pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, orb: 0, drb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, pm: 0 };
}

function lastName(name) {
  const parts = name.split(' ');
  if (parts.length > 2 && /^(Jr\.|Sr\.|II|III|IV)$/.test(parts[parts.length - 1])) return parts[parts.length - 2];
  return parts.length > 1 ? parts.slice(1).join(' ') : name;
}

class Game {
  constructor(opts) {
    this.rng = opts.rng || (opts.seed != null ? mulberry32(opts.seed) : Math.random);
    this.pbp = [];
    this.period = 0;
    this.clock = REG_PERIOD;
    this.elapsed = 0;
    this.quarters = [];
    this.T = [this.makeTeam(opts.home, 0), this.makeTeam(opts.away, 1)];
    this.T[0].opp = this.T[1];
    this.T[1].opp = this.T[0];
    this.poss = 0;
    this.deadBall = true;
    this.offRebound = false;
    this.transition = false;
    this.shortClock = false;
  }

  // ---------- setup ----------
  normal(mean = 0, sd = 1) {
    let u = 0, v = 0;
    while (u === 0) u = this.rng();
    while (v === 0) v = this.rng();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  uniform(a, b) { return a + (b - a) * this.rng(); }
  pick(items, w) {
    let total = 0;
    const ws = items.map((it) => { const x = Math.max(0, w(it)); total += x; return x; });
    if (total <= 0) return items[Math.floor(this.rng() * items.length)];
    let r = this.rng() * total;
    for (let i = 0; i < items.length; i++) { r -= ws[i]; if (r <= 0) return items[i]; }
    return items[items.length - 1];
  }

  makeTeam(input, idx) {
    const strat = { pace: 'normal', offense: 'balanced', defense: 'normal', foulTrouble: 'normal', ...(input.strategy || {}) };
    const players = input.players.map((p) => {
      // Tonight's form: most nights near average, sometimes a heater, sometimes ice cold.
      let use = Math.exp(this.normal(0, 0.12));
      let eff = this.normal(0, 0.028);
      let night = 'normal';
      const roll = this.rng();
      if (roll < 0.035) { use *= 1.3; eff += 0.07; night = 'hot'; }
      else if (roll < 0.07) { use *= 0.9; eff -= 0.06; night = 'cold'; }
      return {
        p, r: p.r, id: p.id, name: p.name, short: lastName(p.name), pos: p.pos,
        target: 0, starter: false, energy: 1, onCourt: false, stint: 0, fouls: 0,
        fouledOut: false, form: { use, eff, night }, s: emptyStats(), played: false,
      };
    });
    // Minutes targets: honour the manager's plan, rescaled to the 240 available.
    const mins = (input.lineup && input.lineup.minutes) || {};
    let sum = 0;
    for (const ps of players) { ps.target = Math.max(0, Number(mins[ps.id] ?? Math.min(ps.r.mpg, 36))); sum += ps.target; }
    if (sum <= 0) { players.forEach((ps) => { ps.target = 240 / players.length; }); sum = 240; }
    // Iteratively scale so the sum is 240 with a 44-minute cap.
    for (let k = 0; k < 6; k++) {
      sum = players.reduce((a, ps) => a + ps.target, 0);
      const f = 240 / sum;
      players.forEach((ps) => { ps.target = Math.min(44, ps.target * f); });
    }
    const starters = ((input.lineup && input.lineup.starters) || []).filter((id) => players.some((ps) => ps.id === id && ps.target > 0));
    for (const ps of players) ps.starter = starters.includes(ps.id);
    const plan = input.matchups || {};
    return {
      idx, id: input.id, name: input.name, abbr: input.abbr || input.name.slice(0, 3).toUpperCase(),
      players, onCourt: [], score: 0, strat, plan: { assign: plan.assign || {}, doubleTeam: plan.doubleTeam || null },
      teamFouls: 0, foulsLast2: 0, guardedBy: new Map(), periodScores: [],
      home: idx === 0,
    };
  }

  log(team, text) {
    this.pbp.push({ q: this.period, c: Math.max(0, Math.round(this.clock * 10) / 10), t: team == null ? -1 : team.idx, x: text, s: [this.T[0].score, this.T[1].score] });
  }

  // ---------- time ----------
  tick(sec) {
    sec = Math.max(0, Math.min(sec, this.clock));
    if (sec === 0) return;
    this.clock -= sec;
    this.elapsed += sec;
    for (const t of this.T) {
      for (const ps of t.players) {
        if (ps.onCourt) {
          ps.s.sec += sec;
          ps.stint += sec;
          ps.energy = Math.max(0, ps.energy - sec / (ps.r.stamina * 60));
        } else {
          ps.stint += sec;
          ps.energy = Math.min(1, ps.energy + sec / 230);
        }
      }
    }
  }

  isCrunch() {
    const m = Math.abs(this.T[0].score - this.T[1].score);
    return this.period > 4 || (this.period === 4 && this.clock <= 300 && m <= 10);
  }
  isGarbage(team) {
    if (this.period !== 4) return false;
    const m = Math.abs(team.score - team.opp.score);
    return (m >= 20 && this.clock <= 360) || (m >= 26 && this.clock <= 540) || m >= 32;
  }

  // ---------- rotations ----------
  foulTroubleLimit(team) {
    if (team.strat.foulTrouble === 'ignore') return this.period >= 4 ? 6 : 5;
    const q = Math.min(this.period, 4);
    const base = { 1: 2, 2: 3, 3: 4, 4: 5 }[q];
    return team.strat.foulTrouble === 'cautious' ? base : base + (q === 1 ? 1 : 0);
  }

  desire(team, ps) {
    if (ps.fouledOut) return -99;
    if (ps.target <= 0) return -50;
    const crunch = this.isCrunch();
    if (this.isGarbage(team)) return -ps.target / 48 + ps.energy * 0.1 + (ps.onCourt ? 0.02 : 0);
    if (crunch) {
      return (ps.target / 48) * 2 + ps.energy * 0.35 + (ps.onCourt ? 0.05 : 0) - (ps.fouls >= 5 ? 0.15 : 0);
    }
    const remaining = Math.max(REG_SECONDS - this.elapsed, 90);
    const want = ps.target * 60 - ps.s.sec;
    let d = want / remaining + (ps.energy - 0.72) * 0.9;
    if (ps.onCourt) d += ps.stint < 150 ? 0.3 : 0.07;
    else if (ps.stint < 80) d -= 0.2;
    if (ps.fouls >= this.foulTroubleLimit(team)) d -= 2;
    return d;
  }

  chooseFive(team, forceStarters) {
    const avail = team.players.filter((ps) => !ps.fouledOut && ps.target > 0);
    let pool = avail.length >= 5 ? avail : team.players.filter((ps) => !ps.fouledOut);
    if (pool.length < 5) pool = team.players; // extreme: play with a fouled-out player (technical in real life)
    const scored = pool.map((ps) => ({ ps, d: (forceStarters && ps.starter ? 100 : 0) + this.desire(team, ps) }));
    scored.sort((a, b) => b.d - a.d);
    const five = [];
    const bigs = () => five.filter((x) => x.r.posn >= 4.5).length;
    const pgs = () => five.filter((x) => x.r.posn <= 1.5).length;
    for (const { ps } of scored) {
      if (five.length === 5) break;
      if (ps.r.posn >= 4.5 && bigs() >= 2 && scored.length > 7) continue;
      if (ps.r.posn <= 1.5 && pgs() >= 3 && scored.length > 7) continue;
      five.push(ps);
    }
    for (const { ps } of scored) { if (five.length === 5) break; if (!five.includes(ps)) five.push(ps); }
    // Positional sanity: avoid 5-guard or 5-big units when the bench allows it.
    const sum = () => five.reduce((a, x) => a + x.r.posn, 0);
    for (let tries = 0; tries < 4 && (sum() < 11 || sum() > 19.5); tries++) {
      const tooSmall = sum() < 11;
      const out = [...five].filter((x) => !(forceStarters && x.starter))
        .sort((a, b) => (tooSmall ? a.r.posn - b.r.posn : b.r.posn - a.r.posn))[0];
      if (!out) break;
      const inn = scored.map((x) => x.ps).find((x) => !five.includes(x) && x.target > 0 && !x.fouledOut
        && (tooSmall ? x.r.posn > out.r.posn + 1 : x.r.posn < out.r.posn - 1));
      if (!inn) break;
      five[five.indexOf(out)] = inn;
    }
    return five;
  }

  doSubs(team, forceStarters = false) {
    const next = this.chooseFive(team, forceStarters);
    const out = team.onCourt.filter((ps) => !next.includes(ps));
    const inn = next.filter((ps) => !team.onCourt.includes(ps));
    if (!out.length && !inn.length && team.onCourt.length === 5) return false;
    for (const ps of out) { ps.onCourt = false; ps.stint = 0; }
    for (const ps of inn) { ps.onCourt = true; ps.stint = 0; ps.played = true; }
    if (team.onCourt.length === 5 && inn.length) {
      const pairs = inn.map((ps, i) => `${ps.short} in${out[i] ? ` for ${out[i].short}` : ''}`);
      this.log(team, `Substitution: ${pairs.join(', ')}`);
    }
    team.onCourt = next;
    return true;
  }

  assignMatchups() {
    for (const [D, O] of [[this.T[0], this.T[1]], [this.T[1], this.T[0]]]) {
      O.guardedBy = new Map();
      const freeD = [...D.onCourt];
      const freeO = [...O.onCourt];
      for (const [mine, theirs] of Object.entries(D.plan.assign || {})) {
        const d = freeD.find((x) => x.id === mine);
        const o = freeO.find((x) => x.id === theirs);
        if (d && o) { O.guardedBy.set(o.id, d); freeD.splice(freeD.indexOf(d), 1); freeO.splice(freeO.indexOf(o), 1); }
      }
      freeD.sort((a, b) => a.r.posn - b.r.posn);
      freeO.sort((a, b) => a.r.posn - b.r.posn);
      freeO.forEach((o, i) => O.guardedBy.set(o.id, freeD[i] || D.onCourt[0]));
    }
  }

  // ---------- helpers ----------
  // Players in foul trouble defend more carefully.
  caution(ps) { return ps.fouls >= 5 ? 0.4 : ps.fouls >= 4 ? 0.7 : 1; }
  sum(team, key) { return team.onCourt.reduce((a, ps) => a + ps.r[key], 0); }
  teamDefPct(team) { return team.onCourt.reduce((a, ps) => a + ps.r.defPct, 0) / 5; }
  doubled(def) {
    const target = def.plan.doubleTeam;
    return target && def.opp.onCourt.some((ps) => ps.id === target) ? target : null;
  }

  score(team, ps, pts) {
    team.score += pts;
    ps.s.pts += pts;
    for (const x of team.onCourt) x.s.pm += pts;
    for (const x of team.opp.onCourt) x.s.pm -= pts;
  }

  inPenalty(team) {
    const limit = this.period > 4 ? 4 : 5;
    return team.teamFouls >= limit || team.foulsLast2 >= 2;
  }

  personalFoul(team, ps, countsForTeam = true) {
    ps.s.pf += 1;
    ps.fouls += 1;
    if (countsForTeam) {
      team.teamFouls += 1;
      if (this.clock <= 120) team.foulsLast2 += 1;
    }
    if (ps.fouls >= 6 && !ps.fouledOut) {
      ps.fouledOut = true;
      this.log(team, `${ps.name} has fouled out (6 fouls)`);
      this.doSubs(team);
      this.assignMatchups();
    }
  }

  /** Returns true if the shooting team keeps the ball (offensive rebound on last FT). */
  freeThrows(off, ps, n) {
    let made = 0;
    const late = this.period >= 4 && this.clock < 60 && Math.abs(off.score - off.opp.score) <= 5;
    for (let i = 1; i <= n; i++) {
      ps.s.fta += 1;
      const pct = ps.r.ftPct - (late ? 0.02 : 0);
      if (this.rng() < pct) {
        ps.s.ftm += 1;
        made++;
        this.score(off, ps, 1);
        this.log(off, `${ps.name} makes free throw ${i} of ${n}`);
      } else {
        this.log(off, `${ps.name} misses free throw ${i} of ${n}`);
        if (i === n) return this.rebound(off, 0.45);
      }
    }
    this.deadBall = true;
    return false;
  }

  /** Resolve a missed shot. Returns true if offense keeps possession. */
  rebound(off, orMult = 1) {
    const def = off.opp;
    const crash = off.strat.offense === 'inside' ? 1.1 : 1;
    const O = this.sum(off, 'orb') * crash * orMult;
    const D = this.sum(def, 'drb');
    if (this.rng() < O / (O + D)) {
      const rb = this.pick(off.onCourt, (x) => x.r.orb);
      rb.s.orb += 1;
      this.log(off, `${rb.name} offensive rebound`);
      this.offRebound = true;
      this.deadBall = false;
      return true;
    }
    const rb = this.pick(def.onCourt, (x) => x.r.drb);
    rb.s.drb += 1;
    this.log(def, `${rb.name} defensive rebound`);
    this.transition = true;
    this.deadBall = false;
    return false;
  }

  // ---------- possession ----------
  possession() {
    const off = this.T[this.poss];
    const def = off.opp;
    const q = this.period;
    const lead = off.score - def.score; // from the offense's perspective
    const wasOffReb = this.offRebound;
    const wasTransition = this.transition;
    const shortClock = this.shortClock;
    this.offRebound = false;
    this.transition = false;
    this.shortClock = false;

    if (this.deadBall) {
      const a = this.doSubs(off);
      const b = this.doSubs(def);
      if (a || b) this.assignMatchups();
    }
    this.deadBall = false;

    // Late game: trailing defense fouls to stop the clock.
    if (q >= 4 && lead > 0 && this.clock > 0.8) {
      const shouldFoul = (lead <= 2 && this.clock <= 24) || (lead >= 3 && lead <= 8 && this.clock <= 45) || (lead >= 9 && lead <= 10 && this.clock <= 25);
      if (shouldFoul && this.rng() < 0.92) {
        this.tick(Math.min(this.clock - 0.1, this.uniform(1, 3.5)));
        const fouler = this.pick(def.onCourt.filter((x) => x.fouls < 5).length ? def.onCourt.filter((x) => x.fouls < 5) : def.onCourt, (x) => 1 / (x.target + 5));
        const shooter = this.pick(off.onCourt, (x) => Math.pow(x.r.ftPct, 8) * (1 + x.r.usage * 5));
        this.log(def, `${fouler.name} intentional foul on ${shooter.name}`);
        this.personalFoul(def, fouler);
        if (this.inPenalty(def)) {
          if (!this.freeThrows(off, shooter, 2)) this.poss = def.idx;
        } else {
          this.deadBall = true; // side out, off keeps it
        }
        return;
      }
    }

    // Leading team with the shot clock off simply dribbles it out.
    const shotClock = wasOffReb || shortClock ? 14 : 24;
    if (q >= 4 && lead > 0 && this.clock <= shotClock) {
      this.tick(this.clock);
      this.log(off, `${off.name} run out the clock`);
      return;
    }

    // How long does this trip take?
    const paceMult = PACE[off.strat.pace] * 0.65 + PACE[def.strat.pace] * 0.35;
    let dur;
    let putback = false;
    if (wasOffReb) {
      putback = this.rng() < 0.42;
      dur = putback ? this.uniform(0.8, 3) : clamp(this.normal(8, 3), 2, 13.5);
    } else if (wasTransition && this.rng() < 0.22) {
      dur = this.uniform(2.5, 7);
    } else {
      dur = clamp(this.normal(15.1 * paceMult, 4.6), 4, shotClock - 0.5);
    }
    if (q >= 4 && this.clock <= 150 && lead > 0) dur = Math.max(dur, shotClock - this.uniform(1.5, 4));
    if (q >= 4 && this.clock <= 60 && lead < 0) dur = Math.min(dur, this.uniform(3, 8));
    const heave = this.clock < 2.5 && !wasOffReb;
    if (heave && this.rng() < 0.6) {
      // Not enough time to get a real look — most of these just expire.
      this.tick(this.clock);
      return;
    }
    let lastShot = false;
    if (this.clock <= shotClock && (q < 4 || (lead <= 0 && lead >= -3))) {
      // Hold for the last shot of the period.
      dur = heave ? this.clock * this.uniform(0.6, 0.95) : Math.max(this.clock - this.uniform(0.3, 2.5), Math.min(0.3, this.clock));
      lastShot = true;
    }
    if (dur >= this.clock) { dur = this.clock; lastShot = true; }

    // Non-shooting foul (reach-in, loose ball, illegal screen defended...).
    const aggr = DEF_AGGR[def.strat.defense];
    const pNSF = 0.052 * aggr * clamp(this.sum(def, 'pf') / AVG.pf5, 0.8, 1.3);
    if (!lastShot && this.rng() < pNSF) {
      this.tick(dur * this.uniform(0.2, 0.8));
      const fouler = this.pick(def.onCourt, (x) => x.r.pf * this.caution(x));
      const fouled = this.pick(off.onCourt, (x) => x.r.usage);
      this.log(def, `Personal foul on ${fouler.name}`);
      this.personalFoul(def, fouler);
      if (this.inPenalty(def)) {
        if (!this.freeThrows(off, fouled, 2)) this.poss = def.idx;
      } else {
        this.deadBall = true;
        this.shortClock = true;
      }
      return;
    }

    this.tick(dur);

    // Who ends the possession? Usage-weighted, but tonight's form and fatigue matter.
    const dt = this.doubled(def);
    const crunch = this.isCrunch();
    const actor = this.pick(off.onCourt, (x) => {
      let w = Math.pow(x.r.usage, 1.9) * x.form.use * (0.75 + 0.25 * x.energy);
      if (dt === x.id) w *= 0.78;
      if (crunch) w = Math.pow(w, 1.45);
      return w;
    });
    const defender = off.guardedBy.get(actor.id) || def.onCourt[0];

    // Turnover?
    const stlF = this.sum(def, 'stl') / AVG.stl5;
    let pTov = actor.r.tovShare * clamp(Math.sqrt(stlF), 0.8, 1.25) * (aggr > 1 ? 1.07 : aggr < 1 ? 0.95 : 1)
      * (dt === actor.id ? 1.3 : 1) * (1 + (1 - actor.energy) * 0.2);
    if (heave) pTov *= 0.3;
    if (this.rng() < pTov) {
      actor.s.tov += 1;
      const pSteal = clamp(0.5 * Math.pow(stlF, 0.7) * aggr, 0.25, 0.78);
      if (this.rng() < pSteal) {
        const thief = this.pick(def.onCourt, (x) => x.r.stl * (x === defender ? 2 : 1) * (dt && dt === actor.id ? 1.3 : 1));
        thief.s.stl += 1;
        this.log(off, `${actor.name} turnover — stolen by ${thief.name}`);
        this.transition = this.rng() < 0.75;
      } else if (this.rng() < 0.18) {
        this.log(off, `${actor.name} offensive foul (turnover)`);
        this.personalFoul(off, actor, false);
        this.deadBall = true;
      } else {
        const kinds = ['bad pass out of bounds', 'traveling', 'lost ball out of bounds', 'shot clock violation', 'stepped out of bounds', '3-second violation'];
        this.log(off, `${actor.name} turnover (${kinds[Math.floor(this.rng() * kinds.length)]})`);
        this.deadBall = true;
      }
      this.poss = def.idx;
      return;
    }

    // Shot selection.
    let p3 = actor.r.r3 * THREES[off.strat.offense];
    if (putback) p3 *= 0.2;
    if (q >= 4 && lead === -3 && this.clock <= 24) p3 = 0.93;
    else if (q >= 4 && lead <= -4 && lead >= -9 && this.clock <= 45) p3 = Math.max(p3, 0.6);
    else if (q >= 4 && lead <= -7 && this.clock <= 180) p3 = Math.min(0.95, p3 + 0.2);
    if (heave) p3 = 0.8;
    const three = this.rng() < clamp(p3, 0, 0.97);

    // Fouled in the act?
    const r3 = clamp(actor.r.r3, 0, 0.9);
    const k = three ? 0.2 : (1 - r3 * 0.2) / Math.max(1 - r3, 0.1);
    const pFoul = clamp(actor.r.foulDrawn * k * aggr * (putback ? 1.3 : 1), 0, 0.45) * (heave ? 0.2 : 1);
    const fouled = this.rng() < pFoul;

    // Make probability.
    let pMake = three ? actor.r.fg3 : actor.r.fg2;
    pMake += (0.5 - defender.r.defPct) * (three ? 0.035 : 0.05);
    pMake += (0.5 - this.teamDefPct(def)) * 0.025;
    pMake += actor.form.eff;
    pMake -= (1 - actor.energy) * 0.07;
    pMake += (1 - defender.energy) * 0.025;
    if (off.home) pMake += 0.012;
    // Rubber band: big leads breed complacency, big deficits breed urgency.
    if (lead > 8) pMake -= Math.min((lead - 8) * 0.0035, 0.06);
    else if (lead < -8) pMake += Math.min((-lead - 8) * 0.0025, 0.04);
    if (dt === actor.id) pMake -= 0.04;
    else if (dt) pMake += 0.02;
    if (putback) pMake += 0.07;
    if (wasTransition && !three) pMake += 0.04;
    if (heave) pMake = three ? 0.1 : 0.3;
    if (fouled) pMake *= 0.5;
    pMake = clamp(pMake, 0.03, 0.85);
    const made = this.rng() < pMake;
    const kind = three ? '3-pt jump shot' : putback ? 'putback' : this.rng() < 0.45 + (actor.r.posn - 3) * 0.12 ? 'layup' : 'jump shot';
    const shotName = three ? '3-pt shot' : '2-pt shot';

    if (fouled) {
      const fouler = this.rng() < 0.35 * this.caution(defender) ? defender : this.pick(def.onCourt, (x) => x.r.pf * this.caution(x));
      if (made) {
        actor.s.fgm += 1; actor.s.fga += 1;
        if (three) { actor.s.tpm += 1; actor.s.tpa += 1; }
        this.score(off, actor, three ? 3 : 2);
        this.creditAssist(off, actor, putback, three);
        this.log(off, `${actor.name} makes ${kind} — AND ONE! (foul on ${fouler.name})`);
        this.personalFoul(def, fouler);
        if (!this.freeThrows(off, actor, 1)) this.poss = def.idx;
      } else {
        this.log(def, `Shooting foul on ${fouler.name} (${actor.name} ${shotName})`);
        this.personalFoul(def, fouler);
        if (!this.freeThrows(off, actor, three ? 3 : 2)) this.poss = def.idx;
      }
      return;
    }

    actor.s.fga += 1;
    if (three) actor.s.tpa += 1;
    if (made) {
      actor.s.fgm += 1;
      if (three) actor.s.tpm += 1;
      this.score(off, actor, three ? 3 : 2);
      const ast = this.creditAssist(off, actor, putback, three);
      const buzz = this.clock <= 0 ? ' at the buzzer!' : '';
      this.log(off, `${actor.name} makes ${kind}${ast ? ` (assist ${ast.name})` : ''}${buzz}`);
      this.deadBall = true;
      this.poss = def.idx;
      return;
    }
    // Missed — blocked?
    const blkF = clamp(this.sum(def, 'blk') / AVG.blk5, 0.5, 2.2);
    if (!heave && this.rng() < (three ? 0.03 : 0.155) * blkF) {
      const blocker = this.pick(def.onCourt, (x) => x.r.blk * (x === defender ? 1.6 : 1));
      blocker.s.blk += 1;
      this.log(off, `${actor.name} ${shotName} BLOCKED by ${blocker.name}`);
    } else {
      this.log(off, `${actor.name} misses ${kind}`);
    }
    if (this.clock <= 0) return; // period over, nobody gets the board
    if (!this.rebound(off)) this.poss = def.idx;
  }

  creditAssist(off, shooter, putback, three) {
    const others = off.onCourt.filter((x) => x !== shooter);
    const ast4 = others.reduce((a, x) => a + x.r.ast, 0);
    const base = putback ? 0.08 : three ? 0.82 : 0.5;
    const pAst = clamp(base * clamp(Math.sqrt(ast4 / AVG.ast4), 0.75, 1.3), 0, 0.95);
    if (this.rng() >= pAst) return null;
    const a = this.pick(others, (x) => Math.pow(x.r.ast, 2));
    a.s.ast += 1;
    return a;
  }

  // ---------- game flow ----------
  startPeriod(n, firstPoss) {
    this.period = n;
    this.clock = n <= 4 ? REG_PERIOD : OT_PERIOD;
    for (const t of this.T) {
      t.teamFouls = 0;
      t.foulsLast2 = 0;
      const rest = n === 3 ? 0.65 : n === 1 ? 0 : 0.3;
      for (const ps of t.players) ps.energy = Math.min(1, ps.energy + rest);
      t.startScore = t.score;
      this.doSubs(t, n === 1 || n === 3);
    }
    this.assignMatchups();
    this.poss = firstPoss;
    this.deadBall = false;
    this.offRebound = false;
    this.transition = false;
    this.shortClock = false;
    const label = n <= 4 ? `Start of Q${n}` : `Start of ${n === 5 ? '' : n - 4}OT`;
    this.log(null, label);
  }

  endPeriod() {
    for (const t of this.T) t.periodScores.push(t.score - t.startScore);
    const label = this.period <= 4 ? `End of Q${this.period}` : `End of ${this.period === 5 ? '' : this.period - 4}OT`;
    this.log(null, `${label}: ${this.T[0].abbr} ${this.T[0].score} - ${this.T[1].abbr} ${this.T[1].score}`);
  }

  run() {
    const tipWinner = this.rng() < 0.5 ? 0 : 1;
    let n = 1;
    for (;;) {
      let first;
      if (n <= 4) first = n === 1 || n === 4 ? tipWinner : 1 - tipWinner;
      else first = this.rng() < 0.5 ? 0 : 1;
      this.startPeriod(n, first);
      if (n === 1 || n > 4) this.log(this.T[first], `${this.T[first].name} win the tip`);
      let guard = 0;
      while (this.clock > 0 && guard++ < 2000) this.possession();
      this.endPeriod();
      if (n >= 4 && this.T[0].score !== this.T[1].score) break;
      n++;
      if (n > 12) { // absurd safety valve
        const t = this.T[this.rng() < 0.5 ? 0 : 1];
        t.score += 1;
        break;
      }
    }
    return this.result();
  }

  result() {
    const box = (t) => {
      const players = t.players.map((ps) => ({
        id: ps.id, name: ps.name, pos: ps.pos, starter: ps.starter,
        dnp: !ps.played, night: ps.form.night, fouledOut: ps.fouledOut,
        ...ps.s, sec: Math.round(ps.s.sec),
      }));
      players.sort((a, b) => (b.starter - a.starter) || (b.sec - a.sec));
      const totals = emptyStats();
      for (const p of players) for (const k of Object.keys(totals)) totals[k] += p[k];
      totals.pm = 0;
      return { teamId: t.id, name: t.name, abbr: t.abbr, score: t.score, periods: t.periodScores, players, totals };
    };
    const ot = Math.max(0, this.period - 4);
    return {
      home: box(this.T[0]),
      away: box(this.T[1]),
      ot,
      winner: this.T[0].score > this.T[1].score ? this.T[0].id : this.T[1].id,
      pbp: this.pbp,
    };
  }
}

function simulateGame(opts) {
  return new Game(opts).run();
}

module.exports = { simulateGame, mulberry32, Game };
