import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHarness } from './helpers/test-harness.mjs';

test('CSV, OFX, PDF text and manual input converge to the canonical bank transaction model', async () => {
  const ctx = createHarness();
  try {
    ctx.finance.createAccount({ id:'bank-1', name:'Banco Principal', type:'BANK' }, { id:'admin', role:'ADMIN' });
    const sources = [
      { sourceType:'CSV', accountId:'bank-1', documentId:'csv-1', content:'Data;Descrição;Valor\n13/09/2026;POSTO SHELL;-125,50' },
      { sourceType:'OFX', accountId:'bank-1', documentId:'ofx-1', content:'<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260913<TRNAMT>-125.50<FITID>x1<NAME>POSTO SHELL</STMTTRN>' },
      { sourceType:'PDF', accountId:'bank-1', documentId:'pdf-1', text:'13/09/2026 POSTO SHELL -125,50' },
      { sourceType:'MANUAL', accountId:'bank-1', documentId:'manual-1', rows:[{ date:'2026-09-13', description:'POSTO SHELL', amountCents:12550, direction:'debit' }] },
    ];

    for (const source of sources) {
      const preview = await ctx.statements.preview(source);
      assert.equal(preview.transactions.length, 1);
      const tx = preview.transactions[0];
      assert.equal(tx.accountId, 'bank-1');
      assert.equal(tx.date, '2026-09-13');
      assert.equal(tx.description, 'POSTO SHELL');
      assert.equal(tx.amountCents, 12550);
      assert.equal(tx.direction, 'debit');
      assert.ok(tx.sourceFingerprint);
      assert.ok(tx.businessFingerprint);
      assert.equal(tx.category, 'Combustível');
      assert.equal(tx.classification.matched, true);
    }
  } finally { ctx.cleanup(); }
});

test('re-importing the same source is idempotent but business-similar transactions remain reviewable', async () => {
  const ctx = createHarness();
  try {
    ctx.finance.createAccount({ id:'bank-1', name:'Banco Principal', type:'BANK' }, { id:'admin', role:'ADMIN' });
    const source = { sourceType:'CSV', accountId:'bank-1', documentId:'same-file', content:'Data;Descrição;Valor\n13/09/2026;PIX FORNECEDOR;-50,00' };
    const first = await ctx.statements.commit(source, { id:'admin', role:'ADMIN' });
    const second = await ctx.statements.commit(source, { id:'admin', role:'ADMIN' });
    assert.equal(first.inserted, 1);
    assert.equal(second.inserted, 0);
    assert.equal(second.duplicates, 1);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS total FROM bank_transactions').get().total, 1);

    const distinctSource = { ...source, documentId:'another-file' };
    const third = await ctx.statements.commit(distinctSource, { id:'admin', role:'ADMIN' });
    assert.equal(third.inserted, 1);
    assert.equal(ctx.db.prepare('SELECT COUNT(DISTINCT business_fingerprint) AS total FROM bank_transactions').get().total, 1);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS total FROM bank_transactions').get().total, 2);
  } finally { ctx.cleanup(); }
});

test('deterministic engine identifies transfers between owned accounts without posting them automatically', async () => {
  const ctx = createHarness();
  try {
    ctx.finance.createAccount({ id:'bank-a', name:'Banco A', type:'BANK' }, { id:'admin', role:'ADMIN' });
    ctx.finance.createAccount({ id:'bank-b', name:'Banco B', type:'BANK' }, { id:'admin', role:'ADMIN' });
    await ctx.statements.commit({ sourceType:'MANUAL', accountId:'bank-a', documentId:'a', rows:[{ date:'2026-09-13', description:'TRANSFERENCIA ENTRE CONTAS', amountCents:50000, direction:'debit' }] }, { id:'admin', role:'ADMIN' });
    await ctx.statements.commit({ sourceType:'MANUAL', accountId:'bank-b', documentId:'b', rows:[{ date:'2026-09-13', description:'TRANSFERENCIA ENTRE CONTAS', amountCents:50000, direction:'credit' }] }, { id:'admin', role:'ADMIN' });
    const result = await ctx.statements.suggestTransfers();
    assert.equal(result.internalTransfers.length, 1);
    assert.equal(result.withdrawals.length, 0);
    assert.equal(result.returns.length, 0);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS total FROM cash_movements').get().total, 0);
  } finally { ctx.cleanup(); }
});
