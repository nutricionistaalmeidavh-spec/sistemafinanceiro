import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './helpers/test-harness.mjs';

test('conta que vence hoje nao esta atrasada; amanha estara', () => {
  const h=createHarness();
  try {
    const entry=h.finance.createEntry({kind:'PAYABLE',description:'Teste hoje',amountCents:3500,dueAt:'2026-09-12'});
    assert.equal(h.finance.getEntry(entry.id,{asOf:'2026-09-12'}).isOverdue,false);
    assert.equal(h.finance.getEntry(entry.id,{asOf:'2026-09-13'}).isOverdue,true);
  } finally {h.cleanup();}
});

test('nao aceita datas impossiveis no lancamento nem na baixa', () => {
  const h=createHarness();
  try {
    assert.throws(()=>h.finance.createEntry({kind:'PAYABLE',description:'Fev',amountCents:1000,dueAt:'2026-02-31'}),/date/i);
    const account=h.finance.createAccount({name:'Banco',type:'BANK'});
    const entry=h.finance.createEntry({kind:'PAYABLE',description:'Teste',amountCents:1000,dueAt:'2026-09-13'});
    assert.throws(()=>h.finance.settleEntry(entry.id,{amountCents:1000,accountId:account.id,method:'PIX',occurredAt:'2026-02-31'}),/date/i);
  } finally {h.cleanup();}
});

test('baixa aceita varios metodos e rejeita valores e metodos nao reconhecidos', () => {
  const h=createHarness();
  try {
    const account=h.finance.createAccount({name:'Caixa',type:'CASH'});
    const entry=h.finance.createEntry({kind:'PAYABLE',description:'Conta',amountCents:10000,dueAt:'2026-09-13'});
    const paid=h.finance.settleEntry(entry.id,{amountCents:2500,accountId:account.id,method:'CASH',occurredAt:'2026-09-12'});
    assert.equal(paid.settlement.method,'CASH');
    assert.equal(paid.entry.openCents,7500);
    assert.throws(()=>h.finance.settleEntry(entry.id,{amountCents:1000,accountId:account.id,method:'UNSUPPORTED'}),/method/i);
  } finally {h.cleanup();}
});

test('edicao de conta preserva baixas e impede reduzir total abaixo do pago', () => {
  const h=createHarness();
  try {
    const account=h.finance.createAccount({name:'Banco',type:'BANK'});
    const entry=h.finance.createEntry({kind:'PAYABLE',description:'Antigo',amountCents:10000,dueAt:'2026-09-15',accountId:account.id});
    h.finance.settleEntry(entry.id,{amountCents:3000,accountId:account.id,method:'PIX'});
    assert.throws(()=>h.finance.updateEntry(entry.id,{amountCents:2000}),/settled|paid|pago|baixo/i);
    const updated=h.finance.updateEntry(entry.id,{description:'Novo',dueAt:'2026-09-20',amountCents:9000});
    assert.equal(updated.status,'PARTIAL');
    assert.equal(updated.openCents,6000);
    assert.equal(h.cashflow.listMovements().filter(x=>x.type==='SETTLEMENT').length,1);
  } finally {h.cleanup();}
});

test('edicao de recorrencia afeta apenas novas parcelas e nao duplica vencimentos', () => {
  const h=createHarness();
  try {
    const rule=h.recurrence.createRule({kind:'PAYABLE',description:'Aluguel',amountCents:10000,startDate:'2026-01-01',dueDay:10,maxOccurrences:4});
    const first=h.recurrence.generateDue({asOf:'2026-01-10'});
    assert.equal(first.length,1);
    const edited=h.recurrence.updateRule(rule.id,{description:'Aluguel novo',amountCents:12000,dueDay:12});
    assert.equal(edited.generatedCount,1);
    assert.equal(h.recurrence.generateDue({asOf:'2026-02-12'}).length,1);
    assert.equal(h.recurrence.generateDue({asOf:'2026-02-12'}).length,0);
    const items=h.finance.listEntries({recurrenceRuleId:rule.id});
    assert.deepEqual(items.map(x=>x.amountCents),[10000,12000]);
    assert.deepEqual(items.map(x=>x.dueAt),['2026-01-10','2026-02-12']);
    assert.throws(()=>h.recurrence.updateRule(rule.id,{maxOccurrences:1}),/occurr|gerad/i);
  } finally {h.cleanup();}
});
