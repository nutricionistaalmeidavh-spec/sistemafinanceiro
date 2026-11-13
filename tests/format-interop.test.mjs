import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);

test('open-format ODS exporter and importer round-trip Brazilian amounts without any paid service',async()=>{
  const {toOdsBuffer,parseStatementOds}=require('../electron/services/open-format-service.cjs');
  const file=await toOdsBuffer({
    headers:['Data','Descrição','Valor','Direção'],
    rows:[['13/11/2026','Transferência fictícia',-120.35,'debit']]
  });
  assert.equal(file.subarray(0,2).toString(),'PK');
  const rows=await parseStatementOds(file.toString('base64'));
  assert.equal(rows[0].description,'Transferência fictícia');
  assert.equal(rows[0].amount,'-120.35');
  assert.equal(rows[0].direction,'debit');
});
test('QIF import converts transactions into preview-only canonical rows with cent-stable decimal strings',()=>{
  const {parseQif}=require('../electron/services/open-format-service.cjs');
  const qif='!Type:Bank\nD13/11/2026\nT-123,45\nPFornecedor fictício\nMNota A\n^\nD14/11/2026\nT1.245,67\nPCliente\n^\n';
  const rows=parseQif(qif);
  assert.equal(rows.length,2);
  assert.equal(rows[0].date,'13/11/2026');
  assert.equal(rows[0].amount,'-123,45');
  assert.equal(rows[1].amount,'1.245,67');
});
test('CNAB layout inspector rejects malformed records and never pretends to import them as bank statement rows',()=>{
  const {inspectCnab}=require('../electron/services/open-format-service.cjs');
  const data=['00100000'+''.padEnd(232,' '),'00100015'+''.padEnd(232,' '),'00199999'+''.padEnd(232,' ')].join('\r\n');
  const report=inspectCnab(data);
  assert.equal(report.layout,240);
  assert.equal(report.records,3);
  assert.equal(report.transactionImportSupported,false);
  assert.throws(()=>inspectCnab('arquivo incompleto'),/CNAB|layout/i);
});
