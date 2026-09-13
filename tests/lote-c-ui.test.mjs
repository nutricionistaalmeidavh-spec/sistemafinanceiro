import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const theme = fs.readFileSync(new URL('../src/lote-c-theme.css', import.meta.url), 'utf8');
const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('Lote C Financeiro/Admin theme uses the approved blue financial identity', () => {
  assert.match(theme, /--finance-primary:#2563eb/i);
  assert.match(theme, /--finance-primary-deep:#1e3a8a/i);
  assert.match(theme, /--finance-success:#15803d/i);
  assert.match(theme, /--finance-muted:#475569/i);
  assert.match(main, /lote-c-theme\.css/);
  assert.match(app, /Administração/);
});
