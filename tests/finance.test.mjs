import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createFinanceService } = require('../electron/services/finance-service.cjs');

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE financial_accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, type TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE customers (id TEXT PRIMARY KEY, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE creditors (id TEXT PRIMARY KEY, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE financial_categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, nature TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE financial_entries (id TEXT PRIMARY KEY, kind TEXT NOT NULL, description TEXT NOT NULL, category_id TEXT, account_id TEXT, customer_id TEXT, creditor_id TEXT, amount_cents INTEGER NOT NULL, issue_at TEXT, due_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN', source_type TEXT, source_id TEXT, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, cancelled_at TEXT);
    CREATE TABLE financial_settlements (id TEXT PRIMARY KEY, entry_id TEXT NOT NULL, amount_cents INTEGER NOT NULL, method TEXT, note TEXT, occurred_at TEXT NOT NULL, created_at TEXT NOT NULL, reversed_at TEXT);
    CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT, actor_id TEXT, actor_role TEXT, context_json TEXT, created_at TEXT NOT NULL);
    INSERT INTO creditors(id,name,active) VALUES ('cred-1','Fornecedor',1);
    INSERT INTO customers(id,name,active) VALUES ('cust-1','Cliente',1);
    INSERT INTO financial_categories(id,name,nature,active) VALUES ('cat-exp','Despesa','EXPENSE',1),('cat-rev','Receita','REVENUE',1);
  `);
  return db;
}

test('payable lifecycle supports partial settlement, reversal and cancellation rules', () => {
  const db = setup();
  let id = 0;
  const finance = createFinanceService({ db, now: () => '2026-09-12T17:00:00.000Z', idFactory: (prefix) => `${prefix}-${++id}` });
  const actor = { id: 'local-admin', role: 'ADMIN' };
  const account = finance.createAccount({ name: 'Banco', type: 'BANK' }, actor);
  const entry = finance.createEntry({ kind: 'PAYABLE', description: 'Conta de energia', amountCents: 10000, dueAt: '2026-09-10', accountId: account.id, creditorId: 'cred-1', categoryId: 'cat-exp' }, actor);
  assert.equal(entry.openCents, 10000);
  assert.equal(entry.isOverdue, true);
  const paid = finance.settleEntry(entry.id, { amountCents: 4000, method: 'PIX', occurredAt: '2026-09-12' }, actor);
  assert.equal(paid.entry.status, 'PARTIAL');
  assert.equal(paid.entry.openCents, 6000);
  const reversed = finance.reverseSettlement(paid.settlement.id, { reason: 'Baixa incorreta', actor });
  assert.equal(reversed.entry.status, 'OPEN');
  assert.equal(reversed.entry.openCents, 10000);
  const cancelled = finance.cancelEntry(entry.id, { reason: 'Lançamento duplicado', actor });
  assert.equal(cancelled.status, 'CANCELLED');
  db.close();
});

test('receivable requires revenue category and customer-compatible links', () => {
  const db = setup();
  const finance = createFinanceService({ db, now: () => '2026-09-12T17:00:00.000Z', idFactory: (prefix) => `${prefix}-1` });
  assert.throws(() => finance.createEntry({ kind: 'RECEIVABLE', description: 'Serviço', amountCents: 1000, dueAt: '2026-09-30', categoryId: 'cat-exp', customerId: 'cust-1' }), /category/i);
  const entry = finance.createEntry({ kind: 'RECEIVABLE', description: 'Serviço', amountCents: 1000, dueAt: '2026-09-30', categoryId: 'cat-rev', customerId: 'cust-1' });
  assert.equal(entry.kind, 'RECEIVABLE');
  assert.equal(entry.customerId, 'cust-1');
  db.close();
});
