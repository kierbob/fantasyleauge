import{test}from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';
import{buildCatalog}from'../shared/catalog.ts';import{box,automaticTimeout,startGame,makeGame}from'../shared/engine.ts';import{createLeague}from'../shared/league.ts';import{boxValue,comparePlayerStats}from'../shared/stat-sorting.ts';
import{validateSubscription,notificationService}from'../server/notifications.ts';import{Store}from'../server/store.ts';
const c=buildCatalog(JSON.parse(readFileSync('data/nbastats.json','utf8')));
test('automatic timeouts apply to human-managed teams and enforce cooldown',()=>{
  const l=createLeague('Timeout test','GS',{id:'u',name:'Human'},c,'solo'),g=makeGame('g',0,'GS','LAL',3);startGame(g,l);g.clock=360;g.score.GS=10;g.score.LAL=20;
  g.plays=Array.from({length:4},(_,i)=>({id:i+1,quarter:1,clock:380-i*5,team:'LAL',text:'Made basket',home:10,away:20,kind:'score'}));
  automaticTimeout(g);assert.equal(g.timeouts.GS,6);assert.equal(g.timeoutTicks,20);g.timeoutTicks=0;automaticTimeout(g);assert.equal(g.timeouts.GS,6);
});
test('box score sorts use numerical totals, combined rebounds and per-game season rates',()=>{
  const a={...box('a'),pts:9,orb:2,drb:7,gp:1},b={...box('b'),pts:20,orb:4,drb:3,gp:4};
  assert.deepEqual([a,b].sort((x,y)=>boxValue(y,'pts')-boxValue(x,'pts')).map(x=>x.id),['b','a']);
  assert.deepEqual([a,b].sort((x,y)=>boxValue(x,'pts')-boxValue(y,'pts')).map(x=>x.id),['a','b']);assert.equal(boxValue(a,'reb'),9);assert.equal(boxValue(b,'pts',true),5);
  const ids=[...c.players.keys()];for(const direction of [-1,1]){const sorted=ids.sort((a,b)=>comparePlayerStats(a,b,'points',direction,c.players,c.models));assert.equal(Object.keys(c.players.get(sorted.at(-1)!)!.stats).length,0);}
});
test('push subscriptions reject arbitrary servers and invalid keys',()=>{
  const s={endpoint:'https://fcm.googleapis.com/fcm/send/test',keys:{auth:'a'.repeat(22),p256dh:'b'.repeat(87)}};assert.deepEqual(validateSubscription(s),s);
  for(const endpoint of ['http://127.0.0.1/test','https://127.0.0.1/test','https://example.com/test','https://fcm.googleapis.com:444/test'])assert.throws(()=>validateSubscription({...s,endpoint}),/Unsupported/);
  assert.throws(()=>validateSubscription({...s,keys:{auth:'bad',p256dh:'bad'}}),/Invalid/);
});
test('notification inbox persists, deduplicates events, and sends no push without configuration',()=>{
  const store=new Store(':memory:');try{
    const service=notificationService(store);const l=createLeague('Notice test','GS',{id:'u',name:'Human'},c,'solo');service.remember(l);
    const g=l.games.find(g=>g.home==='GS'||g.away==='GS')!;startGame(g,l);service.changed(l);service.changed(l);
    const inbox=store.db.prepare('SELECT * FROM notifications WHERE userId=?').all('u');assert.equal(inbox.length,1);assert.equal(inbox[0].title,'It’s game time');
    g.status='final';g.score[g.home]=100;g.score[g.away]=95;service.changed(l);assert.equal(store.db.prepare('SELECT * FROM notifications').all().length,2);
  }finally{store.close();}
});
test('PWA manifest and service worker are deployable under a GitHub repository path',()=>{
  const manifest=JSON.parse(readFileSync('public/manifest.webmanifest','utf8'));assert.equal(manifest.start_url,'./');assert.equal(manifest.scope,'./');assert.equal(manifest.display,'standalone');
  for(const icon of manifest.icons)assert.ok(readFileSync('public/'+icon.src).length>100);
  const worker=readFileSync('public/sw.js','utf8');assert.match(worker,/showNotification/);assert.match(worker,/target.origin!==scope.origin/);assert.match(worker,/notificationclick/);
});

test('configured Web Push uses persisted VAPID keys and meaningful event payloads',async()=>{
  const oldUrl=process.env.PUBLIC_APP_URL,oldSubject=process.env.WEB_PUSH_SUBJECT;
  process.env.PUBLIC_APP_URL='https://courtside-test.github.io/game/';process.env.WEB_PUSH_SUBJECT='https://courtside-test.github.io/game/';
  const store=new Store(':memory:');
  try{
    const sent:{subscription:unknown;payload:unknown;options:unknown}[]=[];
    const sender=async(subscription:unknown,payload:unknown,options:unknown)=>{sent.push({subscription,payload,options});return{statusCode:201,body:'',headers:{}};};
    const service=notificationService(store,sender as never);assert.equal(service.configured,true);assert.ok(service.publicKey);
    const again=notificationService(store,sender as never);assert.equal(again.publicKey,service.publicKey);
    store.db.prepare('INSERT INTO push_subscriptions(endpoint,userId,subscription) VALUES(?,?,?)').run('https://fcm.googleapis.com/fcm/send/test','u',JSON.stringify({endpoint:'https://fcm.googleapis.com/fcm/send/test',keys:{auth:'a'.repeat(22),p256dh:'b'.repeat(87)}}));
    const l=createLeague('Push test','GS',{id:'u',name:'Human'},c,'solo');service.remember(l);startGame(l.games.find(g=>g.home==='GS'||g.away==='GS')!,l);service.changed(l);
    await new Promise(resolve=>setImmediate(resolve));assert.equal(sent.length,1);
    const payload=JSON.parse(String(sent[0].payload));assert.equal(payload.title,'It’s game time');assert.equal(payload.url,'https://courtside-test.github.io/game/');assert.equal(payload.leagueId,l.id);
    const options=sent[0].options as {vapidDetails:{publicKey:string}};assert.equal(options.vapidDetails.publicKey,service.publicKey);
  }finally{store.close();if(oldUrl===undefined)delete process.env.PUBLIC_APP_URL;else process.env.PUBLIC_APP_URL=oldUrl;if(oldSubject===undefined)delete process.env.WEB_PUSH_SUBJECT;else process.env.WEB_PUSH_SUBJECT=oldSubject;}
});
