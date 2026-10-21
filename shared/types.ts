export type Zone = 'restrictedArea' | 'paintNonRestricted' | 'midRange' | 'aboveTheBreak3' | 'corner3';
export interface SeasonStats {
  team: string; gamesPlayed: number; minutes: number; points: number; rebounds: number;
  offensiveRebounds: number; defensiveRebounds: number; assists: number; steals: number;
  blocks: number; turnovers: number; fieldGoalsAttempted: number; fieldGoalPct: number;
  threePointersAttempted: number; threePointPct: number; freeThrowsAttempted: number;
  freeThrowPct: number; plusMinus: number; offensiveRating: number; defensiveRating: number;
  netRating: number; trueShootingPct: number; effectiveFgPct: number; usagePct: number;
  assistPct: number; reboundPct: number; pie: number; freeThrowRate: number | null;
  shotZones: Record<Zone, {made: number | null; attempted: number | null; pct: number | null}>;
}
export interface Player {
  playerId: string; fullName: string; position: string; jerseyNumber?: string | null;
  teamName?: string; teamAbbreviation?: string;
  bio: Record<string, string | number | null>;
  stats: Record<string, SeasonStats>;
}
export interface Team { teamName: string; teamAbbreviation: string; players: Player[] }
export interface Dataset {
  source: string; season: string; statSeasons: string[]; fetchedAt: string;
  teamCount: number; playerCount: number; freeAgentCount: number;
  teams: Record<string, Team>; freeAgents: Player[];
}
export interface Model {
  id: string; estimated: boolean; season: string | null; overall: number;
  shotRate: number; threeRate: number; twoPct: number; threePct: number; ftPct: number;
  ftRate: number; turnoverRate: number; assistRate: number; stealRate: number; blockRate: number;
  orbRate: number; drbRate: number; defense: number; historicalMinutes: number;
  zones: {name: Zone; weight: number; pct: number}[];
}
export type Strategy = 'balanced' | 'pace' | 'perimeter' | 'inside';
export interface Rotation { starters: string[]; minutes: Record<string, number>; strategy: Strategy }
export interface Box {
  id: string; seconds: number; pts: number; fgm: number; fga: number; tpm: number; tpa: number;
  ftm: number; fta: number; orb: number; drb: number; ast: number; stl: number; blk: number;
  tov: number; pf: number; plusMinus: number; energy: number;
}
export interface Play { id: number; quarter: number; clock: number; team: string; text: string; home: number; away: number; kind: string }
export interface Shot { player: string; team: string; x: number; y: number; made: boolean; value: number; distance: number }
export interface Game {
  id: string; day: number; home: string; away: string; status: 'scheduled' | 'live' | 'final';
  quarter: number; clock: number; possession: string; score: Record<string, number>;
  quarters: Record<string, number[]>; boxes: Record<string, Record<string, Box>>;
  onCourt: Record<string, string[]>; plays: Play[]; shots: Shot[]; rng: number;
  timeouts: Record<string, number>; teamFouls: Record<string, number>;
  paused: boolean; timeoutTicks: number; speed: number; wallBudget: number; lastSub: number;
  rotationState?: Record<string, {lastChange: number; onSince: Record<string, number>; offSince: Record<string, number>}>;
}
export interface Trade { id: string; from: string; to: string; give: string[]; receive: string[]; status: 'pending' | 'accepted' | 'rejected' | 'cancelled'; reason: string; created: string }
export interface Member { userId: string; name: string; team: string }
export interface Draft {
  status: 'lobby' | 'live' | 'complete'; type: 'snake' | 'fixed'; rounds: number;
  order: string[]; picks: {number:number;round:number;team:string;playerId:string;automatic:boolean}[];
  pickSeconds: number; deadline: number | null; nextAiAt: number;
}
export interface League {
  id: string; code: string; name: string; owner: string; created: string; startDate: string;
  gameHour: number; mode: 'solo' | 'multiplayer'; members: Member[];
  rosters: Record<string, string[]>; freeAgents: string[]; rotations: Record<string, Rotation>;
  games: Game[]; trades: Trade[]; activity: {text: string; at: string}[]; revision: number;
  customTeams?: Record<string,{teamName:string;teamAbbreviation:string}>;
  draft?: Draft;
}
export interface Catalog { data: Dataset; players: Map<string, Player>; models: Record<string, Model>; warnings: string[] }
export const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];
