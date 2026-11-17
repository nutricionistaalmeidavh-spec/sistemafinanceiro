import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const require=createRequire(import.meta.url);
const { DatabaseService }=require('../electron/services/database.cjs');
const { createFinanceService }=require('../electron/services/finance-service.cjs');
const { createPlanningService }=require('../electron/services/planning-service.cjs');
const { createRecurrenceService }=require('../electron/services/recurrence-service.cjs');

function fixture(run) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'finance-cost-centers-'));
  const database=new DatabaseService({dataDir:path.join(root,'data'),migrationsDir:path.resolve('database/migrations'),databaseFactory:(filename)=>new DatabaseSync(filename)});
  try {
    database.open();
    const db=database.connection();
    const now=()=> '2026-11-17T12:00:00.000Z';
    const finance=createFinanceService({db,now});
    const recurrence=createRecurrenceService({db,finance,now});
    const planning=createPlanningService({db,finance,recurrence,now});
    const alpha=planning.saveCostCenter({code:'OBRA',name:'Obra A'});
    const admin=planning.saveCostCenter({code:'ADM',name:'Administrativo'});
    return run({db,finance,recurrence,planning,alpha,admin});
  } finally {database.close();fs.rmSync(root,{recursive:true,force:true});}
}
const entry={kind:'PAYABLE',description:'Materiais',amountCents:10001,dueAt:'2026-11-17'};

test('criação atribui centro de custo no lançamento de forma canônica',()=>fixture(({finance,planning,alpha})=>{
  const created=finance.createEntry({...entry,allocations:[{costCenterId:alpha.id,percentage:100}]});
  assert.deepEqual(planning.getEntryAllocations(created.id).map(x=>[x.costCenterId,x.amountCents,x.percentageBasisPoints]),[[alpha.id,10001,10000]]);
}));

test('rateio proporcional de centavos e edição no mesmo lançamento',()=>fixture(({finance,planning,alpha,admin})=>{
  const created=finance.createEntry({...entry,allocations:[{costCenterId:alpha.id,percentage:60},{costCenterId:admin.id,percentage:40}]});
  assert.equal(planning.getEntryAllocations(created.id).reduce((sum,x)=>sum+x.amountCents,0),10001);
  finance.updateEntry(created.id,{allocations:[{costCenterId:alpha.id,percentage:50},{costCenterId:admin.id,percentage:50}]});
  const updated=planning.getEntryAllocations(created.id);
  assert.equal(updated.reduce((sum,x)=>sum+x.amountCents,0),10001);
  assert.deepEqual(updated.map(x=>x.percentageBasisPoints).sort((a,b)=>a-b),[5000,5000]);
  finance.updateEntry(created.id,{allocations:[]});
  assert.equal(planning.getEntryAllocations(created.id).length,0);
}));

test('rateio inválido faz rollback da criação e da edição sem dados órfãos',()=>fixture(({db,finance,planning,alpha,admin})=>{
  assert.throws(()=>finance.createEntry({...entry,allocations:[{costCenterId:alpha.id,percentage:90}]}),/100%/);
  assert.equal(db.prepare('SELECT COUNT(*) total FROM financial_entries').get().total,0);
  const created=finance.createEntry({...entry,allocations:[{costCenterId:alpha.id,percentage:100}]});
  assert.throws(()=>finance.updateEntry(created.id,{description:'Alterado',allocations:[{costCenterId:admin.id,percentage:30}]}),/100%/);
  assert.equal(finance.getEntry(created.id).description,entry.description);
  assert.equal(planning.getEntryAllocations(created.id)[0].costCenterId,alpha.id);
}));

test('recorrência replica percentual para cada parcela com valores ajustados',()=>fixture(({finance,planning,recurrence,alpha,admin})=>{
  recurrence.createRule({ ...entry, startDate:'2026-11-17',dueDay:17,intervalMonths:1,maxOccurrences:2,
    allocations:[{costCenterId:alpha.id,percentage:60},{costCenterId:admin.id,percentage:40}] });
  const generated=recurrence.generateDue({asOf:'2026-12-17'});
  assert.equal(generated.length,2);
  for(const item of generated) {
    const rows=planning.getEntryAllocations(item.id);
    assert.equal(rows.length,2);
    assert.equal(rows.reduce((sum,x)=>sum+x.amountCents,0),finance.getEntry(item.id).amountCents);
  }
}));
