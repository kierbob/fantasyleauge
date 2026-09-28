'use strict';
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { simulateGame } = require('./engine');
const { makeSchedule } = require('./schedule');

const DEFAULT_SETTINGS = {
  numTeams: 8, // total teams, humans + CPU (must be even)
  humanSlots: 2, // you + your friend(s)
  rosterSize: 13, // draft rounds
  maxRoster: 15,
  minRoster: 8,
  seasonGames: 82,
  tickMinutes: 60, // one full slate of games every hour
  playoffTeams: 4,
  seriesLength: 7,
  injuries: true,
  pickSeconds: 90, // draft pick clock for humans, 0 = unlimited
  tradeDeadline: 58, // last game-day trades are allowed, 0 = none
};

const CPU_NAMES = [
  ['Harbor City Hawks', 'HCH'], ['Iron Valley Miners', 'IVM'], ['Desert Storm', 'DST'], ['Northside Nighthawks', 'NNH'],
  ['Bayou Gators', 'BYG'], ['Summit Peaks', 'SUM'], ['Metro Voltage', 'MVO'], ['Lakeshore Lightning', 'LKL'],
  ['Capital Comets', 'CAP'], ['Redwood Rangers', 'RWR'], ['Gulf Coast Tide', 'GCT'], ['Prairie Stampede', 'PRS'],
  ['Neon District', 'NEO'], ['Steel Town Forge', 'STF'], ['Emerald Kings', 'EMK'], ['Canyon Coyotes', 'CYC'],
  ['Twin Rivers Otters', 'TRO'], ['Midnight Owls', 'MOW'],
];
const COLORS = ['#c8102e', '#1d428a', '#007a33', '#fdb927', '#5a2d81', '#ce1141', '#00788c', '#e56020',
  '#0e2240', '#860038', '#006bb6', '#b4975a', '#98002e', '#00471b', '#236192', '#c4ced4', '#6f263d', '#0c2340', '#ef3b24', '#002b5c'];

const INJURIES = ['sprained ankle', 'hamstring strain', 'knee soreness', 'back spasms', 'illness', 'calf strain',
  'concussion protocol', 'wrist sprain', 'hip contusion', 'sore Achilles', 'groin strain', 'bruised shin', 'finger sprain', 'load management'];

const SUM_KEYS = ['gp', 'gs', 'sec', 'pts', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'orb', 'drb', 'ast', 'stl', 'blk', 'tov', 'pf', 'pm', 'dd', 'td'];

class LeagueError extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}
const fail = (msg, status) => { throw new LeagueError(msg, status); };

const round1 = (x) => Math.round(x * 10) / 10;
const pct = (m, a) => (a > 0 ? Math.round((m / a) * 1000) / 1000 : null);
function emptyLine() { const o = {}; for (const k of SUM_KEYS) o[k] = 0; o.hi = 0; return o; }
function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(String(pw), salt, 32).toString('hex') };
}
function checkPassword(pw, pass) {
  if (!pass) return false;
  const h = crypto.scryptSync(String(pw), pass.salt, 32);
  return crypto.timingSafeEqual(h, Buffer.from(pass.hash, 'hex'));
}
function makeAbbr(name) {
  const words = name.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean);
  const a = words.length >= 3 ? words.slice(0, 3).map((w) => w[0]).join('') : words.length === 2 ? words[0].slice(0, 2) + words[1][0] : (words[0] || 'TM').slice(0, 3);
  return a.toUpperCase();
}
function averages(line) {
  const g = line.gp || 0;
  const per = (k) => (g ? round1(line[k] / g) : 0);
  return {
    gp: g, gs: line.gs, min: g ? round1(line.sec / 60 / g) : 0, pts: per('pts'), reb: g ? round1((line.orb + line.drb) / g) : 0,
    orb: per('orb'), ast: per('ast'), stl: per('stl'), blk: per('blk'), tov: per('tov'), pf: per('pf'), tpm: per('tpm'),
    fgm: per('fgm'), fga: per('fga'), ftm: per('ftm'), fta: per('fta'), tpa: per('tpa'),
    fgp: pct(line.fgm, line.fga), tpp: pct(line.tpm, line.tpa), ftp: pct(line.ftm, line.fta), pm: per('pm'),
    dd: line.dd, td: line.td, hi: line.hi,
  };
}

class League extends EventEmitter {
  constructor({ store, pool, now = () => Date.now(), rng = Math.random }) {
    super();
    this.store = store;
    this.pool = pool;
    this.now = now;
    this.rng = rng;
    this.s = store ? store.load() : null;
    if (this.s) this.syncPlayers();
  }

  // ------------------------------------------------------------------ basics
  exists() { return !!this.s; }
  save() { if (this.store) this.store.save(this.s); }
  saveNow() { if (this.store) this.store.saveNow(this.s); }
  changed(kind) { this.save(); this.emit('update', { kind }); }
  id(prefix) { return `${prefix}${this.s.seq++}`; }

  syncPlayers() {
    for (const p of this.pool.values()) {
      if (!this.s.players[p.id]) this.s.players[p.id] = { owner: null, inj: null, st: emptyLine(), ps: emptyLine(), log: [] };
    }
  }

  team(id) { return this.s.teams.find((t) => t.id === id); }
  mustTeam(id) { return this.team(id) || fail('No such team', 404); }
  pl(id) { return this.pool.get(id); }
  injured(pid) { const P = this.s.players[pid]; return !!(P && P.inj && P.inj.games > 0); }
  isCommish(team) { return team && team.id === this.s.commissioner; }
  tickMs() { return Math.max(1, Number(this.s.settings.tickMinutes)) * 60000; }

  notify(teamId, type, text, link) {
    const t = this.team(teamId);
    if (!t || t.kind !== 'human') return;
    const list = (this.s.notifications[teamId] ||= []);
    const n = { id: this.id('n'), ts: this.now(), type, text, link: link || null, read: false };
    list.unshift(n);
    if (list.length > 250) list.length = 250;
    this.emit('notify', { teamId, n });
  }
  notifyAll(type, text, link, exceptId) {
    for (const t of this.s.teams) if (t.id !== exceptId) this.notify(t.id, type, text, link);
  }
  news(type, text, link) {
    this.s.news.unshift({ id: this.id('w'), ts: this.now(), type, text, link: link || null });
    if (this.s.news.length > 400) this.s.news.length = 400;
  }

  newTeam(name, owner, kind) {
    const idx = this.s.teams.length;
    const t = {
      id: `t${idx + 1}`, name, abbr: makeAbbr(name), owner, kind, pass: null, color: COLORS[idx % COLORS.length],
      roster: [], lineup: { starters: [], minutes: {}, auto: true },
      strategy: { pace: 'normal', offense: 'balanced', defense: 'normal', foulTrouble: 'normal' },
      matchups: {}, autodraft: false,
      rec: { w: 0, l: 0, hw: 0, hl: 0, aw: 0, al: 0, pf: 0, pa: 0, streak: 0, last: [] },
    };
    this.s.teams.push(t);
    return t;
  }

  cleanName(name, max = 32) {
    const n = String(name || '').replace(/\s+/g, ' ').trim().slice(0, max);
    if (n.length < 2) fail('Names need at least 2 characters');
    return n;
  }

