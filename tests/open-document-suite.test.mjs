import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ExcelJS = require('exceljs');
const { PDFDocument } = require('pdf-lib');
const suite = require('../electron/services/open-document-suite.cjs');
const { createReportService, zipStore } = require('../electron/services/report-service.cjs');
const { parseCsv } = require('../electron/services/statement-import-service.cjs');

const report = {
  kind: 'FINANCIAL_REPORT', generatedAt: '2026-11-13T12:00:00.000Z',
  filters: { from:'2026-11-01', to:'2026-11-30' },
  rows: [{
    id:'tx1', dueAt:'2026-11-13', kind:'PAYABLE', description:'=2+2', status:'OPEN',
    amountCents:12345, settledCents:4500, openCents:7845, account:'Banco',
    category:'Despesas', counterparty:'Fornecedor', costCenters:'Obra 1', tags:'Suprimentos'
  }],
  totals: { amountCents: 12345, settledCents: 4500, openCents: 7845 },
};
const csv = (value) => '\uFEFFData;Valor\r\n' + value.rows.length;

test('ExcelJS creates a formatted two-sheet workbook without spreadsheet formula injection', async () => {
  const buffer = await suite.toStyledXlsxBuffer(report);
  assert.ok(Buffer.isBuffer(buffer));
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer);
  assert.deepEqual(book.worksheets.map(w => w.name), ['Lançamentos','Resumo']);
  assert.equal(book.worksheets[0].getCell('C2').value, '=2+2');
  assert.equal(book.worksheets[0].getCell('C2').type, ExcelJS.ValueType.String);
  assert.equal(book.worksheets[0].getCell('E2').value, 123.45);
  assert.equal(book.worksheets[1].getCell('B2').value, 123.45);
  assert.match(book.worksheets[0].getColumn(5).numFmt, /R\$/);
});

test('Word, canonical JSON, and integrity manifest ZIP are produced without changing source', async () => {
  const original = JSON.stringify(report);
  const docx = await suite.toDocxBuffer(report);
  assert.ok(Buffer.isBuffer(docx));
  assert.equal(docx.subarray(0,2).toString(), 'PK');
  const json = JSON.parse(suite.toJsonBuffer(report).toString('utf8'));
  assert.equal(json.version, 1);
  assert.equal(json.rows[0].amountCents, 12345);
  assert.equal(json.totals.amountCents, 12345);
  const archive = await suite.toPackageBuffer(report, { toCsv:csv, zipStore });
  assert.equal(archive.subarray(0,2).toString(), 'PK');
  assert.match(archive.toString('utf8'), /manifest.json/);
  assert.match(archive.toString('utf8'), /relatorio.docx/);
  assert.equal(JSON.stringify(report), original);
});

test('pdf-lib merges locally generated pages and retains page count', async () => {
  const first = await PDFDocument.create();
  first.addPage([400,400]);
  const second = await PDFDocument.create();
  second.addPage([400,400]); second.addPage([400,400]);
  const merged = await suite.mergePdfBuffers([await first.save(), await second.save()]);
  assert.equal((await PDFDocument.load(merged)).getPageCount(), 3);
  const annotated = await suite.annotatePdfBuffer(merged, 'Relatório integrado');
  assert.equal((await PDFDocument.load(annotated)).getTitle(), 'Relatório integrado');
});

test('XLSX bank import previews numeric amounts and refuses executable formula cells', async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Extrato');
  sheet.addRow(['Data','Descrição','Valor','Direção']);
  sheet.addRow(['13/11/2026','PIX teste',123.45,'credit']);
  const bytes = await book.xlsx.writeBuffer();
  const rows = await suite.parseStatementXlsx(Buffer.from(bytes).toString('base64'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, '13/11/2026');
  assert.equal(rows[0].amount, '123.45');
  sheet.getCell('C2').value = { formula: '2+2', result: 4 };
  await assert.rejects(suite.parseStatementXlsx(Buffer.from(await book.xlsx.writeBuffer()).toString('base64')), /fórmula/);
});

test('Papa Parse handles escaped multiline delimiters without dropping CSV amounts', () => {
  const rows = parseCsv('Data;Descrição;Valor\r\n13/11/2026;"PIX;\nFornecedor";-1.234,56\r\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].description, 'PIX;\nFornecedor');
  assert.equal(rows[0].amount, '-1.234,56');
});

test('invalid report money and oversized XLSX data fail closed', async () => {
  await assert.rejects(suite.toStyledXlsxBuffer({ ...report, totals: { amountCents:0.1, settledCents:0,openCents:0 }}), /inteiro seguro|monetário inválido/);
  await assert.rejects(suite.parseStatementXlsx('abc'), /inválido/);
});
