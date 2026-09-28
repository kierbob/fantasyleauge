'use strict';
// Tiny JSON persistence: one league file plus one file per played game (box score + play-by-play).
const fs = require('fs');
const path = require('path');

class Store {
  constructor(dir) {
    this.dir = dir;
    this.gamesDir = path.join(dir, 'games');
    fs.mkdirSync(this.gamesDir, { recursive: true });
    this.file = path.join(dir, 'league.json');
    this.timer = null;
  }

  load() {
    if (!fs.existsSync(this.file)) return null;
    return JSON.parse(fs.readFileSync(this.file, 'utf8'));
  }

  writeAtomic(file, data) {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  }

  saveNow(state) {
    clearTimeout(this.timer);
    this.timer = null;
    this.writeAtomic(this.file, JSON.stringify(state));
  }

  // Coalesce bursts of writes (draft picks, lineup tweaks) into one.
  save(state) {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.saveNow(state); }, 250);
  }

  saveGame(id, game) {
    this.writeAtomic(path.join(this.gamesDir, `${id}.json`), JSON.stringify(game));
  }

  loadGame(id) {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
    const f = path.join(this.gamesDir, `${id}.json`);
    if (!fs.existsSync(f)) return null;
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  }
}

module.exports = { Store };
