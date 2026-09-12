import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHarness } from './helpers/test-harness.mjs';

const require = createRequire(import.meta.url);
const { createAuthService } = require('../electron/services/auth-service.cjs');
const { seedQaFixture } = require('../electron/services/qa-fixture-service.cjs');

test('QA fixture seeds representative finance data exactly once with an injected credential', () => {
  const h = createHarness();
  try {
    const now = () => '2026-09-12T15:00:00.000Z';
    const auth = createAuthService({ db: h.db, now });
    const password = `Qa-${'x'.repeat(16)}!`;
    const first = seedQaFixture({ db: h.db, auth, now, password });
    const second = seedQaFixture({ db: h.db, auth, now, password });

    assert.equal(first.login, 'admin');
    assert.equal(first.password, password);
    assert.equal(second.seeded, false);
    assert.equal(auth.authenticate('admin', password).user.role, 'ADMIN');
    assert.ok(h.db.prepare('SELECT COUNT(*) count FROM financial_accounts').get().count >= 4);
    assert.ok(h.db.prepare('SELECT COUNT(*) count FROM financial_entries').get().count >= 7);
    assert.ok(h.db.prepare('SELECT COUNT(*) count FROM financial_settlements').get().count >= 3);
    assert.ok(h.db.prepare('SELECT COUNT(*) count FROM recurring_rules').get().count >= 3);
    assert.ok(h.db.prepare('SELECT COUNT(*) count FROM internal_alerts').get().count >= 1);
    assert.ok(h.db.prepare('SELECT COUNT(*) count FROM account_alert_settings').get().count >= 1);
    assert.ok(h.db.prepare('SELECT COUNT(*) count FROM users').get().count >= 3);
  } finally { h.cleanup(); }
});

test('Electron main keeps fixture opt-in and reset isolated to QA mode', async () => {
  const source = await import('node:fs').then(({ readFileSync }) => readFileSync('electron/main.cjs','utf8'));
  assert.match(source, /process\.env\.ARTISYS_QA === '1'/);
  assert.match(source, /ARTISYS_QA_RESET === '1'/);
  assert.match(source, /seedQaFixture/);
  assert.match(source, /artisys-financeiro-qa/);
});
