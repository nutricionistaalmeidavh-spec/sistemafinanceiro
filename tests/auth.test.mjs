import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createAuthService } = require('../electron/services/auth-service.cjs');

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, login TEXT NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT, actor_id TEXT, actor_role TEXT, context_json TEXT, created_at TEXT NOT NULL);
  `);
  return db;
}

test('bootstrap admin, authenticate and enforce finance permission', () => {
  const db = setup();
  let n = 0;
  const auth = createAuthService({ db, now: () => '2026-09-12T17:00:00.000Z', tokenFactory: () => `token-${++n}`, idFactory: () => 'user-2' });
  assert.equal(auth.needsBootstrap(), true);
  const admin = auth.bootstrapAdmin({ password: 'SenhaForte123', name: 'Administrador' });
  assert.equal(admin.login, 'admin');
  assert.equal(auth.needsBootstrap(), false);
  const session = auth.authenticate('ADMIN', 'SenhaForte123');
  assert.equal(session.user.role, 'ADMIN');
  assert.equal(auth.require(session.token, 'finance.manage').id, 'local-admin');
  const analyst = auth.createUser(session.token, { name: 'Financeiro', login: 'financeiro', password: 'OutraSenha123', role: 'FINANCE' });
  assert.equal(analyst.role, 'FINANCE');
  const analystSession = auth.authenticate('financeiro', 'OutraSenha123');
  assert.equal(auth.require(analystSession.token, 'registry.manage').id, 'user-2');
  assert.throws(() => auth.require(analystSession.token, 'users.manage'), /permission denied/i);
  db.close();
});
