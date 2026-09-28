/*
 * In-browser runtime for the GitHub Pages build.
 * Runs the exact same league + game engine as the Node server (bundled into core.js),
 * stores everything in IndexedDB on this device, and answers the app's /api/* calls locally.
 * Game days are simulated on schedule while the app is open; any that were missed while it
 * was closed are caught up as soon as it opens again.
 */
(() => {
  'use strict';
  const { League, LeagueError } = FHCore.league;
  const { parsePlayersCsv, buildPool } = FHCore.players;
  const { routes, dispatch } = FHCore.routes;

  // ---------------------------------------------------------------- SHA-256 (sync)
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  function sha256(bytes) {
    const len = bytes.length;
    const total = ((len + 9 + 63) >> 6) << 6;
    const buf = new Uint8Array(total);
    buf.set(bytes);
    buf[len] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(total - 4, len * 8);
    dv.setUint32(total - 8, Math.floor(len / 0x20000000));
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const W = new Uint32Array(64);
    const rot = (x, n) => (x >>> n) | (x << (32 - n));
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rot(W[i - 15], 7) ^ rot(W[i - 15], 18) ^ (W[i - 15] >>> 3);
        const s1 = rot(W[i - 2], 17) ^ rot(W[i - 2], 19) ^ (W[i - 2] >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
        const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    return [...H].map((x) => x.toString(16).padStart(8, '0')).join('');
  }
  const utf8 = (s) => new TextEncoder().encode(s);
  const secure = {
    randomHex(n) { const b = new Uint8Array(n); crypto.getRandomValues(b); return [...b].map((x) => x.toString(16).padStart(2, '0')).join(''); },
    hash(pw, salt) { let h = sha256(utf8(`${salt}:${pw}`)); for (let i = 0; i < 500; i++) h = sha256(utf8(h + salt)); return h; },
    equal(a, b) { return a === b; },
  };

  // ---------------------------------------------------------------- IndexedDB store
  function idb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('fantasy-hoops', 1);
      req.onupgradeneeded = () => { req.result.createObjectStore('kv'); req.result.createObjectStore('games'); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  const tx = (db, store, mode, fn) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r && r.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });

  class BrowserStore {
    constructor(db, state) { this.db = db; this.state = state; this.timer = null; this.pending = null; this.recent = new Map(); }
    static async open() {
      try {
        const db = await idb();
        const state = await tx(db, 'kv', 'readonly', (s) => s.get('state'));
        if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
        return new BrowserStore(db, state || null);
      } catch (e) {
        console.warn('IndexedDB unavailable — league will not be saved', e);
        return new BrowserStore(null, null);
      }
    }
    load() { return this.state; }
    // The league object lives in memory; writes are coalesced so a burst of changes is one write.
    save(state, delay = 200) {
      this.pending = state;
      if (this.timer) return;
      this.timer = setTimeout(() => this.flush(), delay);
    }
    saveNow(state) { this.save(state, 50); }
    flush() {
      clearTimeout(this.timer);
      this.timer = null;
      const state = this.pending;
      this.pending = null;
      if (!state || !this.db) return Promise.resolve();
      return tx(this.db, 'kv', 'readwrite', (s) => s.put(state, 'state')).catch((e) => console.error('save failed', e));
    }
    saveGame(id, game) {
      this.recent.set(id, game);
      if (this.recent.size > 40) this.recent.delete(this.recent.keys().next().value);
      if (this.db) tx(this.db, 'games', 'readwrite', (s) => s.put(game, id)).catch((e) => console.error('game save failed', e));
    }
    loadGame(id) {
      if (this.recent.has(id)) return Promise.resolve(this.recent.get(id));
      if (!this.db) return Promise.resolve(null);
      return tx(this.db, 'games', 'readonly', (s) => s.get(id)).then((g) => g || null);
    }
    async clear() {
      if (!this.db) return;
      clearTimeout(this.timer);
      this.pending = null;
      await tx(this.db, 'kv', 'readwrite', (s) => s.clear());
      await tx(this.db, 'games', 'readwrite', (s) => s.clear());
    }
  }

  // ---------------------------------------------------------------- boot
  const listeners = { update: [], notify: [] };
  let league = null;
  let store = null;
  let table = null;

  const ready = (async () => {
    store = await BrowserStore.open();
    const pool = buildPool(parsePlayersCsv(FH_PLAYERS_CSV));
    league = new League({ store, pool, secure });
    table = routes(league);
    league.on('update', (d) => listeners.update.forEach((fn) => fn(d)));
    league.on('notify', ({ teamId, n }) => listeners.notify.forEach((fn) => fn(teamId, n)));
    // Scheduler: runs draft clocks and game days. Several ticks per beat so missed days catch up fast.
    setInterval(() => {
      try { for (let i = 0; i < 4; i++) league.tick(); } catch (e) { console.error('tick failed', e); }
    }, 250);
    const flush = () => { if (league.s) { store.pending = league.s; store.flush(); } };
    document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
    window.addEventListener('pagehide', flush);
  })();

  window.FH_LOCAL = {
    ready,
    async request(method, path, body, token) {
      await ready;
      try {
        const pathname = path.split('?')[0];
        const data = await dispatch(league, table, { method, pathname, body: body || {}, token }, LeagueError);
        // Behave like a network hop: callers get their own copy, never live league objects.
        return { ok: true, status: 200, data: JSON.parse(JSON.stringify(data)) };
      } catch (e) {
        if (!(e instanceof LeagueError)) console.error(e);
        return { ok: false, status: e.status || 500, data: { error: e instanceof LeagueError ? e.message : 'Something went wrong' } };
      }
    },
    on(event, fn) { listeners[event].push(fn); },
    async reset() {
      await ready;
      league.s = null; // stop the scheduler and the on-hide flush from re-saving
      await store.clear();
      localStorage.removeItem('fh_token');
      location.hash = '#/';
      location.reload();
    },
  };
})();
