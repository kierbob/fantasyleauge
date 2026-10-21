import webpush from 'web-push';
import type { PushSubscription } from 'web-push';
import type { League } from '../shared/types.ts';
import { currentDraftTeam } from '../shared/draft.ts';
import { assert } from '../shared/league.ts';
import type { Store } from './store.ts';

export function validateSubscription(value:unknown):PushSubscription {
  const s=value as PushSubscription;
  assert(s&&typeof s.endpoint==='string'&&s.endpoint.length<2048&&s.keys,'Invalid push subscription');
  const url=new URL(s.endpoint);
  const host=url.hostname;
  assert(url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&(
    host==='fcm.googleapis.com'||host.endsWith('.push.apple.com')||host==='updates.push.services.mozilla.com'||host.endsWith('.notify.windows.com')
  ),'Unsupported push service endpoint');
  assert(typeof s.keys.auth==='string'&&/^[A-Za-z0-9_-]{20,30}$/.test(s.keys.auth),'Invalid push auth key');
  assert(typeof s.keys.p256dh==='string'&&/^[A-Za-z0-9_-]{80,100}$/.test(s.keys.p256dh),'Invalid push encryption key');
  return s;
}
export function notificationService(store:Store,send?:typeof webpush.sendNotification) {
  const appUrl=process.env.PUBLIC_APP_URL,subject=process.env.WEB_PUSH_SUBJECT;
  const configured=!!appUrl?.startsWith('https://')&&!!subject&&/^(https:|mailto:)/.test(subject);
  let keys:{publicKey:string;privateKey:string}|null=null;
  if(configured){
    const existing=store.db.prepare('SELECT value FROM settings WHERE key=?').get('vapid');
    keys=existing?JSON.parse(String(existing.value)):webpush.generateVAPIDKeys();
    if(!existing)store.db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('vapid',JSON.stringify(keys));
  }
  const previous=new Map<string,League>();
  function remember(l:League){previous.set(l.id,structuredClone(l));}
  function notify(userId:string,id:string,league:League,title:string,body:string){
    const result=store.db.prepare('INSERT OR IGNORE INTO notifications(id,userId,title,body,leagueId,created) VALUES(?,?,?,?,?,?)').run(`${id}:${userId}`,userId,title,body,league.id,Date.now());
    if(!result.changes||!keys||!configured)return;
    const vapidDetails={subject:subject!,publicKey:keys.publicKey,privateKey:keys.privateKey};
    for(const row of store.db.prepare('SELECT endpoint,subscription FROM push_subscriptions WHERE userId=?').all(userId)){
      const payload=JSON.stringify({title,body,tag:id,url:appUrl,leagueId:league.id});
      void Promise.resolve().then(()=>(send??webpush.sendNotification)(JSON.parse(String(row.subscription)),payload,{vapidDetails,TTL:3600,timeout:10000})).catch((e:{statusCode?:number})=>{
        if(e.statusCode===404||e.statusCode===410)store.db.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').run(String(row.endpoint));
        else console.error('Push delivery failed:',e.statusCode??'network error');
      });
    }
  }
  function changed(l:League){
    const old=previous.get(l.id);remember(l);if(!old)return;
    const teamName=(t:string)=>l.customTeams?.[t]?.teamName??t;
    if(l.draft?.status==='live'&&(old.draft?.status!=='live'||l.draft.picks.length!==old.draft.picks.length)){
      if(old.draft?.status!=='live')for(const m of l.members)notify(m.userId,`${l.id}:draft:start`,l,'The draft is live',`${l.name}: your randomized draft order is ready.`);
      const turn=currentDraftTeam(l),m=l.members.find(m=>m.team===turn);
      if(m)notify(m.userId,`${l.id}:draft:turn:${l.draft.picks.length}`,l,'You’re on the clock',`${teamName(m.team)} · pick ${l.draft.picks.length+1}. Open Courtside to choose your player.`);
    }
    if(l.draft?.status==='complete'&&old.draft?.status==='live')for(const m of l.members)notify(m.userId,`${l.id}:draft:complete`,l,'Your roster is ready',`${l.name}: the draft is complete. Set your rotation before tip-off.`);
    for(const g of l.games){const before=old.games.find(x=>x.id===g.id);if(before?.status===g.status)continue;
      for(const m of l.members.filter(m=>m.team===g.home||m.team===g.away)){
        if(g.status==='live')notify(m.userId,`${l.id}:game:${g.id}:live`,l,'It’s game time',`${teamName(g.away)} at ${teamName(g.home)} is live.`);
        if(g.status==='final')notify(m.userId,`${l.id}:game:${g.id}:final`,l,'Final buzzer',`${teamName(g.away)} ${g.score[g.away]} — ${teamName(g.home)} ${g.score[g.home]}`);
      }
    }
    for(const t of l.trades){const before=old.trades.find(x=>x.id===t.id);if(before?.status===t.status)continue;
      for(const m of l.members.filter(m=>m.team===t.to||(m.team===t.from&&t.status!=='pending')))notify(m.userId,`${l.id}:trade:${t.id}:${t.status}`,l,t.status==='pending'?'New trade offer':`Trade ${t.status}`,`${teamName(t.from)} ↔ ${teamName(t.to)} · ${t.reason}`);
    }
  }
  return {configured,publicKey:keys?.publicKey??null,remember,changed};
}
