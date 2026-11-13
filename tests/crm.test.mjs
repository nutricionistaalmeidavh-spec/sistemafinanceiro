import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const { createCrmService }=require('../electron/services/crm-service.cjs');
const { createFinanceService }=require('../electron/services/finance-service.cjs');
const { createRegistryService }=require('../electron/services/registry-service.cjs');
const actor={id:'local-admin',role:'ADMIN'};
function setup(){
  const db=new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON;');
  const dir=new URL('../database/migrations/',import.meta.url);
  for(const file of fs.readdirSync(dir).filter(f=>/^\d+.*\.sql$/.test(f)).sort())db.exec(fs.readFileSync(new URL(file,dir),'utf8'));
  db.prepare("INSERT INTO users(id,login,name,role,password_hash,password_salt,active,created_at,updated_at) VALUES ('local-admin','admin','Admin','ADMIN','x','x',1,'now','now')").run();
  const finance=createFinanceService({db,now:()=> '2026-11-13T16:00:00.000Z'});
  const registry=createRegistryService({db,now:()=> '2026-11-13T16:00:00.000Z'});
  const crm=createCrmService({db,finance,registry,now:()=> '2026-11-13T16:00:00.000Z'});
  return {db,finance,registry,crm};
}
test('P0 captures leads, opportunities, activity history and tasks without creating financial entries',()=>{
  const {db,crm}=setup();
  const lead=crm.saveLead({name:'Cliente Teste',email:'teste@example.com',source:'INDICACAO'},actor);
  assert.equal(crm.listLeads().length,1);
  assert.throws(()=>crm.saveLead({name:'Duplicado',email:'TESTE@example.com'},actor),/duplicad|existente/i);
  const deal=crm.saveOpportunity({leadId:lead.id,title:'Licença comercial',amountCents:149900},actor);
  assert.equal(deal.stage,'NEW');
  assert.equal(crm.moveOpportunity(deal.id,'QUALIFIED',actor).stage,'QUALIFIED');
  const activity=crm.addActivity({opportunityId:deal.id,kind:'CALL',note:'Retorno agendado'},actor);
  assert.equal(activity.kind,'CALL');
  const task=crm.saveTask({opportunityId:deal.id,title:'Ligar amanhã',dueAt:'2026-11-14'},actor);
  assert.equal(crm.setTaskDone(task.id,true,actor).done,true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM financial_entries').get().n,0);
  db.close();
});
test('P1 quote is versioned, preserves cents and proposes without creating receivables',()=>{
  const {db,crm}=setup();
  const lead=crm.saveLead({name:'Empresa Beta',document:'12345678000155'},actor);
  const deal=crm.saveOpportunity({leadId:lead.id,title:'Projeto',amountCents:15001},actor);
  const quote=crm.createQuote({opportunityId:deal.id,items:[{description:'Serviço',quantity:3,unitPriceCents:5000},{description:'Ajuste',quantity:1,unitPriceCents:1}]},actor);
  assert.equal(quote.totalCents,15001);
  assert.equal(crm.createQuote({opportunityId:deal.id,items:[{description:'Revisão',quantity:1,unitPriceCents:15001}]},actor).version,2);
  assert.equal(crm.moveOpportunity(deal.id,'WON',actor).stage,'WON');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM financial_entries').get().n,0);
  assert.throws(()=>crm.previewReceivables({quoteId:quote.id,installments:2,firstDueAt:'2026-12-10'}),/cliente|convert/i);
  const customer=crm.convertLead(lead.id,{},actor);
  assert.equal(crm.getOpportunity(deal.id).customerId,customer.id);
  const preview=crm.previewReceivables({quoteId:quote.id,installments:2,firstDueAt:'2026-12-10'});
  assert.deepEqual(preview.installments.map(p=>p.amountCents),[7501,7500]);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM financial_entries').get().n,0);
  db.close();
});
test('P1 confirmation is explicit, idempotent, atomic and does not create realized cash',()=>{
  const {db,crm,finance}=setup();
  const lead=crm.saveLead({name:'Empresa Gamma',document:'11222333000144'},actor);
  const deal=crm.saveOpportunity({leadId:lead.id,title:'Venda',amountCents:10001},actor);
  const quote=crm.createQuote({opportunityId:deal.id,items:[{description:'Pacote',quantity:1,unitPriceCents:10001}]},actor);
  crm.moveOpportunity(deal.id,'WON',actor);
  crm.convertLead(lead.id,{},actor);
  const input={quoteId:quote.id,installments:3,firstDueAt:'2026-12-15',expectedTotalCents:10001};
  const first=crm.confirmReceivables(input,actor);
  assert.equal(first.entries.length,3);
  assert.equal(first.entries.reduce((s,x)=>s+x.amountCents,0),10001);
  assert.equal(first.entries.every(x=>x.status==='OPEN'),true);
  const again=crm.confirmReceivables(input,actor);
  assert.deepEqual(again.entries.map(x=>x.id),first.entries.map(x=>x.id));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM financial_entries').get().n,3);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM financial_settlements').get().n,0);
  assert.throws(()=>crm.confirmReceivables({...input,installments:1},actor),/diferent|confirmad|existing/i);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM financial_entries').get().n,3);
  assert.equal(finance.listEntries({kind:'RECEIVABLE'}).length,3);
  db.close();
});
test('P1 rejects stale totals and rolls back invalid schedules',()=>{
  const {db,crm}=setup();
  const lead=crm.saveLead({name:'Empresa Delta'},actor);
  const deal=crm.saveOpportunity({leadId:lead.id,title:'Venda',amountCents:20000},actor);
  const quote=crm.createQuote({opportunityId:deal.id,items:[{description:'Serviço',quantity:1,unitPriceCents:20000}]},actor);
  crm.moveOpportunity(deal.id,'WON',actor);
  crm.convertLead(lead.id,{},actor);
  assert.throws(()=>crm.confirmReceivables({quoteId:quote.id,installments:2,firstDueAt:'2026-12-10',expectedTotalCents:19999},actor),/alterad|valor|total/i);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM financial_entries').get().n,0);
  db.close();
});