  // ------------------------------------------------------------------ accounts
  setup(input) {
    if (this.s) fail('A league already exists on this server', 409);
    const settings = { ...DEFAULT_SETTINGS };
    for (const [k, v] of Object.entries(input.settings || {})) {
      if (k in settings) settings[k] = typeof DEFAULT_SETTINGS[k] === 'boolean' ? !!v : Number(v);
    }
    settings.numTeams = Math.max(2, Math.min(16, Math.round(settings.numTeams / 2) * 2));
    settings.humanSlots = Math.max(1, Math.min(settings.numTeams, Math.round(settings.humanSlots)));
    settings.rosterSize = Math.max(8, Math.min(15, Math.round(settings.rosterSize)));
    settings.maxRoster = Math.max(settings.rosterSize, Math.min(17, Math.round(settings.maxRoster)));
    settings.seasonGames = Math.max(2, Math.min(82, Math.round(settings.seasonGames)));
    settings.tickMinutes = Math.max(1, Math.min(1440, Number(settings.tickMinutes)));
    settings.playoffTeams = Math.min(settings.numTeams, [2, 4, 8].reduce((a, n) => (settings.playoffTeams >= n ? n : a), 2));
    settings.seriesLength = [1, 3, 5, 7].includes(settings.seriesLength) ? settings.seriesLength : 7;
    settings.tradeDeadline = Math.max(0, Math.min(settings.seasonGames, Math.round(settings.tradeDeadline)));
    if (this.pool.size < settings.numTeams * settings.rosterSize + 10) fail('Not enough players in the pool for that many teams');
    const pw = String(input.password || '');
    if (pw.length < 4) fail('Password needs at least 4 characters');
    this.s = {
      version: 1, createdAt: this.now(), name: this.cleanName(input.leagueName || 'Fantasy Hoops League', 40),
      inviteCode: crypto.randomBytes(3).toString('hex').toUpperCase(), commissioner: null, settings,
      phase: 'lobby', teams: [], players: {}, draft: null, schedule: [], round: 0, days: [], results: {},
      playoffs: null, champion: null, nextTickAt: null, paused: false, trades: [], transactions: [],
      notifications: {}, news: [], sessions: {}, seq: 1, season: 1,
    };
    this.syncPlayers();
    const me = this.newTeam(this.cleanName(input.teamName), this.cleanName(input.ownerName, 24), 'human');
    me.pass = hashPassword(pw);
    this.s.commissioner = me.id;
    for (let i = 1; i < settings.humanSlots; i++) this.newTeam(`Open Slot ${i}`, '', 'open');
    const names = [...CPU_NAMES].sort(() => this.rng() - 0.5);
    for (let i = settings.humanSlots; i < settings.numTeams; i++) {
      const [n, a] = names[(i - settings.humanSlots) % names.length];
      const t = this.newTeam(n, 'CPU', 'cpu');
      t.abbr = a;
    }
    this.news('league', `${this.s.name} was created by ${me.owner}. Invite code: share it with your friends.`);
    this.saveNow();
    this.emit('update', { kind: 'league' });
    return this.createSession(me);
  }

  createSession(team) {
    const token = crypto.randomBytes(24).toString('hex');
    this.s.sessions[token] = team.id;
    this.save();
    return { token, teamId: team.id };
  }

  join(input) {
    if (!this.s) fail('No league yet', 404);
    if (String(input.inviteCode || '').trim().toUpperCase() !== this.s.inviteCode) fail('Wrong invite code', 403);
    const slot = this.s.teams.find((t) => t.kind === 'open');
    if (!slot) fail('League is full', 409);
    const pw = String(input.password || '');
    if (pw.length < 4) fail('Password needs at least 4 characters');
    const name = this.cleanName(input.teamName);
    const owner = this.cleanName(input.ownerName, 24);
    if (this.s.teams.some((t) => t.kind === 'human' && (t.owner.toLowerCase() === owner.toLowerCase() || t.name.toLowerCase() === name.toLowerCase()))) {
      fail('That team or owner name is taken');
    }
    slot.name = name;
    slot.abbr = makeAbbr(name);
    slot.owner = owner;
    slot.kind = 'human';
    slot.pass = hashPassword(pw);
    this.news('league', `${owner} joined the league as ${name}.`);
    this.notifyAll('league', `${owner} joined the league (${name}).`, '#/league', slot.id);
    this.changed('league');
    return this.createSession(slot);
  }

  login(input) {
    if (!this.s) fail('No league yet', 404);
    const who = String(input.name || '').trim().toLowerCase();
    const t = this.s.teams.find((x) => x.kind === 'human' && (x.owner.toLowerCase() === who || x.name.toLowerCase() === who));
    if (!t || !checkPassword(input.password, t.pass)) fail('Wrong name or password', 401);
    return this.createSession(t);
  }

  logout(token) { delete this.s.sessions[token]; this.save(); }
  sessionTeam(token) {
    if (!this.s || !token) return null;
    const id = this.s.sessions[token];
    return id ? this.team(id) : null;
  }

  // ------------------------------------------------------------------ views
  publicTeam(t) {
    return {
      id: t.id, name: t.name, abbr: t.abbr, owner: t.owner, kind: t.kind, color: t.color,
      rec: t.rec, rosterCount: t.roster.length, autodraft: t.autodraft,
    };
  }

  standings() {
    const rows = this.s.teams.map((t) => ({ ...this.publicTeam(t), pct: t.rec.w + t.rec.l ? t.rec.w / (t.rec.w + t.rec.l) : 0, diff: t.rec.pf - t.rec.pa }));
    rows.sort((a, b) => b.pct - a.pct || b.diff - a.diff || a.name.localeCompare(b.name));
    const lead = rows[0];
    for (const r of rows) r.gb = lead ? ((lead.rec.w - r.rec.w) + (r.rec.l - lead.rec.l)) / 2 : 0;
    return rows;
  }

  summary(viewer) {
    const s = this.s;
    if (!s) return { exists: false };
    return {
      exists: true, name: s.name, phase: s.phase, season: s.season, settings: s.settings,
      inviteCode: viewer ? s.inviteCode : undefined,
      commissioner: s.commissioner, me: viewer ? viewer.id : null,
      round: s.round, totalRounds: s.schedule.length, nextTickAt: s.nextTickAt, paused: s.paused, now: this.now(),
      teams: s.teams.map((t) => this.publicTeam(t)), standings: this.standings(),
      draft: s.draft ? this.draftState() : null, playoffs: s.playoffs, champion: s.champion,
      unread: viewer ? (s.notifications[viewer.id] || []).filter((n) => !n.read).length : 0,
      pendingTrades: viewer ? s.trades.filter((tr) => tr.status === 'pending' && tr.to === viewer.id).length : 0,
      tradesOpen: this.tradesOpen(),
      lastDay: s.days.length ? { ...s.days[s.days.length - 1], games: s.days[s.days.length - 1].games.map((id) => s.results[id]).filter(Boolean) } : null,
    };
  }

  playerRow(p) {
    const P = this.s.players[p.id];
    return {
      id: p.id, name: p.name, team: p.team, pos: p.pos, age: p.age, ovr: p.ovr, value: round1(p.value), def: Math.round(p.r.defPct * 100),
      owner: P.owner, inj: P.inj && P.inj.games > 0 ? P.inj : null,
      real: {
        g: p.g, min: p.mp, pts: round1(p.pts), reb: round1(p.orb + p.drb), ast: p.ast, stl: p.stl, blk: p.blk, tov: p.tov,
        tpm: p.tp, fgp: pct(p.fg, p.fga), tpp: pct(p.tp, p.tpa), ftp: pct(p.ft, p.fta),
      },
      st: averages(P.st),
    };
  }

  playersView() {
    return [...this.pool.values()].map((p) => this.playerRow(p));
  }

  playerDetail(id) {
    const p = this.pl(id) || fail('No such player', 404);
    const P = this.s.players[id];
    const r = p.r;
    return {
      ...this.playerRow(p),
      playoffs: averages(P.ps),
      log: P.log.slice(-100),
      ratings: {
        usage: round1(r.usage * 36), threeRate: Math.round(r.r3 * 100), fg2: Math.round(r.fg2 * 1000) / 10,
        fg3: Math.round(r.fg3 * 1000) / 10, ft: Math.round(r.ftPct * 1000) / 10, defense: Math.round(r.defPct * 100), stamina: round1(r.stamina),
      },
    };
  }

