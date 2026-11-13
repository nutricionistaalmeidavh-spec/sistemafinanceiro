import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHarness } from './helpers/test-harness.mjs';

const require=createRequire(import.meta.url);
const { createPlanningService }=require('../electron/services/planning-service.cjs');

test('dashboard atual mostra caixa e banco no saldo consolidado e nao inclui movimentos futuros',()=>{
 const h=createHarness();
 try{
  const bank=h.finance.createAccount({name:'Banco',type:'BANK'});
  const cash=h.finance.createAccount({name:'Caixa',type:'CASH'});
  h.cashflow.createManualMovement({accountId:bank.id,type:'DEPOSIT',amountCents:20000,occurredAt:'2026-09-11'});
  h.cashflow.createManualMovement({accountId:cash.id,type:'DEPOSIT',amountCents:5000,occurredAt:'2026-09-11'});
  h.cashflow.createManualMovement({accountId:bank.id,type:'DEPOSIT',amountCents:990000,occurredAt:'2026-11-11'});
  const snapshot=h.analytics.getDashboardSnapshot({year:2026});
  assert.equal(snapshot.balanceAsOf,'2026-09-12');
  assert.equal(snapshot.cards.totalBalanceCents,25000);
  assert.equal(snapshot.cards.bankBalanceCents,20000);
  assert.equal(snapshot.monthly[10].inCents,0,'novembro futuro não é fluxo realizado na data atual');
  assert.equal(snapshot.accountBalances.find(a=>a.id===cash.id).balanceCents,5000);
 }finally{h.cleanup();}
});

test('ano historico mostra saldo ate fim daquele ano e nao valores posteriores',()=>{
 const h=createHarness();
 try{
  const bank=h.finance.createAccount({name:'Banco',type:'BANK'});
  h.cashflow.createManualMovement({accountId:bank.id,type:'DEPOSIT',amountCents:12000,occurredAt:'2025-12-01'});
  h.cashflow.createManualMovement({accountId:bank.id,type:'DEPOSIT',amountCents:25000,occurredAt:'2026-01-01'});
  const snapshot=h.analytics.getDashboardSnapshot({year:2025});
  assert.equal(snapshot.balanceAsOf,'2025-12-31');
  assert.equal(snapshot.cards.totalBalanceCents,12000);
 }finally{h.cleanup();}
});

test('politica de aprovacao bloqueia pagamento somente quando aplicavel e valida decisao efetiva',()=>{
 const h=createHarness();
 try{
  const account=h.finance.createAccount({name:'Conta',type:'BANK'});
  const planning=createPlanningService({db:h.db,now:()=> '2026-09-12T12:00:00.000Z'});
  planning.saveApprovalPolicy({name:'Limite 50',minAmountCents:5000,requiredApprovals:1,approverRoles:['ADMIN']},{id:'owner',role:'ADMIN'});
  const small=h.finance.createEntry({kind:'PAYABLE',description:'Café',amountCents:3000,dueAt:'2026-09-14'});
  assert.equal(h.finance.settleEntry(small.id,{accountId:account.id,amountCents:3000}).entry.status,'SETTLED');
  const big=h.finance.createEntry({kind:'PAYABLE',description:'Aluguel',amountCents:10000,dueAt:'2026-09-14'});
  assert.throws(()=>h.finance.settleEntry(big.id,{accountId:account.id,amountCents:1000}),/aprov|approv/i);
  assert.equal(h.finance.getEntry(big.id).openCents,10000);
  const req=planning.requestApproval({entryId:big.id},{id:'owner',role:'ADMIN'});
  assert.throws(()=>h.finance.settleEntry(big.id,{accountId:account.id,amountCents:1000}),/aprov|approv/i);
  planning.decideApproval(req.id,{decision:'APPROVED'},{id:'manager',role:'ADMIN'});
  assert.equal(h.finance.settleEntry(big.id,{accountId:account.id,amountCents:1000}).entry.status,'PARTIAL');
  assert.equal(h.finance.settleEntry(big.id,{accountId:account.id,amountCents:9000}).entry.status,'SETTLED');
 }finally{h.cleanup();}
});

test('aumentar valor depois de aprovacao exige nova autorizacao antes de pagar',()=>{
 const h=createHarness();
 try{
  const account=h.finance.createAccount({name:'Conta',type:'BANK'});
  const planning=createPlanningService({db:h.db,now:()=> '2026-09-12T12:00:00.000Z'});
  planning.saveApprovalPolicy({name:'Compras',minAmountCents:5000,requiredApprovals:1,approverRoles:['ADMIN']},{id:'owner',role:'ADMIN'});
  const entry=h.finance.createEntry({kind:'PAYABLE',description:'Serviço',amountCents:10000,dueAt:'2026-09-14'});
  const req=planning.requestApproval({entryId:entry.id},{id:'owner',role:'ADMIN'});
  planning.decideApproval(req.id,{decision:'APPROVED'},{id:'manager',role:'ADMIN'});
  h.finance.updateEntry(entry.id,{amountCents:15000});
  assert.throws(()=>h.finance.settleEntry(entry.id,{accountId:account.id,amountCents:15000}),/aprov|approv/i);
  const fresh=planning.requestApproval({entryId:entry.id},{id:'owner',role:'ADMIN'});
  planning.decideApproval(fresh.id,{decision:'APPROVED'},{id:'manager',role:'ADMIN'});
  assert.equal(h.finance.settleEntry(entry.id,{accountId:account.id,amountCents:15000}).entry.status,'SETTLED');
 }finally{h.cleanup();}
});

test('recorrencia encerrada nao e confundida com pausa nem aceita reativacao indevida',()=>{
 const h=createHarness();
 try{
  const r=h.recurrence.createRule({kind:'PAYABLE',description:'Parcela unica',amountCents:1000,startDate:'2026-09-01',dueDay:10,maxOccurrences:1});
  h.recurrence.generateDue({asOf:'2026-09-12'});
  const rule=h.recurrence.listRules().find(x=>x.id===r.id);
  assert.equal(rule.lifecycleStatus,'COMPLETED');
  assert.equal(rule.active,false);
  assert.throws(()=>h.recurrence.setRuleActive(r.id,true),/conclu|completed|ended/i);
  const other=h.recurrence.createRule({kind:'PAYABLE',description:'Mensal',amountCents:1000,startDate:'2026-09-01',dueDay:20});
  h.recurrence.setRuleActive(other.id,false);
  assert.equal(h.recurrence.listRules().find(x=>x.id===other.id).lifecycleStatus,'PAUSED');
 }finally{h.cleanup();}
});
