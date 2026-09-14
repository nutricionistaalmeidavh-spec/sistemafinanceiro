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
const { createReportService }=require('../electron/services/report-service.cjs');
const { createAnalyticsService }=require('../electron/services/analytics-service.cjs');

test('reports and DRE honor cost center allocation and tag filters',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'finance1824-report-'));
  const database=new DatabaseService({dataDir:path.join(root,'data'),migrationsDir:path.resolve('database/migrations'),databaseFactory:(filename)=>new DatabaseSync(filename)});
  try {
    database.open();
    const db=database.connection();
    const now=()=> '2026-09-14T12:00:00.000Z';
    const finance=createFinanceService({db,now});
    const cashflow={getAccountBalances:()=>[],listMovements:()=>[]};
    const analytics=createAnalyticsService({db,finance,cashflow,now});
    const reports=createReportService({db,finance,analytics,now});
    db.prepare("INSERT INTO financial_categories(id,name,nature,dre_group,active,created_at,updated_at) VALUES (?,?,?,?,1,?,?)").run('cat','Operação','EXPENSE','OPERATING',now(),now());
    db.prepare("INSERT INTO financial_entries(id,kind,description,category_id,amount_cents,due_at,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run('e1','PAYABLE','Fornecedor','cat',10000,'2026-09-20','PARTIAL',now(),now());
    db.prepare("INSERT INTO financial_settlements(id,entry_id,amount_cents,occurred_at,created_at) VALUES (?,?,?,?,?)").run('s1','e1',5000,'2026-09-14',now());
    db.prepare("INSERT INTO cost_centers(id,code,name,active,created_at,updated_at) VALUES (?,?,?,?,?,?)").run('cc1','OBRA','Obra A',1,now(),now());
    db.prepare("INSERT INTO entry_allocations(entry_id,cost_center_id,amount_cents,percentage_basis_points,created_at,updated_at) VALUES (?,?,?,?,?,?)").run('e1','cc1',6000,6000,now(),now());
    db.prepare("INSERT INTO tags(id,name,active,created_at,updated_at) VALUES (?,?,?,?,?)").run('tag1','Urgente',1,now(),now());
    db.prepare("INSERT INTO entry_tags(entry_id,tag_id,created_at) VALUES (?,?,?)").run('e1','tag1',now());

    const report=reports.financialReport({from:'2026-09-01',to:'2026-09-30',costCenterId:'cc1',tagId:'tag1'});
    assert.equal(report.rows.length,1);
    assert.equal(report.rows[0].amountCents,6000);
    assert.equal(report.rows[0].settledCents,3000);
    assert.equal(report.rows[0].openCents,3000);
    assert.match(report.rows[0].costCenters,/Obra A/);
    assert.equal(report.rows[0].tags,'Urgente');
    assert.match(reports.toCsv(report),/Centros de custo/);

    const realized=analytics.getDre({from:'2026-09-01',to:'2026-09-30',basis:'realized',costCenterId:'cc1',tagId:'tag1'});
    assert.equal(realized.totals.expenseCents,3000);
    const accrual=analytics.getDre({from:'2026-09-01',to:'2026-09-30',basis:'accrual',costCenterId:'cc1',tagId:'tag1'});
    assert.equal(accrual.totals.expenseCents,6000);
    const missingTag=analytics.getDre({from:'2026-09-01',to:'2026-09-30',basis:'realized',tagId:'missing'});
    assert.equal(missingTag.totals.expenseCents,0);
  } finally {
    database.close();
    fs.rmSync(root,{recursive:true,force:true});
  }
});
