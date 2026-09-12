import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './helpers/test-harness.mjs';

test('recurrence generates monthly entries once and respects maximum occurrences', () => {
  const h = createHarness();
  try {
    const rule = h.recurrence.createRule({ id:'r1', kind:'RECEIVABLE', description:'Mensalidade', amountCents:10000, startDate:'2026-01-01', dueDay:10, maxOccurrences:3 });
    assert.equal(rule.nextDueAt, '2026-01-10');
    const generated = h.recurrence.generateDue({ asOf:'2026-04-01' });
    assert.equal(generated.length, 3);
    assert.deepEqual(generated.map((x)=>x.dueAt), ['2026-01-10','2026-02-10','2026-03-10']);
    assert.equal(new Set(generated.map((x)=>x.recurrenceKey)).size, 3);
    assert.equal(h.recurrence.generateDue({ asOf:'2026-04-01' }).length, 0);
    const after = h.recurrence.listRules().find((x)=>x.id==='r1');
    assert.equal(after.generatedCount, 3); assert.equal(after.active, false);
    const paused = h.recurrence.createRule({ id:'r2', kind:'PAYABLE', description:'Aluguel', amountCents:5000, startDate:'2026-01-01', dueDay:5 });
    h.recurrence.setRuleActive(paused.id, false);
    assert.equal(h.recurrence.generateDue({ asOf:'2026-12-31' }).some((x)=>x.recurrenceRuleId==='r2'), false);
  } finally { h.cleanup(); }
});
