import type { Catalog, Dataset, Model, Player, SeasonStats, Zone } from './types.ts';

export const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const numeric = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export function latestStats(p: Player): [string, SeasonStats] | null {
  return Object.entries(p.stats).sort(([a], [b]) => b.localeCompare(a)).find(([, s]) => s.gamesPlayed > 0 && s.minutes > 0) ?? null;
}
export function buildCatalog(input: unknown): Catalog {
  const data = input as Dataset;
  if (!data || typeof data !== 'object' || !data.teams || !Array.isArray(data.freeAgents) || !Array.isArray(data.statSeasons)) throw Error('Invalid dataset structure');
  const warnings: string[] = [];
  const players = new Map<string, Player>();
  let count = 0;
  const add = (p: Player, team?: string) => {
    if (!p.playerId || !p.fullName || !p.position || !p.bio || !p.stats || players.has(p.playerId)) throw Error(`Invalid or duplicate player: ${p.playerId}`);
    if (team && (p.teamAbbreviation !== team || p.teamName !== data.teams[team].teamName)) throw Error(`Roster assignment mismatch: ${p.playerId}`);
    for (const [season, s] of Object.entries(p.stats)) {
      for (const field of ['gamesPlayed', 'minutes', 'points', 'rebounds', 'offensiveRebounds', 'defensiveRebounds', 'assists', 'steals', 'blocks', 'turnovers', 'fieldGoalsAttempted', 'threePointersAttempted', 'freeThrowsAttempted'] as const) {
        if (!numeric(s[field]) || s[field] < 0) throw Error(`Invalid ${field}: ${p.playerId}/${season}`);
      }
      for (const field of ['fieldGoalPct', 'threePointPct', 'freeThrowPct'] as const) {
        if (!numeric(s[field]) || s[field] < 0 || s[field] > 1) throw Error(`Invalid percentage: ${p.playerId}/${season}/${field}`);
      }
      if (s.threePointersAttempted > s.fieldGoalsAttempted) throw Error(`3PA exceeds FGA: ${p.playerId}/${season}`);
      if (Math.abs(s.rebounds - s.offensiveRebounds - s.defensiveRebounds) > .21) warnings.push(`Rebound components differ: ${p.playerId}/${season}`);
      if (s.minutes === 0 || s.gamesPlayed === 0) warnings.push(`Zero sample: ${p.playerId}/${season}`);
    }
    if (!latestStats(p)) warnings.push(`Estimated abilities required: ${p.playerId}`);
    players.set(p.playerId, p);
  };
  for (const [id, t] of Object.entries(data.teams)) {
    if (t.teamAbbreviation !== id || !t.teamName || !Array.isArray(t.players) || t.players.length < 5) throw Error(`Invalid team: ${id}`);
    for (const p of t.players) { add(p, id); count++; }
  }
  for (const p of data.freeAgents) add(p);
  if (Object.keys(data.teams).length !== data.teamCount || count !== data.playerCount || data.freeAgents.length !== data.freeAgentCount) throw Error('Declared counts do not match dataset');
  const samples = [...players.values()].map(p => ({ p, s: latestStats(p)?.[1] })).filter((x): x is {p: Player; s: SeasonStats} => !!x.s && x.s.minutes >= 5);
  // Priors are calculated from this file only, grouped by primary position.
  const models: Record<string, Model> = {};
  for (const p of players.values()) {
    const match = latestStats(p);
    const group = samples.filter(x => x.p.position.split('/')[0] === p.position.split('/')[0]);
    const prior = group.length ? group : samples;
    if (!prior.length) throw Error('No statistical sample available for simulation priors');
    const mean = (f: (s: SeasonStats) => number) => prior.reduce((a, x) => a + f(x.s), 0) / prior.length;
    const s = match?.[1];
    const weight = s ? clamp(s.gamesPlayed * s.minutes / 600, 0, 1) : 0;
    const blend = (f: (s: SeasonStats) => number) => (s ? weight * f(s) : 0) + (1 - weight) * mean(f);
    const minute = (v: SeasonStats) => Math.max(v.minutes, 1);
    const twoPct = (v: SeasonStats) => clamp((v.fieldGoalsAttempted * v.fieldGoalPct - v.threePointersAttempted * v.threePointPct) / Math.max(.01, v.fieldGoalsAttempted - v.threePointersAttempted), .15, .85);
    const model: Model = {
      id: p.playerId, estimated: !s, season: match?.[0] ?? null, overall: 0,
      shotRate: clamp(blend(v => v.fieldGoalsAttempted / minute(v)), .05, 1.2),
      threeRate: clamp(blend(v => v.threePointersAttempted / Math.max(.1, v.fieldGoalsAttempted)), 0, .95),
      twoPct: blend(twoPct), threePct: blend(v => v.threePointPct), ftPct: blend(v => v.freeThrowPct),
      ftRate: blend(v => v.freeThrowsAttempted / minute(v)), turnoverRate: blend(v => v.turnovers / minute(v)),
      assistRate: blend(v => v.assists / minute(v)), stealRate: blend(v => v.steals / minute(v)),
      blockRate: blend(v => v.blocks / minute(v)), orbRate: blend(v => v.offensiveRebounds / minute(v)),
      drbRate: blend(v => v.defensiveRebounds / minute(v)),
      defense: clamp(blend(v => numeric(v.defensiveRating) ? v.defensiveRating : 112), 90, 130),
      historicalMinutes: s?.minutes ?? mean(v => v.minutes), zones: [],
    };
    for (const name of ['restrictedArea', 'paintNonRestricted', 'midRange', 'aboveTheBreak3', 'corner3'] as Zone[]) {
      const three = name === 'aboveTheBreak3' || name === 'corner3';
      model.zones.push({name, weight: Math.max(0, blend(v => (v.shotZones?.[name]?.attempted ?? 0) / minute(v))), pct: clamp(blend(v => v.shotZones?.[name]?.pct ?? (three ? v.threePointPct : twoPct(v))), .05, .95)});
    }
    // A game rating, never represented as an imported NBA fact.
    const efficiency = 2 * model.twoPct * (1 - model.threeRate) + 3 * model.threePct * model.threeRate;
    model.overall = Math.round(clamp(48 + model.shotRate * efficiency * 30 + model.assistRate * 30 + (model.orbRate + model.drbRate) * 22 + model.blockRate * 35 + model.stealRate * 35 - model.turnoverRate * 35 + (112 - model.defense) * .25, 45, 99));
    models[p.playerId] = model;
  }
  return {data, players, models, warnings};
}
