import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './helpers/test-harness.mjs';

test('dashboard uses the reporting cut-off date and never counts future installments as overdue today', () => {
  const h = createHarness();
  try {
    h.finance.createEntry({ kind:'PAYABLE', description:'Vence daqui a oito dias', amountCents:5000, dueAt:'2026-09-20' });
    const snapshot = h.analytics.getDashboardSnapshot({ year:2026 });
    assert.equal(snapshot.cards.overduePayableCents, 0);
    assert.equal(snapshot.cards.payableOpenCents, 5000);
    assert.equal(snapshot.asOf, '2026-09-12');
  } finally { h.cleanup(); }
});

test('bank reconciliation rejects transactions with incompatible financial direction', async () => {
  const h = createHarness();
  try {
    const bank = h.finance.createAccount({name:'Banco', type:'BANK'});
    const entry = h.finance.createEntry({kind:'PAYABLE', description:'Fornecedor', amountCents:10000, dueAt:'2026-09-10', accountId:bank.id});
    await h.statements.commit({ sourceType:'MANUAL', accountId:bank.id, documentId:'incoming', rows:[{date:'2026-09-12', description:'Recebimento', amountCents:10000, direction:'credit'}] });
    const tx = h.statements.listTransactions()[0];
    await assert.rejects(h.statements.recordDecision({transactionId:tx.id, entryId:entry.id, decision:'accepted', amountCents:10000}), /direction|nature|incompat|kind/i);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS total FROM bank_reconciliation_links').get().total, 0);
  } finally { h.cleanup(); }
});

test('reconciliation may document a payment already registered without creating it again', async () => {
  const h = createHarness();
  try {
    const bank = h.finance.createAccount({ name:'Banco', type:'BANK' });
    const entry = h.finance.createEntry({ kind:'PAYABLE', description:'Conta paga', amountCents:10000, dueAt:'2026-09-10', accountId:bank.id });
    h.finance.settleEntry(entry.id, {amountCents:10000, accountId:bank.id, occurredAt:'2026-09-11'});
    await h.statements.commit({sourceType:'MANUAL',accountId:bank.id,documentId:'paid',rows:[{date:'2026-09-11',description:'PIX de saída',amountCents:10000,direction:'debit'}]});
    const tx = h.statements.listTransactions()[0];
    await h.statements.recordDecision({transactionId:tx.id,entryId:entry.id,decision:'accepted',amountCents:10000});
    assert.equal(h.db.prepare('SELECT COUNT(*) AS total FROM bank_reconciliation_links').get().total,1);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS total FROM financial_settlements').get().total,1);
    assert.equal(h.finance.getEntry(entry.id).status, 'SETTLED');
    assert.equal(h.cashflow.getAccountBalances().find(a=>a.id===bank.id).balanceCents, -10000);
  } finally { h.cleanup(); }
});

test('legacy payments preserve the original account when an entry changes accounts', () => {
  const h = createHarness();
  try {
    const oldAccount=h.finance.createAccount({name:'Antiga',type:'BANK'});
    const newAccount=h.finance.createAccount({name:'Nova',type:'BANK'});
    const entry=h.finance.createEntry({kind:'PAYABLE',description:'Histórico',amountCents:9000,dueAt:'2026-09-10',accountId:oldAccount.id});
    const paid=h.finance.settleEntry(entry.id,{accountId:oldAccount.id,amountCents:9000});
    h.db.prepare('UPDATE financial_settlements SET account_id=NULL WHERE id=?').run(paid.settlement.id);
    h.finance.updateEntry(entry.id, {accountId:newAccount.id});
    const balances=h.cashflow.getAccountBalances();
    assert.equal(balances.find(a=>a.id===oldAccount.id).balanceCents,-9000);
    assert.equal(balances.find(a=>a.id===newAccount.id).balanceCents,0);
  } finally { h.cleanup(); }
});

test('partial payments and reversals keep summary, DRE and cashflow consistent', () => {
  const h=createHarness();
  try {
    const bank=h.finance.createAccount({name:'Banco',type:'BANK'});
    const entry=h.finance.createEntry({kind:'PAYABLE',description:'Parcelado',amountCents:10000,dueAt:'2026-09-10',accountId:bank.id});
    const one=h.finance.settleEntry(entry.id,{amountCents:2500,accountId:bank.id});
    h.finance.settleEntry(entry.id,{amountCents:3500,accountId:bank.id});
    assert.equal(h.finance.getSummary().payableOpenCents,4000);
    assert.equal(h.analytics.getDre({from:'2026-01-01',to:'2026-12-31',basis:'realized'}).totals.expenseCents,6000);
    h.finance.reverseSettlement(one.settlement.id,{reason:'Erro de baixa'});
    assert.equal(h.finance.getSummary().payableOpenCents,6500);
    assert.equal(h.cashflow.getAccountBalances().find(a=>a.id===bank.id).balanceCents,-3500);
    assert.equal(h.analytics.getDre({from:'2026-01-01',to:'2026-12-31',basis:'realized'}).totals.expenseCents,3500);
  } finally { h.cleanup(); }
});