  teamView(id, viewer) {
    const t = this.mustTeam(id);
    const mine = viewer && viewer.id === t.id;
    const games = [];
    this.s.schedule.forEach((round, ri) => round.forEach((g, gi) => {
      if (g.home !== t.id && g.away !== t.id) return;
      const gid = `s${ri}-${gi}`;
      const res = this.s.results[gid];
      const home = g.home === t.id;
      games.push({ id: gid, day: ri + 1, home, opp: home ? g.away : g.home, played: !!res, us: res ? (home ? res.hs : res.as) : null, them: res ? (home ? res.as : res.hs) : null, ot: res ? res.ot : 0 });
    }));
    for (const r of Object.values(this.s.results)) {
      if (!r.playoff || (r.home !== t.id && r.away !== t.id)) continue;
      const home = r.home === t.id;
      games.push({ id: r.id, day: r.label, playoff: true, home, opp: home ? r.away : r.home, played: true, us: home ? r.hs : r.as, them: home ? r.as : r.hs, ot: r.ot });
    }
    return {
      ...this.publicTeam(t),
      roster: t.roster.map((pid) => this.pl(pid)).filter(Boolean).map((p) => this.playerRow(p)),
      lineup: t.lineup, strategy: t.strategy,
      matchups: mine ? t.matchups : undefined,
      games,
      nextOpponent: this.nextOpponent(t.id),
    };
  }

  nextOpponent(teamId) {
    if (this.s.phase === 'season') {
      const round = this.s.schedule[this.s.round] || [];
      const g = round.find((x) => x.home === teamId || x.away === teamId);
      return g ? (g.home === teamId ? g.away : g.home) : null;
    }
    if (this.s.phase === 'playoffs' && this.s.playoffs) {
      const series = this.s.playoffs.rounds[this.s.playoffs.current].find((x) => !x.winner && (x.hi === teamId || x.lo === teamId));
      return series ? (series.hi === teamId ? series.lo : series.hi) : null;
    }
    return null;
  }

  scheduleView() {
    const days = this.s.days.map((d) => ({ ...d, games: d.games.map((id) => this.s.results[id]).filter(Boolean) }));
    const upcoming = this.s.phase === 'season'
      ? this.s.schedule.slice(this.s.round, this.s.round + 3).map((round, k) => ({
        label: `Game ${this.s.round + k + 1}`,
        at: this.s.nextTickAt ? this.s.nextTickAt + k * this.tickMs() : null,
        games: round.map((g) => ({ home: g.home, away: g.away })),
      }))
      : [];
    return { days, upcoming };
  }

  gameView(id) {
    const g = this.store ? this.store.loadGame(id) : this._games && this._games[id];
    return g || fail('Game not found', 404);
  }

  // ------------------------------------------------------------------ draft
  pickerAt(no) {
    const d = this.s.draft;
    const n = d.order.length;
    const round = Math.floor(no / n);
    const i = no % n;
    return d.order[round % 2 ? n - 1 - i : i];
  }

  draftState() {
    const d = this.s.draft;
    return {
      order: d.order, picks: d.picks, pickNo: d.pickNo, total: d.total, deadline: d.deadline,
      current: d.pickNo < d.total ? this.pickerAt(d.pickNo) : null,
      round: Math.floor(d.pickNo / d.order.length) + 1,
    };
  }

  startDraft(by) {
    if (!this.isCommish(by)) fail('Only the commissioner can start the draft', 403);
    if (this.s.phase !== 'lobby') fail('Draft already started');
    const names = CPU_NAMES.filter(([n]) => !this.s.teams.some((t) => t.name === n));
    for (const t of this.s.teams) {
      if (t.kind !== 'open') continue;
      const [n, a] = names.shift() || [`CPU Team ${t.id}`, `C${t.id}`];
      Object.assign(t, { kind: 'cpu', name: n, abbr: a, owner: 'CPU' });
    }
    const order = this.s.teams.map((t) => t.id).sort(() => this.rng() - 0.5);
    this.s.draft = { order, picks: [], pickNo: 0, total: order.length * this.s.settings.rosterSize, deadline: null };
    this.s.phase = 'draft';
    this.setPickDeadline();
    const orderText = order.map((id, i) => `${i + 1}. ${this.team(id).name}`).join(', ');
    this.news('draft', `The draft is live! Order: ${orderText}`, '#/draft');
    this.notifyAll('draft', 'The draft has started — get to the draft room!', '#/draft');
    this.changed('draft');
  }

  setPickDeadline() {
    const d = this.s.draft;
    if (d.pickNo >= d.total) { d.deadline = null; return; }
    const t = this.team(this.pickerAt(d.pickNo));
    const secs = this.s.settings.pickSeconds;
    if (t.kind !== 'human' || t.autodraft) d.deadline = this.now() + 1200;
    else d.deadline = secs > 0 ? this.now() + secs * 1000 : null;
    if (t.kind === 'human' && !t.autodraft) this.notify(t.id, 'draft', "You're on the clock!", '#/draft');
  }

  draftPick(team, pid) {
    if (this.s.phase !== 'draft') fail('The draft is not running');
    if (this.pickerAt(this.s.draft.pickNo) !== team.id) fail("It's not your pick");
    const p = this.pl(pid) || fail('No such player', 404);
    if (this.s.players[pid].owner) fail(`${p.name} is already taken`);
    this.doPick(team, p, false);
  }

  doPick(team, p, auto) {
    const d = this.s.draft;
    this.s.players[p.id].owner = team.id;
    team.roster.push(p.id);
    const no = d.pickNo;
    d.picks.push({ no: no + 1, round: Math.floor(no / d.order.length) + 1, teamId: team.id, pid: p.id, name: p.name, auto, ts: this.now() });
    d.pickNo++;
    this.emit('draftpick', { teamId: team.id, pid: p.id });
    if (d.pickNo >= d.total) this.finishDraft();
    else { this.setPickDeadline(); this.changed('draft'); }
  }

  setAutodraft(team, on) {
    team.autodraft = !!on;
    if (this.s.phase === 'draft' && this.pickerAt(this.s.draft.pickNo) === team.id) this.setPickDeadline();
    this.changed('draft');
  }

  posGroup(p) { const n = p.r.posn; return n <= 2.25 ? 'G' : n < 4 ? 'W' : 'B'; }

  bestAvailableFor(team) {
    const avail = [...this.pool.values()].filter((p) => !this.s.players[p.id].owner);
    const have = { G: 0, W: 0, B: 0 };
    for (const pid of team.roster) { const p = this.pl(pid); if (p) have[this.posGroup(p)]++; }
    const size = this.s.settings.rosterSize;
    const want = { G: Math.round(size * 0.36), W: Math.round(size * 0.28), B: Math.round(size * 0.36) };
    const left = Math.max(1, size - team.roster.length);
    let best = null;
    let bestScore = -Infinity;
    for (const p of avail) {
      const g = this.posGroup(p);
      const need = Math.max(0, want[g] - have[g]);
      const urgency = need >= left ? 0.35 : need > 0 ? 0.05 : have[g] >= want[g] + 2 ? -0.12 : 0;
      const inj = this.injured(p.id) ? 0.85 : 1;
      const score = p.value * (1 + urgency) * inj + this.rng() * 1.2;
      if (score > bestScore) { bestScore = score; best = p; }
    }
    return best;
  }

  finishDraft() {
    const s = this.s;
    s.draft.deadline = null;
    s.phase = 'season';
    s.schedule = makeSchedule(s.teams.map((t) => t.id), s.settings.seasonGames, this.rng);
    s.round = 0;
    for (const t of s.teams) this.autoLineup(t);
    const tick = this.tickMs();
    let next = Math.ceil(this.now() / tick) * tick;
    if (next - this.now() < 60000) next += tick;
    s.nextTickAt = next;
    const mins = Math.round((next - this.now()) / 60000);
    this.news('draft', `The draft is complete. Game 1 tips off in ${mins} minute${mins === 1 ? '' : 's'}.`, '#/scores');
    this.notifyAll('draft', 'Draft complete! Set your lineup before game 1 tips off.', '#/team');
    this.saveNow();
    this.emit('update', { kind: 'draft' });
  }

