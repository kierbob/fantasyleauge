import { randomBytes, randomUUID } from 'node:crypto';
import { makeGame } from './engine.ts';
import { POSITIONS } from './types.ts';
import type { Catalog, League, Rotation, Trade } from './types.ts';

export function assert(condition: unknown, message: string): asserts condition { if (!condition) throw Error(message); }
export function autoRotation(ids: string[], catalog: Catalog): Rotation {
  const sorted = [...ids].sort((a, b) => catalog.models[b].overall - catalog.models[a].overall);
  const starters: string[] = [];
  for (const position of POSITIONS) {
    const id = sorted.find(id => !starters.includes(id) && catalog.players.get(id)!.position.split('/').includes(position)) ?? sorted.find(id => !starters.includes(id));
    if (id) starters.push(id);
  }
  const bench = sorted.filter(id => !starters.includes(id)).slice(0, 5);
  const minutes = Object.fromEntries(ids.map(id => [id, 0]));
  starters.forEach(id => minutes[id] = 32);
  bench.forEach((id, i) => minutes[id] = Math.floor(80 / bench.length) + (i < 80 % bench.length ? 1 : 0));
  return {starters, minutes, strategy: 'balanced'};
}
export function validateRotation(rotation: Rotation, roster: string[]) {
  assert(rotation && Array.isArray(rotation.starters) && rotation.starters.length === 5 && new Set(rotation.starters).size === 5, 'Select five distinct starters');
  assert(['balanced', 'pace', 'perimeter', 'inside'].includes(rotation.strategy), 'Invalid strategy');
  assert(rotation.minutes && typeof rotation.minutes === 'object', 'Minutes are required');
  assert(Object.keys(rotation.minutes).length === roster.length && Object.keys(rotation.minutes).every(id => roster.includes(id)), 'Minutes must match your roster');
  assert(rotation.starters.every(id => roster.includes(id) && rotation.minutes[id] > 0), 'Starters need positive minutes and must belong to your team');
  const values = roster.map(id => rotation.minutes[id]);
  assert(values.every(n => Number.isInteger(n) && n >= 0 && n <= 48), 'Minutes must be whole numbers between 0 and 48');
  assert(values.reduce((a,b) => a+b, 0) === 240, 'Your rotation must total exactly 240 minutes');
  assert(values.filter(n => n > 0).length >= 8, 'Use at least eight players in your rotation');
}
export function createLeague(name: string, team: string, user: {id: string; name: string}, catalog: Catalog, mode: League['mode'], hour = 19): League {
  assert(typeof name === 'string' && name.trim().length >= 3 && name.length <= 60, 'League name must be 3–60 characters');
  assert(catalog.data.teams[team], 'Unknown team');
  assert(mode === 'solo' || mode === 'multiplayer', 'Invalid league mode');
  assert(Number.isInteger(hour) && hour >= 0 && hour < 24, 'Choose a daily tip-off hour (UTC)');
  const id = randomUUID();
  const rosters = Object.fromEntries(Object.entries(catalog.data.teams).map(([key,t]) => [key, t.players.map(p => p.playerId)]));
  const league: League = {id, code: randomBytes(6).toString('hex').toUpperCase(), name: name.trim(), owner: user.id, mode,
    created: new Date().toISOString(), startDate: new Date().toISOString().slice(0,10), gameHour: hour,
    members: [{userId: user.id, name: user.name, team}], rosters,
    freeAgents: catalog.data.freeAgents.map(p => p.playerId),
    rotations: Object.fromEntries(Object.entries(rosters).map(([t, ids]) => [t, autoRotation(ids, catalog)])),
    games: [], trades: [], activity: [], revision: 0};
  // A custom, two-leg round robin: every team plays once daily for 58 days.
  generateSchedule(league);
  activity(league, `${user.name} founded the league and took control of ${team}.`);
  return league;
}
export function generateSchedule(league: League) {
  league.games=[];
  const wheel = Object.keys(league.rosters);
  assert(wheel.length % 2 === 0, 'Round robin requires an even number of teams');
  for (let day = 0; day < wheel.length - 1; day++) {
    for (let i = 0; i < wheel.length / 2; i++) {
      const a = wheel[i], b = wheel[wheel.length - 1 - i];
      const [home, away] = day % 2 ? [a,b] : [b,a];
      const seed = randomBytes(4).readUInt32LE();
      league.games.push(makeGame(`${day}-${i}`, day, home, away, seed));
      league.games.push(makeGame(`${day+wheel.length-1}-${i}`, day + wheel.length - 1, away, home, seed ^ 0xa36f1c2d));
    }
    wheel.splice(1, 0, wheel.pop()!);
  }
  league.games.sort((a,b) => a.day-b.day || a.id.localeCompare(b.id));
}
export function activity(l: League, text: string) { l.activity.unshift({text, at: new Date().toISOString()}); l.activity = l.activity.slice(0,100); }
export function assertUnlocked(l: League, ...teams: string[]) { assert(!l.games.some(g => g.status === 'live' && teams.some(t => g.home === t || g.away === t)), 'Roster moves are locked while either team has a live game'); }
export function ensureRosterIntegrity(l: League, c: Catalog) {
  const ids = [...Object.values(l.rosters).flat(), ...l.freeAgents];
  assert(ids.length === c.players.size && new Set(ids).size === c.players.size && ids.every(id => c.players.has(id)), 'Player ownership invariant failed');
  for (const roster of Object.values(l.rosters)) assert(roster.length >= (l.draft && l.draft.status!=='complete'?0:8) && roster.length <= 20, 'Rosters must contain 8–20 players after the draft');
}
export function tradeValue(ids: string[], c: Catalog) {
  return ids.reduce((value, id) => { const m = c.models[id]; return value + Math.pow(Math.max(5, m.overall - 40), 2) * (m.estimated ? .85 : 1); }, 0);
}
export function evaluateAI(l: League, t: Pick<Trade, 'from'|'to'|'give'|'receive'>, c: Catalog) {
  const incoming = tradeValue(t.give,c), outgoing = tradeValue(t.receive,c);
  const bestOut = Math.max(...t.receive.map(id => c.models[id].overall));
  const bestIn = Math.max(...t.give.map(id => c.models[id].overall));
  const rated = Object.values(c.models).filter(m=>!m.estimated).map(m=>m.overall).sort((a,b)=>b-a);
  const cornerstone = rated[Math.max(0,Math.floor(rated.length*.05))];
  if (bestOut >= cornerstone && bestIn < bestOut - 3) return {accepted:false, reason:'A cornerstone player requires a comparable centerpiece. Bundling reserves does not replace star value.'};
  if (t.give.length > t.receive.length + 1) return {accepted:false, reason:'The AI will not accept a package of fringe players for a smaller core.'};
  const remaining = l.rosters[t.to].filter(id => !t.receive.includes(id)).concat(t.give);
  for (const pos of POSITIONS) {
    const supports = (id:string) => c.players.get(id)!.position.split('/').includes(pos);
    if (l.rosters[t.to].some(supports) && !remaining.some(supports)) return {accepted:false, reason:`The deal removes all ${pos} coverage from the AI roster.`};
  }
  if (incoming < outgoing * 1.08) return {accepted:false, reason:`The AI needs at least an 8% value improvement. This offer returns ${Math.round(incoming/outgoing*100)}% of its outgoing value.`};
  return {accepted:true, reason:'Accepted: value improves by at least 8%, star protection passes, and positional coverage is retained.'};
}
export function validateTrade(l: League, t: Pick<Trade,'from'|'to'|'give'|'receive'>) {
  assert(l.rosters[t.from] && l.rosters[t.to] && t.from !== t.to, 'Choose another team');
  assert(Array.isArray(t.give) && Array.isArray(t.receive) && t.give.length > 0 && t.receive.length > 0 && t.give.length <= 5 && t.receive.length <= 5, 'Trade 1–5 players on each side');
  assert(new Set([...t.give, ...t.receive]).size === t.give.length + t.receive.length, 'Duplicate players in trade');
  assert(t.give.every(id => l.rosters[t.from].includes(id)) && t.receive.every(id => l.rosters[t.to].includes(id)), 'A player in this offer has changed teams');
  assertUnlocked(l, t.from, t.to);
  const fromSize = l.rosters[t.from].length - t.give.length + t.receive.length;
  const toSize = l.rosters[t.to].length - t.receive.length + t.give.length;
  assert([fromSize,toSize].every(n => n >= 8 && n <= 20), 'Both rosters must retain 8–20 players');
}
export function executeTrade(l: League, t: Trade, c: Catalog) {
  validateTrade(l,t);
  l.rosters[t.from] = l.rosters[t.from].filter(id => !t.give.includes(id)).concat(t.receive);
  l.rosters[t.to] = l.rosters[t.to].filter(id => !t.receive.includes(id)).concat(t.give);
  l.rotations[t.from] = autoRotation(l.rosters[t.from],c); l.rotations[t.to] = autoRotation(l.rosters[t.to],c);
  t.status='accepted';
  // Pending offers involving transferred players become stale immediately.
  for (const other of l.trades) if (other.id !== t.id && other.status === 'pending' && [...other.give,...other.receive].some(id => [...t.give,...t.receive].includes(id))) { other.status='cancelled'; other.reason='A player changed teams in another transaction.'; }
  ensureRosterIntegrity(l,c);
  activity(l, `${t.from} and ${t.to} completed a trade. Rotations were reset; review your minutes.`);
}
export function tipoffAt(l: League, day: number) { return Date.parse(`${l.startDate}T00:00:00Z`) + day * 86400000 + l.gameHour * 3600000; }
