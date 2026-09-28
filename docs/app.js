/* Fantasy Hoops — single page app (no build step, no dependencies). */
(() => {
  'use strict';

  // ------------------------------------------------------------ helpers
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = $('#app');

  const S = {
    token: localStorage.getItem('fh_token'),
    league: null,
    players: null,
    route: [],
    dirty: false,
    seq: 0,
    es: null,
    ui: {
      players: { q: '', pos: 'all', status: 'all', mode: 'real', sort: 'ovr', dir: -1, limit: 100 },
      draft: { q: '', pos: 'all' },
      game: { tab: 'box', q: 'all' },
      trade: { to: null, give: [], get: [], msg: '' },
      scores: { all: false },
    },
  };

  // GitHub Pages build: the whole league runs in this browser (pages/local.js).
  const LOCAL = window.FH_LOCAL || null;

  async function api(method, path, body) {
    if (LOCAL) {
      const r = await LOCAL.request(method, path, body, S.token);
      if (r.status === 401 && S.token && path !== '/api/login') logout(true);
      if (!r.ok) throw new Error(r.data.error || `Request failed (${r.status})`);
      return r.data;
    }
    const res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: `Bearer ${S.token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && S.token && path !== '/api/login') { logout(true); }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  const pct = (x) => (x == null ? '–' : x >= 1 ? '1.000' : x.toFixed(3).replace(/^0/, ''));
  const n1 = (x) => (x == null ? '–' : Number(x).toFixed(1));
  const mmss = (sec) => { sec = Math.max(0, Math.round(sec)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };
  const clockFmt = (c) => (c >= 60 ? mmss(c) : c.toFixed(1));
  const timeOf = (ts) => new Date(ts).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const ago = (ts) => {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  };
  function countdownText(ts) {
    const ms = ts - Date.now();
    if (ms <= 0) return 'now';
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
  }
  const cd = (ts) => `<span class="countdown" data-countdown="${ts}">${countdownText(ts)}</span>`;

  const L = () => S.league;
  const me = () => (L() ? L().teams.find((t) => t.id === L().me) : null);
  const team = (id) => (L() ? L().teams.find((t) => t.id === id) : null);
  const isCommish = () => L() && L().me && L().me === L().commissioner;
  const badge = (t, cls = 'sm') => (t ? `<span class="team-badge ${cls}" style="background:${esc(t.color)}">${esc(t.abbr)}</span>` : '');
  const teamLink = (id) => { const t = team(id); return t ? `<a href="#/team/${t.id}">${esc(t.name)}</a>` : 'Free agent'; };
  const rec = (t) => `${t.rec.w}-${t.rec.l}`;
  const ovrCls = (o) => (o >= 90 ? 'o90' : o >= 80 ? 'o80' : o >= 70 ? 'o70' : o >= 60 ? 'o60' : 'o0');
  const ovr = (p) => `<span class="ovr ${ovrCls(p.ovr)}" title="Overall rating">${p.ovr}</span>`;
  const injTag = (p) => (p.inj ? ` <span class="tag inj" title="${esc(p.inj.type)}">OUT ${p.inj.games}</span>` : '');
  const pcell = (p) => `<a class="pname" href="#/player/${esc(p.id)}">${esc(p.name)}</a><span class="pos">${esc(p.pos)} · ${esc(p.team)}</span>${injTag(p)}`;
  const phaseName = { lobby: 'Waiting for players', draft: 'Draft in progress', season: 'Regular season', playoffs: 'Playoffs', complete: 'Season complete' };
  const reb = (st) => st.reb;

  function toast(text, type = '', link = null) {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = text;
    el.onclick = () => { if (link) location.hash = link; el.remove(); };
    const box = $('#toasts');
    box.appendChild(el);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => el.remove(), 8000);
  }
  function showError(e) { toast(`⚠️ ${e.message || e}`, 'error'); }

  function modal(html) {
    const m = $('#modal');
    m.innerHTML = `<div class="box">${html}</div>`;
    m.classList.remove('hidden');
  }
  function closeModal() { $('#modal').classList.add('hidden'); $('#modal').innerHTML = ''; }

  // Swap view HTML while keeping focus/caret in inputs (live updates arrive while typing).
  function setView(html) {
    const a = document.activeElement;
    const id = a && a.id;
    const sel = a && 'selectionStart' in a ? [a.selectionStart, a.selectionEnd] : null;
    app.innerHTML = html;
    if (id) {
      const el = document.getElementById(id);
      if (el) { el.focus(); if (sel) try { el.setSelectionRange(sel[0], sel[1]); } catch { /* not text */ } }
    }
  }

  // ------------------------------------------------------------ data
  async function refreshLeague() {
    S.league = await api('GET', '/api/league');
    if (S.league.exists && S.token && !S.league.me) logout(true);
  }
  async function getPlayers(force) {
    if (!S.players || force) S.players = await api('GET', '/api/players');
    return S.players;
  }

  // ------------------------------------------------------------ chrome
  function renderChrome() {
    const lg = L();
    $('#brand-name').textContent = lg && lg.exists ? lg.name : 'Fantasy Hoops';
    const nav = $('#nav');
    const acts = $('#top-actions');
    if (!lg || !lg.exists || !lg.me) { nav.innerHTML = ''; acts.innerHTML = ''; $('#ticker').innerHTML = ''; return; }
    const cur = S.route[0] || 'home';
    const items = [['home', '#/', 'Home'], ['team', '#/team', 'My Team'], ['players', '#/players', 'Players'], ['draft', '#/draft', 'Draft'],
      ['scores', '#/scores', 'Scores'], ['standings', '#/standings', 'Standings'], ['trades', '#/trades', `Trades${lg.pendingTrades ? ` (${lg.pendingTrades})` : ''}`], ['league', '#/league', 'League']];
    nav.innerHTML = items.map(([k, h, t]) => `<a href="${h}" class="${cur === k ? 'active' : ''}">${t}</a>`).join('');
    const m = me();
    acts.innerHTML = `<span class="me-chip">${esc(m.owner)}</span>${LOCAL ? '<button class="bell" data-act="switchUser" title="Switch manager (pass the phone)">👥</button>' : ''}
      <button class="bell" data-act="bell" title="Notifications">🔔${lg.unread ? `<span class="count">${lg.unread > 99 ? '99+' : lg.unread}</span>` : ''}</button>`;
    const d = lg.lastDay;
    $('#ticker').innerHTML = d && d.games.length ? `<div class="ticker-inner"><span class="tick-label">${esc(d.label)} · Final</span>${d.games.map((g) => {
      const h = team(g.home); const a = team(g.away);
      return `<a class="tick-game" href="#/game/${g.id}"><div class="tl ${g.as > g.hs ? 'win' : ''}"><span>${esc(a.abbr)}</span><span>${g.as}</span></div><div class="tl ${g.hs > g.as ? 'win' : ''}"><span>${esc(h.abbr)}</span><span>${g.hs}</span></div>${g.ot ? `<div class="muted small">${g.ot > 1 ? g.ot : ''}OT</div>` : ''}</a>`;
    }).join('')}</div>` : '';
  }

  // ------------------------------------------------------------ router
  async function route() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    S.route = parts;
    S.dirty = false;
    stopReplay();
    await render();
    window.scrollTo(0, 0);
  }

  async function render() {
    const seq = ++S.seq;
    try {
      if (!S.league) await refreshLeague();
      renderChrome();
      if (!L().exists) return viewSetup();
      if (!S.token || !L().me) return viewAuth();
      connectEvents();
      const [view, arg, arg2] = S.route;
      const fn = VIEWS[view || 'home'] || VIEWS.home;
      await fn(arg, arg2, seq);
    } catch (e) {
      if (seq === S.seq) setView(`<div class="card"><div class="error">${esc(e.message)}</div><a href="#/">Back home</a></div>`);
    }
  }
  const stale = (seq) => seq !== S.seq;

  // ------------------------------------------------------------ live events
  let refreshTimer = null;
  function connectEvents() {
    if (S.es || !S.token) return;
    if (LOCAL) {
      S.es = { close() {} };
      if (!S.localHooked) {
        S.localHooked = true;
        LOCAL.on('update', (d) => { if (S.token) onUpdate(d); });
        LOCAL.on('notify', (teamId, n) => { if (S.token && L() && teamId === L().me) onNotify(n); });
      }
      return;
    }
    const es = new EventSource(`/api/events?token=${encodeURIComponent(S.token)}`);
    S.es = es;
    es.addEventListener('update', (ev) => onUpdate(JSON.parse(ev.data)));
    es.addEventListener('notify', (ev) => onNotify(JSON.parse(ev.data)));
  }
  function onUpdate({ kind }) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      S.players = null;
      try { await refreshLeague(); } catch { return; }
      renderChrome();
      const v = S.route[0] || 'home';
      if (S.dirty) { markStale(); return; }
      if (v === 'game' || (v === 'player' && kind !== 'games')) return;
      if (S.replay) return;
      render();
    }, kind === 'draft' ? 150 : 500);
  }
  function onNotify(n) {
    if (L()) L().unread++;
    renderChrome();
    toast(n.text, n.type, n.link);
    if (window.Notification && Notification.permission === 'granted' && document.hidden) {
      try { new Notification(L().name, { body: n.text }); } catch { /* ignore */ }
    }
  }
  function markStale() {
    if ($('#stale-note')) return;
    const el = document.createElement('div');
    el.id = 'stale-note';
    el.className = 'notice accent';
    el.innerHTML = 'League data changed while you were editing. <button class="btn sm" data-act="reload">Reload view</button>';
    app.prepend(el);
  }

  function logout(silent) {
    if (S.token && !silent) api('POST', '/api/logout').catch(() => {});
    localStorage.removeItem('fh_token');
    S.token = null;
    if (S.es) { S.es.close(); S.es = null; }
    S.league = null;
    S.players = null;
    if (!silent) location.hash = '#/';
    render();
  }

  // ------------------------------------------------------------ setup & auth
  function viewSetup() {
    setView(`<div class="auth">
      <div class="hero"><h1>🏀 Fantasy Hoops</h1><p>Draft real NBA players against your friends. Every game day a full 48-minute game is simulated possession by possession from real stats — fouls, free throws, overtime and all.</p></div>
      <div class="card"><h2>Create your league</h2>
      <form data-form="setup">
        <label class="field"><span>League name</span><input type="text" name="leagueName" value="Hoops League" required></label>
        <div class="form-row">
          <label class="field"><span>Your name</span><input type="text" name="ownerName" required></label>
          <label class="field"><span>Your team name</span><input type="text" name="teamName" required></label>
        </div>
        <label class="field"><span>Password</span><input type="password" name="password" required minlength="4"></label>
        <details class="adv" open><summary>League settings</summary>
          <div class="form-row">
            <label class="field"><span>Total teams</span><select name="numTeams">${[2, 4, 6, 8, 10, 12, 14, 16].map((n) => `<option ${n === 8 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
            <label class="field"><span>Human managers</span><select name="humanSlots">${[1, 2, 3, 4, 5, 6, 8].map((n) => `<option ${n === 2 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
            <label class="field"><span>Games per team</span><input type="number" name="seasonGames" value="82" min="2" max="82"></label>
          </div>
          <div class="form-row">
            <label class="field"><span>Minutes between game days</span><input type="number" name="tickMinutes" value="60" min="1" max="1440"></label>
            <label class="field"><span>Draft pick clock (sec, 0 = none)</span><input type="number" name="pickSeconds" value="${LOCAL ? 0 : 90}" min="0" max="600"></label>
            <label class="field"><span>Roster size (draft rounds)</span><input type="number" name="rosterSize" value="13" min="8" max="15"></label>
          </div>
          <div class="form-row">
            <label class="field"><span>Playoff teams</span><select name="playoffTeams"><option>2</option><option selected>4</option><option>8</option></select></label>
            <label class="field"><span>Series length</span><select name="seriesLength"><option>1</option><option>3</option><option>5</option><option selected>7</option></select></label>
            <label class="field"><span>Trade deadline (after game #, 0 = none)</span><input type="number" name="tradeDeadline" value="58" min="0" max="82"></label>
          </div>
          <label><input type="checkbox" name="injuries" checked> Injuries</label>
          <p class="muted small">Empty human slots become CPU teams when the draft starts. CPU teams draft, set lineups, sign free agents and make/answer trade offers.</p>
        </details>
        <button class="btn primary" type="submit">Create league</button>
      </form></div></div>`);
  }

  function viewAuth() {
    const lg = L();
    const open = lg.teams.filter((t) => t.kind === 'open').length;
    setView(`<div class="auth">
      <div class="hero"><h1>${esc(lg.name)}</h1><p>${esc(phaseName[lg.phase])} · ${lg.teams.filter((t) => t.kind === 'human').map((t) => esc(t.owner)).join(', ')}</p></div>
      <div class="grid grid-halves">
        <div class="card"><h2>Join the league</h2>
          ${open ? `<form data-form="join">
            <label class="field"><span>Invite code</span><input type="text" name="inviteCode" required autocomplete="off" style="text-transform:uppercase"></label>
            <label class="field"><span>Your name</span><input type="text" name="ownerName" required></label>
            <label class="field"><span>Team name</span><input type="text" name="teamName" required></label>
            <label class="field"><span>Password</span><input type="password" name="password" required minlength="4"></label>
            <button class="btn primary" type="submit">Join</button>
          </form>` : '<p class="muted">No open slots — the league is full.</p>'}
        </div>
        <div class="card"><h2>Log in</h2>
          ${LOCAL ? `<div class="btn-row" style="margin-bottom:10px">${lg.teams.filter((t) => t.kind === 'human').map((t) => `<button class="btn sm" data-act="pickLogin" data-name="${esc(t.owner)}">${badge(t)} ${esc(t.owner)}</button>`).join('')}</div>` : ''}
          <form data-form="login">
            <label class="field"><span>Your name or team name</span><input type="text" name="name" id="loginName" required></label>
            <label class="field"><span>Password</span><input type="password" name="password" required></label>
            <button class="btn blue" type="submit">Log in</button>
          </form>
        </div>
      </div></div>`);
  }

  function formData(f) {
    const o = {};
    for (const el of f.elements) {
      if (!el.name) continue;
      o[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    }
    return o;
  }

  // ------------------------------------------------------------ home
  async function viewHome(_a, _b, seq) {
    const lg = L();
    const m = me();
    const [mine, news] = await Promise.all([api('GET', `/api/teams/${m.id}`), api('GET', '/api/news')]);
    if (stale(seq)) return;
    let main = '';
    if (lg.phase === 'lobby') {
      const link = `${location.origin}/`;
      main = `<div class="card"><h2>Waiting for managers</h2>
        ${LOCAL ? '<p>This league lives on this device. Hand the phone to your friend: tap <b>👥</b> (top right), then <b>Join</b> with this invite code:</p>' : '<p>Send your friend this link and invite code:</p>'}
        <div class="notice accent">${LOCAL ? '' : `<div><b>${esc(link)}</b></div>`}<div style="font-size:26px;font-weight:800;letter-spacing:4px">${esc(lg.inviteCode)}</div></div>
        ${LOCAL ? '<button class="btn" data-act="switchUser" style="margin-bottom:12px">👥 Switch manager now</button>' : ''}
        <table><thead><tr><th class="l">Team</th><th class="l">Manager</th><th class="l">Type</th></tr></thead><tbody>
        ${lg.teams.map((t) => `<tr><td class="l">${badge(t)} ${esc(t.name)}</td><td class="l">${esc(t.owner || '—')}</td><td class="l"><span class="tag ${t.kind}">${t.kind === 'open' ? 'open slot' : t.kind}</span></td></tr>`).join('')}
        </tbody></table>
        ${isCommish() ? `<p class="muted small">Open slots become CPU teams when you start. Draft order is random; it's a snake draft of ${lg.settings.rosterSize} rounds.</p><button class="btn primary" data-act="startDraft">Start the draft</button>` : '<p class="muted">The commissioner will start the draft.</p>'}
      </div>`;
    } else if (lg.phase === 'draft') {
      const d = lg.draft;
      const onClock = team(d.current);
      main = `<div class="card ${d.current === m.id ? 'on-clock' : ''}"><h2>The draft is live</h2>
        <p>Round ${d.round} · Pick ${d.pickNo + 1} of ${d.total} — <b>${esc(onClock ? onClock.name : '')}</b> on the clock ${d.deadline ? cd(d.deadline) : ''}</p>
        <a class="btn primary" href="#/draft">Go to the draft room</a></div>`;
    } else {
      const standing = lg.standings.findIndex((t) => t.id === m.id) + 1;
      const opp = mine.nextOpponent ? team(mine.nextOpponent) : null;
      const streak = m.rec.streak ? `${m.rec.streak > 0 ? 'W' : 'L'}${Math.abs(m.rec.streak)}` : '—';
      main = `<div class="card"><div class="stat-tiles">
          <div class="tile"><div class="k">Record</div><div class="v">${rec(m)}</div></div>
          <div class="tile"><div class="k">Standing</div><div class="v">${standing}<span class="muted small"> / ${lg.teams.length}</span></div></div>
          <div class="tile"><div class="k">Streak</div><div class="v">${streak}</div></div>
          <div class="tile"><div class="k">${lg.phase === 'complete' ? 'Champion' : 'Next game day'}</div><div class="v">${lg.phase === 'complete' ? esc(team(lg.champion).abbr) : lg.paused ? 'Paused' : lg.nextTickAt ? cd(lg.nextTickAt) : '—'}</div></div>
        </div></div>`;
      if (lg.phase === 'complete') {
        const c = team(lg.champion);
        main += `<div class="card center"><div style="font-size:48px">🏆</div><h1>${esc(c.name)}</h1><p class="muted">${esc(c.owner)} won season ${lg.season}.</p>
          ${isCommish() ? '<button class="btn primary" data-act="newSeason">Start next season (keep rosters)</button>' : ''}</div>`;
      }
      if (opp) {
        main += `<div class="card"><div class="card-head"><h2>Next game</h2><span class="muted">${lg.phase === 'playoffs' ? 'Playoffs' : `Game ${lg.round + 1} of ${lg.totalRounds}`} · ${lg.nextTickAt ? timeOf(lg.nextTickAt) : ''}</span></div>
          <div class="matchup"><div class="side">${badge(m, 'lg')}<b>${esc(m.name)}</b><span class="muted">${rec(m)}</span></div>
          <div class="vs">VS</div>
          <div class="side">${badge(opp, 'lg')}<b>${esc(opp.name)}</b><span class="muted">${rec(opp)}</span></div></div>
          <div class="btn-row" style="justify-content:center"><a class="btn" href="#/team">Set lineup</a><a class="btn" href="#/team/${m.id}/plan/${opp.id}">Game plan vs ${esc(opp.abbr)}</a><a class="btn" href="#/team/${opp.id}">Scout ${esc(opp.abbr)}</a></div></div>`;
      }
      if (lg.playoffs) main += `<div class="card"><h2>Playoff bracket</h2>${bracket()}</div>`;
      if (lg.lastDay) main += `<div class="card"><div class="card-head"><h2>Latest scores · ${esc(lg.lastDay.label)}</h2><a href="#/scores">All scores</a></div><div class="scores">${lg.lastDay.games.map(scoreCard).join('')}</div></div>`;
    }
    const icon = { trade: '🔁', big: '🔥', injury: '🚑', draft: '📋', playoffs: '🏆', transaction: '✍️', league: '📣' };
    const feed = `<div class="card"><h2>League news</h2><ul class="feed">${news.news.slice(0, 30).map((n) => `<li><span class="ic">${icon[n.type] || '•'}</span><span>${n.link ? `<a href="${esc(n.link)}">${esc(n.text)}</a>` : esc(n.text)}</span><span class="ts">${ago(n.ts)}</span></li>`).join('') || '<li class="muted">Nothing yet.</li>'}</ul></div>`;
    const mini = `<div class="card"><div class="card-head"><h2>Standings</h2><a href="#/standings">Full</a></div><table><thead><tr><th class="l">Team</th><th>W</th><th>L</th><th>GB</th></tr></thead><tbody>
      ${lg.standings.map((t) => `<tr class="${t.id === m.id ? 'me' : ''}"><td class="l">${badge(t)} <a href="#/team/${t.id}">${esc(t.name)}</a></td><td>${t.rec.w}</td><td>${t.rec.l}</td><td>${t.gb ? t.gb.toFixed(1) : '—'}</td></tr>`).join('')}</tbody></table></div>`;
    setView(`<div class="grid grid-2"><div>${main}</div><div>${mini}${feed}</div></div>`);
  }

  function scoreCard(g) {
    const h = team(g.home); const a = team(g.away);
    const hw = g.hs > g.as;
    const top = g.top && (hw ? g.top.home : g.top.away);
    return `<a class="score-card" href="#/game/${g.id}">
      <div class="row ${hw ? 'lose' : ''}">${badge(a)}<span class="nm">${esc(a.name)}</span><span class="sc">${g.as}</span></div>
      <div class="row ${hw ? '' : 'lose'}">${badge(h)}<span class="nm">${esc(h.name)}</span><span class="sc">${g.hs}</span></div>
      <div class="foot">Final${g.ot ? ` / ${g.ot > 1 ? g.ot : ''}OT` : ''} · ${esc(g.label)}${top ? ` · ${esc(top.name)} ${top.pts}p ${top.reb}r ${top.ast}a` : ''}</div></a>`;
  }

  function bracket() {
    const P = L().playoffs;
    if (!P) return '';
    return `<div class="bracket">${P.rounds.map((round) => `<div class="bracket-round">${round.map((s) => {
      const row = (id, seed) => { const t = team(id); const cls = s.winner ? (s.winner === id ? 'won' : 'out') : ''; return `<div class="st ${cls}"><span>${badge(t)} <span class="muted small">${seed}</span> ${esc(t.name)}</span><b>${s.wins[id]}</b></div>`; };
      return `<div class="series">${row(s.hi, s.hiSeed)}${row(s.lo, s.loSeed)}</div>`;
    }).join('')}</div>`).join('')}</div>`;
  }

  // ------------------------------------------------------------ team
  const statHead = '<th>GP</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>TO</th><th>3PM</th><th>FG%</th><th>FT%</th>';
  const statCells = (s) => `<td>${s.gp ?? s.g ?? 0}</td><td>${n1(s.min)}</td><td><b>${n1(s.pts)}</b></td><td>${n1(reb(s))}</td><td>${n1(s.ast)}</td><td>${n1(s.stl)}</td><td>${n1(s.blk)}</td><td>${n1(s.tov)}</td><td>${n1(s.tpm)}</td><td>${pct(s.fgp)}</td><td>${pct(s.ftp)}</td>`;

  async function viewTeam(id, sub, seq) {
    const lg = L();
    const tid = id || lg.me;
    const t = await api('GET', `/api/teams/${tid}`);
    if (stale(seq)) return;
    const mine = t.id === lg.me;
    const tm = team(t.id);
    let planOpp = null;
    if (mine) {
      const oppId = (sub === 'plan' && S.route[3]) || S.ui.planOpp || t.nextOpponent || lg.teams.find((x) => x.id !== t.id).id;
      S.ui.planOpp = oppId;
      planOpp = await api('GET', `/api/teams/${oppId}`);
      if (stale(seq)) return;
    }
    const head = `<div class="page-head">${badge(tm, 'lg')}<div class="grow"><h1>${esc(t.name)}</h1><div class="muted">${esc(t.owner)} · ${rec(tm)} · ${t.roster.length} players ${t.kind === 'cpu' ? '<span class="tag cpu">CPU</span>' : ''}</div></div>
      ${!mine ? `<a class="btn primary" href="#/trades/${t.id}">Propose trade</a>` : ''}</div>`;
    const inSeason = lg.phase === 'season' || lg.phase === 'playoffs';
    let html = head;
    if (mine && t.roster.length) {
      const Lu = t.lineup;
      const rows = [...t.roster].sort((a, b) => (Lu.starters.includes(b.id) - Lu.starters.includes(a.id)) || ((Lu.minutes[b.id] || 0) - (Lu.minutes[a.id] || 0)) || b.ovr - a.ovr);
      const total = t.roster.reduce((a, p) => a + (p.inj ? 0 : Number(Lu.minutes[p.id] || 0)), 0);
      html += `<div class="card"><div class="card-head"><h2>Lineup & rotation</h2>
          <label><input type="checkbox" data-on="autoLineup" ${Lu.auto ? 'checked' : ''}> Auto-manage (recomputed every game day)</label></div>
        <p class="muted small">Pick 5 starters and target minutes. The coach AI subs at dead balls to hit your targets, adjusting for fatigue, foul trouble, blowouts and crunch time. Targets are scaled to the 240 available minutes (${total} set${total !== 240 ? ` <span class="sum-bad">→ will be scaled</span>` : ' <span class="sum-ok">✓</span>'}).</p>
        <div class="table-wrap"><table><thead><tr><th class="l">Start</th><th class="l">Player</th><th>OVR</th><th>Target MIN</th><th class="l">Real per game</th><th class="l">This season</th><th></th></tr></thead><tbody>
        ${rows.map((p) => `<tr><td class="l"><input type="checkbox" data-on="starter" data-pid="${p.id}" ${Lu.starters.includes(p.id) ? 'checked' : ''}></td>
          <td class="l">${pcell(p)}</td><td>${ovr(p)}</td>
          <td><input class="min" type="number" min="0" max="48" data-on="minutes" data-pid="${p.id}" value="${Lu.minutes[p.id] || 0}"></td>
          <td class="l small">${n1(p.real.min)}m · ${n1(p.real.pts)}p ${n1(p.real.reb)}r ${n1(p.real.ast)}a</td>
          <td class="l small">${p.st.gp ? `${p.st.gp}g · ${n1(p.st.min)}m · ${n1(p.st.pts)}p ${n1(p.st.reb)}r ${n1(p.st.ast)}a` : '<span class="muted">—</span>'}</td>
          <td>${inSeason ? `<button class="btn sm" data-act="drop" data-pid="${p.id}">Drop</button>` : ''}</td></tr>`).join('')}
        </tbody></table></div>
        <h3 style="margin-top:14px">Coaching strategy</h3>
        <div class="form-row">
          ${sel('pace', 'Pace', { slow: 'Slow (grind it out)', normal: 'Normal', fast: 'Fast (push in transition)' }, t.strategy.pace)}
          ${sel('offense', 'Shot focus', { inside: 'Attack the paint', balanced: 'Balanced', perimeter: 'Let it fly from 3' }, t.strategy.offense)}
          ${sel('defense', 'Defensive pressure', { conservative: 'Conservative (fewer fouls)', normal: 'Normal', aggressive: 'Aggressive (more steals & fouls)' }, t.strategy.defense)}
          ${sel('foulTrouble', 'Foul trouble', { cautious: 'Sit players early', normal: 'Normal', ignore: 'Let them play' }, t.strategy.foulTrouble)}
        </div>
        <button class="btn primary" data-act="saveLineup">Save lineup & strategy</button>
      </div>`;
      html += planCard(t, planOpp);
    } else {
      html += `<div class="card"><h2>Roster</h2><div class="table-wrap"><table><thead><tr><th class="l">Player</th><th>OVR</th>${statHead}<th class="l">Starter</th></tr></thead><tbody>
        ${[...t.roster].sort((a, b) => b.ovr - a.ovr).map((p) => { const s = p.st.gp ? p.st : { ...p.real, gp: p.real.g }; return `<tr><td class="l">${pcell(p)}</td><td>${ovr(p)}</td>${statCells(s)}<td class="l">${t.lineup.starters.includes(p.id) ? '✓' : ''}</td></tr>`; }).join('')}
        </tbody></table></div><p class="muted small">Shows this season's averages once a player has played, otherwise real NBA averages.</p></div>`;
    }
    const games = t.games.filter((g) => g.played).slice(-12).reverse();
    const upcoming = t.games.filter((g) => !g.played).slice(0, 5);
    html += `<div class="grid grid-halves" style="margin-top:16px"><div class="card"><h2>Recent results</h2><table><tbody>
      ${games.map((g) => `<tr><td class="l">${g.playoff ? esc(g.day) : `G${g.day}`}</td><td class="l">${g.home ? 'vs' : '@'} ${teamLink(g.opp)}</td><td class="${g.us > g.them ? 'good' : 'bad'}"><b>${g.us > g.them ? 'W' : 'L'}</b></td><td><a href="#/game/${g.id}">${g.us}-${g.them}${g.ot ? ` ${g.ot > 1 ? g.ot : ''}OT` : ''}</a></td></tr>`).join('') || '<tr><td class="muted l">No games yet</td></tr>'}
      </tbody></table></div><div class="card"><h2>Upcoming</h2><table><tbody>
      ${upcoming.map((g) => `<tr><td class="l">G${g.day}</td><td class="l">${g.home ? 'vs' : '@'} ${teamLink(g.opp)}</td></tr>`).join('') || '<tr><td class="muted l">—</td></tr>'}
      </tbody></table></div></div>`;
    setView(html);
  }

  function sel(name, label, opts, cur) {
    return `<label class="field"><span>${label}</span><select data-strategy="${name}" data-on="dirty">${Object.entries(opts).map(([v, t]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`;
  }

  function planCard(t, opp) {
    if (!opp) return '';
    const plan = (t.matchups && t.matchups[opp.id]) || { assign: {}, doubleTeam: null };
    const oppOpts = (cur) => `<option value="">Auto (by position)</option>${[...opp.roster].sort((a, b) => b.ovr - a.ovr).map((p) => `<option value="${p.id}" ${cur === p.id ? 'selected' : ''}>${esc(p.name)} (${esc(p.pos)}, ${n1(p.real.pts)} ppg)</option>`).join('')}`;
    const mine = [...t.roster].filter((p) => (t.lineup.minutes[p.id] || 0) > 0).sort((a, b) => (t.lineup.minutes[b.id] || 0) - (t.lineup.minutes[a.id] || 0));
    const others = L().teams.filter((x) => x.id !== t.id);
    return `<div class="card"><div class="card-head"><h2>Defensive game plan</h2>
      <label>vs <select data-on="planOpp">${others.map((o) => `<option value="${o.id}" ${o.id === opp.id ? 'selected' : ''}>${esc(o.name)}${o.id === t.nextOpponent ? ' (next)' : ''}</option>`).join('')}</select></label></div>
      <p class="muted small">Choose who guards whom against this team. Your matchup defender affects the shooter's percentages, steals, blocks and who picks up fouls. Double-teaming their star cuts his touches and efficiency, but his teammates get more open looks.</p>
      <div class="table-wrap"><table><thead><tr><th class="l">Your player</th><th class="l">Defense</th><th class="l">Guards</th></tr></thead><tbody>
      ${mine.map((p) => `<tr><td class="l">${pcell(p)}</td><td class="l"><span class="muted small">DEF ${p.def}</span></td><td class="l"><select data-assign="${p.id}" data-on="dirty">${oppOpts(plan.assign[p.id])}</select></td></tr>`).join('')}
      </tbody></table></div>
      <label class="field" style="margin-top:12px;max-width:420px"><span>Double-team</span><select id="doubleTeam" data-on="dirty"><option value="">Nobody</option>${[...opp.roster].sort((a, b) => b.ovr - a.ovr).map((p) => `<option value="${p.id}" ${plan.doubleTeam === p.id ? 'selected' : ''}>${esc(p.name)} (${p.ovr})</option>`).join('')}</select></label>
      <button class="btn primary" data-act="savePlan" data-opp="${opp.id}">Save game plan vs ${esc(opp.abbr)}</button></div>`;
  }

  // ------------------------------------------------------------ players
  const COLS = [['gp', 'GP'], ['min', 'MIN'], ['pts', 'PTS'], ['reb', 'REB'], ['ast', 'AST'], ['stl', 'STL'], ['blk', 'BLK'], ['tov', 'TO'], ['tpm', '3PM'], ['fgp', 'FG%'], ['ftp', 'FT%']];
  function posGroup(pos) { return /C/.test(pos) ? 'C' : /F/.test(pos) ? 'F' : 'G'; }
  function statOf(p, mode, k) {
    const s = mode === 'real' ? p.real : p.st;
    if (k === 'gp') return mode === 'real' ? p.real.g : p.st.gp;
    return s[k] ?? 0;
  }

  async function viewPlayers(_a, _b, seq) {
    const players = await getPlayers();
    if (stale(seq)) return;
    const u = S.ui.players;
    const q = u.q.trim().toLowerCase();
    const list = players.filter((p) => (!q || p.name.toLowerCase().includes(q) || p.team.toLowerCase() === q)
      && (u.pos === 'all' || posGroup(p.pos) === u.pos || (u.pos === 'F' && /F/.test(p.pos)) || (u.pos === 'G' && /G/.test(p.pos)))
      && (u.status === 'all' || (u.status === 'fa' && !p.owner) || (u.status === 'owned' && p.owner) || (u.status === 'mine' && p.owner === L().me)));
    list.sort((a, b) => {
      if (u.sort === 'name') return (u.dir === -1 ? 1 : -1) * a.name.localeCompare(b.name);
      const va = (u.sort === 'ovr' ? a.ovr : statOf(a, u.mode, u.sort)) ?? -1;
      const vb = (u.sort === 'ovr' ? b.ovr : statOf(b, u.mode, u.sort)) ?? -1;
      return (u.dir === -1 ? vb - va : va - vb) || b.ovr - a.ovr;
    });
    const shown = list.slice(0, u.limit);
    const canAdd = L().phase === 'season';
    const th = (k, label, cls = '') => `<th class="sortable ${cls} ${u.sort === k ? 'sorted' : ''}" data-act="sortPlayers" data-k="${k}">${label}${u.sort === k ? (u.dir === -1 ? ' ▾' : ' ▴') : ''}</th>`;
    setView(`<div class="card"><div class="card-head"><h2>Players</h2><span class="muted small">${list.length} players · ${L().settings.maxRoster} max roster</span></div>
      <div class="toolbar">
        <input type="search" id="pq" placeholder="Search name or team (e.g. LAL)" value="${esc(u.q)}" data-on="pq" style="min-width:220px">
        <div class="seg">${['all', 'G', 'F', 'C'].map((p) => `<button data-act="ppos" data-v="${p}" class="${u.pos === p ? 'on' : ''}">${p === 'all' ? 'All' : p}</button>`).join('')}</div>
        <select data-on="pstatus"><option value="all" ${u.status === 'all' ? 'selected' : ''}>All players</option><option value="fa" ${u.status === 'fa' ? 'selected' : ''}>Free agents</option><option value="owned" ${u.status === 'owned' ? 'selected' : ''}>Rostered</option><option value="mine" ${u.status === 'mine' ? 'selected' : ''}>My team</option></select>
        <span class="grow"></span>
        <div class="seg"><button data-act="pmode" data-v="real" class="${u.mode === 'real' ? 'on' : ''}">Real NBA averages</button><button data-act="pmode" data-v="st" class="${u.mode === 'st' ? 'on' : ''}">This season (sim)</button></div>
      </div>
      <div class="table-wrap"><table><thead><tr>${th('ovr', 'OVR')}${th('name', 'Player', 'l')}<th class="l">Fantasy team</th>${COLS.map(([k, l]) => th(k, l)).join('')}<th></th></tr></thead><tbody>
      ${shown.map((p) => {
        const s = u.mode === 'real' ? { ...p.real, gp: p.real.g } : p.st;
        return `<tr class="${p.owner === L().me ? 'me' : ''}"><td>${ovr(p)}</td><td class="l">${pcell(p)}</td><td class="l">${p.owner ? teamLink(p.owner) : '<span class="tag fa">FA</span>'}</td>${statCells(s)}
        <td>${!p.owner && canAdd ? `<button class="btn sm good" data-act="add" data-pid="${p.id}">+ Add</button>` : ''}</td></tr>`;
      }).join('')}
      </tbody></table></div>
      ${list.length > shown.length ? `<div class="center" style="margin-top:10px"><button class="btn" data-act="moreplayers">Show more (${list.length - shown.length})</button></div>` : ''}
    </div>`);
  }

  async function viewPlayer(id, _b, seq) {
    const p = await api('GET', `/api/players/${id}`);
    if (stale(seq)) return;
    const lg = L();
    const mine = p.owner === lg.me;
    const bar = (label, v, max, txt) => `<span>${label}</span><div class="bar"><div style="width:${Math.max(3, Math.min(100, (v / max) * 100))}%"></div></div><b>${txt ?? v}</b>`;
    const actions = [];
    if (!p.owner && lg.phase === 'season') actions.push(`<button class="btn good" data-act="add" data-pid="${p.id}">+ Add to roster</button>`);
    if (mine && (lg.phase === 'season' || lg.phase === 'playoffs')) actions.push(`<button class="btn" data-act="drop" data-pid="${p.id}">Drop</button>`);
    if (p.owner && !mine && lg.tradesOpen) actions.push(`<a class="btn primary" href="#/trades/${p.owner}" data-act="tradeFor" data-pid="${p.id}" data-team="${p.owner}">Trade for him</a>`);
    const line = (label, s) => `<tr><td class="l"><b>${label}</b></td>${statCells(s)}<td>${n1(s.tpa)}</td><td>${n1(s.fta)}</td><td>${s.pm != null ? n1(s.pm) : '–'}</td></tr>`;
    setView(`<div class="card"><div class="player-top"><div class="big-ovr ovr ${ovrCls(p.ovr)}">${p.ovr}</div>
        <div style="flex:1"><h1>${esc(p.name)}</h1><div class="muted">${esc(p.pos)} · ${esc(p.team)} (NBA) · Age ${p.age} · ${p.owner ? `Fantasy: ${teamLink(p.owner)}` : '<span class="tag fa">Free agent</span>'} ${injTag(p)}</div>
        ${p.inj ? `<div class="bad small">Out: ${esc(p.inj.type)} — ${p.inj.games} more game(s)</div>` : ''}</div>
        <div class="btn-row">${actions.join('')}</div></div></div>
      <div class="grid grid-2" style="margin-top:16px"><div class="card"><h2>Averages</h2><div class="table-wrap"><table><thead><tr><th class="l"></th>${statHead}<th>3PA</th><th>FTA</th><th>+/-</th></tr></thead><tbody>
        ${line('Real NBA (per game)', { ...p.real, gp: p.real.g, tpa: null, fta: null, pm: null })}
        ${p.st.gp ? line('This season', p.st) : ''}
        ${p.playoffs.gp ? line('Playoffs', p.playoffs) : ''}
        </tbody></table></div>
        ${p.st.gp ? `<p class="small muted">Season highs: ${p.st.hi} pts · ${p.st.dd} double-doubles · ${p.st.td} triple-doubles</p>` : ''}</div>
        <div class="card"><h2>Sim ratings</h2><div class="kv">
          ${bar('Usage / 36', p.ratings.usage, 40)}${bar('3PT rate', p.ratings.threeRate, 80, `${p.ratings.threeRate}%`)}
          ${bar('2PT %', p.ratings.fg2, 70, `${p.ratings.fg2}%`)}${bar('3PT %', p.ratings.fg3, 50, `${p.ratings.fg3}%`)}
          ${bar('FT %', p.ratings.ft, 100, `${p.ratings.ft}%`)}${bar('Defense', p.ratings.defense, 100)}${bar('Stamina', p.ratings.stamina, 17)}
        </div><p class="muted small">Derived from real per-game numbers. Tendencies, not caps: volume depends on minutes, teammates and the defense.</p></div></div>
      <div class="card"><h2>Game log</h2><div class="table-wrap"><table><thead><tr><th class="l">Game</th><th class="l">Opp</th><th class="l">Result</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>TO</th><th>FG</th><th>3PT</th><th>FT</th><th>PF</th><th>+/-</th></tr></thead><tbody>
      ${[...p.log].reverse().map((g) => `<tr><td class="l"><a href="#/game/${g.g}">${esc(g.d)}</a></td><td class="l">${g.h ? 'vs' : '@'} ${esc(g.opp)}</td><td class="l ${g.w ? 'good' : 'bad'}">${g.w ? 'W' : 'L'} ${esc(g.sc)}</td><td>${g.min}</td><td><b>${g.pts}</b></td><td>${g.reb}</td><td>${g.ast}</td><td>${g.stl}</td><td>${g.blk}</td><td>${g.tov}</td><td>${g.fgm}-${g.fga}</td><td>${g.tpm}-${g.tpa}</td><td>${g.ftm}-${g.fta}</td><td>${g.pf}</td><td>${g.pm > 0 ? '+' : ''}${g.pm}</td></tr>`).join('') || '<tr><td class="l muted" colspan="15">No games played yet.</td></tr>'}
      </tbody></table></div></div>`);
  }

  // ------------------------------------------------------------ draft
  async function viewDraft(_a, _b, seq) {
    const lg = L();
    if (lg.phase === 'lobby') {
      setView(`<div class="card"><h2>Draft room</h2><p>The draft hasn't started. ${lg.teams.filter((t) => t.kind === 'open').length} open slot(s) — share invite code <b>${esc(lg.inviteCode)}</b>.</p>
        ${isCommish() ? '<button class="btn primary" data-act="startDraft">Start the draft</button>' : '<p class="muted">Waiting for the commissioner to start it.</p>'}</div>`);
      return;
    }
    const players = await getPlayers();
    if (stale(seq)) return;
    const d = lg.draft;
    const m = me();
    const myTurn = lg.phase === 'draft' && d.current === m.id;
    const u = S.ui.draft;
    const q = u.q.trim().toLowerCase();
    const avail = players.filter((p) => !p.owner && (!q || p.name.toLowerCase().includes(q)) && (u.pos === 'all' || (u.pos === 'G' ? /G/.test(p.pos) : u.pos === 'F' ? /F/.test(p.pos) : /C/.test(p.pos))))
      .sort((a, b) => b.value - a.value).slice(0, 80);
    const onClock = team(d.current);
    const mineList = players.filter((p) => p.owner === m.id);
    const n = d.order.length;
    const rounds = Math.ceil(d.total / n);
    const byPick = new Map(d.picks.map((pk) => [pk.no - 1, pk]));
    const board = `<div class="board">${d.order.map((tid, col) => {
      const t = team(tid);
      let cells = '';
      for (let r = 0; r < rounds; r++) {
        const no = r * n + (r % 2 ? n - 1 - col : col);
        const pk = byPick.get(no);
        cells += `<div class="board-cell ${no === d.pickNo && lg.phase === 'draft' ? 'next' : ''}">${pk ? `<div class="n">${esc(pk.name)}</div><div class="muted">${r + 1}.${(no % n) + 1}${pk.auto ? ' · auto' : ''}</div>` : `<div class="muted">${r + 1}.${(no % n) + 1}</div>`}</div>`;
      }
      return `<div class="board-col"><div class="hd" style="border-color:${esc(t.color)}">${esc(t.name)}</div>${cells}</div>`;
    }).join('')}</div>`;
    const header = lg.phase === 'draft'
      ? `<div class="card ${myTurn ? 'on-clock' : ''}"><div class="clock-box">
          <div>${myTurn ? "<h2>You're on the clock!</h2>" : `<h2>${badge(onClock)} ${esc(onClock.name)} on the clock</h2>`}<div class="muted">Round ${d.round} · Pick ${d.pickNo + 1} of ${d.total}</div>
          ${LOCAL && !myTurn && onClock.kind === 'human' && !onClock.autodraft ? `<button class="btn primary" data-act="switchUser" style="margin-top:8px">👥 Hand the phone to ${esc(onClock.owner)}</button>` : ''}</div>
          <div class="timer">${onClock.kind !== 'human' || onClock.autodraft ? '<span class="muted small">auto-picking…</span>' : d.deadline ? cd(d.deadline) : '∞'}</div><span class="grow" style="flex:1"></span>
          <label><input type="checkbox" data-on="autodraft" ${m.autodraft ? 'checked' : ''}> Autodraft for me</label></div></div>`
      : '<div class="card"><h2>Draft complete ✅</h2><p class="muted">The season is underway. Free agents can be added from the Players page.</p></div>';
    setView(`${header}
      <div class="grid grid-2" style="margin-top:16px">
        <div class="card"><div class="card-head"><h2>Best available</h2>
          <div class="toolbar" style="margin:0"><input type="search" id="dq" placeholder="Search" value="${esc(u.q)}" data-on="dq">
          <div class="seg">${['all', 'G', 'F', 'C'].map((p) => `<button data-act="dpos" data-v="${p}" class="${u.pos === p ? 'on' : ''}">${p === 'all' ? 'All' : p}</button>`).join('')}</div></div></div>
          <div class="table-wrap"><table><thead><tr><th>OVR</th><th class="l">Player</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>3PM</th><th>FG%</th><th></th></tr></thead><tbody>
          ${avail.map((p) => `<tr><td>${ovr(p)}</td><td class="l">${pcell(p)}</td><td>${n1(p.real.min)}</td><td><b>${n1(p.real.pts)}</b></td><td>${n1(p.real.reb)}</td><td>${n1(p.real.ast)}</td><td>${n1(p.real.stl)}</td><td>${n1(p.real.blk)}</td><td>${n1(p.real.tpm)}</td><td>${pct(p.real.fgp)}</td>
            <td>${lg.phase === 'draft' ? `<button class="btn sm ${myTurn ? 'primary' : ''}" data-act="draftPick" data-pid="${p.id}" ${myTurn ? '' : 'disabled'}>Draft</button>` : ''}</td></tr>`).join('')}
          </tbody></table></div></div>
        <div><div class="card"><h2>My roster (${mineList.length}/${lg.settings.rosterSize})</h2><table><tbody>
          ${mineList.map((p) => `<tr><td class="l">${pcell(p)}</td><td>${ovr(p)}</td></tr>`).join('') || '<tr><td class="muted l">No picks yet</td></tr>'}</tbody></table></div>
          <div class="card"><h2>Recent picks</h2><table><tbody>${[...d.picks].reverse().slice(0, 12).map((pk) => `<tr><td class="l muted">${pk.round}.${((pk.no - 1) % n) + 1}</td><td class="l">${badge(team(pk.teamId))} <a href="#/player/${pk.pid}">${esc(pk.name)}</a></td></tr>`).join('') || '<tr><td class="muted l">—</td></tr>'}</tbody></table></div></div>
      </div>
      <div class="card"><h2>Draft board</h2>${board}</div>`);
  }

  // ------------------------------------------------------------ scores
  async function viewScores(_a, _b, seq) {
    const sch = await api('GET', '/api/schedule');
    if (stale(seq)) return;
    const lg = L();
    const days = [...sch.days].reverse();
    const shown = S.ui.scores.all ? days : days.slice(0, 8);
    const up = sch.upcoming.map((d, i) => `<div class="card"><div class="card-head"><h3>${esc(d.label)}</h3><span class="muted">${d.at ? `${timeOf(d.at)}${i === 0 && !lg.paused ? ` · tips off in ${cd(d.at)}` : ''}` : ''}${lg.paused ? ' · paused' : ''}</span></div>
      <div class="scores">${d.games.map((g) => { const h = team(g.home); const a = team(g.away); return `<div class="score-card"><div class="row">${badge(a)}<span class="nm">${esc(a.name)}</span><span class="muted">${rec(a)}</span></div><div class="row">${badge(h)}<span class="nm">${esc(h.name)}</span><span class="muted">${rec(h)}</span></div><div class="foot">@ ${esc(h.abbr)}</div></div>`; }).join('')}</div></div>`).join('');
    setView(`${lg.phase === 'playoffs' || lg.phase === 'complete' ? `<div class="card"><h2>Playoffs</h2>${bracket()}${lg.phase === 'playoffs' && lg.nextTickAt ? `<p class="muted">Next playoff games in ${cd(lg.nextTickAt)}</p>` : ''}</div>` : ''}
      ${up}
      ${shown.map((d) => `<div class="card"><div class="card-head"><h3>${esc(d.label)}</h3><span class="muted small">${timeOf(d.at)}</span></div><div class="scores">${d.games.map(scoreCard).join('')}</div></div>`).join('') || (up ? '' : '<div class="card muted">No games yet.</div>')}
      ${days.length > shown.length ? `<div class="center"><button class="btn" data-act="allScores">Show all ${days.length} game days</button></div>` : ''}`);
  }

  // ------------------------------------------------------------ game
  const elapsedOf = (e) => (e.q <= 4 ? (e.q - 1) * 720 + (720 - e.c) : 2880 + (e.q - 5) * 300 + (300 - e.c));
  const qName = (q) => (q <= 4 ? `Q${q}` : q === 5 ? 'OT' : `${q - 4}OT`);

  async function viewGame(id, _b, seq) {
    const g = await api('GET', `/api/games/${id}`);
    if (stale(seq)) return;
    S.game = g;
    renderGame();
  }

  function boxTable(side, g) {
    const t = team(side.teamId) || { name: side.name, color: '#666', abbr: side.abbr };
    const row = (p) => {
      if (p.dnp) return `<tr><td class="l">${esc(p.name)}<span class="pos">${esc(p.pos)}</span></td><td class="l muted" colspan="14">DNP — Coach's decision</td></tr>`;
      const icon = p.night === 'hot' ? ' <span title="On fire tonight">🔥</span>' : p.night === 'cold' ? ' <span title="Cold night">🧊</span>' : '';
      return `<tr><td class="l"><a class="pname" href="#/player/${esc(p.id)}">${esc(p.name)}</a><span class="pos">${esc(p.pos)}</span>${icon}${p.fouledOut ? ' <span class="tag inj">FO</span>' : ''}</td>
        <td>${mmss(p.sec)}</td><td><b>${p.pts}</b></td><td>${p.orb + p.drb}</td><td>${p.ast}</td><td>${p.stl}</td><td>${p.blk}</td><td>${p.tov}</td>
        <td>${p.fgm}-${p.fga}</td><td>${p.tpm}-${p.tpa}</td><td>${p.ftm}-${p.fta}</td><td>${p.orb}</td><td>${p.drb}</td><td>${p.pf}</td><td>${p.pm > 0 ? '+' : ''}${p.pm}</td></tr>`;
    };
    const T = side.totals;
    const starters = side.players.filter((p) => p.starter);
    const bench = side.players.filter((p) => !p.starter);
    return `<div class="card"><div class="card-head"><h3>${badge(t)} ${esc(t.name)}</h3><b>${side.score}</b></div><div class="table-wrap"><table>
      <thead><tr><th class="l">Starters</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>TO</th><th>FG</th><th>3PT</th><th>FT</th><th>OREB</th><th>DREB</th><th>PF</th><th>+/-</th></tr></thead>
      <tbody>${starters.map(row).join('')}<tr class="divider"><td class="l" colspan="15">Bench</td></tr>${bench.map(row).join('')}
      <tr class="total"><td class="l">Team</td><td></td><td>${T.pts}</td><td>${T.orb + T.drb}</td><td>${T.ast}</td><td>${T.stl}</td><td>${T.blk}</td><td>${T.tov}</td><td>${T.fgm}-${T.fga}</td><td>${T.tpm}-${T.tpa}</td><td>${T.ftm}-${T.fta}</td><td>${T.orb}</td><td>${T.drb}</td><td>${T.pf}</td><td></td></tr>
      <tr><td class="l muted">Shooting</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td>${pct(T.fga ? T.fgm / T.fga : null)}</td><td>${pct(T.tpa ? T.tpm / T.tpa : null)}</td><td>${pct(T.fta ? T.ftm / T.fta : null)}</td><td colspan="4"></td></tr>
      </tbody></table></div></div>`;
  }

  function renderGame() {
    const g = S.game;
    const u = S.ui.game;
    const h = team(g.home.teamId) || g.home; const a = team(g.away.teamId) || g.away;
    const periods = g.home.periods.length;
    const status = `Final${g.ot ? ` / ${g.ot > 1 ? g.ot : ''}OT` : ''}`;
    const line = `<table class="linescore"><thead><tr><th class="l"></th>${Array.from({ length: periods }, (_, i) => `<th>${qName(i + 1)}</th>`).join('')}<th>T</th></tr></thead><tbody>
      <tr><td class="l">${esc(a.abbr)}</td>${g.away.periods.map((x) => `<td>${x}</td>`).join('')}<td><b>${g.away.score}</b></td></tr>
      <tr><td class="l">${esc(h.abbr)}</td>${g.home.periods.map((x) => `<td>${x}</td>`).join('')}<td><b>${g.home.score}</b></td></tr></tbody></table>`;
    const quarters = ['all', ...Array.from({ length: periods }, (_, i) => String(i + 1))];
    setView(`<div class="card">
      <div class="muted center small">${esc(g.label)}${g.playoff ? ' · Playoffs' : ''} · ${timeOf(g.at)}</div>
      <div class="game-head">
        <div class="tm">${badge(a, 'lg')}<b>${esc(a.name)}</b></div>
        <div><div class="big" id="live-score">${g.away.score} - ${g.home.score}</div><div class="status" id="live-status">${status}</div></div>
        <div class="tm">${badge(h, 'lg')}<b>${esc(h.name)}</b></div>
      </div>${line}</div>
      <div class="card"><div class="toolbar"><div class="seg"><button data-act="gtab" data-v="box" class="${u.tab === 'box' ? 'on' : ''}">Box score</button><button data-act="gtab" data-v="pbp" class="${u.tab === 'pbp' ? 'on' : ''}">Play-by-play</button></div>
        <span class="grow"></span><button class="btn primary" data-act="replay">▶ Watch live replay</button></div>
      ${u.tab === 'box' ? `${boxTable(g.away, g)}${boxTable(g.home, g)}` : `
        <div class="toolbar"><div class="seg">${quarters.map((q) => `<button data-act="gq" data-v="${q}" class="${u.q === q ? 'on' : ''}">${q === 'all' ? 'All' : qName(Number(q))}</button>`).join('')}</div></div>
        <div class="pbp"><table><tbody id="pbp-body">${pbpRows(g.pbp.filter((e) => u.q === 'all' || String(e.q) === u.q))}</tbody></table></div>`}
      </div>`);
  }

  function pbpRow(e, g) {
    if (e.t < 0) return `<tr class="period"><td colspan="4">${esc(e.x)}</td></tr>`;
    const side = e.t === 0 ? g.home : g.away;
    const scoring = /makes/.test(e.x);
    return `<tr class="${scoring ? 'score' : ''}"><td class="clk l">${qName(e.q)} ${clockFmt(e.c)}</td><td class="l" style="width:46px"><span class="tag">${esc(side.abbr)}</span></td><td class="l">${esc(e.x)}</td><td class="scr">${e.s[1]}-${e.s[0]}</td></tr>`;
  }
  function pbpRows(list) { return [...list].reverse().map((e) => pbpRow(e, S.game)).join(''); }

  // Live replay: plays the stored play-by-play back on a game clock.
  function stopReplay() { if (S.replay) { clearInterval(S.replay.timer); S.replay = null; } }
  function startReplay() {
    stopReplay();
    const g = S.game;
    S.ui.game.tab = 'pbp';
    S.ui.game.q = 'all';
    renderGame();
    const body = $('#pbp-body');
    body.innerHTML = '';
    const bar = document.createElement('div');
    bar.className = 'live-bar';
    bar.innerHTML = `<span class="tag live">LIVE</span><span>Speed</span><div class="seg" id="speed">${[10, 30, 60, 240].map((x) => `<button data-act="speed" data-v="${x}" class="${x === 30 ? 'on' : ''}">${x}×</button>`).join('')}</div><button class="btn sm" data-act="skip">Skip to final</button>`;
    body.closest('.card').insertBefore(bar, body.closest('.pbp'));
    const end = elapsedOf(g.pbp[g.pbp.length - 1]);
    S.replay = { t: 0, i: 0, speed: 30, end, timer: null };
    const step = () => {
      const R = S.replay;
      if (!R) return;
      R.t += R.speed * 0.1;
      let html = '';
      while (R.i < g.pbp.length && elapsedOf(g.pbp[R.i]) <= R.t) { html = pbpRow(g.pbp[R.i], g) + html; R.i++; }
      if (html) body.insertAdjacentHTML('afterbegin', html);
      const last = g.pbp[Math.max(0, R.i - 1)];
      const sc = $('#live-score');
      const st = $('#live-status');
      if (!sc) { stopReplay(); return; }
      sc.textContent = `${last.s[1]} - ${last.s[0]}`;
      if (R.i >= g.pbp.length) { st.textContent = `Final${g.ot ? ` / ${g.ot > 1 ? g.ot : ''}OT` : ''}`; stopReplay(); return; }
      const q = last.q;
      const len = q <= 4 ? 720 : 300;
      const base = q <= 4 ? (q - 1) * 720 : 2880 + (q - 5) * 300;
      st.innerHTML = `<span class="tag live">LIVE</span> ${qName(q)} ${clockFmt(Math.max(0, len - (R.t - base)))}`;
    };
    S.replay.timer = setInterval(step, 100);
  }

  // ------------------------------------------------------------ standings
  function viewStandings() {
    const lg = L();
    const po = lg.settings.playoffTeams;
    setView(`<div class="card"><h2>Standings</h2><div class="table-wrap"><table><thead><tr><th class="l">#</th><th class="l">Team</th><th class="l">Manager</th><th>W</th><th>L</th><th>PCT</th><th>GB</th><th>HOME</th><th>AWAY</th><th>PF/G</th><th>PA/G</th><th>DIFF</th><th>STRK</th><th>L10</th></tr></thead><tbody>
      ${lg.standings.map((t, i) => { const g = t.rec.w + t.rec.l; const l10 = t.rec.last.filter((x) => x === 'W').length; return `<tr class="${t.id === lg.me ? 'me' : ''}" ${i === po - 1 ? 'style="border-bottom:2px solid var(--accent)"' : ''}><td class="l">${i + 1}</td><td class="l">${badge(t)} <a href="#/team/${t.id}">${esc(t.name)}</a></td><td class="l">${esc(t.owner)} ${t.kind === 'cpu' ? '<span class="tag cpu">CPU</span>' : ''}</td>
        <td>${t.rec.w}</td><td>${t.rec.l}</td><td>${pct(g ? t.pct : null)}</td><td>${t.gb ? t.gb.toFixed(1) : '—'}</td><td>${t.rec.hw}-${t.rec.hl}</td><td>${t.rec.aw}-${t.rec.al}</td>
        <td>${g ? n1(t.rec.pf / g) : '–'}</td><td>${g ? n1(t.rec.pa / g) : '–'}</td><td class="${t.diff >= 0 ? 'good' : 'bad'}">${g ? `${t.diff > 0 ? '+' : ''}${n1(t.diff / g)}` : '–'}</td>
        <td>${t.rec.streak ? `${t.rec.streak > 0 ? 'W' : 'L'}${Math.abs(t.rec.streak)}` : '–'}</td><td>${t.rec.last.length ? `${l10}-${t.rec.last.length - l10}` : '–'}</td></tr>`; }).join('')}
      </tbody></table></div><p class="muted small">Top ${po} make the playoffs (best-of-${lg.settings.seriesLength}). Game ${lg.round} of ${lg.totalRounds || lg.settings.seasonGames} played.</p></div>
      ${lg.playoffs ? `<div class="card"><h2>Playoff bracket</h2>${bracket()}</div>` : ''}`);
  }

  // ------------------------------------------------------------ trades
  async function viewTrades(withTeam, _b, seq) {
    const lg = L();
    const u = S.ui.trade;
    if (withTeam && withTeam !== u.to) { u.to = withTeam; u.give = []; u.get = []; }
    if (!u.to || u.to === lg.me) u.to = (lg.teams.find((t) => t.id !== lg.me) || {}).id;
    const [trades, mine, other] = await Promise.all([api('GET', '/api/trades'), api('GET', `/api/teams/${lg.me}`), u.to ? api('GET', `/api/teams/${u.to}`) : null]);
    if (stale(seq)) return;
    u.give = u.give.filter((id) => mine.roster.some((p) => p.id === id));
    u.get = u.get.filter((id) => other && other.roster.some((p) => p.id === id));
    const all = new Map([...mine.roster, ...(other ? other.roster : [])].map((p) => [p.id, p]));
    const pname = (id) => { const p = all.get(id) || (S.players || []).find((x) => x.id === id); return p ? `<a href="#/player/${p.id}">${esc(p.name)}</a>` : esc(id); };
    const tv = (ids) => ids.reduce((a, id) => { const p = all.get(id); return a + (p ? Math.pow(p.value, 1.8) : 0); }, 0);
    const give = tv(u.give); const get = tv(u.get);
    const tot = give + get || 1;
    const pickList = (roster, key) => `<div class="pick-list">${[...roster].sort((a, b) => b.ovr - a.ovr).map((p) => `<label><input type="checkbox" data-on="tradePick" data-side="${key}" data-pid="${p.id}" ${u[key].includes(p.id) ? 'checked' : ''}>${ovr(p)}<span class="grow"><b>${esc(p.name)}</b> <span class="pos">${esc(p.pos)}</span>${injTag(p)}</span><span class="muted small">${n1((p.st.gp ? p.st : p.real).pts)}p ${n1((p.st.gp ? p.st : p.real).reb)}r ${n1((p.st.gp ? p.st : p.real).ast)}a</span></label>`).join('')}</div>`;
    const builder = lg.tradesOpen ? `<div class="card"><div class="card-head"><h2>Propose a trade</h2>
        <label>With <select data-on="tradeTo">${lg.teams.filter((t) => t.id !== lg.me).map((t) => `<option value="${t.id}" ${t.id === u.to ? 'selected' : ''}>${esc(t.name)} (${esc(t.owner)})</option>`).join('')}</select></label></div>
      <div class="trade-builder"><div><h3>You send</h3>${pickList(mine.roster, 'give')}</div><div><h3>You receive from ${esc(other.name)}</h3>${pickList(other.roster, 'get')}</div></div>
      <div style="margin-top:12px"><div class="small muted">Rough trade value (stars are worth more than the sum of role players)</div>
        <div class="meter"><div style="width:${(give / tot) * 100}%;background:var(--accent)"></div><div style="width:${(get / tot) * 100}%;background:var(--accent-2)"></div></div>
        <div class="small"><span style="color:var(--accent)">You send ${Math.round(give)}</span> · <span style="color:var(--accent-2)">You get ${Math.round(get)}</span>
        · Rosters after: you ${mine.roster.length - u.give.length + u.get.length}, them ${other.roster.length - u.get.length + u.give.length} (max ${lg.settings.maxRoster})</div></div>
      <label class="field" style="margin-top:10px"><span>Message (optional)</span><input type="text" id="tradeMsg" value="${esc(u.msg)}" data-on="tradeMsg" maxlength="280"></label>
      <button class="btn primary" data-act="sendTrade" ${u.give.length + u.get.length ? '' : 'disabled'}>Send offer</button>
      ${other.kind === 'cpu' ? '<span class="muted small"> CPU teams answer instantly.</span>' : ''}</div>`
      : `<div class="notice">${lg.phase === 'season' ? 'The trade deadline has passed.' : 'Trades open once the regular season starts.'}</div>`;
    const card = (t) => {
      const from = team(t.from); const to = team(t.to);
      const status = { pending: 'tag', accepted: 'tag fa', rejected: 'tag inj', cancelled: 'tag', void: 'tag' }[t.status];
      let btns = '';
      if (t.status === 'pending' && t.to === lg.me) btns = `<button class="btn good sm" data-act="tradeAct" data-id="${t.id}" data-v="accept">Accept</button> <button class="btn sm" data-act="tradeAct" data-id="${t.id}" data-v="reject">Reject</button>`;
      if (t.status === 'pending' && t.from === lg.me) btns = `<button class="btn sm" data-act="tradeAct" data-id="${t.id}" data-v="cancel">Withdraw</button>`;
      return `<div class="trade-card"><div class="card-head" style="margin:0"><div>${badge(from)} <b>${esc(from.name)}</b> ⇄ ${badge(to)} <b>${esc(to.name)}</b></div><div><span class="${status}">${t.status}</span> <span class="muted small">${ago(t.resolvedAt || t.createdAt)}</span></div></div>
        <div class="sides"><div><div class="small muted">${esc(from.abbr)} receive</div>${t.get.map(pname).join(', ') || '—'}</div><div><div class="small muted">${esc(to.abbr)} receive</div>${t.give.map(pname).join(', ') || '—'}</div></div>
        ${t.message ? `<div class="small">💬 ${esc(t.message)}</div>` : ''}${t.note ? `<div class="small muted">${esc(t.note)}</div>` : ''}<div class="btn-row" style="margin-top:6px">${btns}</div></div>`;
    };
    const incoming = trades.filter((t) => t.status === 'pending' && t.to === lg.me);
    const outgoing = trades.filter((t) => t.status === 'pending' && t.from === lg.me);
    const history = trades.filter((t) => t.status !== 'pending');
    setView(`<div class="grid grid-2"><div>${builder}</div><div>
      <div class="card"><h2>Offers to you (${incoming.length})</h2>${incoming.map(card).join('') || '<p class="muted">None right now.</p>'}</div>
      <div class="card"><h2>Your pending offers</h2>${outgoing.map(card).join('') || '<p class="muted">None.</p>'}</div></div></div>
      <div class="card"><h2>Trade history</h2>${history.map(card).join('') || '<p class="muted">No trades yet.</p>'}</div>`);
  }

  // ------------------------------------------------------------ league
  async function viewLeague(_a, _b, seq) {
    const lg = L();
    const news = await api('GET', '/api/news');
    if (stale(seq)) return;
    const s = lg.settings;
    const commish = isCommish() ? `<div class="card"><h2>Commissioner tools</h2>
      ${lg.phase === 'season' || lg.phase === 'playoffs' ? `<div class="btn-row" style="margin-bottom:12px"><input type="number" id="simN" value="1" min="1" max="100" style="width:80px"><button class="btn primary" data-act="simNow">Sim game day(s) now</button>
        <button class="btn" data-act="pause">${lg.paused ? '▶ Resume season' : '⏸ Pause season'}</button></div>` : ''}
      ${lg.phase === 'lobby' ? '<button class="btn primary" data-act="startDraft">Start the draft</button>' : ''}
      ${lg.phase === 'complete' ? '<button class="btn primary" data-act="newSeason">Start next season</button>' : ''}
      <form data-form="settings" style="margin-top:12px"><div class="form-row">
        <label class="field"><span>Minutes between game days</span><input type="number" name="tickMinutes" value="${s.tickMinutes}" min="1" max="1440"></label>
        <label class="field"><span>Draft pick clock (sec)</span><input type="number" name="pickSeconds" value="${s.pickSeconds}" min="0" max="600"></label>
        <label class="field"><span>Trade deadline (game #)</span><input type="number" name="tradeDeadline" value="${s.tradeDeadline}" min="0" max="${s.seasonGames}"></label>
      </div><label><input type="checkbox" name="injuries" ${s.injuries ? 'checked' : ''}> Injuries enabled</label><div style="margin-top:10px"><button class="btn" type="submit">Save settings</button></div></form></div>` : '';
    setView(`<div class="grid grid-2"><div>
      <div class="card"><h2>${esc(lg.name)} · Season ${lg.season}</h2>
        <p>${esc(phaseName[lg.phase])}${lg.phase === 'season' ? ` — game ${lg.round} of ${lg.totalRounds} played` : ''}${lg.nextTickAt && !lg.paused ? ` · next game day ${timeOf(lg.nextTickAt)} (${cd(lg.nextTickAt)})` : ''}</p>
        <div class="notice">Invite code <b style="letter-spacing:2px">${esc(lg.inviteCode)}</b>${LOCAL ? ' · saved on this device' : ` · link <b>${esc(location.origin)}/</b>`}</div>
        <table><tbody>
          <tr><td class="l">Teams</td><td class="l">${s.numTeams} (${s.humanSlots} human)</td></tr>
          <tr><td class="l">Season</td><td class="l">${s.seasonGames} games, one game day every ${s.tickMinutes} min</td></tr>
          <tr><td class="l">Rosters</td><td class="l">${s.rosterSize} drafted, max ${s.maxRoster}, min ${s.minRoster}</td></tr>
          <tr><td class="l">Playoffs</td><td class="l">Top ${s.playoffTeams}, best-of-${s.seriesLength}</td></tr>
          <tr><td class="l">Trade deadline</td><td class="l">${s.tradeDeadline ? `after game ${s.tradeDeadline}` : 'none'}</td></tr>
          <tr><td class="l">Injuries</td><td class="l">${s.injuries ? 'on' : 'off'}</td></tr>
        </tbody></table></div>
      ${commish}
      <div class="card"><h2>Managers</h2><table><tbody>${lg.teams.map((t) => `<tr><td class="l">${badge(t)} <a href="#/team/${t.id}">${esc(t.name)}</a></td><td class="l">${esc(t.owner || '—')}</td><td class="l"><span class="tag ${t.kind}">${t.id === lg.commissioner ? 'commish' : t.kind}</span></td><td>${rec(t)}</td></tr>`).join('')}</tbody></table></div>
    </div><div>
      <div class="card"><h2>You</h2><p>${esc(me().owner)} · ${esc(me().name)}</p><div class="btn-row"><button class="btn" data-act="enableAlerts">Enable desktop alerts</button><button class="btn" data-act="logout">Log out</button>${LOCAL ? '<button class="btn" data-act="switchUser">👥 Switch manager</button>' : ''}</div>
        ${LOCAL && isCommish() ? '<p class="muted small" style="margin-top:12px">Start over? This erases the league, rosters and every game on this device.</p><button class="btn" data-act="eraseLeague" style="color:var(--bad)">Erase league on this device</button>' : ''}</div>
      <div class="card"><h2>Transactions</h2><ul class="feed">${news.transactions.slice(0, 60).map((x) => `<li><span>${esc(x.text)}</span><span class="ts">${ago(x.ts)}</span></li>`).join('') || '<li class="muted">None yet.</li>'}</ul></div>
    </div></div>`);
  }

  const VIEWS = { home: viewHome, team: viewTeam, players: viewPlayers, player: viewPlayer, draft: viewDraft, scores: viewScores, game: viewGame, standings: viewStandings, trades: viewTrades, league: viewLeague };

  // ------------------------------------------------------------ actions
  async function act(fn, okMsg) {
    try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { showError(e); return null; }
  }
  async function reloadAll() { S.players = null; await refreshLeague(); S.dirty = false; await render(); }

  function collectLineup() {
    const starters = $$('[data-on="starter"]').filter((x) => x.checked).map((x) => x.dataset.pid);
    const minutes = {};
    for (const el of $$('[data-on="minutes"]')) minutes[el.dataset.pid] = Number(el.value) || 0;
    const strategy = {};
    for (const el of $$('[data-strategy]')) strategy[el.dataset.strategy] = el.value;
    return { starters, minutes, strategy };
  }

  async function addPlayer(pid) {
    const lg = L();
    const mine = await api('GET', `/api/teams/${lg.me}`);
    if (mine.roster.length < lg.settings.maxRoster) {
      await act(() => api('POST', '/api/fa/add', { pid }), 'Player added!');
      return reloadAll();
    }
    modal(`<h2>Roster full</h2><p>Pick someone to release:</p><div class="pick-list">${[...mine.roster].sort((a, b) => a.ovr - b.ovr).map((p) => `<label><input type="radio" name="drop" value="${p.id}">${ovr(p)}<span class="grow">${esc(p.name)} ${injTag(p)}</span></label>`).join('')}</div>
      <div class="btn-row" style="margin-top:12px"><button class="btn primary" data-act="confirmAdd" data-pid="${pid}">Add & drop</button><button class="btn" data-act="closeModal">Cancel</button></div>`);
  }

  const ACTIONS = {
    bell: async () => {
      const panel = $('#notif-panel');
      if (!panel.classList.contains('hidden')) { panel.classList.add('hidden'); return; }
      const list = await api('GET', '/api/notifications');
      panel.innerHTML = `<div class="hd"><b>Notifications</b><button class="btn sm" data-act="bell">Close</button></div>${list.map((n) => `<a class="notif ${n.read ? '' : 'unread'}" href="${esc(n.link || '#/')}" data-act="notifGo"><span>${{ trade: '🔁', game: '🏀', injury: '🚑', draft: '📋', playoffs: '🏆', transaction: '✍️', league: '📣' }[n.type] || '•'}</span><span style="flex:1">${esc(n.text)}<div class="muted small">${ago(n.ts)}</div></span></a>`).join('') || '<div class="notif muted">Nothing yet.</div>'}`;
      panel.classList.remove('hidden');
      await api('POST', '/api/notifications/read');
      L().unread = 0;
      renderChrome();
    },
    notifGo: (el) => { $('#notif-panel').classList.add('hidden'); location.hash = el.getAttribute('href'); },
    reload: () => reloadAll(),
    logout: () => logout(false),
    switchUser: () => { logout(false); toast('Pass the phone — log in or join as the other manager.'); },
    pickLogin: (el) => { const f = $('#loginName'); f.value = el.dataset.name; const pw = $('form[data-form=login] input[name=password]'); if (pw) pw.focus(); },
    eraseLeague: async () => {
      if (!LOCAL || !confirm('Erase this league and all its games from this device? This cannot be undone.')) return;
      if (!confirm('Really erase everything?')) return;
      await LOCAL.reset();
    },
    closeModal,
    enableAlerts: async () => {
      if (!window.Notification) return toast('This browser does not support notifications');
      const p = await Notification.requestPermission();
      toast(p === 'granted' ? 'Desktop alerts on — you will be pinged for trades, results and injuries.' : 'Notifications were blocked.');
    },
    startDraft: async () => { if (confirm('Start the draft now? Open slots become CPU teams.')) { await act(() => api('POST', '/api/draft/start')); location.hash = '#/draft'; await reloadAll(); } },
    draftPick: async (el) => { await act(() => api('POST', '/api/draft/pick', { pid: el.dataset.pid })); await reloadAll(); },
    dpos: (el) => { S.ui.draft.pos = el.dataset.v; render(); },
    ppos: (el) => { S.ui.players.pos = el.dataset.v; S.ui.players.limit = 100; render(); },
    pmode: (el) => { S.ui.players.mode = el.dataset.v; if (el.dataset.v === 'st' && S.ui.players.sort === 'ovr') S.ui.players.sort = 'pts'; render(); },
    sortPlayers: (el) => { const u = S.ui.players; const k = el.dataset.k; if (u.sort === k) u.dir *= -1; else { u.sort = k; u.dir = -1; } render(); },
    moreplayers: () => { S.ui.players.limit += 150; render(); },
    add: (el) => addPlayer(el.dataset.pid),
    confirmAdd: async (el) => {
      const drop = ($('input[name=drop]:checked') || {}).value;
      if (!drop) return toast('Pick a player to drop');
      closeModal();
      await act(() => api('POST', '/api/fa/add', { pid: el.dataset.pid, drop }), 'Done!');
      reloadAll();
    },
    drop: async (el) => { if (!confirm('Release this player to free agency?')) return; await act(() => api('POST', '/api/fa/drop', { pid: el.dataset.pid }), 'Player released'); reloadAll(); },
    saveLineup: async () => {
      const body = collectLineup();
      if (body.starters.length !== 5) return toast(`Pick exactly 5 starters (you have ${body.starters.length})`);
      const r = await act(() => api('PUT', '/api/lineup', body), 'Lineup saved ✔');
      if (r) { S.dirty = false; reloadAll(); }
    },
    savePlan: async (el) => {
      const assign = {};
      for (const s of $$('[data-assign]')) if (s.value) assign[s.dataset.assign] = s.value;
      const r = await act(() => api('PUT', `/api/matchups/${el.dataset.opp}`, { assign, doubleTeam: $('#doubleTeam').value || null }), 'Game plan saved ✔');
      if (r) S.dirty = false;
    },
    gtab: (el) => { stopReplay(); S.ui.game.tab = el.dataset.v; renderGame(); },
    gq: (el) => { stopReplay(); S.ui.game.q = el.dataset.v; renderGame(); },
    replay: () => startReplay(),
    speed: (el) => { if (S.replay) S.replay.speed = Number(el.dataset.v); $$('#speed button').forEach((b) => b.classList.toggle('on', b === el)); },
    skip: () => { if (S.replay) S.replay.t = S.replay.end + 1; },
    allScores: () => { S.ui.scores.all = true; render(); },
    sendTrade: async () => {
      const u = S.ui.trade;
      const r = await act(() => api('POST', '/api/trades', { to: u.to, give: u.give, get: u.get, message: u.msg }));
      if (!r) return;
      toast(r.status === 'accepted' ? 'Trade accepted! 🎉' : r.status === 'rejected' ? `Rejected. ${r.note || ''}` : 'Offer sent — they have been notified.', 'trade');
      u.give = []; u.get = []; u.msg = '';
      reloadAll();
    },
    tradeAct: async (el) => {
      const v = el.dataset.v;
      if (v === 'accept' && !confirm('Accept this trade?')) return;
      await act(() => api('POST', `/api/trades/${el.dataset.id}/${v}`), v === 'accept' ? 'Trade complete! 🎉' : null);
      reloadAll();
    },
    tradeFor: (el) => { const u = S.ui.trade; u.to = el.dataset.team; u.give = []; u.get = [el.dataset.pid]; location.hash = `#/trades/${el.dataset.team}`; },
    simNow: async () => { const n = Number($('#simN').value) || 1; const r = await act(() => api('POST', '/api/commish/sim', { n })); if (r) toast(`Simulated ${r.played} game day(s)`); reloadAll(); },
    pause: async () => { await act(() => api('POST', '/api/commish/pause', { paused: !L().paused })); reloadAll(); },
    newSeason: async () => { if (confirm('Start a new season with the same rosters?')) { await act(() => api('POST', '/api/commish/newseason')); reloadAll(); } },
  };

  const ON = {
    dirty: () => { S.dirty = true; },
    starter: () => { S.dirty = true; },
    minutes: () => { S.dirty = true; },
    autoLineup: async (el) => {
      if (el.checked) { await act(() => api('PUT', '/api/lineup', { auto: true }), 'Auto lineup on'); reloadAll(); } else { await act(() => api('PUT', '/api/lineup', collectLineup()), 'Manual lineup — you are the coach now'); reloadAll(); }
    },
    planOpp: (el) => { S.ui.planOpp = el.value; location.hash = `#/team/${L().me}/plan/${el.value}`; },
    pq: (el) => { S.ui.players.q = el.value; S.ui.players.limit = 100; render(); },
    pstatus: (el) => { S.ui.players.status = el.value; render(); },
    dq: (el) => { S.ui.draft.q = el.value; render(); },
    autodraft: async (el) => { await act(() => api('POST', '/api/draft/autodraft', { on: el.checked })); reloadAll(); },
    tradeTo: (el) => { const u = S.ui.trade; u.to = el.value; u.get = []; location.hash = `#/trades/${el.value}`; },
    tradePick: (el) => {
      const u = S.ui.trade; const arr = u[el.dataset.side]; const id = el.dataset.pid;
      if (el.checked && !arr.includes(id)) arr.push(id);
      if (!el.checked) u[el.dataset.side] = arr.filter((x) => x !== id);
      render();
    },
    tradeMsg: (el) => { S.ui.trade.msg = el.value; },
  };

  const FORMS = {
    setup: async (f) => {
      const d = formData(f);
      const settings = {};
      for (const k of ['numTeams', 'humanSlots', 'seasonGames', 'tickMinutes', 'pickSeconds', 'rosterSize', 'playoffTeams', 'seriesLength', 'tradeDeadline']) settings[k] = Number(d[k]);
      settings.injuries = d.injuries;
      settings.maxRoster = Math.max(settings.rosterSize + 2, 15);
      const r = await act(() => api('POST', '/api/setup', { leagueName: d.leagueName, teamName: d.teamName, ownerName: d.ownerName, password: d.password, settings }));
      if (r) { S.token = r.token; localStorage.setItem('fh_token', r.token); S.league = null; location.hash = '#/'; render(); }
    },
    join: async (f) => {
      const r = await act(() => api('POST', '/api/join', formData(f)));
      if (r) { S.token = r.token; localStorage.setItem('fh_token', r.token); S.league = null; location.hash = '#/'; render(); }
    },
    login: async (f) => {
      const r = await act(() => api('POST', '/api/login', formData(f)));
      if (r) { S.token = r.token; localStorage.setItem('fh_token', r.token); S.league = null; render(); }
    },
    settings: async (f) => {
      const d = formData(f);
      await act(() => api('POST', '/api/commish/settings', { tickMinutes: Number(d.tickMinutes), pickSeconds: Number(d.pickSeconds), tradeDeadline: Number(d.tradeDeadline), injuries: d.injuries }), 'Settings saved');
      reloadAll();
    },
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) {
      if (!e.target.closest('#notif-panel') && !e.target.closest('.bell')) $('#notif-panel').classList.add('hidden');
      if (e.target.id === 'modal') closeModal();
      return;
    }
    const fn = ACTIONS[el.dataset.act];
    if (!fn) return;
    e.preventDefault();
    Promise.resolve(fn(el, e)).catch(showError);
  });
  let debounce = null;
  const onEvent = (e) => {
    const el = e.target.closest('[data-on]');
    if (!el) return;
    const fn = ON[el.dataset.on];
    if (!fn) return;
    const isText = el.type === 'search' || el.type === 'text';
    if (isText) {
      if (e.type !== 'input') return;
      if (el.dataset.on === 'tradeMsg') { fn(el, e); return; }
      clearTimeout(debounce);
      debounce = setTimeout(() => Promise.resolve(fn(el, e)).catch(showError), 250);
      return;
    }
    if (e.type === 'input') { if (el.type === 'number') S.dirty = true; return; }
    Promise.resolve(fn(el, e)).catch(showError);
  };
  document.addEventListener('input', onEvent);
  document.addEventListener('change', onEvent);
  document.addEventListener('submit', (e) => {
    const f = e.target;
    if (!f.dataset.form) return;
    e.preventDefault();
    FORMS[f.dataset.form](f).catch(showError);
  });

  setInterval(() => {
    for (const el of $$('[data-countdown]')) el.textContent = countdownText(Number(el.dataset.countdown));
  }, 1000);

  window.addEventListener('hashchange', route);
  route();
})();
