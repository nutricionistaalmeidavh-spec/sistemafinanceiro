const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function defaultDatabaseFactory(filename) {
  return new DatabaseSync(filename);
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

  #migrationFiles() {
    return fs.readdirSync(this.migrationsDir)
      .filter((file) => /^\d+.*\.sql$/.test(file))
      .sort();
  }

  #preMigrationBackup(current, target) {
    if (current <= 0 || target <= current || !fs.existsSync(this.dbPath)) return null;
    this.checkpoint();
    const dir = path.join(this.dataDir, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const destination = path.join(dir, `pre-migration-v${current}-to-v${target}-${stamp}.sqlite`);
    fs.copyFileSync(this.dbPath, destination);
    return destination;
  }

  #migrate() {
    const files = this.#migrationFiles();
    let current = this.#userVersion();
    const target = files.reduce((max, file) => Math.max(max, Number(file.match(/^\d+/)[0])), current);
    this.#preMigrationBackup(current, target);

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

  checkpoint() {
    if (!this.db) throw new Error('database is not open');
    try { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); }
    catch { try { this.db.exec('PRAGMA wal_checkpoint(FULL)'); } catch {} }
    return true;
  }

  prepareBackup(destination) {
    if (!this.db) throw new Error('database is not open');
    if (!destination) throw new Error('backup destination is required');
    this.checkpoint();
    const target = path.resolve(String(destination));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(this.dbPath, target);
    return target;
  }

  reopen() {
    this.close();
    return this.open();
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
