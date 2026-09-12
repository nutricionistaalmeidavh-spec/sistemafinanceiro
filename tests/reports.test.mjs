import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHarness } from './helpers/test-harness.mjs';
const require = createRequire(import.meta.url);
const { createReportService } = require('../electron/services/report-service.cjs');

test('reports generate receipt, filtered totals, CSV, XLSX and printable HTML', () => {
  const ctx = createHarness();
  try {
    const now = '2026-09-12T12:00:00.000Z';
    ctx.db.prepare(`INSERT INTO customers(id,name,document,active,created_at,updated_at) VALUES ('c1','Cliente Teste','123',1,?,?)`).run(now, now);
    ctx.db.prepare(`INSERT INTO financial_categories(id,name,nature,dre_group,active,created_at,updated_at) VALUES ('r1','Serviços','REVENUE','OPERATING',1,?,?)`).run(now, now);
    const account = ctx.finance.createAccount({ id: 'bank1', name: 'Banco', type: 'BANK' });
    const entry = ctx.finance.createEntry({ id: 'receivable1', kind: 'RECEIVABLE', description: 'Mensalidade; especial', amountCents: 12345, dueAt: '2026-09-12', accountId: account.id, categoryId: 'r1', customerId: 'c1' });
    const paid = ctx.finance.settleEntry(entry.id, { id: 'settlement1', amountCents: 12345, accountId: account.id, method: 'PIX', occurredAt: '2026-09-12' });
    const reports = createReportService({ db: ctx.db, finance: ctx.finance, analytics: ctx.analytics, now: () => now });

    const receipt = reports.settlementReceipt(paid.settlement.id);
    assert.equal(receipt.settlement.amountCents, 12345);
    assert.equal(receipt.counterparty.name, 'Cliente Teste');

    const report = reports.financialReport({ from: '2026-09-01', to: '2026-09-30', kind: 'RECEIVABLE' });
    assert.equal(report.rows.length, 1);
    assert.equal(report.totals.amountCents, 12345);
    assert.equal(report.totals.settledCents, 12345);

    const csv = reports.toCsv(report);
    assert.equal(csv.startsWith('\uFEFF'), true);
    assert.match(csv, /"Mensalidade; especial"/);
    const xlsx = reports.toXlsxBuffer(report);
    assert.equal(Buffer.isBuffer(xlsx), true);
    assert.equal(xlsx.subarray(0, 2).toString(), 'PK');
    assert.ok(xlsx.length > 1000);
    const html = reports.toPrintableHtml(receipt);
    assert.match(html, /<!doctype html>/i);
    assert.match(html, /Cliente Teste/);
  } finally { ctx.cleanup(); }
});
