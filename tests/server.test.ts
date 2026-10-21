import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCatalog } from '../shared/catalog.ts';
import { createApp } from '../server/app.ts';
import { Store } from '../server/store.ts';
import { createLeague, tipoffAt } from '../shared/league.ts';
import type { League } from '../shared/types.ts';
const c=buildCatalog(JSON.parse(readFileSync('data/nbastats.json','utf8')));

test('two managers share authoritative state; outsiders and invalid commands cannot mutate it',async()=>{
  const store=new Store(':memory:');const app=createApp(c,store,{manualTick:true});
  await new Promise<void>(r=>app.server.listen(0,'127.0.0.1',r));
  const addr=app.server.address();assert.ok(addr&&typeof addr!=='string');const base=`http://127.0.0.1:${addr.port}/api/`;
  const abort=new AbortController();
  async function request(path:string,cookie='',b?:unknown){const res=await fetch(base+path,{method:b===undefined?'GET':'POST',headers:{Cookie:cookie,...(b===undefined?{}:{'Content-Type':'application/json'})},body:b===undefined?undefined:JSON.stringify(b)});return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]??''};}
  try {
    assert.equal((await request('leagues')).status,401);
    const owner=await request('auth','',{action:'register',name:'Owner',password:'password-one'});
    const friend=await request('auth','',{action:'register',name:'Friend',password:'password-two'});
    const stranger=await request('auth','',{action:'register',name:'Stranger',password:'password-three'});
    assert.equal(owner.status,200);assert.ok(owner.cookie.includes('courtside='));
    assert.equal((await request('auth','',{action:'login',name:'Owner',password:'wrong-password'})).status,400);
    assert.equal((await request('auth','',{action:'register',name:'owner',password:'password-one'})).status,400);
    const created=await request('leagues',owner.cookie,{name:'Friends association',team:'GS',mode:'multiplayer',gameHour:23});assert.equal(created.status,201);
    const id=created.data.id,code=created.data.code;
    assert.equal((await request(`leagues/${id}/advance-day`,owner.cookie,{})).status,400);
    assert.equal((await request(`leagues/${id}`,stranger.cookie)).status,403);
    assert.equal((await request('leagues/preview?code='+code,friend.cookie)).status,200);
    assert.equal((await request('leagues/join',friend.cookie,{code,team:'GS'})).status,400);
    assert.equal((await request('leagues/join',friend.cookie,{code,team:'LAL'})).status,200);
    const before=await request(`leagues/${id}`,owner.cookie);const rotation=structuredClone(before.data.rotations.GS);rotation.strategy='perimeter';
    assert.equal((await request(`leagues/${id}/rotation`,owner.cookie,{rotation,team:'LAL'})).status,200);
    const after=await request(`leagues/${id}`,friend.cookie);assert.equal(after.data.rotations.GS.strategy,'perimeter');assert.equal(after.data.rotations.LAL.strategy,'balanced');
    const invalid=structuredClone(rotation);invalid.minutes[invalid.starters[0]]=100;
    const rev=after.data.revision;assert.equal((await request(`leagues/${id}/rotation`,owner.cookie,{rotation:invalid})).status,400);assert.equal((await request(`leagues/${id}`,owner.cookie)).data.revision,rev);
    const a=after.data.rosters.GS[0],b=after.data.rosters.LAL[0];
    const offered=await request(`leagues/${id}/trade`,owner.cookie,{to:'LAL',give:[a],receive:[b]});assert.equal(offered.data.trades[0].status,'pending');
    const trade=offered.data.trades[0];assert.equal((await request(`leagues/${id}/trade-response`,owner.cookie,{id:trade.id,action:'accept'})).status,400);
    const accepted=await request(`leagues/${id}/trade-response`,friend.cookie,{id:trade.id,action:'accept'});assert.equal(accepted.data.trades[0].status,'accepted');assert.ok(accepted.data.rosters.GS.includes(b));assert.ok(accepted.data.rosters.LAL.includes(a));
    const fa=accepted.data.freeAgents[0];const signed=await request(`leagues/${id}/free-agent`,owner.cookie,{id:fa,action:'sign'});assert.equal(signed.status,200);assert.ok(!signed.data.freeAgents.includes(fa));assert.ok(signed.data.rosters.GS.includes(fa));
    const released=await request(`leagues/${id}/free-agent`,owner.cookie,{id:fa,action:'release'});assert.ok(released.data.freeAgents.includes(fa));
    const contested=released.data.freeAgents[1];
    const race=await Promise.all([request(`leagues/${id}/free-agent`,owner.cookie,{id:contested,action:'sign'}),request(`leagues/${id}/free-agent`,friend.cookie,{id:contested,action:'sign'})]);
    assert.deepEqual(race.map(r=>r.status).sort(),[200,400]);
    const ownership=await request(`leagues/${id}`,owner.cookie);
    assert.equal(Object.values(ownership.data.rosters as Record<string,string[]>).flat().filter(id=>id===contested).length,1);
    const snapshot=app.leagues.get(id)!;const game=snapshot.games.find(g=>g.home==='GS'||g.away==='GS')!;
    assert.equal((await request(`leagues/${id}/game`,friend.cookie,{id:game.id,action:'start'})).status,400);
    assert.equal((await request(`leagues/${id}/game`,owner.cookie,{id:game.id,action:'start'})).status,200);
    assert.equal((await request(`leagues/${id}/game`,friend.cookie,{id:game.id,action:'timeout'})).status,400);
    assert.equal((await request(`leagues/${id}/game`,owner.cookie,{id:game.id,action:'speed',speed:60})).status,400);
    const stream1=await fetch(base+`leagues/${id}/events`,{headers:{Cookie:owner.cookie},signal:abort.signal});
    const stream2=await fetch(base+`leagues/${id}/events`,{headers:{Cookie:friend.cookie},signal:abort.signal});
    assert.equal(stream1.status,200);assert.equal(stream2.status,200);
    const reader1=stream1.body!.getReader(),reader2=stream2.body!.getReader();
    async function packet(reader:ReadableStreamDefaultReader<Uint8Array>){let text='';while(!text.includes('\n\n')){const result=await reader.read();assert.ok(!result.done);text+=new TextDecoder().decode(result.value);}return JSON.parse(text.split('\n\n')[0].slice(6));}
    const s1=await packet(reader1),s2=await packet(reader2);assert.equal(s1.revision,s2.revision);assert.deepEqual(s1.games.find((g:{id:string})=>g.id===game.id).score,s2.games.find((g:{id:string})=>g.id===game.id).score);
    app.tick(tipoffAt(snapshot,0)-1);
    const liveEvent1=await packet(reader1),liveEvent2=await packet(reader2);
    assert.equal(liveEvent1.kind,'patch');assert.equal(liveEvent1.revision,s1.revision+1);assert.deepEqual(liveEvent1,liveEvent2);
    assert.ok(liveEvent1.games.length<30,'Live updates should not resend the full season schedule');
    for(let i=0;i<24;i++)app.tick(tipoffAt(snapshot,0)-1);
    // Independent GETs and the persisted state all report the same generated game.
    const v1=await request(`leagues/${id}`,owner.cookie),v2=await request(`leagues/${id}`,friend.cookie);assert.deepEqual(v1.data,v2.data);
    const live=v1.data.games.find((g:{id:string})=>g.id===game.id);assert.ok(live.clock<720);assert.equal(live.rng,0);
    const saved=store.load()[0].games.find(g=>g.id===game.id)!;assert.deepEqual(saved.score,live.score);assert.equal(saved.clock,live.clock);
    assert.equal((await request(`leagues/${id}/free-agent`,owner.cookie,{id:fa,action:'sign'})).status,400);
    const stolen=await request(`leagues/${id}/trade`,owner.cookie,{to:'LAL',give:[a],receive:[b]});assert.equal(stolen.status,400);
    const badOrigin=await fetch(base+`leagues/${id}/auto-rotation`,{method:'POST',headers:{Cookie:owner.cookie,'Content-Type':'application/json',Origin:'https://untrusted.invalid'},body:'{}'});assert.equal(badOrigin.status,400);
    await request('logout',owner.cookie,{});assert.equal((await request('me',owner.cookie)).status,401);
  } finally {abort.abort();app.close();app.server.closeAllConnections();store.close();}
});