  // ------------------------------------------------------------------ lineups
  pickStarters(avail) {
    const five = [];
    const count = (fn) => five.filter(fn).length;
    for (const p of avail) {
      if (five.length === 5) break;
      if (p.r.posn >= 4.5 && count((x) => x.r.posn >= 4.5) >= 2) continue;
      if (p.r.posn >= 4 && count((x) => x.r.posn >= 4) >= 3) continue;
      if (p.r.posn <= 2.25 && count((x) => x.r.posn <= 2.25) >= 3) continue;
      five.push(p);
    }
    for (const p of avail) { if (five.length >= 5) break; if (!five.includes(p)) five.push(p); }
    const ensure = (fn) => {
      if (count(fn) > 0) return;
      const cand = avail.find((p) => fn(p) && !five.includes(p));
      if (!cand || five.length < 5) return;
      const out = [...five].sort((a, b) => a.value - b.value)[0];
      five[five.indexOf(out)] = cand;
    };
    ensure((p) => p.r.posn <= 2.5);
    ensure((p) => p.r.posn >= 4);
    return five;
  }

  autoLineup(team) {
    const avail = team.roster.filter((pid) => !this.injured(pid)).map((pid) => this.pl(pid)).filter(Boolean)
      .sort((a, b) => b.value - a.value);
    const starters = this.pickStarters(avail);
    const order = [...starters, ...avail.filter((p) => !starters.includes(p))];
    const slots = [34, 33, 32, 31, 30, 24, 20, 17, 13, 6];
    const minutes = {};
    for (const pid of team.roster) minutes[pid] = 0;
    // Only two true centers share the floor, so centers get at most 96 of the 240 minutes;
    // whatever doesn't fit goes to the best guards/wings instead of being wasted.
    let bigMin = 0;
    let leftover = 0;
    const cap = (p) => Math.max(0, Math.round(p.mp + 5));
    order.forEach((p, i) => {
      let m = Math.min(slots[i] || 0, cap(p));
      if (p.r.posn >= 4.5) {
        const room = Math.max(0, 96 - bigMin);
        if (m > room) { leftover += m - room; m = room; }
        bigMin += m;
      }
      minutes[p.id] = m;
    });
    for (const p of order) {
      if (leftover <= 0) break;
      if (p.r.posn >= 4.5) continue;
      const add = Math.min(Math.min(38, cap(p)) - minutes[p.id], leftover);
      if (add > 0) { minutes[p.id] += add; leftover -= add; }
    }
    team.lineup = { starters: starters.map((p) => p.id), minutes, auto: true };
  }

  /** Keep a manual lineup valid after roster moves; arrivals inherit departed players' minutes. */
  fixLineup(team, arrivals = [], departed = []) {
    if (team.lineup.auto || team.kind !== 'human') { this.autoLineup(team); return; }
    const L = team.lineup;
    let freed = 0;
    const startersOut = departed.filter((pid) => L.starters.includes(pid)).length;
    for (const pid of departed) { freed += L.minutes[pid] || 0; delete L.minutes[pid]; }
    L.starters = L.starters.filter((pid) => team.roster.includes(pid));
    const arr = arrivals.map((pid) => this.pl(pid)).filter(Boolean).sort((a, b) => b.value - a.value);
    for (const p of arr) {
      const share = arr.length ? Math.round(freed / arr.length) : 0;
      L.minutes[p.id] = Math.min(40, share);
    }
    for (let i = 0; i < startersOut && arr[i]; i++) if (L.starters.length < 5) L.starters.push(arr[i].id);
    for (const pid of team.roster) if (!(pid in L.minutes)) L.minutes[pid] = 0;
    if (L.starters.length < 5) {
      const bench = team.roster.filter((pid) => !L.starters.includes(pid)).map((pid) => this.pl(pid)).filter(Boolean).sort((a, b) => b.value - a.value);
      while (L.starters.length < 5 && bench.length) L.starters.push(bench.shift().id);
    }
  }

  setLineup(team, body) {
    const L = { ...team.lineup, minutes: { ...team.lineup.minutes } };
    if (body.auto === true) {
      this.autoLineup(team);
    } else {
      if (Array.isArray(body.starters)) {
        const st = [...new Set(body.starters)];
        if (st.length !== 5) fail('Pick exactly 5 starters');
        for (const pid of st) if (!team.roster.includes(pid)) fail('Starter is not on your roster');
        L.starters = st;
      }
      if (body.minutes && typeof body.minutes === 'object') {
        for (const [pid, m] of Object.entries(body.minutes)) {
          if (!team.roster.includes(pid)) continue;
          const v = Number(m);
          if (!Number.isFinite(v) || v < 0 || v > 48) fail('Minutes must be between 0 and 48');
          L.minutes[pid] = Math.round(v);
        }
      }
      for (const pid of L.starters) if (!(L.minutes[pid] > 0)) L.minutes[pid] = 24;
      L.auto = false;
      team.lineup = L;
    }
    if (body.strategy) this.setStrategy(team, body.strategy);
    this.changed('team');
    return team.lineup;
  }

  setStrategy(team, st) {
    const allowed = { pace: ['slow', 'normal', 'fast'], offense: ['inside', 'balanced', 'perimeter'], defense: ['conservative', 'normal', 'aggressive'], foulTrouble: ['cautious', 'normal', 'ignore'] };
    for (const [k, vals] of Object.entries(allowed)) if (st[k] && vals.includes(st[k])) team.strategy[k] = st[k];
  }

  setMatchups(team, oppId, body) {
    const opp = this.mustTeam(oppId);
    if (opp.id === team.id) fail("You can't game-plan against yourself");
    const assign = {};
    const usedOpp = new Set();
    for (const [mine, theirs] of Object.entries(body.assign || {})) {
      if (!theirs) continue;
      if (!team.roster.includes(mine)) fail('Defender is not on your roster');
      if (!opp.roster.includes(theirs)) fail('That player is not on their roster');
      if (usedOpp.has(theirs)) fail('Each opponent can only have one primary defender');
      usedOpp.add(theirs);
      assign[mine] = theirs;
    }
    const doubleTeam = body.doubleTeam && opp.roster.includes(body.doubleTeam) ? body.doubleTeam : null;
    team.matchups[opp.id] = { assign, doubleTeam };
    this.changed('team');
    return team.matchups[opp.id];
  }

  // ------------------------------------------------------------------ roster moves
  tradesOpen() {
    const s = this.s;
    if (s.phase !== 'season') return false;
    return !(s.settings.tradeDeadline > 0 && s.round >= s.settings.tradeDeadline);
  }

  logTransaction(text) {
    this.s.transactions.unshift({ ts: this.now(), text });
    if (this.s.transactions.length > 300) this.s.transactions.length = 300;
  }

  addFreeAgent(team, pid, dropId) {
    if (this.s.phase !== 'season') fail('Free agency is only open during the regular season');
    const p = this.pl(pid) || fail('No such player', 404);
    if (this.s.players[pid].owner) fail(`${p.name} is not a free agent`);
    const max = this.s.settings.maxRoster;
    if (dropId) this.releasePlayer(team, dropId, true);
    if (team.roster.length >= max) fail(`Roster is full (${max}). Drop someone first.`);
    this.s.players[pid].owner = team.id;
    team.roster.push(pid);
    this.fixLineup(team, [pid], dropId ? [dropId] : []);
    this.voidTradesWith([pid]);
    const text = `${team.name} signed ${p.name}${dropId ? ` and released ${this.pl(dropId).name}` : ''}.`;
    this.logTransaction(text);
    this.news('transaction', text, `#/player/${pid}`);
    this.notifyAll('transaction', text, `#/player/${pid}`, team.id);
    this.changed('roster');
  }