test('P0 CSV preview flags duplicates and commits only valid unique leads',()=>{
 const {db,crm}=setup();
 crm.saveLead({name:'Existente',email:'ja@empresa.com'},actor);
 const rows=[
  {name:'Novo Alpha',email:'alpha@empresa.com',phone:'11999990000',source:'CSV'},
  {name:'Duplicado',email:'JA@empresa.com'},
  {name:'Duplicado no arquivo',email:'alpha@empresa.com'},
  {name:'',email:'semnome@empresa.com'},
 ];
 const preview=crm.previewLeadImport(rows);
 assert.equal(preview.rows.filter(x=>x.status==='READY').length,1);
 assert.equal(preview.rows.filter(x=>x.status==='DUPLICATE').length,2);
 assert.equal(preview.rows.filter(x=>x.status==='INVALID').length,1);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM crm_leads').get().n,1);
 const result=crm.commitLeadImport(rows,actor);
 assert.equal(result.created,1);
 assert.equal(result.skipped,3);
 assert.equal(crm.listLeads().length,2);
 assert.equal(crm.commitLeadImport(rows,actor).created,0);
 db.close();
});

test('P0 stage history records transitions and remains queryable',()=>{
 const {db,crm}=setup();
 const lead=crm.saveLead({name:'Histórico Alpha'},actor);
 const deal=crm.saveOpportunity({leadId:lead.id,title:'Consulta',amountCents:1200},actor);
 crm.moveOpportunity(deal.id,'QUALIFIED',actor);
 crm.moveOpportunity(deal.id,'PROPOSAL',actor);
 assert.deepEqual(crm.listStageHistory(deal.id).map(x=>x.toStage),['QUALIFIED','PROPOSAL']);
 db.close();
});
test('P1 conversion recognizes formatted existing documents and rejects conflicting identity',()=>{
 const {db,crm,registry}=setup();
 const existing=registry.saveCustomer({name:'Cliente já cadastrado',document:'12.345.678/0001-00'},actor);
 const lead=crm.saveLead({name:'Lead da mesma empresa',document:'12345678000100'},actor);
 const linked=crm.convertLead(lead.id,{},actor);
 assert.equal(linked.id,existing.id);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM customers').get().n,1);
 const another=registry.saveCustomer({name:'Outro documento',document:'12.345.678/0001-99'},actor);
 const lead2=crm.saveLead({name:'Lead 2',document:'12345678000177'},actor);
 assert.throws(()=>crm.convertLead(lead2.id,{customerId:another.id},actor),/conflitante/i);
 db.close();
});
test('P1 mid-batch failure rolls back already-created receivables',()=>{
 const {db,crm,finance,registry}=setup();
 const lead=crm.saveLead({name:'Rollback Comercial'},actor);
 const deal=crm.saveOpportunity({leadId:lead.id,title:'Projeto de rollback',amountCents:20000},actor);
 const quote=crm.createQuote({opportunityId:deal.id,items:[{description:'Entrega',quantity:1,unitPriceCents:20000}]},actor);
 crm.moveOpportunity(deal.id,'WON',actor);crm.convertLead(lead.id,{},actor);
 let writes=0;
 const wrappedFinance={...finance,createEntry(...args){writes++;if(writes===2)throw Error('falha simulada na segunda parcela');return finance.createEntry(...args);}};
 const broken=createCrmService({db,finance:wrappedFinance,registry,now:()=> '2026-11-13T16:00:00.000Z'});
 assert.throws(()=>broken.confirmReceivables({quoteId:quote.id,installments:2,firstDueAt:'2026-12-12',expectedTotalCents:20000},actor),/simulada/i);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM financial_entries').get().n,0);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM crm_billing_links').get().n,0);
 db.close();
});