test('SQLite persists independent leagues and rotation edits across restart',()=>{
  const dir=mkdtempSync(join(tmpdir(),'courtside-test-'));const path=join(dir,'save.sqlite');
  try {const store=new Store(path);const first=createLeague('First universe','GS',{id:'owner',name:'Owner'},c,'solo');const second=createLeague('Second universe','BOS',{id:'owner',name:'Owner'},c,'solo');first.rotations.GS.strategy='inside';store.save(first);store.save(second);store.close();const reopened=new Store(path);const loaded=reopened.load();assert.equal(loaded.length,2);assert.equal(loaded.find(l=>l.id===first.id)!.rotations.GS.strategy,'inside');assert.notEqual(loaded[0].code,loaded[1].code);reopened.close();}finally{rmSync(dir,{recursive:true,force:true});}
});

test('daily scheduler starts one matchup per team and resumes backlog in sequence',()=>{
  const store=new Store(':memory:');const app=createApp(c,store,{manualTick:true});
  try {const l=createLeague('Scheduled league','GS',{id:'owner',name:'Owner'},c,'multiplayer');app.leagues.set(l.id,l);app.tick(tipoffAt(l,0)-1);assert.equal(l.games.filter(g=>g.status==='live').length,0);app.tick(tipoffAt(l,0));assert.equal(l.games.filter(g=>g.status==='live').length,15);app.tick(tipoffAt(l,10));assert.equal(l.games.filter(g=>g.status==='live').length,15);const loaded:League=store.load()[0];assert.equal(loaded.games.filter(g=>g.status==='live').length,15);assert.equal(loaded.games.filter(g=>g.status==='live'&&g.day>0).length,0);}finally{app.close();store.close();}
});

test('solo league can complete a whole day without overlapping future matchups',()=>{
  const store=new Store(':memory:');const app=createApp(c,store,{manualTick:true});
  try {
    const l=createLeague('Solo whole day','GS',{id:'owner',name:'Owner'},c,'solo');
    app.leagues.set(l.id,l);app.tick(tipoffAt(l,0));
    for(const g of l.games.filter(g=>g.status==='live'))g.speed=60;
    let ticks=0;while(l.games.some(g=>g.status==='live')&&ticks++<100)app.tick(tipoffAt(l,0));
    assert.equal(l.games.filter(g=>g.status==='final').length,15);
    assert.equal(l.games.filter(g=>g.status==='live').length,0);
    app.tick(tipoffAt(l,1));assert.equal(l.games.filter(g=>g.status==='live').length,15);assert.ok(l.games.filter(g=>g.status==='live').every(g=>g.day===1));
  }finally{app.close();store.close();}
});
