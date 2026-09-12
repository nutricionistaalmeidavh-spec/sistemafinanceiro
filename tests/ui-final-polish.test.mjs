import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');

test('E14 final UI exposes accessible navigation, focus states and collection search controls', () => {
  const app = read('src/App.tsx');
  const css = `${read('src/styles.css')}\n${read('src/final-polish.css')}`;
  const finance = read('src/pages/FinancePage.tsx');
  const registry = read('src/pages/RegistryPage.tsx');
  const recurring = read('src/pages/RecurringPage.tsx');
  const alerts = read('src/pages/AlertsPage.tsx');
  const users = read('src/pages/UsersPage.tsx');

  assert.match(app, /aria-label="Navegação principal"/);
  assert.match(app, /data-testid=\{`nav-\$\{target\}`\}/);
  for (const page of ['dashboard','alerts','cashflow','finance','dre','reports','recurring','registry','users','system']) {
    assert.match(app, new RegExp(`nav\\('${page}'`));
  }
  assert.match(css, /:focus-visible/);
  assert.match(css, /\.page-toolbar/);
  assert.match(css, /\.search-control/);
  assert.match(css, /position:sticky/);
  assert.match(finance, /data-testid="finance-search"/);
  assert.match(registry, /data-testid="registry-search"/);
  assert.match(recurring, /data-testid="recurring-search"/);
  assert.match(alerts, /data-testid="alerts-filter"/);
  assert.match(users, /data-testid="users-search"/);
});
