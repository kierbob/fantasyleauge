'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { URL } = require('url');
const { loadPlayers, buildPool } = require('./players');
const { Store } = require('./store');
const { League, LeagueError } = require('./league');
const { routes, dispatch } = require('./routes');

const PUBLIC = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

function createServer({ dataDir, playersCsv } = {}) {
  const pool = buildPool(loadPlayers(playersCsv));
  const store = new Store(dataDir || process.env.DATA_DIR || path.join(__dirname, '..', 'data', 'save'));
  const league = new League({ store, pool });
  const clients = new Set();

  const send = (req, res, status, obj) => {
    const body = JSON.stringify(obj);
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
    if (body.length > 2048 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      headers['Content-Encoding'] = 'gzip';
      res.writeHead(status, headers);
      res.end(zlib.gzipSync(body));
    } else {
      res.writeHead(status, headers);
      res.end(body);
    }
  };

  const readBody = (req) => new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e5) { reject(new LeagueError('Body too large', 413)); req.destroy(); } });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new LeagueError('Invalid JSON')); }
    });
    req.on('error', reject);
  });

  const tokenOf = (req, url) => {
    const h = req.headers.authorization || '';
    if (h.startsWith('Bearer ')) return h.slice(7);
    return url.searchParams.get('token');
  };

  const table = routes(league);

  function serveStatic(req, res, pathname) {
    let file = path.normalize(path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname));
    if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  }

  function openEvents(req, res, me) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\n\n');
    const client = { res, teamId: me ? me.id : null };
    clients.add(client);
    req.on('close', () => clients.delete(client));
  }
  const push = (client, event, data) => client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  league.on('update', (d) => { for (const c of clients) push(c, 'update', d); });
  league.on('notify', ({ teamId, n }) => { for (const c of clients) if (c.teamId === teamId) push(c, 'notify', n); });
  const ping = setInterval(() => { for (const c of clients) c.res.write(': ping\n\n'); }, 25000);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const { pathname } = url;
    if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);
    try {
      const token = tokenOf(req, url);
      const me = league.sessionTeam(token);
      if (pathname === '/api/events') return openEvents(req, res, me);
      const body = req.method === 'GET' ? {} : await readBody(req);
      const out = await dispatch(league, table, { method: req.method, pathname, body, token }, LeagueError);
      return send(req, res, 200, out);
    } catch (e) {
      if (!(e instanceof LeagueError)) console.error(e);
      send(req, res, e.status || 500, { error: e instanceof LeagueError ? e.message : 'Server error' });
    }
  });

  const loop = setInterval(() => {
    try { league.tick(); } catch (e) { console.error('tick failed', e); }
  }, 1000);

  server.on('close', () => { clearInterval(loop); clearInterval(ping); });
  return { server, league, store, pool };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const { server, league } = createServer();
  server.listen(port, () => {
    console.log(`Fantasy hoops running on http://localhost:${port}`);
    if (league.exists()) console.log(`League "${league.s.name}" — phase: ${league.s.phase}, invite code: ${league.s.inviteCode}`);
  });
  const shutdown = () => { if (league.exists()) league.saveNow(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { createServer };
