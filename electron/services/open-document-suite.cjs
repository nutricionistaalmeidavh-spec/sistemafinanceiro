'use strict';

const crypto = require('node:crypto');
const ExcelJS = require('exceljs');
const Docx = require('docx');
const { PDFDocument } = require('pdf-lib');
const { unzipSync } = require('fflate');

const HEADERS = Object.freeze(['Vencimento','Tipo','Descrição','Status','Valor','Baixado','Em aberto','Conta','Categoria','Contraparte','Centros de custo','Tags']);
const MONEY_FORMAT = '"R$" #,##0.00;[Red]("R$" #,##0.00)';
const MAX_REPORT_ROWS = 50000;
const MAX_DOCUMENT_ROWS = 5000;
const MAX_IMPORT_BYTES = 12 * 1024 * 1024;
const MAX_IMPORT_ROWS = 50000;

function assertReport(report) {
  if (!report || report.kind !== 'FINANCIAL_REPORT' || !Array.isArray(report.rows) || !report.totals) throw new TypeError('financial report is required');
  if (report.rows.length > MAX_REPORT_ROWS) throw new RangeError('relatório excede 50 mil lançamentos');
  for (const row of report.rows) for (const key of ['amountCents','settledCents','openCents']) {
    if (!Number.isSafeInteger(row[key])) throw new TypeError('valor monetário não é inteiro seguro: ' + key);
  }
  for (const value of Object.values(report.totals)) if (!Number.isSafeInteger(value)) throw new TypeError('total monetário inválido');
  return report;
}
function amount(cents) { return Number(cents) / 100; }
function formatMoney(cents) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount(cents));
}
function rowValues(row) {
  return [row.dueAt,row.kind,row.description,row.status,amount(row.amountCents),amount(row.settledCents),amount(row.openCents),row.account,row.category,row.counterparty,row.costCenters || '',row.tags || ''];
}
async function toStyledXlsxBuffer(input) {
  const report = assertReport(input);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ArtiSys Financeiro';
  workbook.created = new Date(report.generatedAt);
  const sheet = workbook.addWorksheet('Lançamentos', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = HEADERS.map((header,index) => ({
    header, key: 'column' + index, width: [15,15,46,17,19,19,19,26,25,30,38,22][index]
  }));
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF34305F' } };
  for (const row of report.rows) sheet.addRow(rowValues(row).map(value => value ?? ''));
  sheet.autoFilter = { from: 'A1', to: 'L' + Math.max(1, report.rows.length + 1) };
  for (const col of ['E','F','G']) sheet.getColumn(col).numFmt = MONEY_FORMAT;
  const summary = workbook.addWorksheet('Resumo');
  summary.columns = [{ header:'Indicador', key:'label', width:32 },{ header:'Valor (R$)', key:'value', width:24 }];
  summary.getRow(1).font = { bold:true };
  summary.addRow(['Total', amount(report.totals.amountCents)]);
  summary.addRow(['Baixado', amount(report.totals.settledCents)]);
  summary.addRow(['Em aberto', amount(report.totals.openCents)]);
  summary.addRow(['Lançamentos', report.rows.length]);
  summary.getColumn(2).numFmt = MONEY_FORMAT;
  summary.getCell('B5').numFmt = '0';
  const bytes = await workbook.xlsx.writeBuffer();
  return Buffer.from(bytes);
}
function tableCells(values) {
  return new Docx.TableRow({ children: values.map(value => new Docx.TableCell({
    children: [new Docx.Paragraph({ text: String(value ?? ''), spacing: { after: 50 } })]
  })) });
}
async function toDocxBuffer(input) {
  const report = assertReport(input);
  if (report.rows.length > MAX_DOCUMENT_ROWS) throw new RangeError('DOCX limitado a 5 mil linhas; use XLSX para relatórios maiores');
  const children = [
    new Docx.Paragraph({ text: 'ArtiSys Financeiro', heading: Docx.HeadingLevel.TITLE }),
    new Docx.Paragraph({ text: 'Relatório financeiro', heading: Docx.HeadingLevel.HEADING_1 }),
    new Docx.Paragraph({ text: 'Gerado em: ' + report.generatedAt }),
    new Docx.Paragraph({ text: 'Total: ' + formatMoney(report.totals.amountCents) + '  |  Baixado: ' + formatMoney(report.totals.settledCents) + '  |  Em aberto: ' + formatMoney(report.totals.openCents) }),
    new Docx.Paragraph({ text: 'Lançamentos: ' + report.rows.length }),
    new Docx.Table({ rows: [
      tableCells(['Vencimento','Tipo','Descrição','Valor','Baixado','Aberto']),
      ...report.rows.map(row => tableCells([
        row.dueAt, row.kind, row.description, formatMoney(row.amountCents), formatMoney(row.settledCents), formatMoney(row.openCents)
      ]))
    ] })
  ];
  return Docx.Packer.toBuffer(new Docx.Document({ sections: [{ children }] }));
}
function toJsonBuffer(input) {
  const report = assertReport(input);
  const payload = { schema: 'br.com.artisys.financeiro.report', version: 1, exportedAt: report.generatedAt, filters: report.filters, totals: report.totals, rows: report.rows };
  return Buffer.from(JSON.stringify(payload, null, 2) + '\n', 'utf8');
}
function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
async function toPackageBuffer(report, { toCsv, zipStore } = {}) {
  assertReport(report);
  if (typeof toCsv !== 'function' || typeof zipStore !== 'function') throw new TypeError('CSV and ZIP adapters are required');
  const entries = [
    { name: 'relatorio.json', data: toJsonBuffer(report) },
    { name: 'relatorio.csv', data: Buffer.from(toCsv(report), 'utf8') },
    { name: 'relatorio.xlsx', data: await toStyledXlsxBuffer(report) },
    { name: 'relatorio.docx', data: await toDocxBuffer(report) },
  ];
  const manifest = {
    schema: 'br.com.artisys.financeiro.export-package', version: 1,
    generatedAt: report.generatedAt,
    files: entries.map(entry => ({ name: entry.name, bytes: entry.data.length, sha256: sha256(entry.data) }))
  };
  entries.push({ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2) + '\n') });
  return zipStore(entries);
}
function verifyReportPackageBuffer(buffer) {
  const raw = Buffer.from(buffer || []);
  if (raw.length < 32 || raw.length > 80 * 1024 * 1024) throw new RangeError('pacote ZIP inválido ou maior que 80 MB');
  const files = unzipSync(new Uint8Array(raw));
  const names = Object.keys(files);
  if (!names.includes('manifest.json') || names.length < 2 || names.length > 10) throw new TypeError('pacote sem manifesto ou com arquivos inesperados');
  const manifest = JSON.parse(Buffer.from(files['manifest.json']).toString('utf8'));
  if (manifest.schema !== 'br.com.artisys.financeiro.export-package' || manifest.version !== 1 || !Array.isArray(manifest.files)) throw new TypeError('manifesto de pacote não suportado');
  const declared = manifest.files.map(item => item.name);
  if (new Set(declared).size !== declared.length || declared.length !== names.length - 1) throw new TypeError('manifesto inconsistente');
  for (const item of manifest.files) {
    if (typeof item.name !== 'string' || item.name.includes('/') || item.name.includes('\\') || item.name === 'manifest.json') throw new TypeError('nome de arquivo não permitido');
    if (!Object.prototype.hasOwnProperty.call(files,item.name)) throw new TypeError('arquivo ausente do pacote');
    const actual = Buffer.from(files[item.name]);
    if (actual.length > 60 * 1024 * 1024 || actual.length !== item.bytes || sha256(actual) !== item.sha256) throw new Error('integridade SHA-256 do pacote inválida: ' + item.name);
  }
  return { valid:true, fileCount:manifest.files.length, generatedAt:manifest.generatedAt };
}
async function annotatePdfBuffer(source, title = 'ArtiSys Financeiro') {
  const pdf = await PDFDocument.load(source, { updateMetadata: false });
  pdf.setTitle(title);
  pdf.setAuthor('ArtiSys Financeiro');
  pdf.setProducer('ArtiSys Financeiro / pdf-lib');
  return Buffer.from(await pdf.save());
}
async function mergePdfBuffers(buffers) {
  if (!Array.isArray(buffers) || buffers.length < 2 || buffers.length > 10) throw new RangeError('selecione entre 2 e 10 PDFs');
  const result = await PDFDocument.create();
  let pages = 0;
  for (const bytes of buffers) {
    const source = await PDFDocument.load(bytes, { ignoreEncryption: false });
    pages += source.getPageCount();
    if (pages > 300) throw new RangeError('limite de 300 páginas excedido');
    const copied = await result.copyPages(source, source.getPageIndices());
    for (const page of copied) result.addPage(page);
  }
  result.setTitle('Documentos reunidos - ArtiSys Financeiro');
  return Buffer.from(await result.save());
}
function cellText(cell) {
  const value = cell.value;
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0,10);
  if (typeof value === 'number' || typeof value === 'string') return String(value);
  if (typeof value === 'object' && ('formula' in value || 'sharedFormula' in value)) throw new TypeError('planilha contém fórmula; substitua por valores antes de importar');
  if (typeof value === 'object' && Array.isArray(value.richText)) return value.richText.map(part => part.text || '').join('');
  if (typeof value === 'object' && typeof value.text === 'string' && !value.hyperlink) return value.text;
  throw new TypeError('tipo de célula não permitido para importação');
}
function normalizedHeader(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
function getIndex(headers, aliases) {
  return headers.findIndex(value => aliases.includes(normalizedHeader(value)));
}
async function parseStatementXlsx(dataBase64) {
  if (typeof dataBase64 !== 'string' || !dataBase64.trim()) throw new TypeError('XLSX é obrigatório');
  const raw = Buffer.from(dataBase64, 'base64');
  if (!raw.length || raw.length > MAX_IMPORT_BYTES || !raw.subarray(0,2).equals(Buffer.from('PK'))) throw new RangeError('arquivo XLSX inválido ou maior que 12 MB');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(raw);
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 2 || sheet.rowCount > MAX_IMPORT_ROWS + 1) throw new RangeError('planilha deve conter de 1 a 50 mil linhas');
  const headers = Array.from({ length: Math.min(40, sheet.columnCount) }, (_, i) => cellText(sheet.getRow(1).getCell(i + 1)));
  const dateCol = getIndex(headers, ['DATA','DATE','DTPOSTED','VENCIMENTO']);
  const descCol = getIndex(headers, ['DESCRICAO','DESCRICAOOPERACAO','HISTORICO','MEMO','DESCRIPTION','NAME']);
  const amountCol = getIndex(headers, ['VALOR','AMOUNT','TRNAMT']);
  const debitCol = getIndex(headers, ['DEBITO','DEBIT']);
  const creditCol = getIndex(headers, ['CREDITO','CREDIT']);
  const typeCol = getIndex(headers, ['TIPO','NATUREZA','DIRECAO','DIRECTION']);
  if (dateCol < 0 || descCol < 0 || (amountCol < 0 && debitCol < 0 && creditCol < 0)) throw new TypeError('XLSX requer Data, Descrição e Valor (ou Débito/Crédito)');
  const rows = [];
  for (let n = 2; n <= sheet.rowCount; n++) {
    const cells = Array.from({ length: headers.length }, (_, i) => cellText(sheet.getRow(n).getCell(i + 1)));
    if (cells.every(value => !value.trim())) continue;
    const debit = debitCol >= 0 ? cells[debitCol] : '';
    const credit = creditCol >= 0 ? cells[creditCol] : '';
    const amount = amountCol >= 0 ? cells[amountCol] : debit ? '-' + debit : credit;
    rows.push({ date: cells[dateCol], description: cells[descCol], amount,
      direction: amountCol >= 0 ? cells[typeCol] : debit ? 'debit' : 'credit',
      externalId: 'row-' + (n - 1) });
  }
  return rows;
}

module.exports = {
  HEADERS, toStyledXlsxBuffer, toDocxBuffer, toJsonBuffer, toPackageBuffer,
  annotatePdfBuffer, mergePdfBuffers, parseStatementXlsx, verifyReportPackageBuffer
};
