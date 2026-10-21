import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildCatalog } from '../shared/catalog.ts';
import { autoRotation, createLeague, ensureRosterIntegrity, evaluateAI, executeTrade, validateRotation, validateTrade } from '../shared/league.ts';
import { callTimeout, makeGame, simulatePossession, startGame } from '../shared/engine.ts';
import type { Game, Trade } from '../shared/types.ts';
const bytes=readFileSync('data/nbastats.json');
const data=JSON.parse(bytes.toString());
const catalog=buildCatalog(data);
const makeLeague=()=>createLeague('The test association','GS',{id:'owner',name:'Owner'},catalog,'solo');
function finish(g:Game,l:ReturnType<typeof makeLeague>){let n=0;while(g.status==='live'&&n++<3000){g.timeoutTicks=0;simulatePossession(g,l,catalog);}assert.equal(g.status,'final');}

test('canonical import: all records validated, unique IDs and estimates explicitly marked',()=>{
  assert.equal(catalog.players.size,999);assert.equal(Object.keys(data.teams).length,30);
  assert.equal(Object.values(catalog.models).filter(m=>m.estimated).length,249);
  assert.equal(Object.values(catalog.models).filter(m=>m.season==='2025-26').length,566);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'aa3af66cebf5235d7fce948bd2b3ab4e8b46ee0a75b38bdf5badf5a915d50784');
  for(const m of Object.values(catalog.models)){assert.ok(m.overall>=45&&m.overall<=99);assert.ok(m.twoPct>0&&m.twoPct<1);assert.equal(m.estimated,m.season===null);}
});
test('import rejects count mismatch, duplicate players and wrong roster assignment',()=>{
  const wrong=structuredClone(data);wrong.playerCount++;assert.throws(()=>buildCatalog(wrong),/counts/);
  const dup=structuredClone(data);dup.freeAgents.push(dup.freeAgents[0]);assert.throws(()=>buildCatalog(dup),/duplicate/);
  const bad=structuredClone(data);bad.teams.GS.players[0].teamAbbreviation='LAL';assert.throws(()=>buildCatalog(bad),/mismatch/);
});
test('58-day round robin gives every team one game each day and home-away pairings',()=>{
  const l=makeLeague();assert.equal(l.games.length,870);ensureRosterIntegrity(l,catalog);
  for(let day=0;day<58;day++){const games=l.games.filter(g=>g.day===day);assert.equal(games.length,15);assert.equal(new Set(games.flatMap(g=>[g.home,g.away])).size,30);}
  for(const team of Object.keys(l.rosters)){const games=l.games.filter(g=>g.home===team||g.away===team);assert.equal(games.length,58);assert.equal(games.filter(g=>g.home===team).length,29);}
  const first=l.games[0];assert.equal(l.games.filter(g=>g.home===first.away&&g.away===first.home).length,1);
});
test('rotations select five distinct rostered starters and allocate exactly 240 minutes',()=>{
  const l=makeLeague();for(const team of Object.keys(l.rosters))validateRotation(l.rotations[team],l.rosters[team]);
  const r=structuredClone(l.rotations.GS);r.starters[1]=r.starters[0];assert.throws(()=>validateRotation(r,l.rosters.GS),/distinct/);
  const bad=autoRotation(l.rosters.GS,catalog);bad.minutes[l.rosters.GS[0]]++;assert.throws(()=>validateRotation(bad,l.rosters.GS),/240/);
});
test('trades preserve all 999 player assignments, reset rotations, reject invalid and live moves',()=>{
  const l=makeLeague();const a=l.rosters.GS[0],b=l.rosters.LAL[0];
  const t:Trade={id:'trade',from:'GS',to:'LAL',give:[a],receive:[b],status:'pending',created:'',reason:''};
  executeTrade(l,t,catalog);ensureRosterIntegrity(l,catalog);assert.ok(l.rosters.LAL.includes(a));assert.ok(l.rosters.GS.includes(b));assert.equal(t.status,'accepted');validateRotation(l.rotations.GS,l.rosters.GS);
  assert.throws(()=>validateTrade(l,t),/changed teams/);
  assert.throws(()=>validateTrade(l,{...t,give:[b,b],receive:[a]}),/Duplicate/);
  const g=l.games.find(g=>g.home==='GS'||g.away==='GS')!;startGame(g,l);assert.throws(()=>validateTrade(l,{...t,give:[b],receive:[a]}),/locked/);
});
test('AI rejects equal value and star-for-reserves offers; good value can pass',()=>{
  const l=makeLeague();const ids=Object.keys(catalog.models).sort((a,b)=>catalog.models[b].overall-catalog.models[a].overall);
  const star=ids[0],weak=ids[ids.length-1];
  const starOwner=Object.keys(l.rosters).find(t=>l.rosters[t].includes(star));
  assert.ok(starOwner);assert.match(evaluateAI(l,{from:'GS',to:starOwner,give:[weak],receive:[star]},catalog).reason,/cornerstone/);
  const gs=[...l.rosters.GS].sort((a,b)=>catalog.models[b].overall-catalog.models[a].overall),lal=[...l.rosters.LAL].sort((a,b)=>catalog.models[a].overall-catalog.models[b].overall);
  const result=evaluateAI(l,{from:'GS',to:'LAL',give:gs.slice(0,2),receive:[lal[0]]},catalog);assert.equal(result.accepted,true);
});
test('full games conserve minutes, scores, quarters, shot counts, assists and plus-minus across 60 seeds',()=>{
  const l=makeLeague();let overtime=0;const scores:number[]=[];
  const original=JSON.stringify(data);
  for(let seed=1;seed<=60;seed++){
    const keys=Object.keys(l.rosters);const home=keys[seed%30],away=keys[(seed+7)%30];
    const g=makeGame('g',0,home,away,seed);startGame(g,l);finish(g,l);
    assert.notEqual(g.score[home],g.score[away]);if(g.quarter>4)overtime++;
    const duration=2880+Math.max(0,g.quarter-4)*300;
    for(const team of [home,away]){
      const boxes=Object.values(g.boxes[team]);const sum=(key:keyof typeof boxes[number])=>boxes.reduce((n,b)=>n+Number(b[key]),0);
      scores.push(g.score[team]);assert.equal(sum('pts'),g.score[team]);assert.equal(g.quarters[team].reduce((a,b)=>a+b,0),g.score[team]);
      assert.equal(sum('seconds'),duration*5);assert.equal(sum('plusMinus'),(g.score[team]-g.score[team===home?away:home])*5);
      assert.ok(sum('ast')<=sum('fgm'));assert.equal(g.shots.filter(s=>s.team===team).length,sum('fga'));
      assert.equal(g.shots.filter(s=>s.team===team&&s.made).length,sum('fgm'));
      for(const b of boxes){assert.equal(b.pts,(b.fgm-b.tpm)*2+b.tpm*3+b.ftm);assert.ok(b.fgm<=b.fga&&b.tpm<=b.tpa&&b.ftm<=b.fta);assert.ok(b.energy>=.35&&b.energy<=1);}
    }
  }
  assert.equal(JSON.stringify(data),original);assert.ok(new Set(scores).size>20);
  const mean=scores.reduce((a,b)=>a+b,0)/scores.length;assert.ok(mean>85&&mean<140,`Scoring sanity: ${mean}`);
  console.log(`Simulation sample: 60 games; mean team score ${mean.toFixed(1)}; overtime games ${overtime}. Sanity check, not a realism certification.`);
});
test('forced tie enters overtime; pause freezes simulation; timeouts recover energy',()=>{
  const l=makeLeague();const g=makeGame('tie',0,'GS','LAL',14);startGame(g,l);
  g.paused=true;const before=JSON.stringify(g);simulatePossession(g,l,catalog);assert.equal(JSON.stringify(g),before);g.paused=false;
  const id=g.onCourt.GS[0];g.boxes.GS[id].energy=.5;callTimeout(g,'GS');assert.equal(g.timeouts.GS,6);assert.ok(g.boxes.GS[id].energy>.5);assert.throws(()=>callTimeout(g,'GS'),/unavailable/);
  let found=false;
  for(let seed=1;seed<100;seed++){const t=makeGame('tie',0,'GS','LAL',seed);startGame(t,l);t.quarter=4;t.clock=1;t.quarters={GS:[0,0,0,0],LAL:[0,0,0,0]};simulatePossession(t,l,catalog);if(t.quarter===5){assert.equal(t.clock,300);found=true;break;}}
  assert.ok(found,'At least one tied final possession must proceed to overtime');
});
test('serialized saves resume with exactly the same original result',()=>{
  const l=makeLeague(),g=l.games[0];startGame(g,l);for(let i=0;i<45;i++)simulatePossession(g,l,catalog);
  const loaded=JSON.parse(JSON.stringify(l)),copy=loaded.games[0];finish(g,l);finish(copy,loaded);assert.deepEqual(copy,g);
});
