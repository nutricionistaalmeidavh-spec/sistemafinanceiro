import test from 'node:test';
import assert from 'node:assert/strict';
import {createHarness} from './helpers/test-harness.mjs';
import {createPlanningService} from '../electron/services/planning-service.cjs';

test('dashboard do ano atual nao antecipa movimentos futuros e mostra saldo de todos os tipos de contas',()=>{
 const h=createHarness();
 try{
  const bank=h.finance.createAccount({name:'Banco',type:'BANK'});
  const cash=h.finance.createAccount({name:'Caixa',type:'CASH'});
  h.cashflow.createManualMovement({accountId:bank.id,type:'OPENING',amountCents:10000,occurredAt:'2026-09-01'});
  h.cashflow.createManualMovement({accountId:cash.id,type:'OPENING',amountCents:20000,occurredAt:'2026-09-01'});
  h.cashflow.createManualMovement({accountId:bank.id,type:'DEPOSIT',amountCents:50000,occurredAt:'2026-09-20'});
  const data=h.analytics.getDashboardSnapshot({year:2026});
  assert.equal(data.asOf,'2026-09-12');
  assert.equal(data.cards.totalBalanceCents,30000);
  assert.equal(data.cards.bankBalanceCents,10000);
  assert.equal(data.accountBalances.reduce((sum,x)=>sum+x.balanceCents,0),30000);
  assert.equal(data.monthly[8].inCents,30000); // apenas saldos de abertura, sem deposito futuro
 }finally{h.cleanup();}
});

test('politica de aprovacao de despesa impede baixa ate existir aprovacao concluida',()=>{
 const h=createHarness();
 try{
  const account=h.finance.createAccount({name:'Banco',type:'BANK'});
  const entry=h.finance.createEntry({kind:'PAYABLE',description:'Fornecedor com aprovacao',amountCents:20000,dueAt:'2026-09-20'});
  const planning=createPlanningService({db:h.db,now:()=> '2026-09-12T12:00:00.000Z'});
  planning.saveApprovalPolicy({name:'Controle interno',minAmountCents:10000,requiredApprovals:1,approverRoles:['MANAGER']},{id:'admin',role:'ADMIN'});
  assert.throws(()=>h.finance.settleEntry(entry.id,{amountCents:5000,accountId:account.id,method:'PIX'}),/aprova|approval/i);
  const pending=planning.requestApproval({entryId:entry.id},{id:'admin',role:'ADMIN'});
  assert.throws(()=>h.finance.settleEntry(entry.id,{amountCents:5000,accountId:account.id,method:'PIX'}),/aprova|approval/i);
  planning.decideApproval(pending.id,{decision:'APPROVED'},{id:'manager',role:'MANAGER'});
  const settled=h.finance.settleEntry(entry.id,{amountCents:5000,accountId:account.id,method:'PIX'});
  assert.equal(settled.entry.openCents,15000);
 }finally{h.cleanup();}
});

test('alterar valor de despesa aprovada impede reutilizar autorizacao anterior',()=>{
 const h=createHarness();
 try{
  const account=h.finance.createAccount({name:'Banco',type:'BANK'});
  const entry=h.finance.createEntry({kind:'PAYABLE',description:'Investimento',amountCents:12000,dueAt:'2026-09-20'});
  const planning=createPlanningService({db:h.db,now:()=> '2026-09-12T12:00:00.000Z'});
  planning.saveApprovalPolicy({name:'Aprovar',minAmountCents:10000,requiredApprovals:1,approverRoles:['MANAGER']},{id:'admin',role:'ADMIN'});
  const request=planning.requestApproval({entryId:entry.id},{id:'admin',role:'ADMIN'});
  planning.decideApproval(request.id,{decision:'APPROVED'},{id:'manager',role:'MANAGER'});
  h.finance.updateEntry(entry.id,{amountCents:15000});
  assert.throws(()=>h.finance.settleEntry(entry.id,{amountCents:15000,accountId:account.id}),/aprova|approval/i);
 }finally{h.cleanup();}
});

test('visao historica nao considera baixa futura nem estorno posterior ao fechamento',()=>{
 let clock='2026-09-01T12:00:00.000Z';
 const h=createHarness({now:()=>clock});
 try{
  const account=h.finance.createAccount({name:'Banco',type:'BANK'});
  const entry=h.finance.createEntry({kind:'PAYABLE',description:'Conta a pagar',amountCents:12000,dueAt:'2026-09-10'});
  clock='2026-09-20T12:00:00.000Z';
  h.finance.settleEntry(entry.id,{amountCents:12000,accountId:account.id,occurredAt:'2026-09-20'});
  const before=h.finance.getEntry(entry.id,{asOf:'2026-09-12'});
  assert.equal(before.openCents,12000);
  assert.equal(before.status,'OPEN');
  assert.equal(before.isOverdue,true);
  assert.equal(h.finance.getSummary({asOf:'2026-09-12'}).payableOpenCents,12000);
  assert.equal(h.finance.getEntry(entry.id,{asOf:'2026-09-21'}).openCents,0);
 }finally{h.cleanup();}
});
