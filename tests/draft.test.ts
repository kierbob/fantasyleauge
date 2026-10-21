import{test}from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';
import{buildCatalog}from'../shared/catalog.ts';
import{createDraftLeague,startDraft,currentDraftTeam,makeDraftPick,chooseDraftPlayer}from'../shared/draft.ts';
import{ensureRosterIntegrity,validateRotation}from'../shared/league.ts';
import{Store}from'../server/store.ts';import{createApp}from'../server/app.ts';
import{startGame,simulatePossession}from'../shared/engine.ts';
const c=buildCatalog(JSON.parse(readFileSync('data/nbastats.json','utf8')));
const create=()=>createDraftLeague('Friends draft','London Royals',{id:'owner',name:'Owner'},c,'multiplayer');

test('draft lobby has ten custom teams and every canonical player exactly once in the pool',()=>{
  const l=create();assert.equal(l.members.length,1);assert.equal(Object.keys(l.rosters).length,10);assert.equal(l.customTeams!.F01.teamName,'London Royals');assert.equal(l.games.length,0);assert.equal(l.freeAgents.length,999);assert.equal(l.draft!.status,'lobby');assert.deepEqual(l.draft!.order,[]);ensureRosterIntegrity(l,c);
  assert.throws(()=>createDraftLeague('Test','',{id:'u',name:'u'},c,'solo'),/Team name/);
});
test('draft positions are assigned at start, then snake and fixed orders follow the right rounds',()=>{
  for(const type of ['snake','fixed']as const){const l=create();l.draft!.type=type;startDraft(l,1000);const order=[...l.draft!.order];assert.equal(new Set(order).size,10);assert.deepEqual([...order].sort(),Object.keys(l.rosters).sort());assert.throws(()=>startDraft(l),/already/);
    const turns:string[]=[];for(let i=0;i<30;i++){turns.push(currentDraftTeam(l)!);makeDraftPick(l,l.freeAgents[0],c,false,2000+i);}
    assert.deepEqual(turns.slice(0,10),order);assert.deepEqual(turns.slice(10,20),type==='snake'?[...order].reverse():order);assert.deepEqual(turns.slice(20,30),order);
  }
});
test('a full 150-pick draft creates playable custom rosters and a balanced 18-day season',()=>{
  const l=create();startDraft(l);for(let i=0;i<150;i++){const id=chooseDraftPlayer(l,c);makeDraftPick(l,id,c,true);ensureRosterIntegrity(l,c);}
  assert.equal(l.draft!.status,'complete');assert.equal(l.draft!.deadline,null);assert.equal(l.freeAgents.length,849);assert.equal(l.games.length,90);
  for(const [team,roster]of Object.entries(l.rosters)){assert.equal(roster.length,15);validateRotation(l.rotations[team],roster);assert.equal(l.games.filter(g=>g.home===team).length,9);assert.equal(l.games.filter(g=>g.away===team).length,9);}
  for(let day=0;day<18;day++){const games=l.games.filter(g=>g.day===day);assert.equal(games.length,5);assert.equal(new Set(games.flatMap(g=>[g.home,g.away])).size,10);}
  assert.throws(()=>makeDraftPick(l,l.freeAgents[0],c),/not live/);
  const g=l.games[0];startGame(g,l);let steps=0;while(g.status==='live'&&steps++<2000){g.timeoutTicks=0;simulatePossession(g,l,c);}
  assert.equal(g.status,'final');assert.notEqual(g.score[g.home],g.score[g.away]);
  assert.equal(Object.values(g.boxes[g.home]).reduce((n,b)=>n+b.pts,0),g.score[g.home]);
});
test('AI and expired human picks advance automatically; waiting lobbies do not start games',()=>{
  const store=new Store(':memory:'),app=createApp(c,store,{manualTick:true});
  try{const l=create();app.leagues.set(l.id,l);app.tick(Date.now()+1e9);assert.equal(l.games.length,0);assert.equal(l.draft!.status,'lobby');startDraft(l,1000);l.draft!.order=['F01',...Object.keys(l.rosters).filter(t=>t!=='F01')];app.tick(59999);assert.equal(l.draft!.picks.length,0);app.tick(61000);assert.equal(l.draft!.picks.length,1);assert.equal(l.draft!.picks[0].automatic,true);app.tick(62000);assert.equal(l.draft!.picks.length,1);app.tick(63000);assert.equal(l.draft!.picks.length,2);const loaded=store.load()[0];assert.deepEqual(loaded.draft,l.draft);assert.deepEqual(loaded.rosters,l.rosters);}finally{app.close();store.close();}
});