  releasePlayer(team, pid, partOfAdd = false) {
    if (!['season', 'playoffs'].includes(this.s.phase)) fail('Rosters are locked right now');
    if (!team.roster.includes(pid)) fail('Player is not on your roster');
    if (team.roster.length - 1 < this.s.settings.minRoster && !partOfAdd) fail(`You need at least ${this.s.settings.minRoster} players`);
    team.roster = team.roster.filter((x) => x !== pid);
    this.s.players[pid].owner = null;
    this.voidTradesWith([pid]);
    if (!partOfAdd) {
      this.fixLineup(team, [], [pid]);
      const text = `${team.name} released ${this.pl(pid).name}.`;
      this.logTransaction(text);
      this.news('transaction', text, `#/player/${pid}`);
      this.changed('roster');
    }
  }

  dropPlayer(team, pid) { this.releasePlayer(team, pid, false); }

  // ------------------------------------------------------------------ trades
  tradeValue(pid) {
    const p = this.pl(pid);
    if (!p) return 0;
    const P = this.s.players[pid];
    let v = p.value;
    // Blend in how he's actually playing this season once there's a sample.
    const st = P.st;
    if (st.gp >= 10) {
      const avg = averages(st);
      const gs = avg.pts + 0.4 * avg.fgm - 0.7 * avg.fga - 0.4 * (avg.fta - avg.ftm) + 0.7 * avg.orb + 0.3 * (avg.reb - avg.orb) + avg.stl + 0.7 * avg.ast + 0.7 * avg.blk - 0.4 * avg.pf - avg.tov;
      const w = Math.min(0.4, st.gp / 82);
      v = v * (1 - w) + Math.max(gs * 1.15, 0.5) * w;
    }
    if (P.inj && P.inj.games > 10) v *= 0.75;
    return Math.pow(Math.max(v, 0.5), 1.8);
  }

  validateTradeSides(from, to, give, get) {
    for (const pid of give) if (!from.roster.includes(pid)) fail(`${this.pl(pid) ? this.pl(pid).name : pid} is no longer on ${from.name}`);
    for (const pid of get) if (!to.roster.includes(pid)) fail(`${this.pl(pid) ? this.pl(pid).name : pid} is no longer on ${to.name}`);
    const { maxRoster, minRoster } = this.s.settings;
    const fromSize = from.roster.length - give.length + get.length;
    const toSize = to.roster.length - get.length + give.length;
    if (fromSize > maxRoster) fail(`${from.name} would have ${fromSize} players (max ${maxRoster}) — drop someone first`);
    if (toSize > maxRoster) fail(`${to.name} would have ${toSize} players (max ${maxRoster})`);
    if (fromSize < minRoster || toSize < minRoster) fail(`Teams need at least ${minRoster} players`);
  }

  proposeTrade(from, body) {
    if (!this.tradesOpen()) fail(this.s.phase === 'season' ? 'The trade deadline has passed' : 'Trades are only allowed during the regular season');
    const to = this.mustTeam(body.to);
    if (to.id === from.id) fail("You can't trade with yourself");
    const give = [...new Set(body.give || [])];
    const get = [...new Set(body.get || [])];
    if (!give.length && !get.length) fail('Add at least one player');
    if (give.length > 5 || get.length > 5) fail('Max 5 players per side');
    this.validateTradeSides(from, to, give, get);
    const dup = this.s.trades.find((t) => t.status === 'pending' && t.from === from.id && t.to === to.id
      && t.give.join() === give.join() && t.get.join() === get.join());
    if (dup) fail('You already sent that exact offer');
    const tr = {
      id: this.id('tr'), from: from.id, to: to.id, give, get, message: String(body.message || '').slice(0, 280),
      status: 'pending', createdAt: this.now(), resolvedAt: null, note: null,
    };
    this.s.trades.unshift(tr);
    const desc = this.describeTrade(tr);
    if (to.kind === 'cpu') {
      this.cpuConsiderTrade(tr);
    } else {
      this.notify(to.id, 'trade', `Trade offer from ${from.name}: ${desc}`, '#/trades');
    }
    this.changed('trades');
    return tr;
  }

  describeTrade(tr) {
    const names = (ids) => ids.map((pid) => (this.pl(pid) ? this.pl(pid).name : pid)).join(', ') || 'nothing';
    return `${this.team(tr.from).name} get ${names(tr.get)} — ${this.team(tr.to).name} get ${names(tr.give)}`;
  }

  cpuConsiderTrade(tr) {
    const to = this.team(tr.to);
    const gain = tr.give.reduce((a, pid) => a + this.tradeValue(pid), 0);
    const loss = tr.get.reduce((a, pid) => a + this.tradeValue(pid), 0);
    // CPU wants a clear win, and demands more if you're raiding its best player.
    const best = Math.max(...to.roster.map((pid) => this.tradeValue(pid)));
    const franchise = tr.get.some((pid) => this.tradeValue(pid) >= best * 0.999);
    const need = franchise ? 1.15 : 1.05;
    if (gain >= loss * need) {
      try { this.executeTrade(tr, `${to.name} (CPU) accepted.`); } catch (e) { tr.status = 'rejected'; tr.note = e.message; tr.resolvedAt = this.now(); }
    } else {
      tr.status = 'rejected';
      tr.resolvedAt = this.now();
      tr.note = gain < loss * 0.8 ? `${to.name}: "Not even close."` : `${to.name}: "Close, but we need a bit more."`;
      this.notify(tr.from, 'trade', `${to.name} rejected your trade. ${tr.note}`, '#/trades');
    }
  }

  respondTrade(team, tradeId, action) {
    const tr = this.s.trades.find((t) => t.id === tradeId) || fail('No such trade', 404);
    if (tr.status !== 'pending') fail('That trade is no longer pending');
    if (action === 'cancel') {
      if (tr.from !== team.id) fail('Only the proposer can cancel');
      tr.status = 'cancelled';
      tr.resolvedAt = this.now();
      this.notify(tr.to, 'trade', `${team.name} withdrew their trade offer.`, '#/trades');
    } else {
      if (tr.to !== team.id) fail('This offer is not addressed to you');
      if (action === 'accept') {
        if (!this.tradesOpen()) fail('Trades are closed');
        this.executeTrade(tr, `${team.name} accepted.`);
      } else if (action === 'reject') {
        tr.status = 'rejected';
        tr.resolvedAt = this.now();
        this.notify(tr.from, 'trade', `${team.name} rejected your trade offer.`, '#/trades');
      } else fail('Unknown action');
    }
    this.changed('trades');
    return tr;
  }

  executeTrade(tr, note) {
    const from = this.team(tr.from);
    const to = this.team(tr.to);
    this.validateTradeSides(from, to, tr.give, tr.get);
    from.roster = from.roster.filter((pid) => !tr.give.includes(pid)).concat(tr.get);
    to.roster = to.roster.filter((pid) => !tr.get.includes(pid)).concat(tr.give);
    for (const pid of tr.get) this.s.players[pid].owner = from.id;
    for (const pid of tr.give) this.s.players[pid].owner = to.id;
    this.fixLineup(from, tr.get, tr.give);
    this.fixLineup(to, tr.give, tr.get);
    tr.status = 'accepted';
    tr.resolvedAt = this.now();
    tr.note = note;
    this.voidTradesWith([...tr.give, ...tr.get], tr.id);
    const desc = this.describeTrade(tr);
    this.logTransaction(`TRADE: ${desc}`);
    this.news('trade', `TRADE: ${desc}`, '#/trades');
    // Everyone in the league hears about it.
    this.notifyAll('trade', `TRADE COMPLETED: ${desc}`, '#/trades');
  }

