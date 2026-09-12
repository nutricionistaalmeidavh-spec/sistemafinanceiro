import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHarness } from './helpers/test-harness.mjs';
const require = createRequire(import.meta.url);
const { createAlertService } = require('../electron/services/alert-service.cjs');

test('alerts derive due, overdue, low balance and internal notices with user state', () => {
  const ctx = createHarness();
  try {
    const actor = { id: 'local-admin', role: 'ADMIN' };
    const account = ctx.finance.createAccount({ name: 'Banco alerta', type: 'BANK' }, actor);
    ctx.cashflow.createManualMovement({ accountId: account.id, type: 'OPENING', amountCents: 1000, occurredAt: '2026-09-01' }, actor);
    ctx.finance.createEntry({ id: 'due-today', kind: 'PAYABLE', description: 'Conta hoje', amountCents: 5000, dueAt: '2026-09-12', accountId: account.id }, actor);
    ctx.finance.createEntry({ id: 'overdue', kind: 'PAYABLE', description: 'Conta atrasada', amountCents: 7000, dueAt: '2026-09-10', accountId: account.id }, actor);
    const alerts = createAlertService({ db: ctx.db, finance: ctx.finance, cashflow: ctx.cashflow, now: () => '2026-09-12T12:00:00.000Z' });
    alerts.setAccountThreshold(account.id, 5000, actor);
    alerts.saveInternalAlert({ id: 'notice-1', title: 'Fechamento', body: 'Conferir caixa', severity: 'INFO', startsAt: '2026-09-12' }, actor);

    const items = alerts.listAlerts({ userId: 'local-admin', asOf: '2026-09-12' });
    assert.deepEqual(new Set(items.map((item) => item.type)), new Set(['DUE_TODAY','OVERDUE','LOW_BALANCE','INTERNAL']));
    const due = items.find((item) => item.type === 'DUE_TODAY');
    alerts.acknowledge(due.key, 'local-admin', 'READ');
    assert.equal(alerts.listAlerts({ userId: 'local-admin', asOf: '2026-09-12' }).find((item) => item.key === due.key).read, true);
    const low = items.find((item) => item.type === 'LOW_BALANCE');
    alerts.acknowledge(low.key, 'local-admin', 'DISMISSED');
    assert.equal(alerts.listAlerts({ userId: 'local-admin', asOf: '2026-09-12' }).some((item) => item.key === low.key), false);
  } finally { ctx.cleanup(); }
});
