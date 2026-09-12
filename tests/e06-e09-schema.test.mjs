import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './helpers/test-harness.mjs';

test('E06-E09 migration remains present after later schema versions', () => {
  const h = createHarness();
  try {
    assert.ok(h.db.prepare('PRAGMA user_version').get().user_version >= 3);
    const tables = new Set(h.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
    assert.equal(tables.has('cash_movements'), true);
    assert.equal(tables.has('recurring_rules'), true);
    const settlementColumns = new Set(h.db.prepare('PRAGMA table_info(financial_settlements)').all().map((row) => row.name));
    assert.equal(settlementColumns.has('account_id'), true);
    const entryColumns = new Set(h.db.prepare('PRAGMA table_info(financial_entries)').all().map((row) => row.name));
    assert.equal(entryColumns.has('recurrence_rule_id'), true);
    assert.equal(entryColumns.has('recurrence_key'), true);
  } finally { h.cleanup(); }
});
