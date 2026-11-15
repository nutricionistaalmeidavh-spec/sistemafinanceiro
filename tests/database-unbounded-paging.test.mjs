import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const { createCrmService }=require('../electron/services/crm-service.cjs');
const { createFinanceService }=require('../electron/services/finance-service.cjs');
const { createRegistryService }=require('../electron/services/registry-service.cjs');
const sqlRoot=new URL('../database/migrations/',import.meta.url);
function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec('PRAGMA foreign_keys=ON;');
 for(const file of fs.readdirSync(sqlRoot).filter(f=>/^\d+.*\.sql$/.test(f)).sort())db.exec(fs.readFileSync(new URL(file,sqlRoot),'utf8'));
 db.prepare("INSERT INTO users(id,login,name,role,password_hash,password_salt,active,created_at,updated_at) VALUES ('admin','admin','Admin','ADMIN','x','x',1,'2026-11-15','2026-11-15')").run();
 const now=()=> '2026-11-15T12:00:00.000Z';
 const finance=createFinanceService({db,now});
 const registry=createRegistryService({db,now});
 return {db,finance,registry,crm:createCrmService({db,finance,registry,now})};
}
test('P0: migration 013 adds stable CRM/Finance ordering and lookup indexes without changing data',()=>{
 const {db}=fixture();
 const list=name=>db.prepare('PRAGMA index_list('+name+')').all().map(x=>x.name);
 assert.ok(list('crm_leads').includes('idx_crm_leads_updated_id'));
 assert.ok(list('crm_opportunities').includes('idx_crm_opportunities_pipeline_updated_id'));
 assert.ok(list('financial_entries').includes('idx_finance_kind_due_id'));
 assert.ok(list('customers').includes('idx_customers_active_name'));
 assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
 db.close();
});
test('P0: lead keyset visits every row, including >5000 records, with stable ordering and canonical customer identity',()=>{
 const {db,crm}=fixture();
 db.exec('BEGIN');
 const insert=db.prepare("INSERT INTO crm_leads(id,name,source,status,created_at,updated_at) VALUES (?,?,'CSV','NEW',?,?)");
 for(let i=0;i<5107;i++){const d=String(i).padStart(6,'0');insert.run('lead-'+d,'Nome '+d,'2026-11-14','2026-11-15');}
 db.exec('COMMIT');
 const seen=new Set();let cursor=null,iterations=0,first;
 do{
  const page=crm.listLeadsPage({limit:137,cursor});
  if(!first)first=page;
  assert.ok(page.items.length<=137);
  for(const row of page.items){assert.equal(seen.has(row.id),false,'duplicate page entry');seen.add(row.id);}
  cursor=page.nextCursor;
  iterations++;
  assert.ok(iterations<100);
 }while(cursor);
 assert.equal(first.total,5107);
 assert.equal(seen.size,5107);
 assert.equal(crm.listLeadsPage({query:'Nome 000042',limit:20}).items[0].id,'lead-000042');
 db.prepare("INSERT INTO customers(id,name,active,created_at,updated_at) VALUES ('cx','Cliente Atualizado',1,'now','now')").run();
 db.prepare("UPDATE crm_leads SET status='CONVERTED',customer_id='cx' WHERE id='lead-000042'").run();
 assert.equal(crm.listLeadsPage({query:'Cliente Atualizado'}).items[0].name,'Cliente Atualizado');
 assert.throws(()=>crm.listLeadsPage({cursor:'not-a-cursor'}),/cursor/i);
 db.close();
});
test('P1: opportunities pagination returns canonical display names and stage totals without hiding records',()=>{
 const {db,crm}=fixture();
 const lead=crm.saveLead({name:'Construtora X'});
 const leadId=lead.id;
 const insert=db.prepare("INSERT INTO crm_opportunities(id,lead_id,title,amount_cents,stage,pipeline_id,stage_id,created_at,updated_at) VALUES (?,?,?,?,'NEW','crm-pipeline-default','crm-stage-new','2026-11-14','2026-11-15')");
 for(let i=0;i<125;i++)insert.run('opp-'+i,leadId,'Oportunidade '+i,100);
 let cursor=null,total=0,first;
 do{const page=crm.listOpportunitiesPage({pipelineId:'crm-pipeline-default',limit:25,cursor});if(!first)first=page;total+=page.items.length;assert.ok(page.items.every(x=>x.partyName==='Construtora X'));cursor=page.nextCursor;}while(cursor);
 assert.equal(total,125);
 assert.equal(first.stageTotals['crm-stage-new'].count,125);
 assert.equal(first.stageTotals['crm-stage-new'].amountCents,12500);
 db.prepare("UPDATE crm_opportunities SET stage='PROPOSAL',stage_id='crm-stage-proposal' WHERE id='opp-110'").run();
 const quotePage=crm.listOpportunitiesPage({quoteOnly:true,limit:15});
 assert.equal(quotePage.total,1);
 assert.equal(quotePage.items[0].id,'opp-110');
 db.close();
});
test('P1: finance keyset loads a bounded batch and preserves settlement status and as-of semantics',()=>{
 const {db,finance}=fixture();
 const insert=db.prepare("INSERT INTO financial_entries(id,kind,description,amount_cents,due_at,status,created_at,updated_at) VALUES (?,'PAYABLE',?,10000,'2026-11-14','OPEN','2026-11-01','2026-11-01')");
 for(let i=0;i<225;i++)insert.run('pay-'+i,'Fatura '+i);
 const payment=db.prepare("INSERT INTO financial_settlements(id,entry_id,amount_cents,occurred_at,created_at) VALUES ('s-1','pay-1',10000,'2026-11-14','2026-11-14')");
 payment.run();
 db.prepare("UPDATE financial_entries SET status='SETTLED' WHERE id='pay-1'").run();
 let cursor=null,seen=new Set();
 do{
  const page=finance.listEntriesPage({kind:'PAYABLE',limit:40,cursor,asOf:'2026-11-15'});
  assert.ok(page.items.length<=40);
  for(const row of page.items){assert.equal(seen.has(row.id),false);seen.add(row.id);}
  cursor=page.nextCursor;
 }while(cursor);
 assert.equal(seen.size,225);
 assert.equal(finance.listEntriesPage({kind:'PAYABLE',status:'SETTLED'}).items.length,1);
 assert.equal(finance.listEntriesPage({kind:'PAYABLE',status:'OVERDUE',limit:40}).items.length,40);
 assert.equal(finance.listEntriesPage({kind:'PAYABLE',query:'Fatura 224',limit:20}).items[0].id,'pay-224');
 db.close();
});
test('P2: CSV preview accepts >5000 records; import can run in bounded batches without an account quota',()=>{
 const {db,crm}=fixture();
 const rows=Array.from({length:5101},(_,i)=>({name:'Contato '+i,email:'lead'+i+'@example.test'}));
 const preview=crm.previewLeadImport(rows);
 assert.equal(preview.ready,5101);
 assert.equal(preview.invalid,0);
 for(let i=0;i<rows.length;i+=250)crm.commitLeadImport(rows.slice(i,i+250));
 assert.equal(db.prepare('SELECT COUNT(*) n FROM crm_leads').get().n,5101);
 db.close();
});


