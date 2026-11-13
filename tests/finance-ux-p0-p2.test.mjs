import test from 'node:test';
import assert from 'node:assert/strict';
import {createHarness} from './helpers/test-harness.mjs';
import {createPlanningService} from '../electron/services/planning-service.cjs';

test('P0: saldo historico nao antecipa pagamentos futuros e preserva a posicao apos estorno',()=>{
  let clock='2026-09-01T12:00:00.000Z';
  const h=createHarness({now:()=>clock});
  try{
    const account=h.finance.createAccount({name:'Banco de teste',type:'BANK'});
    const entry=h.finance.createEntry({kind:'PAYABLE',description:'Fornecedor',amountCents:15000,dueAt:'2026-09-05',accountId:account.id});
    clock='2026-09-22T12:00:00.000Z';
    const payment=h.finance.settleEntry(entry.id,{accountId:account.id,amountCents:15000,occurredAt:'2026-09-20',method:'PIX'});
    const old=h.finance.getEntry(entry.id,{asOf:'2026-09-12'});
    assert.equal(old.status,'OPEN');
    assert.equal(old.openCents,15000);
    assert.equal(old.isOverdue,true);
    assert.equal(h.finance.getSummary({asOf:'2026-09-12'}).payableOpenCents,15000);
    assert.equal(h.cashflow.getAccountBalances({asOf:'2026-09-12'})[0].balanceCents,0);
    assert.equal(h.finance.getEntry(entry.id,{asOf:'2026-09-21'}).status,'SETTLED');
    assert.equal(h.cashflow.getAccountBalances({asOf:'2026-09-21'})[0].balanceCents,-15000);
    clock='2026-09-23T15:00:00.000Z';
    h.finance.reverseSettlement(payment.settlement.id,{reason:'Baixa duplicada'});
    assert.equal(h.finance.getEntry(entry.id,{asOf:'2026-09-21'}).status,'SETTLED');
    assert.equal(h.cashflow.getAccountBalances({asOf:'2026-09-21'})[0].balanceCents,-15000);
    assert.equal(h.analytics.getDre({from:'2026-09-01',to:'2026-09-21'}).totals.expenseCents,15000);
    assert.equal(h.finance.getEntry(entry.id,{asOf:'2026-09-24'}).status,'OPEN');
    assert.equal(h.cashflow.getAccountBalances({asOf:'2026-09-24'})[0].balanceCents,0);
    clock='2026-09-24T18:00:00.000Z';
    h.finance.cancelEntry(entry.id,{reason:'Cancelamento após o estorno'});
    assert.equal(h.finance.getEntry(entry.id,{asOf:'2026-09-21'}).status,'SETTLED');
    assert.equal(h.finance.getEntry(entry.id,{asOf:'2026-09-25'}).status,'CANCELLED');
    assert.equal(h.cashflow.getAccountBalances({asOf:'2026-09-21'})[0].balanceCents,-15000);
    assert.equal(h.analytics.getDre({from:'2026-09-01',to:'2026-09-21',basis:'accrual'}).totals.expenseCents,15000);
    assert.equal(h.analytics.getDre({from:'2026-09-01',to:'2026-09-25',basis:'accrual'}).totals.expenseCents,0);
  }finally{h.cleanup();}
});

test('P0: editar credor ou vencimento invalida aprovacao antiga, mantendo auditoria',()=>{
  const h=createHarness();
  try{
    const account=h.finance.createAccount({name:'Banco',type:'BANK'});
    const one=h.finance.createEntry({kind:'PAYABLE',description:'Servico antigo',amountCents:15000,dueAt:'2026-09-25',accountId:account.id});
    const planning=createPlanningService({db:h.db,now:()=> '2026-09-12T12:00:00.000Z'});
    planning.saveApprovalPolicy({name:'Dupla verificacao',minAmountCents:10000,requiredApprovals:1,approverRoles:['MANAGER']},{id:'admin',role:'ADMIN'});
    const request=planning.requestApproval({entryId:one.id},{id:'admin',role:'ADMIN'});
    planning.decideApproval(request.id,{decision:'APPROVED'},{id:'mgr1',role:'MANAGER'});
    assert.equal(h.finance.getEntry(one.id).approval.status,'APPROVED');
    h.finance.updateEntry(one.id,{dueAt:'2026-09-28'});
    assert.equal(h.finance.getEntry(one.id).approval.status,'REQUIRED');
    assert.throws(()=>h.finance.settleEntry(one.id,{accountId:account.id,amountCents:15000,method:'PIX'}),/aprova/i);
    const status=h.db.prepare('SELECT status FROM approval_requests WHERE id=?').get(request.id).status;
    assert.equal(status,'CANCELLED');
    const audits=h.db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='planning.approval.invalidate'").get().n;
    assert.equal(audits,1);
  }finally{h.cleanup();}
});

test('P0: nao permite registrar baixa futura como pagamento efetivado',()=>{
  const h=createHarness();
  try{
    const account=h.finance.createAccount({name:'Caixa',type:'CASH'});
    const entry=h.finance.createEntry({kind:'PAYABLE',description:'Fatura',amountCents:7500,dueAt:'2026-10-15'});
    assert.throws(()=>h.finance.settleEntry(entry.id,{accountId:account.id,amountCents:7500,occurredAt:'2026-09-13',method:'CASH'}),/future|futur/i);
    assert.equal(h.finance.getEntry(entry.id).openCents,7500);
  }finally{h.cleanup();}
});

test('P0: indicadores realizados nao incluem movimentos futuros apenas porque o filtro termina depois de hoje',()=>{
  const h=createHarness();
  try{
    const account=h.finance.createAccount({name:'Banco',type:'BANK'});
    h.cashflow.createManualMovement({accountId:account.id,type:'OPENING',amountCents:10000,occurredAt:'2026-09-01'});
    h.cashflow.createManualMovement({accountId:account.id,type:'DEPOSIT',amountCents:50000,occurredAt:'2026-09-20'});
    const report=h.analytics.getIndicators({from:'2026-09-01',to:'2026-12-31',asOf:'2026-12-31'});
    assert.equal(report.bankBalanceCents,10000);
    assert.equal(report.totalBalanceCents,10000);
  }finally{h.cleanup();}
});
