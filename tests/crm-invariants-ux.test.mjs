import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';

const require=createRequire(import.meta.url);
const {createCrmService}=require('../electron/services/crm-service.cjs');
const {createCrmIntelligenceService}=require('../electron/services/crm-intelligence-service.cjs');
const {createFinanceService}=require('../electron/services/finance-service.cjs');
const {createRegistryService}=require('../electron/services/registry-service.cjs');
const actor={id:'local-admin',role:'ADMIN'};
const now=()=> '2026-11-15T11:00:00.000Z';

function setup(){
 const db=new DatabaseSync(':memory:');
 db.exec('PRAGMA foreign_keys=ON');
 const root=new URL('../database/migrations/',import.meta.url);
 for(const file of fs.readdirSync(root).filter(f=>/^\d+.*\.sql$/.test(f)).sort()){
  db.exec(fs.readFileSync(new URL(file,root),'utf8'));
 }
 db.prepare("INSERT INTO users(id,login,name,role,password_hash,password_salt,active,created_at,updated_at) VALUES ('local-admin','admin','Admin','ADMIN','x','x',1,'now','now')").run();
 const finance=createFinanceService({db,now});
 const registry=createRegistryService({db,now});
 const crm=createCrmService({db,finance,registry,now});
 const intelligence=createCrmIntelligenceService({db,crm,now});
 return {db,finance,registry,crm,intelligence};
}
function billedOpportunity({crm}){
 const lead=crm.saveLead({name:'Cliente ArtiSys',email:'cliente-qa@example.test'},actor);
 const opp=crm.saveOpportunity({leadId:lead.id,title:'Contrato mensal',amountCents:12501},actor);
 const quote=crm.createQuote({opportunityId:opp.id,items:[{description:'Implantação',quantity:1,unitPriceCents:12501}]},actor);
 crm.moveOpportunity(opp.id,'WON',actor);
 const customer=crm.convertLead(lead.id,{},actor);
 const request={quoteId:quote.id,installments:2,firstDueAt:'2026-12-10',expectedTotalCents:12501};
 const result=crm.confirmReceivables(request,actor);
 return {lead,opp,quote,customer,request,entries:result.entries};
}
test('P0: a new proposal cannot silently change a billed opportunity or its linked receivables',()=>{
 const h=setup();
 try{
  const {crm,db}=h;const deal=billedOpportunity(h);
  assert.throws(()=>crm.createQuote({opportunityId:deal.opp.id,items:[{description:'Novo valor',quantity:1,unitPriceCents:30000}]},actor),/recebíveis|financeir|faturad/i);
  assert.equal(crm.getOpportunity(deal.opp.id).amountCents,12501);
  assert.deepEqual(crm.listQuotes(deal.opp.id).map(q=>q.version),[1]);
  assert.deepEqual(crm.listBillingLinks(deal.opp.id).map(l=>l.entry.amountCents),[6251,6250]);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM financial_entries').get().n,2);
 }finally{h.db.close();}
});
test('P0: billed opportunity cannot silently change its linked customer or lead',()=>{
 const h=setup();
 try{
  const {crm,registry}=h;const deal=billedOpportunity(h);
  const another=registry.saveCustomer({name:'Outro cliente'},actor);
  assert.throws(()=>crm.saveOpportunity({id:deal.opp.id,title:'Alterado',amountCents:12501,customerId:another.id},actor),/recebíveis|cliente|faturad/i);
  const otherLead=crm.saveLead({name:'Outro lead',email:'segundo@example.test'},actor);
  assert.throws(()=>crm.saveOpportunity({id:deal.opp.id,title:'Alterado',amountCents:12501,leadId:otherLead.id},actor),/recebíveis|lead|faturad/i);
  assert.equal(crm.getOpportunity(deal.opp.id).customerId,deal.customer.id);
 }finally{h.db.close();}
});
test('P0: receivable linked to a CRM quote cannot have its financial identity, price or due date rewritten',()=>{
 const h=setup();
 try{
  const {finance,crm,registry}=h;const deal=billedOpportunity(h);
  const entry=deal.entries[0];
  const another=registry.saveCustomer({name:'Outro cliente'},actor);
  assert.throws(()=>finance.updateEntry(entry.id,{amountCents:6000},actor),/CRM|proposta|vinculad/i);
  assert.throws(()=>finance.updateEntry(entry.id,{dueAt:'2027-01-12'},actor),/CRM|proposta|vinculad/i);
  assert.throws(()=>finance.updateEntry(entry.id,{customerId:another.id},actor),/CRM|proposta|vinculad/i);
  assert.equal(finance.getEntry(entry.id).amountCents,6251);
  assert.equal(crm.listBillingLinks(deal.opp.id)[0].entry.amountCents,6251);
  const updated=finance.updateEntry(entry.id,{notes:'Contato financeiro atualizado'},actor);
  assert.equal(updated.notes,'Contato financeiro atualizado');
  assert.equal(h.db.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{h.db.close();}
});
test('P1: changing a completed appointment preserves DONE and never reopens follow-ups',()=>{
 const h=setup();
 try{
  const {crm,intelligence}=h;
  const lead=crm.saveLead({name:'Lead agenda'},actor);
  const opp=crm.saveOpportunity({leadId:lead.id,title:'Serviço',amountCents:30000},actor);
  const made=intelligence.saveAppointment({opportunityId:opp.id,title:'Reunião',scheduledDate:'2026-11-10',scheduledTime:'09:30'},actor);
  intelligence.setAppointmentStatus(made.id,'DONE',actor);
  const updated=intelligence.saveAppointment({id:made.id,opportunityId:opp.id,title:'Reunião com ata',scheduledDate:'2026-11-10',scheduledTime:'10:00'},actor);
  assert.equal(updated.status,'DONE');
  assert.equal(intelligence.getFollowups({asOf:'2026-11-15'}).overdue.length,0);
 }finally{h.db.close();}
});

test('P0: converted lead contact details are read from the canonical customer registry',()=>{
 const h=setup();
 try{
  const {crm,registry}=h;
  const lead=crm.saveLead({name:'Nome antigo',email:'antigo@example.test',phone:'11999990000',document:'12345678000155'},actor);
  const customer=crm.convertLead(lead.id,{},actor);
  registry.saveCustomer({id:customer.id,name:'Nome atualizado',email:'novo@example.test',phone:'11988880000',document:'12345678000166'},actor);
  const viewed=crm.getLead(lead.id);
  assert.equal(viewed.name,'Nome atualizado');
  assert.equal(viewed.email,'novo@example.test');
  assert.equal(viewed.phone,'11988880000');
  assert.equal(viewed.document,'12345678000166');
  assert.equal(crm.listLeads({query:'Nome atualizado'}).length,1);
  assert.throws(()=>crm.saveLead({id:lead.id,name:'Alteração no CRM'},actor),/cliente|canônico|convertido/i);
 }finally{h.db.close();}
});
