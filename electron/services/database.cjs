const fs = require('node:fs');
const path = require('node:path');

function defaultDatabaseFactory(filename) {
  const Database = require('better-sqlite3');
  return new Database(filename);
}

class DatabaseService {
  constructor({ dataDir, migrationsDir, databaseFactory = defaultDatabaseFactory }) {
    this.dataDir = dataDir;
    this.migrationsDir = migrationsDir;
    this.databaseFactory = databaseFactory;
    this.dbPath = path.join(dataDir, 'sistema-financeiro.sqlite');
    this.db = null;
  }

  open() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.db = this.databaseFactory(this.dbPath);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.#migrate();
    return { path: this.dbPath };
  }

  #userVersion() {
    const row = this.db.prepare('PRAGMA user_version').get();
    return Number(row?.user_version ?? 0);
  }

  #migrate() {
    const files = fs.readdirSync(this.migrationsDir)
      .filter((file) => /^\d+.*\.sql$/.test(file))
      .sort();
    let current = this.#userVersion();

    for (const file of files) {
      const version = Number(file.match(/^\d+/)[0]);
      if (version <= current) continue;
      const sql = fs.readFileSync(path.join(this.migrationsDir, file), 'utf8');
      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.db.exec(sql);
        this.db.prepare('INSERT OR IGNORE INTO migrations(id, name) VALUES (?, ?)').run(version, file);
        this.db.exec(`PRAGMA user_version = ${version}`);
        this.db.exec('COMMIT');
        current = version;
      } catch (error) {
        try { this.db.exec('ROLLBACK'); } catch {}
        throw error;
      }
    }
  }

  connection() {
    if (!this.db) throw new Error('database is not open');
    return this.db;
  }

  health() {
    return {
      ok: Boolean(this.db),
      storage: 'sqlite',
      userVersion: this.db ? this.#userVersion() : 0,
      path: this.dbPath,
    };
  }

  close() {
    if (this.db) this.db.close();
    this.db = null;
  }
}

module.exports = { DatabaseService };
