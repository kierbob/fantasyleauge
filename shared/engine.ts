import { clamp } from './catalog.ts';
import type { Box, Catalog, Game, League, Zone } from './types.ts';
import { gameElapsed, updateRotation } from './rotations.ts';

export function random(g: Game) {
  let t = g.rng += 0x6d2b79f5;
  t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61);
  g.rng >>>= 0;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
}
function pick<T>(g: Game, items: T[], weight: (item: T) => number): T {
  const weights = items.map(x => Math.max(.0001, weight(x)));
  let n = random(g) * weights.reduce((a, b) => a + b, 0);
  return items[weights.findIndex(w => (n -= w) < 0)] ?? items[items.length - 1];
}
export function box(id: string): Box {
  return {id, seconds: 0, pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, orb: 0, drb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, plusMinus: 0, energy: 1};
}
export function makeGame(id: string, day: number, home: string, away: string, seed: number): Game {
  return {id, day, home, away, rng: seed, status: 'scheduled', quarter: 1, clock: 720,
    possession: home, score: {[home]: 0, [away]: 0}, quarters: {[home]: [0], [away]: [0]},
    boxes: {}, onCourt: {}, plays: [], shots: [], timeouts: {[home]: 7, [away]: 7},
    teamFouls: {[home]: 0, [away]: 0}, paused: false, timeoutTicks: 0, speed: 1, wallBudget: 0, lastSub: 0};
}
function log(g: Game, team: string, text: string, kind = 'play') {
  g.plays.push({id: g.plays.length + 1, quarter: g.quarter, clock: g.clock, team, text, kind, home: g.score[g.home], away: g.score[g.away]});
}
export function startGame(g: Game, league: League) {
  if (g.status !== 'scheduled') throw Error('Game has already started');
  for (const team of [g.home, g.away]) {
    g.boxes[team] = Object.fromEntries(league.rosters[team].map(id => [id, box(id)]));
    g.onCourt[team] = [...league.rotations[team].starters];
  }
  g.status = 'live'; g.possession = random(g) < .5 ? g.home : g.away;
  log(g, g.possession, 'Opening tip. A new chapter starts here.', 'period');
}
export function callTimeout(g: Game, team: string) {
  if (g.status !== 'live' || ![g.home, g.away].includes(team) || g.timeouts[team] <= 0 || g.timeoutTicks > 0) throw Error('Timeout is unavailable');
  g.timeouts[team]--; g.timeoutTicks = 20;
  for (const t of [g.home, g.away]) for (const b of Object.values(g.boxes[t])) b.energy = Math.min(1, b.energy + .12);
  log(g, team, `${team} calls timeout. Players regroup on the bench.`, 'timeout');
}
export function automaticTimeout(g:Game) {
  if(g.status!=='live'||g.timeoutTicks>0)return;
  const last=g.plays.findLast(p=>p.kind==='timeout');
  const eventElapsed=last?Math.min(last.quarter-1,4)*720+Math.max(0,last.quarter-5)*300+(last.quarter>4?300:720)-last.clock:-Infinity;
  if(gameElapsed(g)-eventElapsed<120)return;
  for(const team of [g.home,g.away]){
    if(!g.timeouts[team])continue;
    const other=team===g.home?g.away:g.home;
    const recent=g.plays.filter(p=>['score','three'].includes(p.kind)).slice(-4);
    const run=recent.length===4&&recent.every(p=>p.team===other);
    const fatigue=g.onCourt[team].reduce((n,id)=>n+g.boxes[team][id].energy,0)/5;
    const behind=g.score[other]-g.score[team];
    const clutch=g.quarter>=4&&g.clock<=120&&behind>=4&&behind<=12;
    if((run&&behind>=6)||(fatigue<.68&&g.timeouts[team]>2)||clutch){callTimeout(g,team);return;}
  }
}
export function simulatePossession(g: Game, league: League, catalog: Catalog) {
  if (g.status !== 'live' || g.paused) return;
  const offense = g.possession, defense = offense === g.home ? g.away : g.home;
  for (const t of [g.home, g.away]) updateRotation(g, t, league.rotations[t], catalog);
  const attackers = g.onCourt[offense], defenders = g.onCourt[defense];
  const models = catalog.models;
  const name = (id: string) => catalog.players.get(id)?.fullName ?? id;
  // Replace stable IDs in substitution events with names at the presentation boundary.
  const energy = (id: string, team: string) => g.boxes[team][id].energy;
  const strategy = league.rotations[offense].strategy;
  const late = g.quarter >= 4 && g.clock < 120 && Math.abs(g.score[offense] - g.score[defense]) <= 8;
  const trailing = g.score[offense] < g.score[defense];
  const seconds = Math.min(g.clock, late && trailing ? 4 + Math.floor(random(g) * 8) : (strategy === 'pace' ? 6 : 8) + Math.floor(random(g) * 10));
  g.clock -= seconds;
  for (const t of [offense, defense]) for (const b of Object.values(g.boxes[t])) {
    if (g.onCourt[t].includes(b.id)) { b.seconds += seconds; b.energy = Math.max(.35, b.energy - seconds * (strategy === 'pace' ? .0007 : .00055)); }
    else b.energy = Math.min(1, b.energy + seconds * .0015);
  }
  const shooter = pick(g, attackers, id => models[id].shotRate * (.65 + energy(id, offense) * .35));
  const m = models[shooter], sb = g.boxes[offense][shooter];
  const defender = pick(g, defenders, id => .1 + models[id].stealRate + models[id].blockRate);
  const db = g.boxes[defense][defender];
  const points = (id: string, n: number) => {
    g.boxes[offense][id].pts += n; g.score[offense] += n; g.quarters[offense][g.quarter - 1] += n;
    for (const pid of attackers) g.boxes[offense][pid].plusMinus += n;
    for (const pid of defenders) g.boxes[defense][pid].plusMinus -= n;
  };
  const freeThrows = (n: number) => {
    let made = 0, lastMade = false;
    for (let i = 0; i < n; i++) { sb.fta++; lastMade = random(g) < m.ftPct * (.97 + .03 * sb.energy); if (lastMade) { sb.ftm++; points(shooter, 1); made++; } }
    log(g, offense, `${name(shooter)} goes ${made}/${n} at the line.`, 'free-throw');
    // Last missed free throw is live; earlier misses do not create a rebound.
    return lastMade;
  };
  const rebound = () => {
    const attackWeight = attackers.reduce((n, id) => n + models[id].orbRate, 0);
    const defendWeight = defenders.reduce((n, id) => n + models[id].drbRate, 0);
    if (random(g) < clamp(attackWeight / Math.max(.01, attackWeight + defendWeight), .1, .45)) {
      const id = pick(g, attackers, id => models[id].orbRate * energy(id, offense)); g.boxes[offense][id].orb++;
      log(g, offense, `${name(id)} keeps it alive. Offensive rebound.`, 'rebound');
      return true;
    }
    const id = pick(g, defenders, id => models[id].drbRate * energy(id, defense)); g.boxes[defense][id].drb++;
    log(g, defense, `${name(id)} collects the defensive rebound.`, 'rebound'); return false;
  };
  let retain = false;
  const teamTov = attackers.reduce((n, id) => n + models[id].turnoverRate, 0);
  const teamShots = attackers.reduce((n, id) => n + models[id].shotRate + .44 * models[id].ftRate, 0);
  const stealPressure = defenders.reduce((n, id) => n + models[id].stealRate, 0);
  if (random(g) < clamp(teamTov / (teamShots + teamTov) * (1.12 - sb.energy * .12), .04, .22)) {
    const offender = pick(g, attackers, id => models[id].turnoverRate); g.boxes[offense][offender].tov++;
    if (random(g) < clamp(stealPressure / Math.max(.01, teamTov), .25, .8)) {
      const thief = pick(g, defenders, id => models[id].stealRate); g.boxes[defense][thief].stl++;
      log(g, defense, `${name(thief)} picks ${name(offender)}'s pocket.`, 'steal');
    } else log(g, offense, `${name(offender)} turns it over.`, 'turnover');
  } else {
    const threeChance = clamp(m.threeRate * (strategy === 'perimeter' ? 1.35 : strategy === 'inside' ? .65 : 1) + (late && trailing ? .12 : 0), 0, .95);
    const three = random(g) < threeChance;
    const zoneOptions = m.zones.filter(z => (z.name === 'aboveTheBreak3' || z.name === 'corner3') === three);
    const zone = pick(g, zoneOptions, z => z.weight);
    const distanceByZone: Record<Zone, [number, number]> = {restrictedArea:[1,4], paintNonRestricted:[5,13], midRange:[14,22], aboveTheBreak3:[24,31], corner3:[22,24]};
    const [minD, maxD] = distanceByZone[zone.name];
    const distance = minD + Math.floor(random(g) * (maxD - minD + 1));
    const defenseRating = defenders.reduce((a, id) => a + models[id].defense, 0) / 5;
    const chance = clamp((three ? m.threePct : m.twoPct) * .7 + zone.pct * .3 + (defenseRating - 112) * .0025 - (1 - sb.energy) * .09, .08, .9);
    const foulChance = clamp(m.ftRate / Math.max(.1, m.shotRate) / (three ? 5 : 2.7), .015, .22);
    const foul = random(g) < foulChance;
    const nonShooting = !foul && random(g) < .055;
    if (foul || nonShooting) {
      db.pf++; g.teamFouls[defense]++;
      log(g, defense, `${name(defender)} · ${foul ? 'shooting' : 'personal'} foul (${db.pf}).${db.pf === 6 ? ' Fouled out.' : ''}`, 'foul');
    }
    if (nonShooting) {
      if (g.teamFouls[defense] >= 5) { if (!freeThrows(2)) retain = rebound(); } else retain = true;
    } else {
      const blockChance = three ? .009 : clamp(defenders.reduce((n, id) => n + models[id].blockRate, 0) / Math.max(.1, teamShots), .01, .17);
      const blocked = !foul && random(g) < blockChance;
      const made = !blocked && random(g) < (foul ? chance * .55 : chance);
      if (!foul || made) {
        sb.fga++; if (three) sb.tpa++;
        const angle = zone.name === 'corner3' ? (random(g) < .5 ? -1.48 : 1.48) : (random(g) - .5) * 2.5;
        g.shots.push({player: shooter, team: offense, x: Math.sin(angle) * distance, y: Math.cos(angle) * distance, distance, made, value: three ? 3 : 2});
      }
      if (made) {
        sb.fgm++; if (three) sb.tpm++; points(shooter, three ? 3 : 2);
        const assistChance = clamp(attackers.reduce((n, id) => n + models[id].assistRate, 0) / Math.max(.01, teamShots * .47), .3, .85);
        let assist = '';
        if (random(g) < assistChance) { const id = pick(g, attackers.filter(id => id !== shooter), id => models[id].assistRate); g.boxes[offense][id].ast++; assist = ` · ${name(id)} assist`; }
        log(g, offense, `${name(shooter)} · ${three ? '3PT' : '2PT'} from ${distance} ft${assist}${foul ? ' · AND ONE!' : ''}`, three ? 'three' : 'score');
      } else if (!foul) {
        if (blocked) { const id = pick(g, defenders, id => models[id].blockRate); g.boxes[defense][id].blk++; log(g, defense, `${name(id)} rejects ${name(shooter)}!`, 'block'); }
        else log(g, offense, `${name(shooter)} misses a ${distance} ft ${three ? 'three' : 'jumper'}.`, 'miss');
        retain = rebound();
      }
      if (foul && !freeThrows(made ? 1 : three ? 3 : 2)) retain = rebound();
    }
  }
  g.possession = retain ? offense : defense;
  if (g.clock === 0) {
    if (g.quarter >= 4 && g.score[g.home] !== g.score[g.away]) { g.status = 'final'; log(g, '', 'Final buzzer. Another game in your league’s history.', 'final'); return; }
    log(g, '', `End of ${g.quarter > 4 ? 'overtime' : `quarter ${g.quarter}`}.`, 'period');
    g.quarter++; g.clock = g.quarter > 4 ? 300 : 720;
    for (const t of [g.home, g.away]) {
      g.quarters[t].push(0); g.teamFouls[t] = 0;
      if (g.quarter > 4) g.timeouts[t] = 2;
      for (const b of Object.values(g.boxes[t])) b.energy = Math.min(1, b.energy + (g.quarter === 3 ? .3 : .15));
    }
    log(g, '', g.quarter > 4 ? 'All square. We’re going to overtime.' : `Quarter ${g.quarter} begins.`, 'period');
  } else automaticTimeout(g);
}
