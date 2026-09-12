import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { createHarness } from './helpers/test-harness.mjs';
const require = createRequire(import.meta.url);
const { createBackupService } = require('../electron/services/backup-service.cjs');

test('backup service creates verified backup and restores only valid SQLite files', () => {
  const ctx = createHarness();
  try {
    const backupsDir = path.join(ctx.root, 'backups');
    const service = createBackupService({
      database: ctx.database,
      backupsDir,
      now: () => '2026-09-12T12:00:00.000Z',
      verifyDatabaseFactory: (filename) => new DatabaseSync(filename),
    });
    ctx.db.prepare("UPDATE app_meta SET value='before-backup' WHERE key='schema'").run();
    const backup = service.createBackup({ kind: 'MANUAL' });
    assert.equal(fs.existsSync(backup.path), true);
    assert.equal(fs.existsSync(`${backup.path}.manifest.json`), true);
    assert.equal(service.verifyBackup(backup.path).valid, true);

    ctx.db.prepare("UPDATE app_meta SET value='after-backup' WHERE key='schema'").run();
    const restored = service.restoreBackup(backup.path, { id: 'local-admin', role: 'ADMIN' });
    assert.equal(restored.restored, true);
    assert.equal(ctx.database.connection().prepare("SELECT value FROM app_meta WHERE key='schema'").get().value, 'before-backup');

    const invalid = path.join(backupsDir, 'invalid.sqlite');
    fs.writeFileSync(invalid, 'not sqlite');
    assert.throws(() => service.restoreBackup(invalid, { id: 'local-admin', role: 'ADMIN' }), /invalid|integrity|backup/i);
  } finally { ctx.cleanup(); }
});
