import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCatalog } from '../shared/catalog.ts';
import { createLeague } from '../shared/league.ts';
import { makeGame, startGame, simulatePossession } from '../shared/engine.ts';
import { updateRotation, gameElapsed } from '../shared/rotations.ts';

const catalog=buildCatalog(JSON.parse(readFileSync('data/nbastats.json','utf8')));
function setup(seed=17) {
  const league=createLeague('Staggered rotations','GS',{id:'owner',name:'Owner'},catalog,'solo');
  const game=makeGame('rotation-game',0,'GS','LAL',seed);
  startGame(game,league);
  updateRotation(game,'GS',league.rotations.GS,catalog);
  return {league,game,rotation:league.rotations.GS};
}

test('resting Curry replaces only Curry and retains his other four teammates',()=>{
  const {game:g,rotation}=setup();const curry=catalog.data.teams.GS.players.find(p=>p.fullName==='Stephen Curry')!.playerId;
  const original=[...g.onCourt.GS];assert.ok(original.includes(curry));
  g.clock=520;
  for(const id of original){g.boxes.GS[id].seconds=200;g.boxes.GS[id].energy=.95;}
  g.boxes.GS[curry].energy=.45;
  const changes=updateRotation(g,'GS',rotation,catalog);
  assert.equal(changes.length,1);assert.equal(changes[0].outgoing,curry);assert.equal(changes[0].reason,'fatigue');
  assert.ok(original.filter(id=>id!==curry).every(id=>g.onCourt.GS.includes(id)));
  assert.ok(rotation.minutes[changes[0].incoming]>0);
  g.clock-=15;assert.equal(updateRotation(g,'GS',rotation,catalog).length,0,'No immediate reverse substitution');
});

test('normal games stagger individual changes, preserve a core, and approach minutes targets',()=>{
  let mixedLineups=0;
  for(let seed=1;seed<=12;seed++){
    const {league,game:g,rotation}=setup(seed);
    let steps=0,previousChange=-Infinity;
    while(g.status==='live'&&g.quarter<=4&&steps++<1000){
      // Isolate scheduled rotation behavior from compulsory foul substitutions.
      for(const b of Object.values(g.boxes.GS))b.pf=0;
      const before=[...g.onCourt.GS];
      simulatePossession(g,league,catalog);
      const incoming=g.onCourt.GS.filter(id=>!before.includes(id));
      const core=g.onCourt.GS.filter(id=>rotation.starters.includes(id)).length;
      assert.equal(new Set(g.onCourt.GS).size,5);
      assert.ok(core>=2,'Keep at least two designated starters available in the normal lineup');
      if(incoming.length){
        assert.equal(incoming.length,1,'Do not swap an entire five-man unit');
        const changeAt=g.rotationState!.GS.lastChange;
        assert.ok(changeAt-previousChange>=45,'Separate normal substitution windows');
        previousChange=changeAt;
        assert.ok(incoming.every(id=>rotation.minutes[id]>0));
      }
      if(core>0&&core<5)mixedLineups++;
    }
    assert.ok(steps<1000);
    for(const [id,target] of Object.entries(rotation.minutes)){
      assert.ok(Math.abs(g.boxes.GS[id].seconds-target*60)<210,`${catalog.players.get(id)!.fullName}: target ${target}, actual ${g.boxes.GS[id].seconds/60}`);
    }
  }
  assert.ok(mixedLineups>100,'Most of the game should use overlapping starter/bench lineups');
});

test('foul-outs override rest and change cooldown without resetting the lineup',()=>{
  const {game:g,rotation}=setup();const old=[...g.onCourt.GS],id=old[0];
  g.rotationState!.GS.lastChange=gameElapsed(g);g.boxes.GS[id].pf=6;
  const changes=updateRotation(g,'GS',rotation,catalog);
  assert.equal(changes.length,1);assert.equal(changes[0].outgoing,id);assert.ok(!g.onCourt.GS.includes(id));
  assert.ok(old.slice(1).every(id=>g.onCourt.GS.includes(id)));
});

test('early foul trouble rests a player; healthy rested alternatives enter first',()=>{
  const {game:g,rotation}=setup();const id=g.onCourt.GS[0];g.boxes.GS[id].pf=2;
  g.clock=600;const changes=updateRotation(g,'GS',rotation,catalog);
  assert.equal(changes.length,1);assert.equal(changes[0].outgoing,id);assert.equal(changes[0].reason,'foul trouble');
  g.clock=500;updateRotation(g,'GS',rotation,catalog);assert.ok(!g.onCourt.GS.includes(id));
});

test('individual stint history survives save/load and older saves initialize safely',()=>{
  const {game:g,league,rotation}=setup();
  for(let i=0;i<50;i++)simulatePossession(g,league,catalog);
  const resumed=JSON.parse(JSON.stringify(g));
  for(let i=0;i<50;i++){simulatePossession(g,league,catalog);simulatePossession(resumed,league,catalog);}
  assert.deepEqual(resumed,g);
  delete resumed.rotationState;
  updateRotation(resumed,'GS',rotation,catalog);
  assert.ok(Object.keys(resumed.rotationState??{}).includes('GS'));assert.equal(resumed.onCourt.GS.length,5);
});
