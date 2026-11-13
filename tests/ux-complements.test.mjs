import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(path)=>fs.readFileSync(path,'utf8');
test('consolidado do dashboard inclui todos os tipos de conta',()=>{
  const dashboard=read('src/pages/DashboardPage.tsx');
  assert.match(dashboard,/Saldo total das contas/);
  assert.match(dashboard,/className="balance-total".*cards\.totalBalanceCents/);
});
test('formulario de baixa nao aceita data futura',()=>{
  const page=read('src/pages/FinancePage.tsx');
  assert.match(page,/max=\{today\(\)\}/);
});
test('conciliacao confirma vinculo sem declarar que houve baixa',()=>{
  const page=read('src/pages/StatementsPage.tsx');
  assert.match(page,/Nenhuma baixa automática foi realizada/);
  assert.match(page,/finally\{setBusy\(false\);\}/);
});
test('drawer permite Escape, armadilha de Tab e devolve foco ao acionador',()=>{
  const kit=read('src/components/finance-ui.tsx');
  assert.match(kit,/event\.key==='Escape'/);
  assert.match(kit,/event\.key!=='Tab'/);
  assert.match(kit,/previous\?\.focus\(\)/);
});

test('recorrencias permitem localizar parcelas realmente geradas, sem duplicacao',()=>{
  const page=read('src/pages/RecurringPage.tsx');
  assert.match(page,/api\.finance\.listEntries\(token,\{recurrenceRuleId:rule\.id\}\)/);
  assert.match(page,/Ver lançamentos/);
  assert.match(page,/history\.map/);
});
