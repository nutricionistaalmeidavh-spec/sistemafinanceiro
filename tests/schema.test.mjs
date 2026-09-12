import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

test('E03-E05 schema creates auth, finance and registry tables', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('../database/migrations/001_bootstrap.sql', import.meta.url), 'utf8'));
  db.exec(fs.readFileSync(new URL('../database/migrations/002_auth_finance_registry.sql', import.meta.url), 'utf8'));
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
  for (const name of ['users','financial_accounts','customers','creditors','financial_categories','financial_entries','financial_settlements','audit_log']) {
    assert.equal(tables.has(name), true, name);
  }
  assert.throws(() => db.prepare("INSERT INTO financial_categories(id,name,nature,dre_group,active,created_at,updated_at) VALUES ('x','X','OTHER','OPERATING',1,'now','now')").run());
  db.close();
});
