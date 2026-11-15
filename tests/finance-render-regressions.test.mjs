import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page=()=>readFileSync(new URL('../src/pages/FinancePage.tsx',import.meta.url),'utf8');
const table=()=>readFileSync(new URL('../src/components/FinanceEntriesTable.tsx',import.meta.url),'utf8');
const qa=()=>readFileSync(new URL('../scripts/ci-capture-final-screens.mjs',import.meta.url),'utf8');
const fixture=()=>readFileSync(new URL('../electron/services/qa-fixture-service.cjs',import.meta.url),'utf8');

test('P1: cancellation relies on canonical IPC notification, not double reload',()=>{
  const src=page();
  const decision=src.slice(src.indexOf('async function confirmDecision'),src.indexOf('async function receiptPdf'));
  assert.doesNotMatch(decision,/await reloadEntries\(\)/);
  assert.match(src,/onDataChanged/);
});

test('P1: category queries follow kind changes without fetching static catalogs again',()=>{
  const src=page();
  assert.match(src,/const reloadCategories\s*=\s*useCallback/);
  const catalogs=src.slice(src.indexOf('const reloadCatalogs'),src.indexOf('const reloadCategories'));
  assert.doesNotMatch(catalogs,/listCategories/);
  assert.match(src,/setForm\(\(old\)\s*=>\s*old\.categoryId/);
});

test('P2: FinanceEntriesTable is memoized and outside mutable form state',()=>{
  assert.match(table(),/memo\(/);
  assert.match(page(),/<FinanceEntriesTable/);
  const src=page();
  assert.doesNotMatch(src,/visibleEntries\.map\(/);
});

test('P0: every critical finance interaction is captured in QA metrics',()=>{
  const src=qa();
  assert.match(src,/summarizeRenderInteraction/);
  for(const name of ['finance-open','finance-search','finance-status','finance-create','finance-payment','finance-edit','finance-cancel']){
    assert.ok(src.includes(name),name);
  }
  assert.match(src,/react-interactions\.json/);
});

test('P2: synthetic ledger volume is gated to isolated QA fixture',()=>{
  const src=fixture();
  assert.match(src,/ledgerRows/);
  assert.match(src,/10000/);
  assert.match(src,/qa-perf-/);
});
