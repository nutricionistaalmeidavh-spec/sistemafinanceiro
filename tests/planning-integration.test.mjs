import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
const require=createRequire(import.meta.url);
const { DatabaseService }=require('../electron/services/database.cjs');
const { createPlanningService }=require('../electron/services/planning-service.cjs');

test('planning integrates rateio, budget, approvals, bulk and projection on SQLite',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'finance1824-int-'));
  const database=new DatabaseService({dataDir:path.join(root,'data'),migrationsDir:path.resolve('database/migrations'),databaseFactory:(filename)=>new DatabaseSync(filename)});
  try {
    database.open();
    const db=database.connection();
    const now=()=> '2026-09-12T12:00:00.000Z';
    let seq=0;
    const planning=createPlanningService({db,now,idFactory:(p)=>`${p}-${++seq}`});
    db.prepare("INSERT INTO financial_categories(id,name,nature,dre_group,active,created_at,updated_at) VALUES (?,?,?,?,1,?,?)").run('cat-exp','Operação','EXPENSE','OPERATING',now(),now());
    db.prepare("INSERT INTO financial_entries(id,kind,description,category_id,amount_cents,due_at,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run('e1','PAYABLE','Fornecedor A','cat-exp',10001,'2026-09-20','OPEN',now(),now());
    db.prepare("INSERT INTO financial_entries(id,kind,description,category_id,amount_cents,due_at,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run('e2','PAYABLE','Fornecedor B','cat-exp',5000,'2026-10-10','OPEN',now(),now());
    db.prepare("INSERT INTO financial_settlements(id,entry_id,amount_cents,occurred_at,created_at) VALUES (?,?,?,?,?)").run('s1','e1',4000,'2026-09-15',now());
    const a=planning.saveCostCenter({code:'A',name:'Obra A'},{id:'admin',role:'ADMIN'});
    const b=planning.saveCostCenter({code:'B',name:'Administrativo'},{id:'admin',role:'ADMIN'});
    const splits=planning.setEntryAllocations('e1',[{costCenterId:a.id,percentage:60},{costCenterId:b.id,percentage:40}],{id:'admin',role:'ADMIN'});
    assert.equal(splits.reduce((sum,row)=>sum+row.amountCents,0),10001);
    const tag=planning.saveTag({name:'Urgente'},{id:'admin',role:'ADMIN'});
    planning.saveBudget({scenarioId:'base',year:2026,month:9,nature:'EXPENSE',amountCents:8000,categoryId:'cat-exp',costCenterId:a.id},{id:'admin',role:'ADMIN'});
    const compare=planning.compareBudget({scenarioId:'base',year:2026,month:9});
    assert.equal(compare.length,1);
    assert.ok(compare[0].actualCents>0);
    assert.equal(compare[0].projectedCents,compare[0].actualCents+compare[0].committedCents);
    const policy=planning.saveApprovalPolicy({name:'Dupla',minAmountCents:5000,requiredApprovals:2,approverRoles:['FINANCE']},{id:'admin',role:'ADMIN'});
    let request=planning.requestApproval({entryId:'e1',policyId:policy.id},{id:'requester',role:'FINANCE'});
    request=planning.decideApproval(request.id,{decision:'APPROVED'},{id:'u1',role:'FINANCE'});
    assert.equal(request.status,'PENDING');
    request=planning.decideApproval(request.id,{decision:'APPROVED'},{id:'u2',role:'FINANCE'});
    assert.equal(request.status,'APPROVED');
    assert.throws(()=>planning.runBulkOperation({entryIds:['e1','missing'],action:'TAG',payload:{tagId:tag.id}},{id:'u1',role:'FINANCE'}),/not found/i);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM entry_tags').get().count,0);
    const bulk=planning.runBulkOperation({entryIds:['e1','e2'],action:'TAG',payload:{tagId:tag.id}},{id:'u1',role:'FINANCE'});
    assert.equal(bulk.count,2);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM entry_tags').get().count,2);
    const projection=planning.getProjection({months:2,adjustments:[{month:'2026-10',amountCents:-1000}]});
    assert.equal(projection.length,2);
    assert.equal(projection[1].adjustmentCents,-1000);
  } finally {
    database.close();
    fs.rmSync(root,{recursive:true,force:true});
  }
});
