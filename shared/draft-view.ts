import type {League}from'./types.ts';
// Browser-safe draft order calculation; no server RNG or Node dependencies.
export function currentDraftTeam(l:League){
  const d=l.draft;if(!d||d.status!=='live')return null;
  const round=Math.floor(d.picks.length/d.order.length),slot=d.picks.length%d.order.length;
  return d.order[d.type==='snake'&&round%2===1?d.order.length-1-slot:slot]??null;
}
