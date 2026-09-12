import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { registerIpcHandlers } = require('../electron/ipc-handlers.cjs');

test('E10-E13 IPC protects alerts reports backup and LAN with the expected permissions', async () => {
  const handlers = new Map();
  const ipcMain = { handle(name, fn) { handlers.set(name, fn); } };
  const calls = [];
  const actor = { id: 'admin', role: 'ADMIN' };
  const auth = {
    needsBootstrap:()=>false, bootstrapAdmin:()=>actor, authenticate:()=>({token:'x'}), session:()=>({user:actor}), logout:()=>{},
    listUsers:()=>[], createUser:()=>actor, setUserActive:()=>actor,
    require(token, permission) { calls.push([token, permission]); return actor; },
  };
  const finance = { listAccounts:()=>[],createAccount:()=>({}),listEntries:()=>[],createEntry:()=>({}),settleEntry:()=>({}),reverseSettlement:()=>({}),cancelEntry:()=>({}),getSummary:()=>({}) };
  const registry = { listCustomers:()=>[],saveCustomer:()=>({}),setCustomerActive:()=>({}),listCreditors:()=>[],saveCreditor:()=>({}),setCreditorActive:()=>({}),listCategories:()=>[],saveCategory:()=>({}),setCategoryActive:()=>({}) };
  const cashflow = { listMovements:()=>[],createManualMovement:()=>({}),transfer:()=>({}),getAccountBalances:()=>[],getCashflowSummary:()=>({}) };
  const analytics = { getDre:()=>({}),getIndicators:()=>({}),getDashboardSnapshot:()=>({}) };
  const recurrence = { listRules:()=>[],createRule:()=>({}),setRuleActive:()=>({}),generateDue:()=>[] };
  const alerts = { listAlerts:()=>[],acknowledge:()=>({}),listAccountThresholds:()=>[],setAccountThreshold:()=>({}),saveInternalAlert:()=>({}) };
  const reports = { financialReport:()=>({kind:'FINANCIAL_REPORT',rows:[]}),settlementReceipt:()=>({}),toCsv:()=>'',toXlsxBuffer:()=>Buffer.from('PK'),toPrintableHtml:()=>'<html></html>' };
  const backup = { listBackups:()=>[],createBackup:()=>({}),verifyBackup:()=>({valid:true}),restoreBackup:()=>({restored:true}) };
  const lan = { status:()=>({enabled:false}),stop:async()=>{},configure:()=>({enabled:false}),startConfigured:async()=>null,createPairingCode:()=>({code:'123456'}) };
  const documents = { savePdf:async()=>({canceled:true}),printHtml:async()=>({printed:true}) };
  registerIpcHandlers({ ipcMain, database:{health:()=>({ok:true})}, auth, finance, registry, cashflow, analytics, recurrence, alerts, reports, backup, lan, documents });

  assert.equal(handlers.has('alerts:list'), true);
  assert.equal(handlers.has('reports:xlsx'), true);
  assert.equal(handlers.has('backup:create'), true);
  assert.equal(handlers.has('lan:configure'), true);

  await handlers.get('alerts:list')({}, 'tok', {});
  assert.deepEqual(calls.at(-1), ['tok','finance.view']);
  await handlers.get('backup:create')({}, 'tok');
  assert.deepEqual(calls.at(-1), ['tok','system.manage']);
  await handlers.get('lan:status')({}, 'tok');
  assert.deepEqual(calls.at(-1), ['tok','system.manage']);
  await handlers.get('alerts:internal:save')({}, 'tok', {title:'Aviso'});
  assert.deepEqual(calls.at(-1), ['tok','system.manage']);
});
