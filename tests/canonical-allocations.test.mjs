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
    const planning=createPlanningService({db:h.db,cashflow:h.cashflow,finance:h.finance,recurrence:h.recurrence,now});
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
    assert.deepEqual(centerValues,[2,0,0]);
    assert.equal(centerValues.reduce((sum,x)=>sum+x,0),h.finance.getEntry(entry.id).settledCents);
    h.finance.updateEntry(entry.id,{amountCents:101});
    const allocations=planning.getEntryAllocations(entry.id);
    assert.equal(allocations.reduce((sum,x)=>sum+x.amountCents,0),101);
    assert.equal(reports.financialReport({}).totals.openCents,99);
  }finally{h.cleanup();}
});