test('multiplayer draft enforces owner settings, exclusive seats, turn ownership, stale picks and CORS bearer auth',async()=>{
  const oldOrigin=process.env.CLIENT_ORIGIN;process.env.CLIENT_ORIGIN='https://courtside-test.github.io';
  const store=new Store(':memory:'),app=createApp(c,store,{manualTick:true});await new Promise<void>(r=>app.server.listen(0,'127.0.0.1',r));const address=app.server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}/api/`;
  async function request(path:string,token='',data?:unknown){const res=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{Origin:'https://courtside-test.github.io',...(token?{Authorization:`Bearer ${token}`}:{ }),...(data===undefined?{}:{'Content-Type':'application/json'})},body:data===undefined?undefined:JSON.stringify(data)});return{status:res.status,data:await res.json(),allow:res.headers.get('access-control-allow-origin')};}
  try{
    const owner=await request('auth','',{action:'register',name:'Draft Owner',password:'draft-owner-test'}),friend=await request('auth','',{action:'register',name:'Draft Friend',password:'draft-friend-test'});assert.equal(owner.allow,'https://courtside-test.github.io');assert.ok(owner.data.token);
    const created=await request('leagues',owner.data.token,{format:'draft',name:'Live draft league',teamName:'London Royals',mode:'multiplayer'});assert.equal(created.status,201);const id=created.data.id,code=created.data.code,path=`leagues/${id}`;
    assert.equal((await request('leagues/join',friend.data.token,{code,teamName:'Brooklyn Beats'})).status,200);
    assert.equal((await request(path+'/draft-settings',friend.data.token,{type:'fixed',pickSeconds:30})).status,400);
    assert.equal((await request(path+'/draft-start',friend.data.token,{})).status,400);
    assert.equal((await request(path+'/free-agent',owner.data.token,{id:created.data.freeAgents[0],action:'sign'})).status,400);
    assert.equal((await request(path+'/draft-settings',owner.data.token,{type:'fixed',pickSeconds:30})).status,200);
    const started=await request(path+'/draft-start',owner.data.token,{});assert.equal(started.status,200);const l=app.leagues.get(id)!;
    // Move AI turns forward until the owner is on the clock.
    while(currentDraftTeam(l)!=='F01')makeDraftPick(l,l.freeAgents[0],c,true);
    const number=l.draft!.picks.length,player=l.freeAgents[0];
    assert.equal((await request(path+'/draft-pick',friend.data.token,{id:player,pickNumber:number})).status,400);
    assert.equal((await request(path+'/draft-pick',owner.data.token,{id:player,pickNumber:number-1})).status,400);
    const picked=await request(path+'/draft-pick',owner.data.token,{id:player,pickNumber:number});assert.equal(picked.status,200);assert.ok(picked.data.rosters.F01.includes(player));assert.ok(!picked.data.freeAgents.includes(player));
    assert.equal((await request(path+'/draft-settings',owner.data.token,{type:'snake',pickSeconds:60})).status,400);
    const notices=await request('notifications',owner.data.token);assert.ok(notices.data.some((n:{title:string})=>n.title==='The draft is live'));
    const stranger=await request('auth','',{action:'register',name:'Late Manager',password:'late-manager-test'});assert.equal((await request('leagues/join',stranger.data.token,{code,teamName:'Too Late'})).status,400);
    const preflight=await fetch(base+'leagues',{method:'OPTIONS',headers:{Origin:'https://courtside-test.github.io','Access-Control-Request-Headers':'authorization'}});assert.equal(preflight.status,204);
    const rejected=await fetch(base+'leagues',{method:'OPTIONS',headers:{Origin:'https://untrusted.invalid'}});assert.equal(rejected.status,403);
  }finally{app.close();app.server.closeAllConnections();store.close();if(oldOrigin===undefined)delete process.env.CLIENT_ORIGIN;else process.env.CLIENT_ORIGIN=oldOrigin;}
});
