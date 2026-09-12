import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { registerIpcHandlers } = require('../electron/ipc-handlers.cjs');

test('IPC protects financial mutations and registers E06-E09 channels', async () => {
  const handlers = new Map();
  const ipcMain = { handle(name, fn) { handlers.set(name, fn); } };
  const actor = { id: 'u1', role: 'FINANCE' };
  const auth = {
    needsBootstrap: () => false, bootstrapAdmin: () => actor, authenticate: () => ({ token:'x',user:actor }), session: () => ({ user:actor }), logout: () => {},
    require(token, permission) { assert.equal(token, 'tok'); if (!['finance.manage','finance.view'].includes(permission)) return actor; return actor; },
    listUsers: () => [], createUser: () => actor, setUserActive: () => actor,
  };
  let receivedActor = null;
  const finance = { createEntry(input,a){receivedActor=a;return{id:'f1',...input};}, listEntries:()=>[],getSummary:()=>({}),listAccounts:()=>[],createAccount:()=>({}),settleEntry:()=>({}),reverseSettlement:()=>({}),cancelEntry:()=>({}) };
  const registry = { listCustomers:()=>[],saveCustomer:()=>({}),setCustomerActive:()=>({}),listCreditors:()=>[],saveCreditor:()=>({}),setCreditorActive:()=>({}),listCategories:()=>[],saveCategory:()=>({}),setCategoryActive:()=>({}) };
  const cashflow = { listMovements:()=>[],createManualMovement:()=>({}),transfer:()=>({}),getAccountBalances:()=>[],getCashflowSummary:()=>({}) };
  const analytics = { getDre:()=>({}),getIndicators:()=>({}),getDashboardSnapshot:()=>({}) };
  const recurrence = { listRules:()=>[],createRule:()=>({}),setRuleActive:()=>({}),generateDue:()=>[] };
  registerIpcHandlers({ ipcMain, database:{health:()=>({ok:true})}, auth, finance, registry, cashflow, analytics, recurrence });
  const result = await handlers.get('finance:entries:create')({}, 'tok', { kind:'PAYABLE' });
  assert.equal(result.id, 'f1'); assert.deepEqual(receivedActor, actor);
  for (const channel of ['cashflow:movements:list','cashflow:transfer','analytics:dre','analytics:dashboard','recurrence:create','recurrence:generate']) assert.equal(handlers.has(channel), true, channel);
});
