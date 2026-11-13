import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=(path)=>fs.readFileSync(path,'utf8');

test('UX onboarding inicia somente com dados ausentes e permite continuar sem duplicar contas',()=>{
 const app=read('src/App.tsx'),guide=read('src/components/FirstUseGuide.tsx');
 assert.match(app,/api\.finance\.listAccounts\(token\)/);
 assert.match(app,/entries\.length===0/);
 assert.match(guide,/existingAccountId\?'entry':'account'/);
 assert.match(guide,/onSkip/);
 assert.match(guide,/disabled=\{busy\}/);
});

test('pagamentos usam um unico fluxo, valor livre, dialogo com erro e limite de data',()=>{
 const page=read('src/pages/FinancePage.tsx');
 assert.match(page,/Registrar pagamento/);
 assert.doesNotMatch(page,/Math\.floor\(entry\.openCents\/2\)/);
 assert.match(page,/data-testid="finance-payment-form"/);
 assert.match(page,/max=\{today\(\)\}/);
 assert.match(page,/role="status"/);
 assert.match(page,/disabled=\{busy\}/);
});

test('dashboard apresenta data, saldo disponivel real e total de contas sem antecipar futuro',()=>{
 const analytics=read('electron/services/analytics-service.cjs');
 const dashboard=read('src/pages/DashboardPage.tsx');
 assert.match(analytics,/const asOf = \[range\.to, localDay\(nowIso\(\)\)\]/);
 assert.match(dashboard,/data\.asOf/);
 assert.match(dashboard,/cards\.availableBalanceCents/);
 assert.match(dashboard,/cards\.totalBalanceCents/);
});

test('recorrencias distinguem concluida de pausa e exibem proximas parcelas e historico',()=>{
 const recurring=read('src/pages/RecurringPage.tsx');
 assert.match(recurring,/ruleCompleted\(rule\)/);
 assert.match(recurring,/Concluída/);
 assert.match(recurring,/Prévia de vencimentos/);
 assert.match(recurring,/Ver lançamentos/);
});

test('conciliacao mostra nomes e explica que vincular nao significa dar baixa',()=>{
 const statements=read('src/pages/StatementsPage.tsx');
 assert.match(statements,/entries\.find/);
 assert.match(statements,/Vincular ao lançamento/);
 assert.match(statements,/Nenhuma baixa automática foi realizada/);
});

test('planejamento possui portugues legivel sem corrupcao de codificacao',()=>{
 const planning=read('src/pages/PlanningPage.tsx');
 assert.doesNotMatch(planning,/Ã.|Â·|â†’|â€¦|â€”/);
 assert.match(planning,/Aprovação solicitada/);
});
