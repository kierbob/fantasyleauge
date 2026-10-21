import { clamp } from './catalog.ts';
import type { Catalog, Game, Rotation } from './types.ts';

export function gameElapsed(g: Game) {
  return Math.min(g.quarter - 1, 4) * 720 + Math.max(0, g.quarter - 5) * 300 + (g.quarter > 4 ? 300 : 720) - g.clock;
}

// This state is saved with the game. It also initializes lazily for older saves.
function stintState(g: Game, team: string) {
  const now = gameElapsed(g);
  g.rotationState ??= {};
  return g.rotationState[team] ??= {
    lastChange: now - 45,
    onSince: Object.fromEntries(g.onCourt[team].map(id => [id, now])),
    offSince: Object.fromEntries(Object.keys(g.boxes[team]).filter(id => !g.onCourt[team].includes(id)).map(id => [id, 0])),
  };
}

function inFoulTrouble(g: Game, fouls: number) {
  if (g.quarter >= 4 && g.clock <= 360) return false;
  return fouls >= Math.min(5, g.quarter + 1);
}

function plannedStint(id: string, rotation: Rotation) {
  // Minutes describe a player's workload, not membership in a five-man unit.
  // Slightly different stint lengths prevent equal minute targets synchronizing.
  const offset = [...id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0) % 91 - 45;
  return clamp(rotation.minutes[id] * 60 / (rotation.starters.includes(id) ? 5 : 4) + offset, 150, 540);
}

function coverage(lineup: string[], catalog: Catalog) {
  const positions = lineup.flatMap(id => catalog.players.get(id)!.position.split('/'));
  return Number(positions.some(p => ['PG','SG','G'].includes(p))) +
    Number(positions.some(p => ['SG','SF','F'].includes(p))) +
    Number(positions.some(p => ['PF','C','F'].includes(p)));
}

/** Makes individual substitutions, retaining continuity instead of rebuilding a unit. */
export function updateRotation(g: Game, team: string, rotation: Rotation, catalog: Catalog) {
  const now = gameElapsed(g), state = stintState(g, team), boxes = g.boxes[team];
  const before = [...g.onCourt[team]];
  const roster = Object.keys(boxes);
  const active = roster.filter(id => rotation.minutes[id] > 0 && boxes[id].pf < 6);
  // Healthy reserves outside the rotation take precedence over disqualified players.
  if (active.length < 5) for (const id of roster) if (boxes[id].pf < 6 && !active.includes(id)) active.push(id);
  if (active.length < 5) for (const id of [...roster].sort((a,b) => boxes[a].pf - boxes[b].pf)) {
    if (!active.includes(id)) active.push(id);
    if (active.length === 5) break;
  }
  const forced = before.filter(id => !active.includes(id));
  const trouble = before.filter(id => inFoulTrouble(g, boxes[id].pf));
  const emergency = forced.length > 0 || trouble.length > 0;
  if (!emergency && now - state.lastChange < 45) return [];
  const clutch = g.quarter >= 4 && g.clock <= 180 && Math.abs(g.score[g.home] - g.score[g.away]) <= 12;
  const remaining = g.quarter > 4 ? g.clock : Math.max(1, 2880 - now);
  const deficit = (id: string) => rotation.minutes[id] * 60 * Math.min(now + 120,2880) / 2880 - boxes[id].seconds;
  const needsAllRemaining = (id: string) => rotation.minutes[id] * 60 - boxes[id].seconds >= remaining * .93;
  const coreAvailable = rotation.starters.filter(id => active.includes(id) && !inFoulTrouble(g, boxes[id].pf));
  const preserveCore = coreAvailable.length >= 2 && rotation.starters.reduce((sum,id) => sum + rotation.minutes[id], 0) >= 120;
  const changes: {incoming:string;outgoing:string;reason:string}[] = [];
  // Ordinary windows replace one player. Only disqualifications may require more.
  const limit = Math.max(1, forced.length);
  for (let i = 0; i < limit; i++) {
    const current = g.onCourt[team];
    const bench = active.filter(id => !current.includes(id));
    let best: {incoming:string;outgoing:string;gain:number;reason:string} | undefined;
    for (const outgoing of current) {
      const invalid = !active.includes(outgoing);
      const foul = inFoulTrouble(g, boxes[outgoing].pf);
      const stint = now - (state.onSince[outgoing] ?? now);
      const targetMet = g.quarter <= 4 && boxes[outgoing].seconds >= rotation.minutes[outgoing] * 60;
      const tired = boxes[outgoing].energy < .7 && stint >= 150;
      const due = stint >= plannedStint(outgoing,rotation);
      for (const incoming of bench) {
        if (!invalid && inFoulTrouble(g, boxes[incoming].pf)) continue;
        if (!invalid && now - (state.offSince[incoming] ?? 0) < 90) continue;
        if (!invalid && !foul && !targetMet && !tired && !due && !(stint >= 150 && needsAllRemaining(incoming)) && !clutch) continue;
        const next = current.map(id => id === outgoing ? incoming : id);
        if (!invalid && !foul && preserveCore && next.filter(id => rotation.starters.includes(id)).length < 2) continue;
        const coverageLoss = Math.max(0, coverage(current,catalog) - coverage(next,catalog));
        const fatigueGain = (boxes[incoming].energy - boxes[outgoing].energy) * 160;
        let gain = deficit(incoming) - deficit(outgoing) + fatigueGain - coverageLoss * 300;
        if (clutch) gain = (catalog.models[incoming].overall * boxes[incoming].energy - catalog.models[outgoing].overall * boxes[outgoing].energy) * 30 - coverageLoss * 300;
        if (foul) gain += 1200;
        if (invalid) gain += 10000;
        if (targetMet) gain += 500;
        if (!invalid && !foul && gain <= 20) continue;
        if (!best || gain > best.gain) best = {incoming,outgoing,gain,reason:invalid?'foul-out / availability':foul?'foul trouble':targetMet?'minutes target':clutch?'closing lineup':tired?'fatigue':'rotation rest'};
      }
    }
    if (!best) break;
    g.onCourt[team] = current.map(id => id === best!.outgoing ? best!.incoming : id);
    state.offSince[best.outgoing] = now;
    state.onSince[best.incoming] = now;
    delete state.onSince[best.outgoing];
    state.lastChange = now;
    changes.push(best);
  }
  for (const change of changes) {
    g.plays.push({id:g.plays.length+1,quarter:g.quarter,clock:g.clock,team,
      text:`${catalog.players.get(change.incoming)!.fullName} in for ${catalog.players.get(change.outgoing)!.fullName} · ${change.reason}`,
      home:g.score[g.home],away:g.score[g.away],kind:'substitution'});
  }
  return changes;
}
