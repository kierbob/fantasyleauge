import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { activity, assert, autoRotation, generateSchedule } from './league.ts';
import type { Catalog, League } from './types.ts';
import { currentDraftTeam } from './draft-view.ts';
export { currentDraftTeam } from './draft-view.ts';

export function validTeamName(name: unknown): string {
  assert(typeof name==='string'&&name.trim().length>=3&&name.trim().length<=32,'Team name must be 3–32 characters');
  return name.trim();
}
export function createDraftLeague(name:string,teamName:string,user:{id:string;name:string},catalog:Catalog,mode:League['mode'],hour=19): League {
  assert(typeof name==='string'&&name.trim().length>=3&&name.length<=60,'League name must be 3–60 characters');
  assert(['solo','multiplayer'].includes(mode),'Invalid league mode');
  assert(Number.isInteger(hour)&&hour>=0&&hour<24,'Invalid daily tip-off hour');
  const ids=Array.from({length:10},(_,i)=>`F${String(i+1).padStart(2,'0')}`);
  const customTeams=Object.fromEntries(ids.map((id,i)=>[id,{teamName:i===0?validTeamName(teamName):`AI Club ${i+1}`,teamAbbreviation:id}]));
  const l:League={id:randomUUID(),code:randomBytes(6).toString('hex').toUpperCase(),name:name.trim(),owner:user.id,created:new Date().toISOString(),startDate:new Date().toISOString().slice(0,10),gameHour:hour,mode,members:[{userId:user.id,name:user.name,team:ids[0]}],customTeams,
    rosters:Object.fromEntries(ids.map(id=>[id,[]])),freeAgents:[...catalog.players.keys()],rotations:{},games:[],trades:[],activity:[],revision:0,
    draft:{status:'lobby',type:'snake',rounds:15,order:[],picks:[],pickSeconds:60,deadline:null,nextAiAt:0}};
  activity(l,`${user.name} opened a 10-team draft lobby. Unclaimed seats will be AI managers.`);
  return l;
}
export function startDraft(l:League,now=Date.now()) {
  const d=l.draft;assert(d?.status==='lobby','Draft has already started');
  d.order=Object.keys(l.rosters);
  for(let i=d.order.length-1;i>0;i--){const j=randomInt(i+1);[d.order[i],d.order[j]]=[d.order[j],d.order[i]];}
  d.status='live';d.deadline=now+d.pickSeconds*1000;d.nextAiAt=now+2000;
  activity(l,`The ${d.type==='snake'?'serpentine':'fixed-order'} draft is live. All ten draft positions were randomly assigned.`);
}
export function chooseDraftPlayer(l:League,c:Catalog) {
  const team=currentDraftTeam(l);assert(team,'Draft is not live');
  const roster=l.rosters[team],counts:Record<string,number>={};
  for(const id of roster)for(const pos of c.players.get(id)!.position.split('/'))counts[pos]=(counts[pos]??0)+1;
  const score=(id:string)=>{
    const positions=c.players.get(id)!.position.split('/');
    const depth=Math.min(...positions.map(pos=>counts[pos]??0));
    const fill=roster.length>=5&&depth===0?7:0;
    return c.models[id].overall + fill - depth*2;
  };
  return [...l.freeAgents].sort((a,b)=>score(b)-score(a)||a.localeCompare(b))[0];
}
export function makeDraftPick(l:League,playerId:string,c:Catalog,automatic=false,now=Date.now()) {
  const d=l.draft,team=currentDraftTeam(l);assert(d?.status==='live'&&team,'Draft is not live');
  assert(l.freeAgents.includes(playerId),'That player has already been drafted');
  const round=Math.floor(d.picks.length/10)+1;
  d.picks.push({number:d.picks.length+1,round,team,playerId,automatic});
  l.freeAgents=l.freeAgents.filter(id=>id!==playerId);l.rosters[team].push(playerId);
  if(d.picks.length===d.rounds*10){
    d.status='complete';d.deadline=null;
    for(const [id,roster]of Object.entries(l.rosters))l.rotations[id]=autoRotation(roster,c);
    const date=new Date(now);if(date.getUTCHours()>=l.gameHour)date.setUTCDate(date.getUTCDate()+1);
    l.startDate=date.toISOString().slice(0,10);generateSchedule(l);
    activity(l,'Draft complete. Every team has 15 players. Your 18-day season is ready.');
  }else{d.deadline=now+d.pickSeconds*1000;d.nextAiAt=now+2000;}
}