  voidTradesWith(pids, exceptId) {
    for (const t of this.s.trades) {
      if (t.status !== 'pending' || t.id === exceptId) continue;
      if ([...t.give, ...t.get].some((pid) => pids.includes(pid))) {
        t.status = 'void';
        t.resolvedAt = this.now();
        t.note = 'A player in this deal changed teams.';
        this.notify(t.from, 'trade', 'One of your trade offers was voided because a player moved.', '#/trades');
        this.notify(t.to, 'trade', 'A trade offer to you was voided because a player moved.', '#/trades');
      }
    }
  }

  tradesView(viewer) {
    const mine = this.s.trades.filter((t) => viewer && (t.from === viewer.id || t.to === viewer.id));
    const league = this.s.trades.filter((t) => t.status === 'accepted');
    const seen = new Set();
    return [...mine, ...league].filter((t) => (seen.has(t.id) ? false : seen.add(t.id))).slice(0, 150);
  }

  // CPU GMs occasionally pitch offers to human managers.
  cpuProposeTrades() {
    if (!this.tradesOpen()) return;
    const humans = this.s.teams.filter((t) => t.kind === 'human');
    if (!humans.length) return;
    for (const cpu of this.s.teams.filter((t) => t.kind === 'cpu')) {
      if (this.rng() > 0.05) continue;
      const human = humans[Math.floor(this.rng() * humans.length)];
      const pending = this.s.trades.filter((t) => t.status === 'pending' && t.to === human.id && this.team(t.from).kind === 'cpu').length;
      if (pending >= 2) continue;
      const targets = human.roster.filter((pid) => !this.injured(pid)).sort((a, b) => this.tradeValue(b) - this.tradeValue(a)).slice(1, 8);
      if (!targets.length) continue;
      const want = targets[Math.floor(this.rng() * targets.length)];
      const wantV = this.tradeValue(want);
      const wantRaw = this.pl(want).value;
      const mine = cpu.roster.filter((pid) => !this.injured(pid)).sort((a, b) => this.tradeValue(b) - this.tradeValue(a));
      let offer = null;
      // 2-for-1: more raw production for the human, but the CPU is consolidating talent.
      for (let i = 0; i < mine.length && !offer; i++) {
        for (let j = i + 1; j < mine.length && !offer; j++) {
          const a = mine[i]; const b = mine[j];
          const raw = this.pl(a).value + this.pl(b).value;
          const tv = this.tradeValue(a) + this.tradeValue(b);
          if (raw >= wantRaw * 1.2 && tv <= wantV * 0.98 && this.pl(a).value < wantRaw) offer = [a, b];
        }
      }
      if (!offer) continue;
      if (human.roster.length + offer.length - 1 > this.s.settings.maxRoster) continue;
      if (cpu.roster.length - offer.length + 1 < this.s.settings.minRoster) continue;
      const tr = {
        id: this.id('tr'), from: cpu.id, to: human.id, give: offer, get: [want], message: `${cpu.name} GM: "We like ${this.pl(want).name}. Two quality pieces for one — interested?"`,
        status: 'pending', createdAt: this.now(), resolvedAt: null, note: null,
      };
      this.s.trades.unshift(tr);
      this.notify(human.id, 'trade', `Trade offer from ${cpu.name}: ${this.describeTrade(tr)}`, '#/trades');
    }
  }

  // Expire CPU offers after a few game days so they don't pile up.
  expireCpuOffers() {
    for (const t of this.s.trades) {
      if (t.status === 'pending' && this.team(t.from).kind === 'cpu' && this.now() - t.createdAt > this.tickMs() * 6) {
        t.status = 'cancelled';
        t.note = 'Offer expired.';
        t.resolvedAt = this.now();
      }
    }
  }

  // CPU roster upkeep: keep enough healthy bodies, occasionally upgrade from free agency.
  cpuMaintenance() {
    const { maxRoster } = this.s.settings;
    const fas = () => [...this.pool.values()].filter((p) => !this.s.players[p.id].owner && !this.injured(p.id)).sort((a, b) => b.value - a.value);
    for (const t of this.s.teams.filter((x) => x.kind === 'cpu')) {
      const healthy = t.roster.filter((pid) => !this.injured(pid));
      let moved = false;
      if (healthy.length < 9) {
        const fa = fas()[0];
        if (fa) {
          if (t.roster.length >= maxRoster) {
            const cut = [...t.roster].sort((a, b) => {
              const ia = this.injured(a) ? this.s.players[a].inj.games : 0;
              const ib = this.injured(b) ? this.s.players[b].inj.games : 0;
              return (ib > 15) - (ia > 15) || this.pl(a).value - this.pl(b).value;
            })[0];
            t.roster = t.roster.filter((x) => x !== cut);
            this.s.players[cut].owner = null;
            this.voidTradesWith([cut]);
            this.logTransaction(`${t.name} released ${this.pl(cut).name}.`);
          }
          this.s.players[fa.id].owner = t.id;
          t.roster.push(fa.id);
          this.logTransaction(`${t.name} signed ${fa.name}.`);
          this.news('transaction', `${t.name} signed free agent ${fa.name}.`, `#/player/${fa.id}`);
          moved = true;
        }
      } else if (this.s.round % 7 === 3) {
        const fa = fas()[0];
        const worst = [...t.roster].sort((a, b) => this.pl(a).value - this.pl(b).value)[0];
        if (fa && worst && fa.value > this.pl(worst).value * 1.12) {
          t.roster = t.roster.filter((x) => x !== worst);
          this.s.players[worst].owner = null;
          this.voidTradesWith([worst]);
          this.s.players[fa.id].owner = t.id;
          t.roster.push(fa.id);
          const text = `${t.name} signed ${fa.name} and released ${this.pl(worst).name}.`;
          this.logTransaction(text);
          this.news('transaction', text, `#/player/${fa.id}`);
          moved = true;
        }
      }
      if (moved || t.lineup.auto) this.autoLineup(t);
    }
    for (const t of this.s.teams.filter((x) => x.kind === 'human' && x.lineup.auto)) this.autoLineup(t);
  }

  // ------------------------------------------------------------------ game days
  gameInput(team, oppId) {
    let avail = team.roster.filter((pid) => !this.injured(pid));
    if (avail.length < 5) avail = [...team.roster]; // emergency: injured guys suit up
    const players = avail.map((pid) => this.pl(pid)).filter(Boolean);
    const plan = team.matchups[oppId] || {};
    return {
      id: team.id, name: team.name, abbr: team.abbr, players,
      lineup: { starters: team.lineup.starters.filter((pid) => avail.includes(pid)), minutes: team.lineup.minutes },
      strategy: team.strategy,
      matchups: { assign: plan.assign || {}, doubleTeam: plan.doubleTeam || null },
    };
  }

  playGame(id, homeId, awayId, label, playoff) {
    const home = this.team(homeId);
    const away = this.team(awayId);
    const res = simulateGame({ home: this.gameInput(home, awayId), away: this.gameInput(away, homeId), rng: this.rng });
    const at = this.now();
    const game = { id, label, at, playoff: !!playoff, ...res };
    if (this.store) this.store.saveGame(id, game);
    else (this._games ||= {})[id] = game;
    const top = (box) => {
      const b = [...box.players].sort((x, y) => (y.pts + y.orb + y.drb + y.ast) - (x.pts + x.orb + x.drb + x.ast))[0];
      return b ? { id: b.id, name: b.name, pts: b.pts, reb: b.orb + b.drb, ast: b.ast } : null;
    };
    const summary = { id, label, at, playoff: !!playoff, home: homeId, away: awayId, hs: res.home.score, as: res.away.score, ot: res.ot, winner: res.winner, top: { home: top(res.home), away: top(res.away) } };
    this.s.results[id] = summary;
    this.recordStats(game, summary);
    if (!playoff) this.recordStandings(summary);
    this.gameNotifications(game, summary);
    return summary;
  }

