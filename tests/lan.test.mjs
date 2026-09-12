import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHarness } from './helpers/test-harness.mjs';
const require = createRequire(import.meta.url);
const { createAlertService } = require('../electron/services/alert-service.cjs');
const { createLanService } = require('../electron/services/lan-service.cjs');

test('LAN stays disabled by default and requires single-use pairing for API access', async () => {
  const ctx = createHarness();
  const actor = { id: 'local-admin', role: 'ADMIN' };
  try {
    const alerts = createAlertService({ db: ctx.db, finance: ctx.finance, cashflow: ctx.cashflow, now: () => '2026-09-12T12:00:00.000Z' });
    const lan = createLanService({ db: ctx.db, finance: ctx.finance, cashflow: ctx.cashflow, analytics: ctx.analytics, alerts, now: () => '2026-09-12T12:00:00.000Z' });
    assert.equal(lan.status().enabled, false);
    lan.configure({ enabled: true, host: '127.0.0.1', port: 0 }, actor);
    const address = await lan.startConfigured();
    assert.ok(address.port > 0);

    const pairing = lan.createPairingCode(actor);
    const paired = await fetch(`http://127.0.0.1:${address.port}/api/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: pairing.code }) });
    assert.equal(paired.status, 200);
    const credentials = await paired.json();
    assert.ok(credentials.token);

    const reuse = await fetch(`http://127.0.0.1:${address.port}/api/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: pairing.code }) });
    assert.equal(reuse.status, 401);

    const denied = await fetch(`http://127.0.0.1:${address.port}/api/dashboard`);
    assert.equal(denied.status, 401);
    const dashboard = await fetch(`http://127.0.0.1:${address.port}/api/dashboard`, { headers: { authorization: `Bearer ${credentials.token}` } });
    assert.equal(dashboard.status, 200);
    assert.equal((await dashboard.json()).year, 2026);

    const page = await fetch(`http://127.0.0.1:${address.port}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Sistema Financeiro/);
    await lan.stop();
  } finally { ctx.cleanup(); }
});
