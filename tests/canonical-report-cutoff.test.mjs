import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHarness } from './helpers/test-harness.mjs';
const require=createRequire(import.meta.url);
const { createReportService }=require('../electron/services/report-service.cjs');

test('relatorio historico usa data de corte e ignora pagamentos posteriores',()=>{
  let clock='2026-09-01T12:00:00.000Z';
  const h=createHarness({now:()=>clock});
  try{
    const bank=h.finance.createAccount({name:'Banco',type:'BANK'});
    const entry=h.finance.createEntry({kind:'RECEIVABLE',description:'Contrato',amountCents:10000,dueAt:'2026-09-10'});
    clock='2026-09-30T12:00:00.000Z';
    h.finance.settleEntry(entry.id,{accountId:bank.id,amountCents:10000,occurredAt:'2026-09-20'});
    const reports=createReportService({db:h.db,finance:h.finance,analytics:h.analytics,now:()=>clock});
    const past=reports.financialReport({from:'2026-09-01',to:'2026-09-15'});
    assert.equal(past.totals.amountCents,10000);
    assert.equal(past.totals.settledCents,0);
    assert.equal(past.totals.openCents,10000);
    assert.equal(past.rows[0].status,'OPEN');
    assert.equal(past.indicators.receivableOpenCents,10000);
    const current=reports.financialReport({from:'2026-09-01',to:'2026-09-30'});
    assert.equal(current.totals.settledCents,10000);
    assert.equal(current.totals.openCents,0);
  }finally{h.cleanup();}
});

test('cancelamentos aparecem no historico mas nao geram valores em aberto nem totais financeiros ativos',()=>{
  let clock='2026-09-01T12:00:00.000Z';
  const h=createHarness({now:()=>clock});
  try{
    const entry=h.finance.createEntry({kind:'PAYABLE',description:'Compra cancelada',amountCents:12500,dueAt:'2026-09-10'});
    clock='2026-09-20T12:00:00.000Z';
    h.finance.cancelEntry(entry.id,{reason:'Fornecedor desistiu'});
    const reports=createReportService({db:h.db,finance:h.finance,analytics:h.analytics,now:()=>clock});
    const report=reports.financialReport({from:'2026-09-01',to:'2026-09-30'});
    assert.equal(report.rows.length,1);
    assert.equal(report.rows[0].status,'CANCELLED');
    assert.equal(report.rows[0].openCents,0);
    assert.deepEqual(report.totals,{amountCents:0,settledCents:0,openCents:0});
    assert.equal(h.finance.getSummary({asOf:'2026-09-20'}).payableOpenCents,0);
  }finally{h.cleanup();}
});