test('P2: customer and creditor cursor pages preserve every registered contact',()=>{
 const {db,registry}=fixture();
 const customer=db.prepare("INSERT INTO customers(id,name,active,created_at,updated_at) VALUES (?,?,1,'2026-11-01','2026-11-01')");
 const creditor=db.prepare("INSERT INTO creditors(id,name,active,created_at,updated_at) VALUES (?,?,1,'2026-11-01','2026-11-01')");
 for(let i=0;i<325;i++){
  const d=String(i).padStart(4,'0');
  customer.run('c'+d,'Cliente '+d);
  creditor.run('v'+d,'Fornecedor '+d);
 }
 for(const [label,read] of [['customers',x=>registry.listCustomersPage(x)],['creditors',x=>registry.listCreditorsPage(x)]]){
  let cursor=null,found=new Set(),pages=0;
  do{
   const page=read({limit:41,cursor});
   assert.equal(page.total,325,label);
   assert.ok(page.items.length<=41);
   for(const item of page.items){assert.ok(!found.has(item.id));found.add(item.id);}
   cursor=page.nextCursor;pages++;
  }while(cursor);
  assert.equal(found.size,325,label);
  assert.equal(pages,8);
 }
 assert.equal(registry.listCustomersPage({query:'Cliente 0300'}).items[0].id,'c0300');
 assert.equal(registry.getCreditor('v0200').name,'Fornecedor 0200');
 db.close();
});

test('P2: task keyset pages handle unscheduled records without lost or duplicated rows',()=>{
 const {db,crm}=fixture();
 const lead=crm.saveLead({name:'Empresa Tarefas'});
 const opportunity=crm.saveOpportunity({leadId:lead.id,title:'Operação',amountCents:1000});
 const insert=db.prepare("INSERT INTO crm_tasks(id,opportunity_id,title,due_at,done_at,created_at,updated_at) VALUES (?,?,?,?,NULL,'2026-11-01','2026-11-01')");
 for(let i=0;i<218;i++)insert.run('task-'+i,opportunity.id,'Tarefa '+i,i%4===0?null:'2026-12-01');
 let cursor=null,found=new Set();
 do{
  const page=crm.listTasksPage({limit:33,cursor});
  assert.equal(page.total,218);
  for(const item of page.items){assert.ok(!found.has(item.id));found.add(item.id);}
  cursor=page.nextCursor;
 }while(cursor);
 assert.equal(found.size,218);
 db.close();
});

test('P1: as-of page reads prior state without settling a future payment',()=>{
 const {db,finance}=fixture();
 db.exec("INSERT INTO financial_entries(id,kind,description,amount_cents,due_at,status,created_at,updated_at) VALUES ('historical','PAYABLE','Parcela histórica',20000,'2026-11-05','SETTLED','2026-11-01','2026-11-14')");
 db.exec("INSERT INTO financial_settlements(id,entry_id,amount_cents,occurred_at,created_at) VALUES ('hist-payment','historical',20000,'2026-11-14','2026-11-14')");
 const before=finance.listEntriesPage({kind:'PAYABLE',asOf:'2026-11-10',status:'OPEN'});
 const after=finance.listEntriesPage({kind:'PAYABLE',asOf:'2026-11-15',status:'SETTLED'});
 assert.equal(before.items[0].openCents,20000);
 assert.equal(after.items[0].openCents,0);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM financial_entries').get().n,1);
 db.close();
});
