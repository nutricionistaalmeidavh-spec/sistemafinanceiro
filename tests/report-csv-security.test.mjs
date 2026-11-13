import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { csvCell } = require('../electron/services/report-service.cjs');

test('CSV exported text cannot execute spreadsheet formulas', () => {
  for (const input of ['=1+1', '+SUM(1,1)', '-cmd', '@SUM(A1)', '\t=1+1', '\r=1+1']) {
    const cell = csvCell(input);
    assert.ok(cell.startsWith('"\''), input);
  }
});
test('CSV escapes quotes and preserves normal content', () => {
  assert.equal(csvCell('Conta "Banco"'), '"Conta ""Banco"""');
  assert.equal(csvCell('Receita'), '"Receita"');
});
