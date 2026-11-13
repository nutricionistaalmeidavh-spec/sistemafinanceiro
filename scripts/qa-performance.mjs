// Deterministic, synthetic-only performance and consistency benchmark for the local-first ledger.
// Usage: PERF_LEVELS=1000,10000,100000 node scripts/qa-performance.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHarness } from '../tests/helpers/test-harness.mjs';

const levels = (process.env.PERF_LEVELS || '1000,10000').split(',').map(Number);
if (!levels.length || levels.some((n) => ![1000,10000,100000].includes(n))) {
  throw new Error('PERF_LEVELS accepts 1000, 10000 and/or 100000 only');
}
const root = path.resolve('qa-artifacts/performance');
fs.mkdirSync(root, { recursive: true });

function timed(fn, rounds = 3) {
  const values = []; let result;
  for (let n = 0; n < rounds; n++) {
    const start = performance.now();
    result = fn();
    values.push(Number((performance.now() - start).toFixed(2)));
  }
  values.sort((a,b)=>a-b);
  return { result, durationMs: { min:values[0], median:values[Math.floor(values.length/2)], max:values.at(-1), samples:values } };
}

for (const count of levels) {
  const h = createHarness();
  try {
    const bank = h.finance.createAccount({ id:'benchmark-bank', name:'Banco fictício', type:'BANK' });
    const insertEntry = h.db.prepare(`INSERT INTO financial_entries(id,kind,description,account_id,amount_cents,issue_at,due_at,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`);
    const insertPaid = h.db.prepare(`INSERT INTO financial_settlements(id,entry_id,account_id,amount_cents,method,occurred_at,created_at)
      VALUES (?,?,?,?,?,?,?)`);
    let expectedPaid = 0;
    let expectedReceivable = 0;
    let expectedPayable = 0;
    let expectedOpenPayable = 0;
    let expectedOpenReceivable = 0;
    const started = performance.now();
    h.db.exec('BEGIN IMMEDIATE');
    try {
      for (let i = 0; i < count; i++) {
        const kind = i % 2 === 0 ? 'PAYABLE' : 'RECEIVABLE';
        const paid = i % 4 === 0 ? 10000 : i % 4 === 1 ? 4000 : 0;
        const status = paid === 10000 ? 'SETTLED' : paid > 0 ? 'PARTIAL' : 'OPEN';
        const id = `synthetic-${i}`;
        insertEntry.run(id, kind, `Dado fictício ${i}`, bank.id, 10000, '2026-09-01', i % 3 === 0 ? '2026-09-20' : '2026-09-10', status, '2026-09-01T12:00:00.000Z', '2026-09-01T12:00:00.000Z');
        if (paid) insertPaid.run(`paid-${i}`,id,bank.id,paid,'PIX','2026-09-11','2026-09-11T12:00:00.000Z');
        expectedPaid += kind === 'RECEIVABLE' ? paid : -paid;
        if (kind === 'PAYABLE') { expectedPayable += 10000; expectedOpenPayable += 10000-paid; }
        else { expectedReceivable += 10000; expectedOpenReceivable += 10000-paid; }
      }
      h.db.exec('COMMIT');
    } catch (err) { h.db.exec('ROLLBACK'); throw err; }

    const insertsMs = Number((performance.now()-started).toFixed(2));
    const summary = timed(() => h.finance.getSummary());
    assert.equal(summary.result.payableTotalCents, expectedPayable);
    assert.equal(summary.result.receivableTotalCents, expectedReceivable);
    assert.equal(summary.result.payableOpenCents, expectedOpenPayable);
    assert.equal(summary.result.receivableOpenCents, expectedOpenReceivable);

    const list = timed(() => h.finance.listEntries({kind:'PAYABLE'}), 2);
    assert.equal(list.result.length, count/2);
    const cash = timed(() => h.cashflow.getCashflowSummary({from:'2026-09-01',to:'2026-09-30'}));
    assert.equal(cash.result.closingBalanceCents,expectedPaid);
    const dashboard = timed(() => h.analytics.getDashboardSnapshot({year:2026}),2);
    assert.equal(dashboard.result.cards.totalBalanceCents,expectedPaid);
    assert.equal(dashboard.result.cards.payableOpenCents,expectedOpenPayable);
    assert.equal(dashboard.result.balanceAsOf,'2026-09-12');

    const report = { count, synthetic:true, persistedEntries:count, insertedMs:insertsMs,
      summary:summary.durationMs, listPayables:list.durationMs,
      cashflow:cash.durationMs, dashboard:dashboard.durationMs,
      heapMb:Number((process.memoryUsage().heapUsed/1048576).toFixed(1)),
      validated:{openPayables:expectedOpenPayable,openReceivables:expectedOpenReceivable,cashBalance:expectedPaid} };
    fs.writeFileSync(path.join(root,`ledger-${count}.json`),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
  } finally { h.cleanup(); }
}
