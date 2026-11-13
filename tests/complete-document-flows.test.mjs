import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PDFDocument } = require('pdf-lib');
const ExcelJS = require('exceljs');
const { createHarness } = await import('./helpers/test-harness.mjs');

test('DRE and cashflow Word/PDF reports use the same canonical totals and embed a real chart', async () => {
  const { toDreDocxBuffer, toCashflowDocxBuffer, dreHtml, cashflowHtml } = require('../electron/services/financial-documents.cjs');
  const dre = { basis: 'accrual', from:'2026-11-01', to:'2026-11-30', groups:[{ group:'Operacional', revenueCents:10050,expenseCents:3050,resultCents:7000 }], totals:{ revenueCents:10050,expenseCents:3050,resultCents:7000 } };
  const cash = { summary:{openingBalanceCents:8000,inCents:10050,outCents:3050,netCents:7000,closingBalanceCents:15000},movements:[{occurredAt:'2026-11-13',direction:'IN',amountCents:10050,note:'Teste fictício'}] };
  const [dreDoc, cashDoc] = await Promise.all([toDreDocxBuffer(dre),toCashflowDocxBuffer(cash)]);
  for(const item of [dreDoc,cashDoc]) { assert.equal(Buffer.from(item).subarray(0,2).toString(),'PK');assert.ok(item.length>4500); }
  assert.match(dreHtml(dre), /data:image\/png;base64,/);
  assert.match(cashflowHtml(cash), /data:image\/png;base64,/);
  assert.match(dreHtml(dre), /70,00/);
  assert.match(cashflowHtml(cash), /150,00/);
});

test('PDF form filling supports text and checkboxes, refuses fields not in the template', async () => {
  const { inspectPdfFormBuffer, fillPdfFormBuffer } = require('../electron/services/open-document-suite.cjs');
  const pdf = await PDFDocument.create();
  const form = pdf.getForm();
  form.createTextField('cliente').addToPage(pdf.addPage([400,400]),{x:20,y:300,width:250,height:28});
  form.createCheckBox('aprovado').addToPage(pdf.getPage(0),{x:20,y:200,width:16,height:16});
  const bytes = Buffer.from(await pdf.save());
  assert.deepEqual((await inspectPdfFormBuffer(bytes)).map(x=>x.name),['cliente','aprovado']);
  const filled = await fillPdfFormBuffer(bytes,{cliente:'Teste local',aprovado:true});
  const reloaded = await PDFDocument.load(filled);
  assert.equal(reloaded.getForm().getTextField('cliente').getText(),'Teste local');
  assert.equal(reloaded.getForm().getCheckBox('aprovado').isChecked(),true);
  await assert.rejects(fillPdfFormBuffer(bytes,{segredo:'x'}),/não encontrado|unknown|inexistente/i);
});

test('XLSX custom header mapping resolves unfamiliar bank layouts without formula evaluation', async () => {
  const { inspectStatementXlsx, parseStatementXlsx } = require('../electron/services/open-document-suite.cjs');
  const book = new ExcelJS.Workbook();const ws=book.addWorksheet('Banco');ws.addRow(['Quando','O que houve','R$ debitado','Entrada/Saída']);ws.addRow(['13/11/2026','PIX fictício','-55,01','debit']);
  const base64=Buffer.from(await book.xlsx.writeBuffer()).toString('base64');
  assert.deepEqual((await inspectStatementXlsx(base64)).headers,['Quando','O que houve','R$ debitado','Entrada/Saída']);
  const rows=await parseStatementXlsx(base64,{date:'Quando',description:'O que houve',amount:'R$ debitado',direction:'Entrada/Saída'});
  assert.equal(rows.length,1);assert.equal(rows[0].amount,'-55,01');assert.equal(rows[0].description,'PIX fictício');
  await assert.rejects(parseStatementXlsx(base64,{date:'Vencimento',description:'O que houve',amount:'R$ debitado'}),/coluna|column|inválid/i);
});

test('OCR correction is audited and never changes a linked financial entry', () => {
  const ctx=createHarness();
  try {
    const { updateAttachmentExtractedText } = require('../electron/services/attachment-ocr-service.cjs');
    const actor={id:'admin',role:'ADMIN'};
    const account=ctx.finance.createAccount({id:'a',name:'Banco',type:'BANK'},actor);
    const entry=ctx.finance.createEntry({id:'e',kind:'PAYABLE',description:'Conta original',amountCents:5000,dueAt:'2026-11-13',accountId:account.id},actor);
    const now='2026-11-13T12:00:00Z';
    ctx.db.prepare('INSERT INTO entry_attachments(id,entry_id,workspace_path,filename,review_status,extracted_text,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run('ocr1',entry.id,'nota.png','nota.png','PENDING','Valor 10,00',now,now);
    const before=ctx.db.prepare('SELECT amount_cents,status FROM financial_entries WHERE id=?').get(entry.id);
    updateAttachmentExtractedText(ctx.db,'ocr1','Valor 50,00',actor,()=>now);
    assert.equal(ctx.db.prepare('SELECT extracted_text FROM entry_attachments WHERE id=?').get('ocr1').extracted_text,'Valor 50,00');
    assert.deepEqual(ctx.db.prepare('SELECT amount_cents,status FROM financial_entries WHERE id=?').get(entry.id),before);
    assert.ok(ctx.db.prepare("SELECT id FROM audit_log WHERE action='planning.attachment.ocr.correct'").get());
  } finally {ctx.cleanup();}
});

test('signed ZIP package import verifies integrity and returns review-only preview',async()=>{
  const { verifyAndPreviewPackage } = require('../electron/services/open-document-suite.cjs');
  const { createReportService } = require('../electron/services/report-service.cjs');
  const ctx=createHarness();try{
    const reports=createReportService({db:ctx.db,finance:ctx.finance,analytics:ctx.analytics});
    const report=reports.financialReport({});
    const packageBytes=await reports.toPackageBuffer(report);
    const inspected=verifyAndPreviewPackage(packageBytes);
    assert.equal(inspected.summary.rows,report.rows.length);
    assert.equal(inspected.summary.amountCents,report.totals.amountCents);
    assert.equal(inspected.valid,true);
  }finally {ctx.cleanup();}
});
