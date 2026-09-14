import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './helpers/test-harness.mjs';

test('E18-E24 migration creates planning and control schema', () => {
  const ctx = createHarness();
  try {
    assert.ok(ctx.db.prepare('PRAGMA user_version').get().user_version >= 6);
    const tables = new Set(ctx.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
    for (const name of ['cost_centers','tags','entry_allocations','entry_tags','budget_scenarios','budgets','financial_goals','entry_attachments','approval_policies','approval_requests','approval_decisions']) {
      assert.equal(tables.has(name), true, name);
    }
    const base = ctx.db.prepare("SELECT * FROM budget_scenarios WHERE id='base'").get();
    assert.equal(base.name, 'Base');
  } finally { ctx.cleanup(); }
});
