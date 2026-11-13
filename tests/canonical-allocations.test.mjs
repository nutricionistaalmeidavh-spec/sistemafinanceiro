import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHarness } from './helpers/test-harness.mjs';
const require=createRequire(import.meta.url);
const { splitCents }=require('../electron/services/allocation-service.cjs');
const { createPlanningService }=require('../electron/services/planning-service.cjs');
const { createReportService }=require('../electron/services/report-service.cjs');

test('centavos de rateio se conservam exatamente para cada baixa e para ajustes',()=>{
  const allocations=[{costCenterId:'A',amountCents:34},{costCenterId:'B',amountCents:33},{costCenterId:'C',amountCents:33}];
  assert.deepEqual([...splitCents(1,allocations).entries()],[['A',1],['B',0],['C',0]]);
  assert.equal([...splitCents(101,allocations).values()].reduce((a,b)=>a+b,0),101);
});

test('DRE, relatórios e orçamentos usam o mesmo rateio por centavo de baixa',()=>{
  const now=()=> '2026-09-14T12:00:00.000Z';
  const h=createHarness({now});
  try{
    const account=h.finance.createAccount({name:'Banco',type:'BANK'});
    const entry=h.finance.createEntry({kind:'PAYABLE',description:'Serviço compartilhado',amountCents:100,dueAt:'2026-09-14'});
    let seq=0;const planning=createPlanningService({db:h.db,cashflow:h.cashflow,finance:h.finance,recurrence:h.recurrence,now,idFactory:(prefix)=>prefix+'-'+(++seq)});
    const centers=['A','B','C'].map(code=>planning.saveCostCenter({code,name:code}));
    planning.setEntryAllocations(entry.id,[{costCenterId:centers[0].id,percentage:34},
      {costCenterId:centers[1].id,percentage:33},{costCenterId:centers[2].id,percentage:33}]);
    h.finance.settleEntry(entry.id,{amountCents:1,accountId:account.id,occurredAt:'2026-09-14'});
    h.finance.settleEntry(entry.id,{amountCents:1,accountId:account.id,occurredAt:'2026-09-14'});
    const reports=createReportService({db:h.db,finance:h.finance,analytics:h.analytics,now});
    const centerValues=centers.map(center=>{
      const report=reports.financialReport({costCenterId:center.id,from:'2026-09-01',to:'2026-09-30'});
      const dre=h.analytics.getDre({from:'2026-09-01',to:'2026-09-30',basis:'realized',costCenterId:center.id});
      assert.equal(report.totals.settledCents,dre.totals.expenseCents);
      return report.totals.settledCents;
    });
    assert.deepEqual(centerValues,[1,1,0]);
    assert.equal(centerValues.reduce((sum,x)=>sum+x,0),h.finance.getEntry(entry.id).settledCents);
    h.finance.updateEntry(entry.id,{amountCents:101});
    const allocations=planning.getEntryAllocations(entry.id);
    assert.equal(allocations.reduce((sum,x)=>sum+x.amountCents,0),101);
    assert.equal(reports.financialReport({}).totals.openCents,99);
  }finally{h.cleanup();}
});


test('rateio cumulativo impede que duas baixas de um centavo ultrapassem a cota do centro',()=>{
  let clock='2026-09-10T12:00:00.000Z';const now=()=>clock;
  const h=createHarness({now});
  try{
    const account=h.finance.createAccount({name:'Conta',type:'BANK'});
    const entry=h.finance.createEntry({kind:'PAYABLE',description:'Duas baixas',amountCents:2,dueAt:'2026-09-15'});
    let seq=0;
    const planning=createPlanningService({db:h.db,cashflow:h.cashflow,finance:h.finance,recurrence:h.recurrence,now,idFactory:(prefix)=>prefix+'-'+(++seq)});
    const a=planning.saveCostCenter({code:'A',name:'Centro A'}),b=planning.saveCostCenter({code:'B',name:'Centro B'});
    planning.setEntryAllocations(entry.id,[{costCenterId:a.id,percentage:50},{costCenterId:b.id,percentage:50}]);
    h.finance.settleEntry(entry.id,{amountCents:1,accountId:account.id,occurredAt:'2026-09-10'});
    clock='2026-10-15T12:00:00.000Z';
    h.finance.settleEntry(entry.id,{amountCents:1,accountId:account.id,occurredAt:'2026-10-15'});
    const reports=createReportService({db:h.db,finance:h.finance,analytics:h.analytics,now});
    const values=[a,b].map(center=>{
      const f=reports.financialReport({costCenterId:center.id});
      assert.equal(f.totals.amountCents,1);
      assert.equal(f.totals.openCents,0);
      return f.totals.settledCents;
    });
    assert.deepEqual(values,[1,1]);
    assert.equal(h.finance.getEntry(entry.id).openCents,0);
    for(const month of [9,10]){
      for(const center of [a,b])planning.saveBudget({scenarioId:'base',year:2026,month,nature:'EXPENSE',amountCents:2,costCenterId:center.id});
    }
    const sep=planning.compareBudget({scenarioId:'base',year:2026,month:9});
    const oct=planning.compareBudget({scenarioId:'base',year:2026,month:10});
    assert.deepEqual(sep.map(x=>x.actualCents),[1,0]);
    assert.deepEqual(oct.map(x=>x.actualCents),[0,1]);
    assert.deepEqual([a,b].map(center=>h.analytics.getDre({from:'2026-09-01',to:'2026-09-30',basis:'realized',costCenterId:center.id}).totals.expenseCents),[1,0]);
    assert.deepEqual([a,b].map(center=>h.analytics.getDre({from:'2026-10-01',to:'2026-10-31',basis:'realized',costCenterId:center.id}).totals.expenseCents),[0,1]);
  }finally{h.cleanup();}
});
