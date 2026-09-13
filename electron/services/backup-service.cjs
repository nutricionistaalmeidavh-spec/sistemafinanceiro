'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { writeAudit } = require('./audit.cjs');

function sha256File(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
function safeStamp(value) { return new Date(value).toISOString().replace(/[:.]/g, '-'); }
function firstValue(row) { return row && Object.values(row)[0]; }

function createBackupService({
  database,
  backupsDir,
  now = () => new Date().toISOString(),
  idFactory = (prefix) => `${prefix}-${randomUUID()}`,
  verifyDatabaseFactory = null,
  autoRetention = 7,
} = {}) {
  if (!database || !backupsDir) throw new TypeError('database and backupsDir are required');
  const nowIso = () => String(now());
  const factory = verifyDatabaseFactory || ((filename) => {
    const Database = require('better-sqlite3');
    return new Database(filename, { readonly: true });
  });
  fs.mkdirSync(backupsDir, { recursive: true });

  function recordBackup({ id, kind, filePath, hash, bytes, schemaVersion, status = 'VERIFIED', createdAt = nowIso(), verifiedAt = nowIso() }) {
    try {
      database.connection().prepare(`INSERT OR REPLACE INTO backup_history(id,kind,path,sha256,bytes,schema_version,status,created_at,verified_at) VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(id, kind, filePath, hash, bytes, schemaVersion, status, createdAt, verifiedAt);
    } catch {}
  }

  function createBackup({ kind = 'MANUAL', destination = null } = {}) {
    const normalizedKind = String(kind || 'MANUAL').toUpperCase();
    if (!['MANUAL', 'AUTO', 'PRE_MIGRATION', 'PRE_RESTORE'].includes(normalizedKind)) throw new Error('invalid backup kind');
    const createdAt = nowIso();
    const filePath = destination ? path.resolve(String(destination)) : path.join(backupsDir, `${normalizedKind.toLowerCase()}-${safeStamp(createdAt)}.sqlite`);
    database.prepareBackup(filePath);
    const hash = sha256File(filePath);
    const bytes = fs.statSync(filePath).size;
    const schemaVersion = Number(database.connection().prepare('PRAGMA user_version').get().user_version || 0);
    const manifest = { version: 1, createdAt, kind: normalizedKind, schemaVersion, entries: [{ path: path.basename(filePath), sha256: hash, bytes }] };
    fs.writeFileSync(`${filePath}.manifest.json`, JSON.stringify(manifest, null, 2), 'utf8');
    const id = idFactory('backup');
    recordBackup({ id, kind: normalizedKind, filePath, hash, bytes, schemaVersion, createdAt });
    return { id, kind: normalizedKind, path: filePath, manifestPath: `${filePath}.manifest.json`, sha256: hash, bytes, schemaVersion, createdAt, verified: true };
  }

  function verifyBackup(filePath) {
    const target = path.resolve(String(filePath || ''));
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return { valid: false, reason: 'backup-not-found' };
    let manifest = null;
    try { manifest = JSON.parse(fs.readFileSync(`${target}.manifest.json`, 'utf8')); } catch {}
    const hash = sha256File(target);
    const bytes = fs.statSync(target).size;
    if (manifest?.entries?.length) {
      const entry = manifest.entries.find((item) => item.path === path.basename(target)) || manifest.entries[0];
      if (entry.sha256 !== hash || Number(entry.bytes) !== bytes) return { valid: false, reason: 'integrity-mismatch', sha256: hash, bytes };
    }
    let probe = null;
    try {
      probe = factory(target);
      const integrityRow = probe.prepare('PRAGMA integrity_check').get();
      const integrity = String(firstValue(integrityRow) || '').toLowerCase();
      if (integrity !== 'ok') return { valid: false, reason: 'sqlite-integrity-check-failed', integrity };
      const schemaVersion = Number(firstValue(probe.prepare('PRAGMA user_version').get()) || 0);
      const requiredTables = ['migrations', 'app_meta'];
      const present = new Set(probe.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('migrations','app_meta')").all().map((row) => row.name));
      const missingTables = requiredTables.filter((name) => !present.has(name));
      if (missingTables.length) return { valid: false, reason: 'invalid-backup-schema', schemaVersion, missingTables };
      return { valid: true, reason: manifest ? 'ok' : 'sqlite-valid-no-manifest', sha256: hash, bytes, schemaVersion, manifest };
    } catch (error) {
      return { valid: false, reason: 'invalid-backup', error: error instanceof Error ? error.message : String(error) };
    } finally {
      try { probe?.close(); } catch {}
    }
  }

  function listBackups({ kind = null, limit = 50 } = {}) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 500));
    if (kind) return database.connection().prepare('SELECT * FROM backup_history WHERE kind=? ORDER BY created_at DESC LIMIT ?').all(String(kind).toUpperCase(), safeLimit);
    return database.connection().prepare('SELECT * FROM backup_history ORDER BY created_at DESC LIMIT ?').all(safeLimit);
  }

  function pruneAutomaticBackups() {
    const rows = database.connection().prepare("SELECT * FROM backup_history WHERE kind='AUTO' ORDER BY created_at DESC").all();
    for (const row of rows.slice(autoRetention)) {
      try { fs.rmSync(row.path, { force: true }); } catch {}
      try { fs.rmSync(`${row.path}.manifest.json`, { force: true }); } catch {}
      database.connection().prepare('DELETE FROM backup_history WHERE id=?').run(row.id);
    }
  }

  function runAutomaticBackup() {
    const day = nowIso().slice(0, 10);
    const existing = database.connection().prepare("SELECT * FROM backup_history WHERE kind='AUTO' AND substr(created_at,1,10)=? ORDER BY created_at DESC LIMIT 1").get(day);
    if (existing && fs.existsSync(existing.path)) return { ...existing, reused: true };
    const backup = createBackup({ kind: 'AUTO' });
    pruneAutomaticBackups();
    return backup;
  }

  function restoreBackup(filePath, actor = null) {
    const verification = verifyBackup(filePath);
    if (!verification.valid) throw new Error(`invalid backup: ${verification.reason}`);
    const currentSchemaVersion = Number(database.connection().prepare('PRAGMA user_version').get().user_version || 0);
    if (verification.schemaVersion > currentSchemaVersion) {
      throw new Error(`incompatible backup schema: v${verification.schemaVersion} is newer than supported v${currentSchemaVersion}`);
    }
    const safety = createBackup({ kind: 'PRE_RESTORE' });
    const activePath = database.dbPath;
    const tempPath = `${activePath}.restore-${Date.now()}.tmp`;
    try {
      database.close();
      fs.copyFileSync(path.resolve(String(filePath)), tempPath);
      fs.rmSync(activePath, { force: true });
      fs.rmSync(`${activePath}-wal`, { force: true });
      fs.rmSync(`${activePath}-shm`, { force: true });
      fs.renameSync(tempPath, activePath);
      database.open();
    } catch (error) {
      try {
        database.close();
        fs.rmSync(tempPath, { force: true });
        fs.copyFileSync(safety.path, activePath);
        database.open();
      } catch {}
      throw error;
    }
    const restoredAt = nowIso();
    const hash = sha256File(activePath);
    const bytes = fs.statSync(activePath).size;
    const schemaVersion = Number(database.connection().prepare('PRAGMA user_version').get().user_version || 0);
    recordBackup({ id: safety.id, kind: 'PRE_RESTORE', filePath: safety.path, hash: safety.sha256, bytes: safety.bytes, schemaVersion: safety.schemaVersion, status: 'VERIFIED', createdAt: safety.createdAt, verifiedAt: restoredAt });
    recordBackup({ id: idFactory('restore'), kind: 'MANUAL', filePath: path.resolve(String(filePath)), hash, bytes, schemaVersion, status: 'RESTORED', createdAt: restoredAt, verifiedAt: restoredAt });
    writeAudit(database.connection(), { action: 'backup.restore', entity: 'database', entityId: null, actor, context: { sourcePath: path.resolve(String(filePath)), safetyPath: safety.path, schemaVersion } }, nowIso);
    return { restored: true, sourcePath: path.resolve(String(filePath)), safetyBackup: safety.path, schemaVersion };
  }

  return { createBackup, verifyBackup, listBackups, runAutomaticBackup, restoreBackup, pruneAutomaticBackups };
}

module.exports = { createBackupService, sha256File };
