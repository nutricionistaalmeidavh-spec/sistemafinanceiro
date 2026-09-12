import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './helpers/test-harness.mjs';

test('E10-E13 migration creates alerts backup and LAN schema', () => {
  const ctx = createHarness();
  try {
    assert.equal(ctx.db.prepare('PRAGMA user_version').get().user_version, 4);
    const tables = new Set(ctx.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
    for (const name of ['alert_states','internal_alerts','account_alert_settings','backup_history','lan_settings','lan_pairing_codes','lan_sessions']) {
      assert.equal(tables.has(name), true, name);
    }
    const lan = ctx.db.prepare("SELECT * FROM lan_settings WHERE id='default'").get();
    assert.equal(lan.enabled, 0);
  } finally { ctx.cleanup(); }
});
