import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createRegistryService } = require('../electron/services/registry-service.cjs');

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE customers (id TEXT PRIMARY KEY, name TEXT NOT NULL, document TEXT, phone TEXT, email TEXT, notes TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE UNIQUE INDEX idx_customers_document ON customers(document) WHERE document IS NOT NULL AND document <> '';
    CREATE TABLE creditors (id TEXT PRIMARY KEY, name TEXT NOT NULL, document TEXT, phone TEXT, email TEXT, notes TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE UNIQUE INDEX idx_creditors_document ON creditors(document) WHERE document IS NOT NULL AND document <> '';
    CREATE TABLE financial_categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, nature TEXT NOT NULL, dre_group TEXT NOT NULL DEFAULT 'OPERATING', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(name,nature));
    CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT, actor_id TEXT, actor_role TEXT, context_json TEXT, created_at TEXT NOT NULL);
  `);
  return db;
}

test('creates and updates customers, creditors and categories', () => {
  const db = setup();
  let id = 0;
  const registry = createRegistryService({ db, now: () => '2026-09-12T17:00:00.000Z', idFactory: (prefix) => `${prefix}-${++id}` });
  const actor = { id: 'local-admin', role: 'ADMIN' };
  const customer = registry.saveCustomer({ name: 'Cliente A', document: '123' }, actor);
  const creditor = registry.saveCreditor({ name: 'Fornecedor A', document: '456' }, actor);
  const category = registry.saveCategory({ name: 'Honorários', nature: 'EXPENSE', dreGroup: 'OPERATING' }, actor);
  assert.equal(registry.listCustomers().length, 1);
  assert.equal(registry.listCreditors().length, 1);
  assert.equal(registry.listCategories({ nature: 'EXPENSE' }).length, 1);
  assert.equal(registry.saveCustomer({ ...customer, phone: '16999999999' }, actor).phone, '16999999999');
  assert.equal(category.nature, 'EXPENSE');
  assert.equal(creditor.active, true);
  db.close();
});
