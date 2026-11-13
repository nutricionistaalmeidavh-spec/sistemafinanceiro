import test from 'node:test';
import assert from 'node:assert/strict';
import {createHarness} from './helpers/test-harness.mjs';

test('posicao historica considera somente baixas e estornos ate a data de corte',()=>{
 let clock='2026-08-30T12:00:00Z';
 const h=createHarness({now:()=>clock});
 try{
  const bank=h.finance.createAccount({name:'Banco',type:'BANK'});
  const entry=h.finance.createEntry({kind:'PAYABLE',description:'Conta',amountCents:10000,dueAt:'2026-09-01'});
  clock='2026-09-12T12:00:00Z';
  const paid=h.finance.settleEntry(entry.id,{amountCents:10000,accountId:bank.id,occurredAt:'2026-09-12'});
  const before=h.finance.getEntry(entry.id,{asOf:'2026-09-10'});
  assert.equal(before.status,'OPEN');
  assert.equal(before.openCents,10000);
  assert.equal(before.isOverdue,true);
  assert.equal(h.finance.getSummary({asOf:'2026-09-10'}).payableOpenCents,10000);
  assert.equal(h.finance.getEntry(entry.id,{asOf:'2026-09-12'}).status,'SETTLED');
  clock='2026-09-20T12:00:00Z';
  h.finance.reverseSettlement(paid.settlement.id,{reason:'Erro de caixa'});
  assert.equal(h.finance.getEntry(entry.id,{asOf:'2026-09-12'}).settledCents,10000);
  assert.equal(h.finance.getEntry(entry.id,{asOf:'2026-09-20'}).openCents,10000);
 }finally{h.cleanup();}
});

test('nao aceita data de pagamento no futuro',()=>{
 const h=createHarness();
 try{
  const bank=h.finance.createAccount({name:'Banco',type:'BANK'});
  const entry=h.finance.createEntry({kind:'PAYABLE',description:'Conta',amountCents:10000,dueAt:'2026-09-12'});
  assert.throws(()=>h.finance.settleEntry(entry.id,{amountCents:1000,accountId:bank.id,occurredAt:'2026-09-30'}),/future|futura/i);
  assert.equal(h.finance.getEntry(entry.id).openCents,10000);
 }finally{h.cleanup();}
});
