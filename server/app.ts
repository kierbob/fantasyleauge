import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { Store } from './store.ts';
import { activity, assert, assertUnlocked, autoRotation, createLeague, ensureRosterIntegrity, evaluateAI, executeTrade, tipoffAt, validateRotation, validateTrade } from '../shared/league.ts';
import { callTimeout, simulatePossession, startGame } from '../shared/engine.ts';
import { chooseDraftPlayer, createDraftLeague, currentDraftTeam, makeDraftPick, startDraft, validTeamName } from '../shared/draft.ts';
import { notificationService, validateSubscription } from './notifications.ts';
import type { Box, Catalog, League, Trade } from '../shared/types.ts';

type User = {id:string; name:string};
const hashToken = (s:string) => createHash('sha256').update(s).digest('hex');
const mime: Record<string,string> = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.json':'application/json', '.webmanifest':'application/manifest+json', '.png':'image/png'};
function json(res: ServerResponse, status:number, value:unknown) { res.writeHead(status, {'Content-Type':'application/json', 'Cache-Control':'no-store'}); res.end(JSON.stringify(value)); }
async function body(req:IncomingMessage) {
  let text = ''; for await (const chunk of req) { text += chunk; if (text.length > 64000) throw Error('Request too large'); }
  try { return JSON.parse(text || '{}'); } catch { throw Error('Invalid JSON request'); }
}
export function createApp(catalog: Catalog, store: Store, options: {manualTick?:boolean; staticDir?:string} = {}) {
  const leagues = new Map(store.load().map(l => [l.id,l]));
  const notifications=notificationService(store);
  for(const l of leagues.values())notifications.remember(l);
  for (const l of leagues.values()) ensureRosterIntegrity(l,catalog);
  const clients = new Map<string, Set<ServerResponse>>();
  const authAttempts = new Map<string,{count:number; reset:number}>();
  function session(req: IncomingMessage): User | null {
    const token = req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1]??/(?:^|; )courtside=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
    if (!token) return null;
    const row = store.db.prepare('SELECT users.id,users.name FROM sessions JOIN users ON users.id=sessions.userId WHERE token=? AND expires>?').get(hashToken(token),Date.now());
    return row ? {id:String(row.id),name:String(row.name)} : null;
  }
  function seasonStats(l: League) {
    const result: Record<string, Box & {gp:number}> = {};
    for (const g of l.games) if (g.status === 'final') for (const boxes of Object.values(g.boxes)) for (const b of Object.values(boxes)) {
      if (!b.seconds) continue;
      if (!result[b.id]) result[b.id] = {...b, gp:0, seconds:0,pts:0,fgm:0,fga:0,tpm:0,tpa:0,ftm:0,fta:0,orb:0,drb:0,ast:0,stl:0,blk:0,tov:0,pf:0,plusMinus:0};
      const r = result[b.id]; r.gp++;
      for (const key of ['seconds','pts','fgm','fga','tpm','tpa','ftm','fta','orb','drb','ast','stl','blk','tov','pf','plusMinus'] as const) r[key] += b[key];
    }
    return result;
  }
  function gameView(g: League['games'][number]) { return {...g,rng:0,boxes:g.status === 'live' ? g.boxes : {},plays:g.status === 'live' ? g.plays.slice(-50) : [],shots:g.status === 'live' ? g.shots.slice(-200) : []}; }
  function view(l: League) { return {...l,games:l.games.map(gameView),seasonStats:seasonStats(l)}; }
  function broadcast(l: League, updated?: Set<string>, finalized = false) {
    if (!clients.get(l.id)?.size) return;
    const state = updated ? {kind:'patch',id:l.id,revision:l.revision,games:l.games.filter(g=>updated.has(g.id)).map(gameView),activity:l.activity,...(finalized?{seasonStats:seasonStats(l)}:{})} : view(l);
    const packet = `data: ${JSON.stringify(state)}\n\n`;
    for (const res of clients.get(l.id)!) if (!res.destroyed && res.writableLength < 2_000_000) res.write(packet);
  }
  function commit(l: League, updated?: Set<string>, finalized = false) { l.revision++; store.save(l); notifications.changed(l); broadcast(l,updated,finalized); }
  function tick(now = Date.now()) {
    for (const l of leagues.values()) {
      if(l.draft&&l.draft.status!=='complete'){
        if(l.draft.status==='live'){
          const team=currentDraftTeam(l)!;
          if((!l.members.some(m=>m.team===team)&&now>=l.draft.nextAiAt)||now>=(l.draft.deadline??Infinity)){
            makeDraftPick(l,chooseDraftPlayer(l,catalog),catalog,true,now);ensureRosterIntegrity(l,catalog);commit(l);
          }
        }
        continue;
      }
      let changed = false, finalized = false; const updated=new Set<string>();
      for (const g of l.games) {
        if (g.status === 'scheduled' && now >= tipoffAt(l,g.day) && !l.games.some(other => other.status !== 'final' && other.day < g.day && [other.home,other.away].some(t => t === g.home || t === g.away)) && !l.games.some(other => other.status === 'live' && [other.home,other.away].some(t => t === g.home || t === g.away))) {
          startGame(g,l); activity(l, `${g.away} at ${g.home} is live.`); changed=true;updated.add(g.id);
        }
        if (g.status !== 'live' || g.paused) continue;
        updated.add(g.id);
        if (g.timeoutTicks > 0) { g.timeoutTicks = Math.max(0,g.timeoutTicks-g.speed); changed=true; continue; }
        // Spend a second of wall time each tick. The displayed clock is interpolated
        // from the pending possession budget without committing client-side results.
        g.wallBudget += g.speed;
        while (g.wallBudget >= 4 && g.status === 'live' && !g.timeoutTicks) {
          const snapshot = structuredClone(g);
          const oldClock = g.clock;
          simulatePossession(g,l,catalog);
          const spent = g.quarter === snapshot.quarter ? oldClock-g.clock : oldClock;
          if (spent > g.wallBudget) { Object.assign(g,snapshot); break; }
          g.wallBudget -= spent;
          changed=true;
          if ((g.status as string) === 'final') { finalized=true;activity(l, `Final · ${g.away} ${g.score[g.away]} — ${g.home} ${g.score[g.home]}`); }
        }
        // Save the clock budget too, so a restart resumes the exact possession.
        changed=true;
      }
      if (changed) commit(l,updated,finalized);
    }
  }
  const timer = options.manualTick ? null : setInterval(() => { try { tick(); } catch (e) { console.error('Scheduler:',e); } },1000);
  const server = http.createServer(async (req,res) => {
    const origin=req.headers.origin;
    const allowedOrigins=(process.env.CLIENT_ORIGIN??'').split(',').map(s=>s.trim()).filter(Boolean);
    if(origin&&allowedOrigins.includes(origin)){
      res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');
      res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
    }
    if(req.method==='OPTIONS'){res.writeHead(origin&&allowedOrigins.includes(origin)?204:403);res.end();return;}
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','same-origin');
    res.setHeader('X-Frame-Options','DENY');
    const url = new URL(req.url ?? '/', 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);
    try {
      if (!url.pathname.startsWith('/api/')) {
        const root = resolve(options.staticDir ?? 'dist');
        const target = resolve(root, '.'+decodeURIComponent(url.pathname));
        if (target !== root && !target.startsWith(root+sep)) return json(res,403,{error:'Forbidden'});
        const file = existsSync(target) && extname(target) ? target : resolve(root,'index.html');
        if (!existsSync(file)) return json(res,404,{error:'Build the client or use the Vite development server on port 5173.'});
        res.setHeader('Content-Type',mime[extname(file)] ?? 'application/octet-stream');
        res.end(readFileSync(file)); return;
      }
      if (req.method !== 'GET') {
        const origin = req.headers.origin;
        assert(!origin || new URL(origin).host === req.headers.host || allowedOrigins.includes(origin), 'Cross-origin request rejected');
        assert(req.headers['content-type']?.startsWith('application/json'), 'Use application/json');
      }
      if (parts[1] === 'health') return json(res,200,{ok:true});
      if (parts[1] === 'auth' && req.method === 'POST') {
        const key=req.socket.remoteAddress ?? 'unknown';
        let attempts = authAttempts.get(key);
        if (!attempts || attempts.reset < Date.now()) { attempts={count:0,reset:Date.now()+60000}; authAttempts.set(key,attempts); }
        assert(++attempts.count <= 20,'Too many sign-in attempts. Wait a minute.');
        const b = await body(req);
        assert(typeof b.name === 'string' && /^[\w -]{3,24}$/.test(b.name.trim()),'Name must be 3–24 letters, numbers, spaces, or hyphens');
        assert(typeof b.password === 'string' && b.password.length >= 8 && b.password.length <= 128,'Password must be 8–128 characters');
        let row = store.db.prepare('SELECT * FROM users WHERE name=? COLLATE NOCASE').get(b.name.trim());
        if (b.action === 'register') {
          assert(!row,'That manager name is taken');
          const salt=randomBytes(16).toString('hex'), id=randomUUID();
          store.db.prepare('INSERT INTO users(id,name,salt,hash) VALUES(?,?,?,?)').run(id,b.name.trim(),salt,scryptSync(b.password,salt,64).toString('hex'));
          row=store.db.prepare('SELECT * FROM users WHERE id=?').get(id);
        } else {
          const salt=String(row?.salt ?? 'missing-user');
          const derived=scryptSync(b.password,salt,64);
          assert(row && timingSafeEqual(derived,Buffer.from(String(row.hash),'hex')),'Incorrect name or password');
        }
        const token=randomBytes(32).toString('hex');
        store.db.prepare('INSERT INTO sessions(token,userId,expires) VALUES(?,?,?)').run(hashToken(token),String(row!.id),Date.now()+30*86400000);
        const secure=('encrypted' in req.socket && req.socket.encrypted) || (process.env.TRUST_PROXY === '1' && req.headers['x-forwarded-proto'] === 'https');
        res.setHeader('Set-Cookie',`courtside=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure ? '; Secure' : ''}`);
        return json(res,200,{id:row!.id,name:row!.name,token});
      }
      const user=session(req);
      if (!user) return json(res,401,{error:'Sign in to manage your league'});
      if (parts[1] === 'logout' && req.method === 'POST') {
        const token=req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1]??/(?:^|; )courtside=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
        if (token) store.db.prepare('DELETE FROM sessions WHERE token=?').run(hashToken(token));
        res.setHeader('Set-Cookie','courtside=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'); return json(res,200,{ok:true});
      }
      if (parts[1] === 'me') return json(res,200,user);
      if(parts[1]==='notifications'){
        if(req.method==='POST'){store.db.prepare('UPDATE notifications SET seen=1 WHERE userId=?').run(user.id);return json(res,200,{ok:true});}
        return json(res,200,store.db.prepare('SELECT id,title,body,leagueId,created,seen FROM notifications WHERE userId=? ORDER BY created DESC LIMIT 50').all(user.id));
      }
      if(parts[1]==='push'){
        if(req.method==='GET')return json(res,200,{configured:notifications.configured,publicKey:notifications.publicKey});
        const b=await body(req);const subscription=validateSubscription(b.subscription);
        if(b.action==='unsubscribe')store.db.prepare('DELETE FROM push_subscriptions WHERE endpoint=? AND userId=?').run(subscription.endpoint,user.id);
        else {assert(notifications.configured,'Push needs a configured HTTPS backend');store.db.prepare('INSERT INTO push_subscriptions(endpoint,userId,subscription) VALUES(?,?,?) ON CONFLICT(endpoint) DO UPDATE SET userId=excluded.userId,subscription=excluded.subscription').run(subscription.endpoint,user.id,JSON.stringify(subscription));}
        return json(res,200,{ok:true});
      }
      if (parts[1] === 'catalog') return json(res,200,{data:catalog.data,models:catalog.models,warnings:catalog.warnings});
      if (parts[1] !== 'leagues') return json(res,404,{error:'Not found'});
      if (!parts[2]) {
        if (req.method === 'GET') return json(res,200,[...leagues.values()].filter(l => l.members.some(m => m.userId === user.id)).map(l=>({id:l.id,name:l.name,mode:l.mode,team:l.members.find(m=>m.userId===user.id)!.team})));
        const b=await body(req); const l=b.format==='draft'?createDraftLeague(b.name,b.teamName,user,catalog,b.mode,b.gameHour??19):createLeague(b.name,b.team,user,catalog,b.mode,b.gameHour ?? 19); leagues.set(l.id,l); commit(l); return json(res,201,view(l));
      }
      if (parts[2] === 'preview') {
        const code=url.searchParams.get('code'); const l=[...leagues.values()].find(l=>l.code===code);
        assert(l && l.mode === 'multiplayer','Invite code not found');
        return json(res,200,{name:l.name,claimed:l.members.map(m=>m.team),draft:l.draft??null,customTeams:l.customTeams??null});
      }
      if (parts[2] === 'join' && req.method === 'POST') {
        const b=await body(req); const l=[...leagues.values()].find(l=>l.code===String(b.code).trim().toUpperCase());
        assert(l && l.mode==='multiplayer','Invite code not found');
        assert(!l.members.some(m=>m.userId===user.id),'You have already joined this league');
        if(l.draft)assert(l.draft.status==='lobby','Draft has started; the lobby is locked');
        const team=l.draft?Object.keys(l.rosters).find(t=>!l.members.some(m=>m.team===t)):b.team;
        assert(team&&l.rosters[team]&&!l.members.some(m=>m.team===team),'The lobby is full or this team is unavailable');
        if(l.customTeams)l.customTeams[team].teamName=validTeamName(b.teamName);
        l.members.push({userId:user.id,name:user.name,team}); activity(l,`${user.name} joined as ${l.customTeams?.[team]?.teamName??team}.`); commit(l); return json(res,200,view(l));
      }
      const l=leagues.get(parts[2]);
      if (!l || !l.members.some(m=>m.userId===user.id)) return json(res,403,{error:'This league is private'});
      const member=l.members.find(m=>m.userId===user.id)!;
      if (parts[3] === 'events') {
        res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});
        if (!clients.has(l.id)) clients.set(l.id,new Set()); clients.get(l.id)!.add(res);
        res.write(`data: ${JSON.stringify(view(l))}\n\n`);
        const keepalive=setInterval(()=>res.write(': heartbeat\n\n'),20000);
        res.on('close',()=>{clearInterval(keepalive);clients.get(l.id)?.delete(res);}); return;
      }
      if (req.method === 'GET') {
        if (parts[3]==='games' && parts[4]) { const g=l.games.find(g=>g.id===parts[4]); assert(g,'Game not found'); return json(res,200,{...g,rng:0}); }
        if (parts[3]==='export') { res.setHeader('Content-Disposition','attachment; filename="courtside-league.json"'); return json(res,200,{...view(l),games:l.games.map(g=>({...g,rng:0}))}); }
        return json(res,200,view(l));
      }
      const b=await body(req);
      // Validate in an isolated copy; a failed command can never partially mutate state.
      // Reading the body yields to other commands. Reload now so concurrent requests
      // cannot overwrite a newer transaction with an earlier league snapshot.
      const next=structuredClone(leagues.get(l.id)!);
      if(next.draft&&next.draft.status!=='complete')assert(['draft-settings','draft-start','draft-pick','team-name'].includes(parts[3]),'Complete the draft before managing rosters or playing games');
      if(parts[3]==='draft-settings'){
        assert(next.owner===user.id&&next.draft?.status==='lobby','Only the commissioner can edit draft settings before starting');
        assert(['snake','fixed'].includes(b.type)&&[30,60,90,120].includes(b.pickSeconds),'Invalid draft settings');next.draft.type=b.type;next.draft.pickSeconds=b.pickSeconds;
      }else if(parts[3]==='draft-start'){assert(next.owner===user.id,'Only the commissioner can start the draft');startDraft(next);}
      else if(parts[3]==='draft-pick'){
        assert(next.draft?.status==='live'&&currentDraftTeam(next)===member.team,'It is not your turn');
        assert(b.pickNumber===next.draft.picks.length,'This pick is stale; refresh the draft board');
        makeDraftPick(next,b.id,catalog,false);
      }else if(parts[3]==='team-name'){
        assert(next.customTeams,'Custom names apply to fantasy teams');next.customTeams[member.team].teamName=validTeamName(b.name);
      }else if (parts[3]==='advance-day') {
        assert(next.owner===user.id && next.mode==='solo','Only solo commissioners can accelerate a league day');
        const day=Math.min(...next.games.filter(g=>g.status!=='final').map(g=>g.day));
        assert(Number.isFinite(day),'This season is complete');
        for(const g of next.games.filter(g=>g.day===day && g.status!=='final')) { if(g.status==='scheduled')startGame(g,next);g.speed=60;g.paused=false; }
        activity(next,`Day ${day+1} is playing at 60× speed in this solo universe.`);
      } else if (parts[3]==='rotation') {
        validateRotation(b.rotation,next.rosters[member.team]); next.rotations[member.team]=b.rotation;
      } else if (parts[3]==='auto-rotation') next.rotations[member.team]=autoRotation(next.rosters[member.team],catalog);
      else if (parts[3]==='trade') {
        const t:Trade={id:randomUUID(),from:member.team,to:b.to,give:b.give,receive:b.receive,status:'pending',reason:'Awaiting the other manager’s decision.',created:new Date().toISOString()};
        validateTrade(next,t);
        assert(next.trades.filter(t=>t.status==='pending' && t.from===member.team).length < 10,'Resolve existing offers before sending more');
        next.trades.push(t);
        if (!next.members.some(m=>m.team===t.to)) { const decision=evaluateAI(next,t,catalog); t.reason=decision.reason; if (decision.accepted) executeTrade(next,t,catalog); else t.status='rejected'; }
        activity(next,`${t.from} proposed a trade to ${t.to}. ${t.reason}`);
      } else if (parts[3]==='trade-response') {
        const t=next.trades.find(t=>t.id===b.id); assert(t && t.status==='pending','Offer is no longer pending');
        if (b.action==='cancel') { assert(t.from===member.team,'Only the sender can cancel'); t.status='cancelled'; t.reason='Cancelled by sender.'; }
        else { assert(t.to===member.team,'Only the receiving manager can decide'); assert(['accept','reject'].includes(b.action),'Invalid response'); if (b.action==='accept') {executeTrade(next,t,catalog); t.reason='Accepted by manager.';} else {t.status='rejected';t.reason='Declined by manager.';} }
      } else if (parts[3]==='free-agent') {
        const id=b.id; assertUnlocked(next,member.team); const roster=next.rosters[member.team];
        if (b.action==='sign') { assert(next.freeAgents.includes(id),'Player is no longer a free agent'); assert(roster.length<20,'Roster limit is 20 players'); next.freeAgents=next.freeAgents.filter(p=>p!==id); roster.push(id); }
        else { assert(b.action==='release' && roster.includes(id),'Player is not on your roster'); assert(roster.length>8,'Keep at least eight players'); next.rosters[member.team]=roster.filter(p=>p!==id);next.freeAgents.push(id); }
        next.rotations[member.team]=autoRotation(next.rosters[member.team],catalog);
        for (const t of next.trades) if (t.status==='pending' && [...t.give,...t.receive].includes(id)) {t.status='cancelled';t.reason='Player moved to or from free agency.';}
        activity(next,`${member.team} ${b.action==='sign'?'signed':'released'} ${catalog.players.get(id)!.fullName}. Rotation reset.`);
      } else if (parts[3]==='game') {
        const g=next.games.find(g=>g.id===b.id); assert(g,'Game not found');
        if (b.action==='timeout') { assert(g.home===member.team || g.away===member.team,'You are not playing in this game'); callTimeout(g,member.team); }
        else {
          assert(next.owner===user.id,'Only the commissioner can control game playback');
          if (b.action==='start') {
            assert(!next.games.some(other=>other.status!=='final' && other.day<g.day && [other.home,other.away].some(t=>t===g.home||t===g.away)),'Finish earlier matchups first');
            assertUnlocked(next,g.home,g.away);
            assert(next.mode==='solo' || Date.now()>=tipoffAt(next,g.day)-next.gameHour*3600000,'This matchup is scheduled for a future day');
            startGame(g,next);activity(next,`${g.away} at ${g.home} is live.`);
          } else { assert(next.mode==='solo','Shared games run in real time and cannot be paused or accelerated'); assert(g.status==='live','Game is not live');
            if (b.action==='pause') g.paused=!g.paused;
            else {assert(b.action==='speed' && [1,5,20,60].includes(b.speed),'Invalid playback speed'); g.speed=b.speed;}
          }
        }
      } else throw Error('Unknown league command');
      ensureRosterIntegrity(next,catalog); leagues.set(next.id,next); commit(next); json(res,200,view(next));
    } catch (e) { if (!res.headersSent) json(res,400,{error:e instanceof Error?e.message:'Request failed'}); else res.end(); }
  });
  return {server,tick,leagues,close:()=>{if(timer)clearInterval(timer);for(const set of clients.values())for(const res of set)res.end();server.close();}};
}
