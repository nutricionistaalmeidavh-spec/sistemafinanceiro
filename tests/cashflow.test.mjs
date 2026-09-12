import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './helpers/test-harness.mjs';

test('cashflow combines manual movements, transfers and settlements by account', () => {
  const h = createHarness();
  try {
    const a = h.finance.createAccount({ id:'a', name:'Banco A', type:'BANK' });
    const b = h.finance.createAccount({ id:'b', name:'Banco B', type:'BANK' });
    h.cashflow.createManualMovement({ accountId:a.id, type:'OPENING', amountCents:100000, occurredAt:'2026-09-01' });
    h.cashflow.createManualMovement({ accountId:a.id, type:'DEPOSIT', amountCents:50000, occurredAt:'2026-09-02' });
    h.cashflow.createManualMovement({ accountId:a.id, type:'WITHDRAWAL', amountCents:10000, occurredAt:'2026-09-03' });
    h.cashflow.transfer({ fromAccountId:a.id, toAccountId:b.id, amountCents:20000, occurredAt:'2026-09-04' });
    const receivable = h.finance.createEntry({ kind:'RECEIVABLE', description:'Receita', amountCents:30000, dueAt:'2026-09-05', accountId:a.id });
    const paidIn = h.finance.settleEntry(receivable.id, { amountCents:30000, occurredAt:'2026-09-05', accountId:a.id });
    const payable = h.finance.createEntry({ kind:'PAYABLE', description:'Despesa', amountCents:15000, dueAt:'2026-09-06', accountId:a.id });
    h.finance.settleEntry(payable.id, { amountCents:15000, occurredAt:'2026-09-06', accountId:a.id });
    let balances = h.cashflow.getAccountBalances({ asOf:'2026-09-30' });
    assert.equal(balances.find((x)=>x.id==='a').balanceCents, 135000);
    assert.equal(balances.find((x)=>x.id==='b').balanceCents, 20000);
    h.finance.reverseSettlement(paidIn.settlement.id, { reason:'teste' });
    balances = h.cashflow.getAccountBalances({ asOf:'2026-09-30' });
    assert.equal(balances.find((x)=>x.id==='a').balanceCents, 105000);
    const summary = h.cashflow.getCashflowSummary({ from:'2026-09-02', to:'2026-09-30', accountId:'a' });
    assert.equal(summary.openingBalanceCents, 100000);
    assert.equal(summary.closingBalanceCents, 105000);
  } finally { h.cleanup(); }
});
