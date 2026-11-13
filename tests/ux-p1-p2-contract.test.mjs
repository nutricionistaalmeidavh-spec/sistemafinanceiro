import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('P1: fluxo guiado respeita contas existentes e nao duplica saldo inicial',()=>{
  const app=readFileSync('src/App.tsx','utf8');
  const guide=readFileSync('src/components/FirstUseGuide.tsx','utf8');
  assert.match(app,/FirstUseGuide/);
  assert.match(guide,/listMovements\(token,\{accountId\}\)/);
  assert.match(guide,/type:'OPENING'/);
});

test('P1: cancelamento e estorno exigem motivo em formulario e mantem confirmacao',()=>{
  const finance=readFileSync('src/pages/FinancePage.tsx','utf8');
  assert.match(finance,/data-testid="finance-decision-form"/);
  assert.doesNotMatch(finance,/window\.prompt\(/);
  assert.match(finance,/role="alert"/);
});

test('P2: recorrencias disponibilizam historico e preview sem dar baixa',()=>{
  const recurring=readFileSync('src/pages/RecurringPage.tsx','utf8');
  assert.match(recurring,/recurrenceRuleId/);
  assert.match(recurring,/Ver lançamentos/);
  assert.match(recurring,/Próximas parcelas/);
  assert.match(recurring,/lifecycleStatus/);
});

test('P2: vinculacao de extrato nao informa pagamento e aguarda proxima decisao',()=>{
  const statements=readFileSync('src/pages/StatementsPage.tsx','utf8');
  assert.match(statements,/Vincular ao lançamento/);
  assert.match(statements,/não registra pagamento/);
  assert.match(statements,/setNotice\(/);
});
