import test from 'node:test';
import assert from 'node:assert/strict';
import planning from '../electron/services/planning-service.cjs';

const { normalizeAllocations, projectSeries, validateBulkSelection } = planning;

test('normalizeAllocations closes percentage rateio exactly in cents', () => {
  const rows = normalizeAllocations(10001, [
    { costCenterId: 'a', percentage: 60 },
    { costCenterId: 'b', percentage: 40 },
  ]);
  assert.deepEqual(rows.map((row) => row.amountCents), [6001, 4000]);
  assert.equal(rows.reduce((sum, row) => sum + row.amountCents, 0), 10001);
});

test('normalizeAllocations rejects divergent explicit values', () => {
  assert.throws(() => normalizeAllocations(10000, [
    { costCenterId: 'a', amountCents: 4000 },
    { costCenterId: 'b', amountCents: 5000 },
  ]), /equal entry amount/i);
});

test('projectSeries applies what-if without mutating source rows', () => {
  const source = [{ month: '2026-10', netCents: 10000 }];
  const result = projectSeries({ openingBalanceCents: 5000, monthly: source, adjustments: [{ month: '2026-10', amountCents: -3000 }] });
  assert.equal(result[0].closingBalanceCents, 12000);
  assert.deepEqual(source, [{ month: '2026-10', netCents: 10000 }]);
});

test('validateBulkSelection fails before write for invalid ids', () => {
  assert.throws(() => validateBulkSelection(['e1', '', 'e2']), /invalid entry id/i);
  assert.deepEqual(validateBulkSelection(['e1', 'e1', 'e2']), ['e1', 'e2']);
});
