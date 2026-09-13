import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');

test('E16 exposes the finance UI kit, grouped shell, actionable dashboard and entry drawer', () => {
  assert.equal(fs.existsSync('src/components/finance-ui.tsx'), true, 'finance-ui kit must exist');
  assert.equal(fs.existsSync('src/finance-ui.css'), true, 'finance-ui stylesheet must exist');

  const kit = read('src/components/finance-ui.tsx');
  const app = read('src/App.tsx');
  const dashboard = read('src/pages/DashboardPage.tsx');
  const finance = read('src/pages/FinancePage.tsx');
  const main = read('src/main.tsx');
  const css = `${read('src/styles.css')}\n${read('src/final-polish.css')}\n${read('src/finance-ui.css')}`;

  for (const exported of ['FinanceButton', 'FinanceMetricCard', 'FinanceStatusBadge', 'FinanceToolbar', 'FinanceEmptyState', 'FinanceDrawer']) {
    assert.match(kit, new RegExp(`export function ${exported}`));
  }

  for (const group of ['Visão geral', 'Financeiro', 'Dados', 'Administração']) {
    assert.match(app, new RegExp(group));
  }
  assert.match(app, /data-testid="mobile-nav-toggle"/);
  assert.match(app, /data-testid="app-sidebar"/);

  assert.match(dashboard, /data-testid="dashboard-attention"/);
  assert.match(dashboard, /FinanceMetricCard/);

  assert.match(finance, /data-testid="finance-new-entry"/);
  assert.match(finance, /data-testid="finance-entry-drawer"/);
  assert.match(finance, /FinanceStatusBadge/);
  assert.match(finance, /FinanceDrawer/);

  assert.match(main, /finance-ui\.css/);
  assert.match(css, /\.finance-drawer/);
  assert.match(css, /\.mobile-nav-toggle/);
  assert.match(css, /--finance-sidebar-width:\s*248px/);
  assert.match(css, /--finance-sidebar-compact:\s*72px/);
});
