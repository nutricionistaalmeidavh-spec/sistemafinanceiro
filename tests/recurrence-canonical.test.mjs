import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHarness } from './helpers/test-harness.mjs';
const require = createRequire(import.meta.url);
const { firstDue, nextDue, amountAtDue, forecastRule } = require('../electron/services/recurrence-schedule.cjs');
const { createPlanningService } = require('../electron/services/planning-service.cjs');

test('motor unico preserva o dia 31 em fevereiro e no mes seguinte', () => {
  const rule={startDate:'2026-01-31',dueDay:31,intervalMonths:1,intervalDays:null,amountCents:10000,annualAdjustmentBps:0};
  assert.equal(firstDue(rule),'2026-01-31');
  assert.equal(nextDue(rule,'2026-01-31'),'2026-02-28');
  assert.equal(nextDue(rule,'2026-02-28'),'2026-03-31');
});

test('regras semanais e quinzenais usam as mesmas datas no previsto e no gerado',()=>{
  const h=createHarness({now:()=> '2026-09-12T12:00:00.000Z'});
  try{
    for(const [days,expected] of [[7,['2026-09-12','2026-09-19','2026-09-26']],[14,['2026-09-12','2026-09-26','2026-10-10']]]){
      const rule=h.recurrence.createRule({kind:'PAYABLE',description:'Contrato '+days,amountCents:12000,startDate:'2026-09-12',intervalDays:days,dueDay:12,maxOccurrences:3});
      const predicted=h.recurrence.listUpcoming({from:'2026-09-12',to:'2026-10-31'}).filter(x=>x.ruleId===rule.id);
      assert.deepEqual(predicted.map(x=>x.dueAt),expected);
      h.recurrence.generateDue({asOf:'2026-10-31'});
      const actual=h.finance.listEntries({recurrenceRuleId:rule.id,asOf:'2026-10-31'});
      assert.deepEqual(actual.map(x=>x.dueAt),expected);
      assert.equal(h.recurrence.generateDue({asOf:'2026-10-31'}).length,0);
    }
  } finally {h.cleanup();}
});

test('reajuste anual por pontos-base e calculado pelo mesmo motor para parcelas e projecao',()=>{
  const h=createHarness({now:()=> '2026-01-01T12:00:00.000Z'});
  try{
    const rule=h.recurrence.createRule({kind:'RECEIVABLE',description:'Contrato anual',amountCents:10000,startDate:'2025-01-31',dueDay:31,intervalMonths:12,annualAdjustmentBps:500,maxOccurrences:3});
    const preview=h.recurrence.listUpcoming({from:'2026-01-01',to:'2027-12-31'}).filter(x=>x.ruleId===rule.id);
    assert.deepEqual(preview.map(x=>[x.dueAt,x.amountCents]),[['2026-01-31',10500],['2027-01-31',11025]]);
    h.recurrence.generateDue({asOf:'2027-01-31'});
    const entries=h.finance.listEntries({recurrenceRuleId:rule.id,asOf:'2027-01-31'});
    assert.deepEqual(entries.map(x=>x.amountCents),[10000,10500,11025]);
  } finally {h.cleanup();}
});

test('projecao nao inventa movimentos realizados nem duplica recorrencias ja lancadas',()=>{
  const now=()=> '2026-01-31T12:00:00.000Z';
  const h=createHarness({now});
  try{
    const account=h.finance.createAccount({name:'Banco',type:'BANK'});
    h.cashflow.createManualMovement({accountId:account.id,type:'OPENING',amountCents:200000,occurredAt:'2026-01-31'});
    const rule=h.recurrence.createRule({kind:'PAYABLE',description:'Aluguel',amountCents:20000,startDate:'2026-01-31',dueDay:31,intervalMonths:1,maxOccurrences:4});
    h.recurrence.generateDue({asOf:'2026-01-31'});
    const planning=createPlanningService({db:h.db,cashflow:h.cashflow,finance:h.finance,recurrence:h.recurrence,now});
    const rows=planning.getProjection({months:4});
    assert.deepEqual(rows.map(x=>x.baseNetCents),[-20000,-20000,-20000,-20000]);
    assert.equal(rows[0].openingBalanceCents,200000);
    assert.equal(rows.at(-1).closingBalanceCents,120000);
    assert.equal(h.cashflow.getAccountBalances({asOf:'2026-01-31'})[0].balanceCents,200000);
  } finally {h.cleanup();}
});

test('parcelas pausadas nunca entram como previsao futura',()=>{
  const h=createHarness();
  try{
    const rule=h.recurrence.createRule({kind:'PAYABLE',description:'Pausavel',amountCents:9999,startDate:'2026-10-01',dueDay:15,intervalMonths:1});
    assert.equal(h.recurrence.listUpcoming({from:'2026-10-01',to:'2026-12-31'}).some(x=>x.ruleId===rule.id),true);
    h.recurrence.setRuleActive(rule.id,false);
    assert.equal(h.recurrence.listUpcoming({from:'2026-10-01',to:'2026-12-31'}).some(x=>x.ruleId===rule.id),false);
  } finally {h.cleanup();}
});

