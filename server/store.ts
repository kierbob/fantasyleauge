import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { League } from '../shared/types.ts';

export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), {recursive:true});
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, salt TEXT NOT NULL, hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS leagues (id TEXT PRIMARY KEY, state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, userId TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, leagueId TEXT NOT NULL, created INTEGER NOT NULL, seen INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS push_subscriptions (endpoint TEXT PRIMARY KEY, userId TEXT NOT NULL, subscription TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  }
  save(league: League) { this.db.prepare('INSERT INTO leagues(id,state) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state').run(league.id, JSON.stringify(league)); }
  load(): League[] { return this.db.prepare('SELECT state FROM leagues').all().map(r => JSON.parse(String(r.state))); }
  close() { this.db.close(); }
}
