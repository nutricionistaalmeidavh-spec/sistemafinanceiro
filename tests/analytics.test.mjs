import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './helpers/test-harness.mjs';

test('analytics produces realized DRE, indicators and dashboard series', () => {
  const h = createHarness();
  try {
    h.finance.createAccount({ id:'bank', name:'Banco', type:'BANK' });
    h.db.prepare("INSERT INTO financial_categories(id,name,nature,dre_group,active,created_at,updated_at) VALUES ('rev','Vendas','REVENUE','OPERATING',1,?,?),('exp','Operação','EXPENSE','OPERATING',1,?,?)").run('2026-01-01','2026-01-01','2026-01-01','2026-01-01');
    const revenue = h.finance.createEntry({ kind:'RECEIVABLE', description:'Contrato', categoryId:'rev', accountId:'bank', amountCents:50000, dueAt:'2026-09-10' });
    h.finance.settleEntry(revenue.id, { amountCents:50000, occurredAt:'2026-09-10', accountId:'bank' });
    const expense = h.finance.createEntry({ kind:'PAYABLE', description:'Fornecedor', categoryId:'exp', accountId:'bank', amountCents:20000, dueAt:'2026-09-11' });
    h.finance.settleEntry(expense.id, { amountCents:20000, occurredAt:'2026-09-11', accountId:'bank' });
    const dre = h.analytics.getDre({ from:'2026-01-01', to:'2026-12-31', basis:'realized' });
    assert.deepEqual(dre.totals, { revenueCents:50000, expenseCents:20000, resultCents:30000 });
    const indicators = h.analytics.getIndicators({ from:'2026-01-01', to:'2026-12-31', asOf:'2026-12-31' });
    assert.equal(indicators.receivedCents, 50000); assert.equal(indicators.paidCents, 20000); assert.equal(indicators.resultCents, 30000); assert.equal(indicators.bankBalanceCents, 30000);
    const dashboard = h.analytics.getDashboardSnapshot({ year:2026 });
    assert.equal(dashboard.monthly[8].inCents, 50000); assert.equal(dashboard.monthly[8].outCents, 20000); assert.equal(dashboard.topExpenses[0].amountCents, 20000);
  } finally { h.cleanup(); }
});
