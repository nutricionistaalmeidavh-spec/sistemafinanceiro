'use strict';

let printing = null;
try { printing = require('@artisys/printing'); } catch {}

function xmlEscape(value) { return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); }
function htmlEscape(value) { return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function csvCell(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }
function money(cents) { return (Number(cents || 0) / 100).toFixed(2).replace('.', ','); }
function columnName(index) { let n = index + 1; let name = ''; while (n > 0) { const rem = (n - 1) % 26; name = String.fromCharCode(65 + rem) + name; n = Math.floor(n / 26); } return name; }
function proportionalCents(value, total, share) {
  const denominator = Number(total || 0);
  if (denominator <= 0) return 0;
  return Math.round((Number(value || 0) * Number(share || 0)) / denominator);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buffer) { let crc = 0xffffffff; for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
function zipStore(entries) {
  const locals = []; const centrals = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28); name.copy(local, 30);
    locals.push(local, data);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8); central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12); central.writeUInt16LE(0, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32); central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38); central.writeUInt32LE(offset, 42); name.copy(central, 46);
    centrals.push(central);
    offset += local.length + data.length;
  }
  const centralData = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralData.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralData, end]);
}

function xlsxSheet(rows) {
  const body = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, colIndex) => {
    const ref = `${columnName(colIndex)}${rowIndex + 1}`;
    if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
  }).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