  recordStats(game, summary) {
    for (const [side, oppSide] of [['home', 'away'], ['away', 'home']]) {
      const box = game[side];
      const opp = this.team(game[oppSide].teamId);
      const won = summary.winner === box.teamId;
      for (const p of box.players) {
        const P = this.s.players[p.id];
        if (!P || p.dnp) continue;
        const L = summary.playoff ? P.ps : P.st;
        L.gp++;
        if (p.starter) L.gs++;
        for (const k of ['sec', 'pts', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'orb', 'drb', 'ast', 'stl', 'blk', 'tov', 'pf', 'pm']) L[k] += p[k];
        const reb = p.orb + p.drb;
        const tens = [p.pts, reb, p.ast, p.stl, p.blk].filter((x) => x >= 10).length;
        if (tens >= 2) L.dd++;
        if (tens >= 3) L.td++;
        L.hi = Math.max(L.hi, p.pts);
        P.log.push({
          g: game.id, d: game.label, po: summary.playoff ? 1 : 0, opp: opp.abbr, h: side === 'home' ? 1 : 0, w: won ? 1 : 0,
          sc: `${box.score}-${game[oppSide].score}`, min: Math.round(p.sec / 60), pts: p.pts, reb, ast: p.ast, stl: p.stl, blk: p.blk,
          tov: p.tov, fgm: p.fgm, fga: p.fga, tpm: p.tpm, tpa: p.tpa, ftm: p.ftm, fta: p.fta, pf: p.pf, pm: p.pm,
        });
        if (P.log.length > 120) P.log.shift();
        this.maybeInjure(p, box.teamId);
      }
    }
  }

  maybeInjure(line, teamId) {
    if (!this.s.settings.injuries) return;
    const P = this.s.players[line.id];
    if (P.inj && P.inj.games > 0) return;
    const risk = 0.0065 * (line.sec / 60 / 30);
    if (this.rng() >= risk) return;
    const r = this.rng();
    const games = r < 0.55 ? 1 + Math.floor(this.rng() * 2) : r < 0.82 ? 3 + Math.floor(this.rng() * 5) : r < 0.96 ? 8 + Math.floor(this.rng() * 12) : 20 + Math.floor(this.rng() * 25);
    const type = games <= 2 && this.rng() < 0.3 ? 'load management' : INJURIES[Math.floor(this.rng() * (INJURIES.length - 1))];
    P.inj = { games, type, since: this.now() };
    const p = this.pl(line.id);
    const text = `${p.name} (${type}) is out ${games === 1 ? '1 game' : `${games} games`}.`;
    this.notify(teamId, 'injury', `Injury: ${text}`, `#/player/${p.id}`);
    if (p.ovr >= 78 || games >= 10) this.news('injury', text, `#/player/${p.id}`);
  }

  recordStandings(r) {
    const h = this.team(r.home);
    const a = this.team(r.away);
    const hw = r.hs > r.as;
    const upd = (t, won, home, pf, pa) => {
      const R = t.rec;
      if (won) { R.w++; if (home) R.hw++; else R.aw++; } else { R.l++; if (home) R.hl++; else R.al++; }
      R.pf += pf;
      R.pa += pa;
      R.streak = won ? (R.streak > 0 ? R.streak + 1 : 1) : (R.streak < 0 ? R.streak - 1 : -1);
      R.last.push(won ? 'W' : 'L');
      if (R.last.length > 10) R.last.shift();
    };
    upd(h, hw, true, r.hs, r.as);
    upd(a, !hw, false, r.as, r.hs);
  }

  gameNotifications(game, sum) {
    const link = `#/game/${game.id}`;
    for (const side of ['home', 'away']) {
      const box = game[side];
      const other = game[side === 'home' ? 'away' : 'home'];
      const won = sum.winner === box.teamId;
      const star = [...box.players].sort((x, y) => y.pts - x.pts)[0];
      const ot = game.ot ? ` (${game.ot > 1 ? game.ot : ''}OT)` : '';
      this.notify(box.teamId, 'game', `${won ? 'W' : 'L'} ${box.score}-${other.score}${ot} ${side === 'home' ? 'vs' : '@'} ${other.name}. ${star.name}: ${star.pts} pts, ${star.orb + star.drb} reb, ${star.ast} ast.`, link);
      for (const p of box.players) {
        if (p.dnp) continue;
        const reb = p.orb + p.drb;
        const real = this.pl(p.id);
        const tens = [p.pts, reb, p.ast, p.stl, p.blk].filter((x) => x >= 10).length;
        const line = `${p.pts} pts, ${reb} reb, ${p.ast} ast`;
        if (p.pts >= 50) this.news('big', `🔥 ${p.name} drops ${p.pts} for ${box.name}! (${p.fgm}-${p.fga} FG, ${p.tpm} threes)`, link);
        else if (tens >= 3) this.news('big', `${p.name} records a triple-double for ${box.name}: ${line}${p.stl >= 10 || p.blk >= 10 ? `, ${p.stl} stl, ${p.blk} blk` : ''}.`, link);
        else if (real && p.pts >= Math.max(30, real.pts + 17)) this.news('big', `Breakout game: ${p.name} pours in ${p.pts} (averages ${round1(real.pts)} in real life).`, link);
        else if (reb >= 22 || p.ast >= 18 || p.blk >= 8 || p.stl >= 7) this.news('big', `Monster line for ${p.name}: ${line}, ${p.stl} stl, ${p.blk} blk.`, link);
        if (p.fouledOut && this.team(box.teamId).kind === 'human') this.notify(box.teamId, 'game', `${p.name} fouled out in ${Math.round(p.sec / 60)} minutes.`, link);
      }
    }
    if (game.ot >= 2) this.news('big', `${game.ot}OT thriller: ${game.home.name} ${game.home.score}, ${game.away.name} ${game.away.score}.`, link);
  }

  simDay() {
    const s = this.s;
    if (s.phase !== 'season' && s.phase !== 'playoffs') return null;
    this.expireCpuOffers();
    this.cpuMaintenance();
    const out = new Set(Object.entries(s.players).filter(([, P]) => P.inj && P.inj.games > 0).map(([id]) => id));
    let day;
    if (s.phase === 'season') {
      const round = s.schedule[s.round];
      const label = `Game ${s.round + 1}`;
      const ids = round.map((g, i) => this.playGame(`s${s.round}-${i}`, g.home, g.away, label, false).id);
      day = { label, at: this.now(), games: ids };
      s.days.push(day);
      s.round++;
      if (s.settings.tradeDeadline > 0 && s.round === s.settings.tradeDeadline) {
        this.news('league', 'The trade deadline has passed. Rosters are set except free agency.');
        this.notifyAll('league', 'Trade deadline has passed.', '#/trades');
        for (const t of s.trades) if (t.status === 'pending') { t.status = 'void'; t.note = 'Trade deadline passed.'; t.resolvedAt = this.now(); }
      }
      this.cpuProposeTrades();
    } else {
      day = this.playoffDay();
    }
    for (const pid of out) {
      const P = s.players[pid];
      if (!P.inj) continue;
      P.inj.games--;
      if (P.inj.games <= 0) {
        const p = this.pl(pid);
        P.inj = null;
        if (P.owner) this.notify(P.owner, 'injury', `${p.name} is healthy and available again.`, `#/player/${pid}`);
      }
    }
    if (s.phase === 'season' && s.round >= s.schedule.length) this.startPlayoffs();
    this.saveNow();
    this.emit('update', { kind: 'games' });
    return day;
  }

