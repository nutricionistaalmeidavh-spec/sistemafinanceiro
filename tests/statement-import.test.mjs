import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHarness } from './helpers/test-harness.mjs';

test('decimal parser rejects fractional cents and unsafe integer amounts',async()=>{
  const {createRequire}=await import('node:module'); const localRequire=createRequire(import.meta.url);
  const {parseAmount}=localRequire('../electron/services/statement-import-service.cjs');
  assert.equal(parseAmount('1.234,56').amountCents,123456);
  assert.equal(parseAmount('-1,234.56').amountCents,123456);
  assert.equal(parseAmount('0,01').amountCents,1);
  assert.equal(parseAmount('1.000').amountCents,100000);
  assert.throws(()=>parseAmount('12,3456'),/decimal|centavo|valor|amount/i);
  assert.throws(()=>parseAmount('999999999999999,99'),/limite|valor|amount/i);
});

test('reject impossible imported dates and normalize standard US QIF dates without month/day corruption',async()=>{
  const {createRequire}=await import('node:module');const req=createRequire(import.meta.url);
  const {parseDate}=req('../electron/services/statement-import-service.cjs');
  const {parseQif}=req('../electron/services/open-format-service.cjs');
  assert.throws(()=>parseDate('31/02/2026'),/invalid date|data inválida/i);
  assert.throws(()=>parseDate('2026-02-29'),/invalid date|data inválida/i);
  assert.equal(parseDate('29/02/2024'),'2024-02-29');
  const us=parseQif('!Type:Bank\nD11/13/2026\nT1.25\nPUS date\n^\n');
  assert.equal(parseDate(us[0].date),'2026-11-13');
});

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

test('ODS and QIF preview/commit preserve real source type and do not create finance entries', async () => {
  const {createRequire}=await import('node:module');const localRequire=createRequire(import.meta.url);
  const {toOdsBuffer}=localRequire('../electron/services/open-format-service.cjs');
  const ctx=createHarness();
  try {
    ctx.finance.createAccount({id:'bank-ods',name:'Banco ODS',type:'BANK'},{id:'admin',role:'ADMIN'});
    const ods=toOdsBuffer({headers:['Data','Descrição','Valor','Direção'],
      rows:[['13/11/2026','PIX ODS fictício',-23.45,'debit']]});
    const qif='!Type:Bank\nD13/11/2026\nT15,30\nPCliente QIF fictício\n^\n';
    const sources=[
      {sourceType:'ODS',accountId:'bank-ods',dataBase64:ods.toString('base64')},
      {sourceType:'QIF',accountId:'bank-ods',content:qif}
    ];
    for(const input of sources){
      const preview=await ctx.statements.preview(input);
      assert.equal(preview.transactions.length,1);
      assert.equal(preview.transactions[0].amountCents,input.sourceType==='ODS'?2345:1530);
      const saved=await ctx.statements.commit(input,{id:'admin',role:'ADMIN'});
      assert.equal(saved.inserted,1);
      const repeated=await ctx.statements.commit(input,{id:'admin',role:'ADMIN'});
      assert.equal(repeated.inserted,0);
    }
    assert.deepEqual(ctx.db.prepare('SELECT original_source_type FROM bank_import_batches WHERE accepted_count=1 ORDER BY created_at, rowid').all().map(row=>row.original_source_type),['ODS','QIF']);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS total FROM financial_entries').get().total,0);
  }finally{ctx.cleanup();}
});

test('re-importing identical file content is idempotent while a distinct source may preserve a business-similar payment', async () => {
  const ctx = createHarness();
  try {
    ctx.finance.createAccount({ id:'bank-1', name:'Banco Principal', type:'BANK' }, { id:'admin', role:'ADMIN' });
    const source = { sourceType:'CSV', accountId:'bank-1', documentId:'same-file', content:'Data;Descrição;Valor\n13/09/2026;PIX FORNECEDOR;-50,00' };
    const first = await ctx.statements.commit(source, { id:'admin', role:'ADMIN' });
    const renamedSameContent = await ctx.statements.commit({ ...source, documentId:'renamed-copy' }, { id:'admin', role:'ADMIN' });
    assert.equal(first.inserted, 1);
    assert.equal(renamedSameContent.inserted, 0);
    assert.equal(renamedSameContent.duplicates, 1);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS total FROM bank_transactions').get().total, 1);

    const distinctSource = { sourceType:'MANUAL', accountId:'bank-1', documentId:'manual-distinct-payment', rows:[{ date:'2026-09-13', description:'PIX FORNECEDOR', amountCents:5000, direction:'debit' }] };
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

test('accepting a reconciliation stores feedback and a link but does not silently settle the payable', async () => {
  const ctx = createHarness();
  try {
    const actor = { id:'admin', role:'ADMIN' };
    ctx.finance.createAccount({ id:'bank-1', name:'Banco Principal', type:'BANK' }, actor);
    const stamp = '2026-09-12T12:00:00.000Z';
    ctx.db.prepare('INSERT INTO creditors(id,name,active,created_at,updated_at) VALUES (?,?,?,?,?)').run('cred-acme','Fornecedor ACME',1,stamp,stamp);
    ctx.db.prepare('INSERT INTO financial_categories(id,name,nature,dre_group,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('cat-material','Materiais','EXPENSE','OPERATING',1,stamp,stamp);
    const entry = ctx.finance.createEntry({ id:'pay-acme', kind:'PAYABLE', description:'Compra ACME', amountCents:10000, dueAt:'2026-09-13', creditorId:'cred-acme', categoryId:'cat-material' }, actor);
    await ctx.statements.commit({ sourceType:'MANUAL', accountId:'bank-1', documentId:'tx-acme', rows:[{ date:'2026-09-13', description:'PIX FORNECEDOR ACME', amountCents:10000, direction:'debit' }] }, actor);
    const suggestions = await ctx.statements.suggestEntries({ minConfidence:0.65 });
    assert.equal(suggestions.length, 1);
    assert.equal(suggestions[0].allocations[0].obligationId, entry.id);

    await ctx.statements.recordDecision({ transactionId:suggestions[0].transactionId, entryId:entry.id, decision:'accepted', amountCents:10000 }, actor);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS total FROM bank_reconciliation_links').get().total, 1);
    assert.equal(ctx.db.prepare('SELECT accepted FROM bank_reconciliation_feedback WHERE transaction_id=? AND entry_id=?').get(suggestions[0].transactionId,entry.id).accepted, 1);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS total FROM financial_settlements').get().total, 0);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS total FROM cash_movements').get().total, 0);
    assert.equal(ctx.finance.listEntries({ kind:'PAYABLE' })[0].status, 'OPEN');
  } finally { ctx.cleanup(); }
});