function createReportService({ db, finance, analytics = null, now = () => new Date().toISOString() } = {}) {
  if (!db || !finance) throw new TypeError('db and finance are required');
  const nowIso = () => String(now());
  const accountName = (id) => id ? db.prepare('SELECT name FROM financial_accounts WHERE id=?').get(String(id))?.name || '' : '';
  const categoryName = (id) => id ? db.prepare('SELECT name FROM financial_categories WHERE id=?').get(String(id))?.name || '' : '';
  function counterparty(entry) {
    if (entry.customerId) return db.prepare('SELECT id,name,document FROM customers WHERE id=?').get(String(entry.customerId)) || null;
    if (entry.creditorId) return db.prepare('SELECT id,name,document FROM creditors WHERE id=?').get(String(entry.creditorId)) || null;
    return null;
  }
  function planningMetadata(entryId) {
    const allocations = db.prepare(`SELECT ea.cost_center_id costCenterId,ea.amount_cents amountCents,ea.percentage_basis_points percentageBasisPoints,cc.code,cc.name
      FROM entry_allocations ea JOIN cost_centers cc ON cc.id=ea.cost_center_id WHERE ea.entry_id=? ORDER BY cc.code,cc.name`).all(String(entryId));
    const tags = db.prepare(`SELECT t.id,t.name FROM entry_tags et JOIN tags t ON t.id=et.tag_id WHERE et.entry_id=? ORDER BY t.name COLLATE NOCASE`).all(String(entryId));
    return { allocations, tags };
  }

  function settlementReceipt(settlementId) {
    const row = db.prepare(`SELECT fs.*,fe.kind,fe.description,fe.amount_cents entry_amount_cents,fe.customer_id,fe.creditor_id,fe.category_id,COALESCE(fs.account_id,fe.account_id) resolved_account_id
      FROM financial_settlements fs JOIN financial_entries fe ON fe.id=fs.entry_id WHERE fs.id=?`).get(String(settlementId));
    if (!row) throw new Error('settlement not found');
    if (row.reversed_at) throw new Error('cannot issue receipt for reversed settlement');
    const party = row.customer_id ? db.prepare('SELECT id,name,document FROM customers WHERE id=?').get(row.customer_id) : row.creditor_id ? db.prepare('SELECT id,name,document FROM creditors WHERE id=?').get(row.creditor_id) : null;
    const account = row.resolved_account_id ? db.prepare('SELECT id,name,type FROM financial_accounts WHERE id=?').get(row.resolved_account_id) : null;
    const category = row.category_id ? db.prepare('SELECT id,name,nature,dre_group FROM financial_categories WHERE id=?').get(row.category_id) : null;
    const receipt = {
      kind: 'SETTLEMENT_RECEIPT',
      title: row.kind === 'RECEIVABLE' ? 'Recibo de recebimento' : 'Comprovante de pagamento',
      number: row.id,
      generatedAt: nowIso(),
      entry: { id: row.entry_id, kind: row.kind, description: row.description, amountCents: Number(row.entry_amount_cents) },
      settlement: { id: row.id, amountCents: Number(row.amount_cents), method: row.method, occurredAt: row.occurred_at, note: row.note },
      counterparty: party ? { id: party.id, name: party.name, document: party.document || null } : null,
      account: account ? { id: account.id, name: account.name, type: account.type } : null,
      category: category ? { id: category.id, name: category.name, nature: category.nature, dreGroup: category.dre_group } : null,
    };
    if (printing?.createReceiptDocument) {
      receipt.printingDocument = printing.createReceiptDocument({
        title: 'ArtiSys Financeiro',
        documentLabel: receipt.title,
        metadata: [['Documento', receipt.number], ['Data', receipt.settlement.occurredAt], ['Descrição', receipt.entry.description], ['Contraparte', receipt.counterparty?.name || '-']],
        totals: [['Valor', `R$ ${money(receipt.settlement.amountCents)}`]],
        payments: [['Forma', receipt.settlement.method || '-']],
        footer: ['Documento financeiro não fiscal'],
      });
    }
    return receipt;
  }

  function financialReport(filters = {}) {
    const { costCenterId = null, tagId = null, ...financeFilters } = filters || {};
    const entries = finance.listEntries(financeFilters);
    const rows = [];
    for (const entry of entries) {
      const metadata = planningMetadata(entry.id);
      if (tagId && !metadata.tags.some((tag) => tag.id === String(tagId))) continue;
      let amountCents = Number(entry.amountCents);
      let settledCents = Number(entry.settledCents);
      let openCents = Number(entry.openCents);
      if (costCenterId) {
        const allocation = metadata.allocations.find((item) => item.costCenterId === String(costCenterId));
        if (!allocation) continue;
        amountCents = Number(allocation.amountCents);
        settledCents = Math.min(amountCents, proportionalCents(entry.settledCents, entry.amountCents, amountCents));
        openCents = Math.max(amountCents - settledCents, 0);
      }
      const party = counterparty(entry);
      rows.push({
        id: entry.id, dueAt: entry.dueAt, kind: entry.kind, description: entry.description, status: entry.status,
        amountCents, settledCents, openCents, isOverdue: Boolean(entry.isOverdue && openCents > 0),
        account: accountName(entry.accountId), category: categoryName(entry.categoryId), counterparty: party?.name || '',
        costCenters: metadata.allocations.map((item) => `${item.code} · ${item.name} (${(Number(item.percentageBasisPoints) / 100).toFixed(2)}%)`).join(', '),
        tags: metadata.tags.map((item) => item.name).join(', '),
      });
    }
    const totals = rows.reduce((acc, row) => ({ amountCents: acc.amountCents + row.amountCents, settledCents: acc.settledCents + row.settledCents, openCents: acc.openCents + row.openCents }), { amountCents: 0, settledCents: 0, openCents: 0 });
    const report = { kind: 'FINANCIAL_REPORT', generatedAt: nowIso(), filters: { ...filters }, rows, totals };
    if (analytics && filters.from && filters.to && !costCenterId && !tagId) report.indicators = analytics.getIndicators({ from: filters.from, to: filters.to, asOf: filters.to });
    return report;
  }

  function toCsv(report) {
    if (!report || !Array.isArray(report.rows)) throw new TypeError('financial report is required');
    const headers = ['Vencimento','Tipo','Descrição','Status','Valor','Baixado','Em aberto','Conta','Categoria','Contraparte','Centros de custo','Tags'];
    const rows = report.rows.map((row) => [row.dueAt,row.kind,row.description,row.status,money(row.amountCents),money(row.settledCents),money(row.openCents),row.account,row.category,row.counterparty,row.costCenters||'',row.tags||'']);
    return `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n')}`;
  }

  function toXlsxBuffer(report) {
    if (!report || !Array.isArray(report.rows)) throw new TypeError('financial report is required');
    const rows = [['Vencimento','Tipo','Descrição','Status','Valor','Baixado','Em aberto','Conta','Categoria','Contraparte','Centros de custo','Tags'], ...report.rows.map((row) => [row.dueAt,row.kind,row.description,row.status,row.amountCents / 100,row.settledCents / 100,row.openCents / 100,row.account,row.category,row.counterparty,row.costCenters||'',row.tags||''])];
    const entries = [
      { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>` },
      { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Financeiro" sheetId="1" r:id="rId1"/></sheets></workbook>` },
      { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>` },
      { name: 'xl/worksheets/sheet1.xml', data: xlsxSheet(rows) },
    ];
    return zipStore(entries);
  }

  function toPrintableHtml(document) {
    if (!document) throw new TypeError('document is required');
    const style = `<style>body{font-family:Arial,sans-serif;color:#1f2937;margin:32px}h1{font-size:24px;margin:0 0 6px}p{margin:4px 0}.muted{color:#6b7280}.box{border:1px solid #d1d5db;border-radius:10px;padding:16px;margin:18px 0}.amount{font-size:28px;font-weight:700}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{padding:8px;border-bottom:1px solid #e5e7eb;text-align:left;font-size:11px}th{background:#f9fafb}@media print{body{margin:8mm}.no-print{display:none}}</style>`;
    if (document.kind === 'SETTLEMENT_RECEIPT') {
      return `<!doctype html><html><head><meta charset="utf-8"><title>${htmlEscape(document.title)}</title>${style}</head><body><h1>${htmlEscape(document.title)}</h1><p class="muted">ArtiSys Financeiro · ${htmlEscape(document.number)}</p><div class="box"><p>${htmlEscape(document.entry.description)}</p><p>${htmlEscape(document.counterparty?.name || 'Contraparte não informada')}</p><p>${htmlEscape(document.account?.name || 'Conta não informada')} · ${htmlEscape(document.settlement.method || 'Forma não informada')}</p><p>${htmlEscape(document.settlement.occurredAt)}</p><div class="amount">R$ ${money(document.settlement.amountCents)}</div></div><p class="muted">Documento financeiro não fiscal. Gerado em ${htmlEscape(document.generatedAt)}</p></body></html>`;
    }
    if (document.kind === 'FINANCIAL_REPORT') {
      const rows = document.rows.map((row) => `<tr><td>${htmlEscape(row.dueAt)}</td><td>${htmlEscape(row.kind)}</td><td>${htmlEscape(row.description)}</td><td>${htmlEscape(row.status)}</td><td>R$ ${money(row.amountCents)}</td><td>R$ ${money(row.settledCents)}</td><td>R$ ${money(row.openCents)}</td><td>${htmlEscape(row.costCenters || '-')}</td><td>${htmlEscape(row.tags || '-')}</td></tr>`).join('');
      return `<!doctype html><html><head><meta charset="utf-8"><title>Relatório Financeiro</title>${style}</head><body><h1>Relatório Financeiro</h1><p class="muted">Gerado em ${htmlEscape(document.generatedAt)}</p><div class="box"><strong>Total: R$ ${money(document.totals.amountCents)}</strong><p>Baixado: R$ ${money(document.totals.settledCents)} · Em aberto: R$ ${money(document.totals.openCents)}</p></div><table><thead><tr><th>Vencimento</th><th>Tipo</th><th>Descrição</th><th>Status</th><th>Valor</th><th>Baixado</th><th>Em aberto</th><th>Centro(s)</th><th>Tags</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
    }
    throw new Error('unsupported printable document');
  }

  return { settlementReceipt, financialReport, toCsv, toXlsxBuffer, toPrintableHtml };
}

module.exports = { createReportService, zipStore, crc32, proportionalCents };