'use strict';
const ExcelJS = require('exceljs');

const fmt = '"R$" #,##0.00;[Red]("R$" #,##0.00)';
const MAX_ROWS = 30000;
function requireInteger(value, label) {
  if (!Number.isSafeInteger(value)) throw new TypeError(label + ' precisa ser inteiro seguro');
  return value / 100;
}
function applySheet(book, title, headers, rows, moneyColumns) {
  if (!Array.isArray(rows) || rows.length > MAX_ROWS) throw new RangeError('Exportação limitada a 30 mil linhas');
  const sheet = book.addWorksheet(title, { views: [{ state:'frozen', ySplit:1 }] });
  sheet.columns = headers.map((header, i) => ({ header, width: Math.max(17, Math.min(40, header.length + 12)), key: 'column' + i }));
  for (const row of rows) sheet.addRow(row);
  sheet.getRow(1).font = { bold:true, color:{argb:'FFFFFFFF'} };
  sheet.getRow(1).fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF34305F'} };
  sheet.autoFilter = { from:'A1', to: sheet.getRow(1).getCell(headers.length).address.replace(/\d+/g,'') + Math.max(1,sheet.rowCount) };
  for (const n of moneyColumns) sheet.getColumn(n).numFmt = fmt;
  return sheet;
}
async function toPlanningXlsxBuffer({budgets=[], comparisons=[], projection=[]}={}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ArtiSys Financeiro';
  applySheet(workbook, 'Orçamento', ['Cenário','Ano','Mês','Natureza','Categoria','Centro de custo','Planejado (R$)','Observações'],
    budgets.map(row => [row.scenario_name || row.scenario_id, row.year,row.month,row.nature,row.category_name || '',row.cost_center_name || '',requireInteger(row.amount_cents,'orçamento'),row.notes || '']), [7]);
  applySheet(workbook, 'Planejado x Realizado', ['Ano','Mês','Natureza','Planejado (R$)','Realizado (R$)','Comprometido (R$)','Projetado (R$)','Diferença (R$)'],
    comparisons.map(row => [row.year,row.month,row.nature,...['plannedCents','actualCents','committedCents','projectedCents','varianceCents'].map(key => requireInteger(row[key],key))]), [4,5,6,7,8]);
  applySheet(workbook, 'Projeção', ['Mês','Saldo inicial','Movimento base','Ajuste','Saldo projetado'],
    projection.map(row => [row.month, requireInteger(row.openingBalanceCents,'saldo'), requireInteger(row.baseNetCents,'base'), requireInteger(row.adjustmentCents,'ajuste'), requireInteger(row.closingBalanceCents,'projetado')]),[2,3,4,5]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
async function toDreXlsxBuffer(input) {
  if (!input || !Array.isArray(input.groups) || !input.totals) throw new TypeError('DRE canônico obrigatório');
  const book = new ExcelJS.Workbook();
  book.creator = 'ArtiSys Financeiro';
  applySheet(book, 'DRE', ['Grupo DRE','Receitas (R$)','Despesas (R$)','Resultado (R$)'],
    [...input.groups.map(row => [row.group,requireInteger(row.revenueCents,'receita'),requireInteger(row.expenseCents,'despesa'),requireInteger(row.resultCents,'resultado')]), ['Total',requireInteger(input.totals.revenueCents,'receita total'),requireInteger(input.totals.expenseCents,'despesa total'),requireInteger(input.totals.resultCents,'resultado total')]], [2,3,4]);
  return Buffer.from(await book.xlsx.writeBuffer());
}
module.exports = { toPlanningXlsxBuffer, toDreXlsxBuffer };
