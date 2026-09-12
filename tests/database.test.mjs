import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const { DatabaseService } = require('../electron/services/database.cjs');

test('DatabaseService creates the local database, applies migrations and reports health', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sistemafinanceiro-'));
  const dataDir = path.join(root, 'data');
  const migrationsDir = path.resolve('database/migrations');
  const service = new DatabaseService({ dataDir, migrationsDir, databaseFactory: (filename) => new DatabaseSync(filename) });
  try {
    const opened = service.open();
    assert.equal(fs.existsSync(opened.path), true);
    assert.equal(service.connection().prepare('PRAGMA user_version').get().user_version, 2);
    assert.deepEqual(service.health(), { ok: true, storage: 'sqlite', userVersion: 2, path: opened.path });
  } finally {
    service.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