  startPlayoffs() {
    const s = this.s;
    const n = Math.min(s.settings.playoffTeams, s.teams.length);
    const seeds = this.standings().slice(0, n).map((t) => t.id);
    const pairs = [];
    for (let i = 0; i < n / 2; i++) pairs.push([seeds[i], seeds[n - 1 - i], i + 1, n - i]);
    // Bracket order so 1 and 2 can only meet in the final.
    const ordered = n === 8 ? [pairs[0], pairs[3], pairs[1], pairs[2]] : pairs;
    s.playoffs = { current: 0, seeds, rounds: [ordered.map(([hi, lo, hs, ls], i) => this.newSeries(hi, lo, hs, ls, 0, i))] };
    s.phase = 'playoffs';
    const champ = this.standings()[0];
    this.news('playoffs', `Regular season over! ${champ.name} finish with the best record (${champ.rec.w}-${champ.rec.l}). Playoffs begin next game day.`, '#/playoffs');
    this.notifyAll('playoffs', 'The playoffs are set!', '#/playoffs');
  }

  newSeries(hi, lo, hiSeed, loSeed, round, idx) {
    return { id: `p${round}-${idx}`, hi, lo, hiSeed, loSeed, wins: { [hi]: 0, [lo]: 0 }, games: [], winner: null };
  }

  playoffDay() {
    const s = this.s;
    const P = s.playoffs;
    const round = P.rounds[P.current];
    const need = Math.ceil(s.settings.seriesLength / 2);
    const names = { 1: 'Finals', 2: 'Semifinals', 3: 'Quarterfinals' };
    const left = P.rounds[0].length * 2 / Math.pow(2, P.current);
    const rname = names[Math.log2(left)] || `Round ${P.current + 1}`;
    const ids = [];
    for (const ser of round) {
      if (ser.winner) continue;
      const k = ser.games.length;
      const hiHome = [0, 1, 4, 6].includes(k) || s.settings.seriesLength === 1;
      const home = hiHome ? ser.hi : ser.lo;
      const away = hiHome ? ser.lo : ser.hi;
      const label = `${rname} G${k + 1}`;
      const r = this.playGame(`${ser.id}-${k}`, home, away, label, true);
      ser.games.push(r.id);
      ids.push(r.id);
      ser.wins[r.winner]++;
      if (ser.wins[r.winner] >= need) {
        ser.winner = r.winner;
        const loser = r.winner === ser.hi ? ser.lo : ser.hi;
        const text = `${this.team(r.winner).name} beat ${this.team(loser).name} ${ser.wins[r.winner]}-${ser.wins[loser]} in the ${rname}.`;
        this.news('playoffs', text, '#/playoffs');
        this.notifyAll('playoffs', text, '#/playoffs');
      }
    }
    const day = { label: `Playoffs: ${rname}`, at: this.now(), games: ids };
    s.days.push(day);
    if (round.every((x) => x.winner)) {
      if (round.length === 1) {
        s.champion = round[0].winner;
        s.phase = 'complete';
        s.nextTickAt = null;
        const t = this.team(s.champion);
        this.news('playoffs', `🏆 ${t.name} (${t.owner}) are the champions!`, '#/playoffs');
        this.notifyAll('playoffs', `🏆 ${t.name} won the championship!`, '#/playoffs');
      } else {
        const next = [];
        for (let i = 0; i < round.length; i += 2) {
          const a = round[i]; const b = round[i + 1];
          const sa = a.winner === a.hi ? a.hiSeed : a.loSeed;
          const sb = b.winner === b.hi ? b.hiSeed : b.loSeed;
          const [hi, lo, hs, ls] = sa <= sb ? [a.winner, b.winner, sa, sb] : [b.winner, a.winner, sb, sa];
          next.push(this.newSeries(hi, lo, hs, ls, P.current + 1, i / 2));
        }
        P.rounds.push(next);
        P.current++;
      }
    }
    return day;
  }

  newSeason(by) {
    if (!this.isCommish(by)) fail('Only the commissioner can do that', 403);
    if (this.s.phase !== 'complete') fail('The current season is not over yet');
    const s = this.s;
    s.season++;
    for (const P of Object.values(s.players)) { P.st = emptyLine(); P.ps = emptyLine(); P.log = []; P.inj = null; }
    for (const t of s.teams) t.rec = { w: 0, l: 0, hw: 0, hl: 0, aw: 0, al: 0, pf: 0, pa: 0, streak: 0, last: [] };
    s.days = [];
    s.results = {};
    s.playoffs = null;
    s.champion = null;
    s.draft = s.draft ? { ...s.draft, deadline: null } : null;
    s.phase = 'season';
    s.schedule = makeSchedule(s.teams.map((t) => t.id), s.settings.seasonGames, this.rng);
    s.round = 0;
    for (const t of s.teams) if (t.lineup.auto) this.autoLineup(t);
    const tick = this.tickMs();
    s.nextTickAt = Math.ceil(this.now() / tick) * tick;
    this.news('league', `Season ${s.season} is here! Rosters carry over — trade and sign away.`);
    this.notifyAll('league', `Season ${s.season} starts at the next game time.`, '#/');
    this.changed('league');
  }

  // ------------------------------------------------------------------ commissioner
  simNow(by, n) {
    if (!this.isCommish(by)) fail('Only the commissioner can do that', 403);
    const count = Math.max(1, Math.min(100, Number(n) || 1));
    let played = 0;
    for (let i = 0; i < count && (this.s.phase === 'season' || this.s.phase === 'playoffs'); i++) { this.simDay(); played++; }
    if (this.s.nextTickAt) {
      const tick = this.tickMs();
      this.s.nextTickAt = Math.ceil((this.now() + 1) / tick) * tick;
    }
    this.changed('games');
    return played;
  }

  setPaused(by, paused) {
    if (!this.isCommish(by)) fail('Only the commissioner can do that', 403);
    this.s.paused = !!paused;
    if (!paused && this.s.nextTickAt && this.s.nextTickAt < this.now()) {
      const tick = this.tickMs();
      this.s.nextTickAt = Math.ceil(this.now() / tick) * tick;
    }
    this.news('league', paused ? 'The commissioner paused the season.' : 'The season has resumed.');
    this.changed('league');
  }

  updateSettings(by, body) {
    if (!this.isCommish(by)) fail('Only the commissioner can do that', 403);
    const s = this.s.settings;
    if (body.tickMinutes != null) {
      s.tickMinutes = Math.max(1, Math.min(1440, Number(body.tickMinutes) || 60));
      if (this.s.nextTickAt) { const tick = this.tickMs(); this.s.nextTickAt = Math.ceil(this.now() / tick) * tick; }
    }
    if (body.pickSeconds != null) s.pickSeconds = Math.max(0, Math.min(600, Number(body.pickSeconds) || 0));
    if (body.injuries != null) s.injuries = !!body.injuries;
    if (body.tradeDeadline != null) s.tradeDeadline = Math.max(0, Math.min(s.seasonGames, Number(body.tradeDeadline) || 0));
    this.changed('league');
  }

  // ------------------------------------------------------------------ loop
  /** Called about once a second by the server. Runs draft clocks and the hourly games. */
  tick() {
    const s = this.s;
    if (!s) return;
    if (s.phase === 'draft' && s.draft.deadline && this.now() >= s.draft.deadline) {
      const team = this.team(this.pickerAt(s.draft.pickNo));
      const p = this.bestAvailableFor(team);
      if (p) this.doPick(team, p, team.kind === 'human');
      return;
    }
    if ((s.phase === 'season' || s.phase === 'playoffs') && !s.paused && s.nextTickAt && this.now() >= s.nextTickAt) {
      this.simDay();
      if (s.nextTickAt) s.nextTickAt += this.tickMs();
      this.saveNow();
    }
  }

  notificationsView(team) { return this.s.notifications[team.id] || []; }
  markRead(team) {
    for (const n of this.s.notifications[team.id] || []) n.read = true;
    this.save();
  }
}

module.exports = { League, LeagueError, DEFAULT_SETTINGS, averages };
