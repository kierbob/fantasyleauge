'use strict';
// API routes shared by the Node server (server/index.js) and the in-browser
// GitHub Pages build (pages/local.js), so both behave identically.
// Each entry: [method, pattern, handler(ctx), needsLogin]

function routes(league) {
  return [
    ['GET', /^\/api\/league$/, (c) => league.summary(c.me)],
    ['POST', /^\/api\/setup$/, (c) => league.setup(c.body)],
    ['POST', /^\/api\/join$/, (c) => league.join(c.body)],
    ['POST', /^\/api\/login$/, (c) => league.login(c.body)],
    ['POST', /^\/api\/logout$/, (c) => { league.logout(c.token); return { ok: true }; }, true],
    ['GET', /^\/api\/players$/, () => league.playersView(), true],
    ['GET', /^\/api\/players\/([\w-]+)$/, (c) => league.playerDetail(c.m[1]), true],
    ['GET', /^\/api\/teams\/(\w+)$/, (c) => league.teamView(c.m[1], c.me), true],
    ['PUT', /^\/api\/lineup$/, (c) => league.setLineup(c.me, c.body), true],
    ['PUT', /^\/api\/matchups\/(\w+)$/, (c) => league.setMatchups(c.me, c.m[1], c.body), true],
    ['POST', /^\/api\/draft\/start$/, (c) => { league.startDraft(c.me); return { ok: true }; }, true],
    ['POST', /^\/api\/draft\/pick$/, (c) => { league.draftPick(c.me, c.body.pid); return { ok: true }; }, true],
    ['POST', /^\/api\/draft\/autodraft$/, (c) => { league.setAutodraft(c.me, c.body.on); return { ok: true }; }, true],
    ['GET', /^\/api\/schedule$/, () => league.scheduleView(), true],
    ['GET', /^\/api\/games\/([\w-]+)$/, (c) => league.gameView(c.m[1]), true],
    ['GET', /^\/api\/trades$/, (c) => league.tradesView(c.me), true],
    ['POST', /^\/api\/trades$/, (c) => league.proposeTrade(c.me, c.body), true],
    ['POST', /^\/api\/trades\/(\w+)\/(accept|reject|cancel)$/, (c) => league.respondTrade(c.me, c.m[1], c.m[2]), true],
    ['POST', /^\/api\/fa\/add$/, (c) => { league.addFreeAgent(c.me, c.body.pid, c.body.drop); return { ok: true }; }, true],
    ['POST', /^\/api\/fa\/drop$/, (c) => { league.dropPlayer(c.me, c.body.pid); return { ok: true }; }, true],
    ['GET', /^\/api\/notifications$/, (c) => league.notificationsView(c.me), true],
    ['POST', /^\/api\/notifications\/read$/, (c) => { league.markRead(c.me); return { ok: true }; }, true],
    ['GET', /^\/api\/news$/, () => ({ news: league.s.news, transactions: league.s.transactions }), true],
    ['POST', /^\/api\/commish\/sim$/, (c) => ({ played: league.simNow(c.me, c.body.n) }), true],
    ['POST', /^\/api\/commish\/pause$/, (c) => { league.setPaused(c.me, c.body.paused); return { ok: true }; }, true],
    ['POST', /^\/api\/commish\/settings$/, (c) => { league.updateSettings(c.me, c.body); return { ok: true }; }, true],
    ['POST', /^\/api\/commish\/newseason$/, (c) => { league.newSeason(c.me); return { ok: true }; }, true],
  ];
}

/** Resolve a request to a handler result. Throws LeagueError-like errors with .status. */
async function dispatch(league, table, { method, pathname, body, token }, LeagueError) {
  const me = league.sessionTeam(token);
  for (const [m, re, handler, auth] of table) {
    const match = pathname.match(re);
    if (!match || m !== method) continue;
    if (auth && !league.exists()) throw new LeagueError('No league yet', 404);
    if (auth && !me) throw new LeagueError('Please log in', 401);
    const out = await handler({ m: match, me, body: body || {}, token });
    return out === undefined ? { ok: true } : out;
  }
  throw new LeagueError('Not found', 404);
}

module.exports = { routes, dispatch };