test('projecoes e realizacoes partem de lancamentos e baixas canonicas e refletem o saldo aberto',()=>{
  const now=()=> '2026-09-12T12:00:00.000Z';
  const h=createHarness({now});
  try{
    const account=h.finance.createAccount({name:'Banco',type:'BANK'});
    const entry=h.finance.createEntry({kind:'RECEIVABLE',description:'Mensalidade',amountCents:10000,dueAt:'2026-09-20',accountId:account.id});
    h.finance.settleEntry(entry.id,{accountId:account.id,amountCents:4000,occurredAt:'2026-09-12'});
    const planning=createPlanningService({db:h.db,cashflow:h.cashflow,finance:h.finance,recurrence:h.recurrence,now});
    const projection=planning.getProjection({months:1});
    assert.equal(projection[0].baseNetCents,6000);
    assert.equal(projection[0].openingBalanceCents,4000);
    assert.equal(h.finance.getSummary({asOf:'2026-09-12'}).receivableOpenCents,6000);
    assert.equal(h.analytics.getIndicators({from:'2026-09-01',to:'2026-09-30'}).receivedCents,4000);
  } finally {h.cleanup();}
});

test('calendario de vencimentos e valores projetados usa ajustes sem floats acumulados',()=>{
  const rule={startDate:'2024-02-29',dueDay:29,intervalMonths:12,intervalDays:null,amountCents:10001,annualAdjustmentBps:500};
  const dates=forecastRule(rule,{nextDueAt:'2024-02-29',generatedCount:0,maxOccurrences:4,endDate:null,active:true},{from:'2024-01-01',to:'2027-12-31'});
  assert.deepEqual(dates.map(x=>x.dueAt),['2024-02-29','2025-02-28','2026-02-28','2027-02-28']);
  assert.deepEqual(dates.map(x=>x.amountCents),[10001,10501,11026,11577]);
  assert.equal(amountAtDue(rule,'2025-02-28'),10501);
});


test('filtro historico de status usa status naquela data, nao o estado atual',()=>{
  let current='2026-09-01T12:00:00.000Z';
  const h=createHarness({now:()=>current});
  try{
    const account=h.finance.createAccount({name:'Banco',type:'BANK'});
    const bill=h.finance.createEntry({kind:'PAYABLE',description:'Fatura',amountCents:10000,dueAt:'2026-09-15'});
    current='2026-09-12T12:00:00.000Z';
    h.finance.settleEntry(bill.id,{amountCents:10000,occurredAt:'2026-09-10',accountId:account.id});
    assert.equal(h.finance.getEntry(bill.id,{asOf:'2026-09-05'}).status,'OPEN');
    assert.equal(h.finance.listEntries({status:'OPEN',asOf:'2026-09-05'}).some(x=>x.id===bill.id),true);
    assert.equal(h.finance.listEntries({status:'SETTLED',asOf:'2026-09-05'}).some(x=>x.id===bill.id),false);
  }finally{h.cleanup();}
});

test('DRE competência não inventa valor realizado antes do vencimento e respeita corte',()=>{
  const h=createHarness({now:()=> '2026-09-12T12:00:00.000Z'});
  try{
    h.finance.createEntry({kind:'RECEIVABLE',description:'Venda futura',amountCents:25000,dueAt:'2026-09-30'});
    const report=h.analytics.getDre({from:'2026-09-01',to:'2026-09-30',basis:'accrual'});
    assert.equal(report.totals.revenueCents,0);
    assert.equal(h.finance.getSummary({asOf:'2026-09-12'}).receivableOpenCents,25000);
  }finally{h.cleanup();}
});

test('saldo caixa, DRE realizada e indicadores convergem nas mesmas baixas',()=>{
  const h=createHarness({now:()=> '2026-09-12T12:00:00.000Z'});
  try{
    const bank=h.finance.createAccount({name:'Banco',type:'BANK'});
    const expense=h.finance.createEntry({kind:'PAYABLE',description:'Serviço',amountCents:10000,dueAt:'2026-09-12'});
    const income=h.finance.createEntry({kind:'RECEIVABLE',description:'Honorários',amountCents:20000,dueAt:'2026-09-12'});
    h.finance.settleEntry(expense.id,{accountId:bank.id,amountCents:5000,occurredAt:'2026-09-12'});
    h.finance.settleEntry(income.id,{accountId:bank.id,amountCents:12000,occurredAt:'2026-09-12'});
    const dre=h.analytics.getDre({from:'2026-09-01',to:'2026-09-30',basis:'realized'});
    const ind=h.analytics.getIndicators({from:'2026-09-01',to:'2026-09-30'});
    const balance=h.cashflow.getAccountBalances({asOf:'2026-09-12'})[0];
    assert.deepEqual([dre.totals.revenueCents,dre.totals.expenseCents],[ind.receivedCents,ind.paidCents]);
    assert.equal(balance.balanceCents,ind.receivedCents-ind.paidCents);
    assert.equal(h.finance.getSummary({asOf:'2026-09-12'}).payableOpenCents,5000);
  }finally{h.cleanup();}
});
