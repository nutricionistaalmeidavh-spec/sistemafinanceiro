import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
const require = createRequire(import.meta.url);
const { DatabaseService } = require('../electron/services/database.cjs');

test('DatabaseService creates a safety copy before migrating an existing database', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-db-lifecycle-'));
  const dataDir = path.join(root, 'data');
  const migrationsDir = path.join(root, 'migrations');
  fs.mkdirSync(migrationsDir, { recursive: true });
  fs.writeFileSync(path.join(migrationsDir, '001_base.sql'), `CREATE TABLE migrations(id INTEGER PRIMARY KEY,name TEXT UNIQUE,applied_at TEXT DEFAULT CURRENT_TIMESTAMP); CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT DEFAULT CURRENT_TIMESTAMP); INSERT INTO app_meta(key,value) VALUES ('schema','v1');`);
  const service = new DatabaseService({ dataDir, migrationsDir, databaseFactory:(filename)=>new DatabaseSync(filename) });
  try {
    service.open();
    service.connection().prepare("UPDATE app_meta SET value='before-v2'").run();
    service.close();
    fs.writeFileSync(path.join(migrationsDir, '002_next.sql'), `CREATE TABLE feature_v2(id INTEGER PRIMARY KEY); UPDATE app_meta SET value='v2';`);
    service.open();
    assert.equal(service.connection().prepare('PRAGMA user_version').get().user_version, 2);
    const backupsDir = path.join(dataDir, 'backups');
    const copies = fs.readdirSync(backupsDir).filter((name)=>name.startsWith('pre-migration-v1-to-v2-') && name.endsWith('.sqlite'));
    assert.equal(copies.length, 1);
    const old = new DatabaseSync(path.join(backupsDir, copies[0]));
    try { assert.equal(old.prepare("SELECT value FROM app_meta WHERE key='schema'").get().value, 'before-v2'); }
    finally { old.close(); }
    const manual = path.join(root, 'manual.sqlite');
    service.prepareBackup(manual);
    assert.equal(fs.existsSync(manual), true);
    service.reopen();
    assert.equal(service.health().userVersion, 2);
  } finally { service.close(); fs.rmSync(root,{recursive:true,force:true}); }
});
