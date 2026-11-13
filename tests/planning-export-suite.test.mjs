import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const ExcelJS = require('exceljs');
const { toPlanningXlsxBuffer,toDreXlsxBuffer } = require('../electron/services/planning-export-service.cjs');

test('planning export renders budget, comparison and projection from canonical integer cents', async()=>{
  const bytes = await toPlanningXlsxBuffer({
    budgets:[{scenario_id:'base',scenario_name:'Base',year:2026,month:11,nature:'EXPENSE',category_name:'Materiais',cost_center_name:'Obra 1',amount_cents:12345,notes:null}],
    comparisons:[{year:2026,month:11,nature:'EXPENSE',plannedCents:12345,actualCents:7000,committedCents:2345,projectedCents:10000,varianceCents:2345}],
    projection:[{month:'2026-12',openingBalanceCents:10000,baseNetCents:2000,adjustmentCents:-500,closingBalanceCents:11500}]
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  assert.deepEqual(wb.worksheets.map(s=>s.name),['Orçamento','Planejado x Realizado','Projeção','Modelo conciliação']);
  assert.equal(wb.worksheets[0].getCell('G2').value,123.45);
  assert.equal(wb.worksheets[1].getCell('E2').value,70);
  assert.equal(wb.worksheets[2].getCell('E2').value,115);
  assert.equal(wb.worksheets[3].getCell('B1').value,'Descrição');
});

test('DRE workbook uses canonical totals and no formulas',async()=>{
  const bytes = await toDreXlsxBuffer({
    groups:[{group:'Operacional',revenueCents:10000,expenseCents:3500,resultCents:6500}],
    totals:{revenueCents:10000,expenseCents:3500,resultCents:6500}
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  assert.equal(wb.worksheets[0].getCell('D3').value,65);
  assert.equal(wb.worksheets[0].getCell('D3').type,ExcelJS.ValueType.Number);
  await assert.rejects(toDreXlsxBuffer({groups:[],totals:{revenueCents:0.1,expenseCents:0,resultCents:0}}),/inteiro seguro/);
});
