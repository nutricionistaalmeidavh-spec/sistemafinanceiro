import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const {createCrmService}=require('../electron/services/crm-service.cjs');
const {createCrmIntelligenceService}=require('../electron/services/crm-intelligence-service.cjs');
const {createFinanceService}=require('../electron/services/finance-service.cjs');
const {createRegistryService}=require('../electron/services/registry-service.cjs');
const actor={id:'local-admin',role:'ADMIN'};
const now=()=> '2026-11-13T16:00:00.000Z';
const directory=new URL('../database/migrations/',import.meta.url);
const files=fs.readdirSync(directory).filter(f=>/^\d+.*\.sql$/.test(f)).sort();
function migrate(db,stop=999){
 db.exec('PRAGMA foreign_keys=ON');
 for(const file of files.filter(f=>Number(f.match(/^\d+/)[0])<=stop))db.exec(fs.readFileSync(new URL(file,directory),'utf8'));
}
function setup(){
 const db=new DatabaseSync(':memory:');migrate(db);
 db.prepare("INSERT INTO users(id,login,name,role,password_hash,password_salt,active,created_at,updated_at) VALUES ('local-admin','admin','Admin','ADMIN','x','x',1,'now','now'),('seller-1','seller1','Vendedor Um','MANAGER','x','x',1,'now','now'),('seller-2','seller2','Vendedor Dois','MANAGER','x','x',1,'now','now')").run();
 const finance=createFinanceService({db,now});
 const registry=createRegistryService({db,now});
 const crm=createCrmService({db,finance,registry,now});
 const intelligence=createCrmIntelligenceService({db,crm,now});
 return {db,finance,registry,crm,intelligence};
}
function deal(crm,name,amountCents,ownerId='seller-1'){
 const lead=crm.saveLead({name},actor);
 return crm.saveOpportunity({leadId:lead.id,title:'Negócio '+name,amountCents,ownerId},actor);
}

test('P2 migration backfills old opportunities into the default canonical pipeline',()=>{
 const db=new DatabaseSync(':memory:');migrate(db,11);
 db.exec("INSERT INTO crm_leads(id,name,created_at,updated_at) VALUES ('legacy-lead','Legado','2026-01-01','2026-01-01')");
 db.exec("INSERT INTO crm_opportunities(id,lead_id,title,amount_cents,stage,created_at,updated_at) VALUES ('legacy-deal','legacy-lead','Negócio legado',12500,'QUALIFIED','2026-01-01','2026-01-01')");
 db.exec(fs.readFileSync(new URL('012_crm_intelligence.sql',directory),'utf8'));
 const row=db.prepare('SELECT pipeline_id,stage_id,stage FROM crm_opportunities WHERE id=?').get('legacy-deal');
 assert.equal(row.pipeline_id,'crm-pipeline-default');
 assert.equal(row.stage_id,'crm-stage-qualified');
 assert.equal(row.stage,'QUALIFIED');
 assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
 db.close();
});

test('P2 allows new pipelines, custom stages and moving an opportunity without financial writes',()=>{
 const {db,crm,intelligence}=setup();
 const pipelines=intelligence.listPipelines();
 assert.equal(pipelines.length,1);
 assert.equal(pipelines[0].stages.length,5);
 const made=intelligence.savePipeline({name:'Consultoria'},actor);
 const custom=intelligence.savePipelineStage({pipelineId:made.id,name:'Diagnóstico',legacyStage:'QUALIFIED',probabilityBps:3500},actor);
 assert.equal(intelligence.listPipelines().find(p=>p.id===made.id).stages.length,6);
 const d=deal(crm,'Construtora',80000);
 const assigned=intelligence.assignPipeline(d.id,made.id,actor);
 assert.equal(assigned.pipelineId,made.id);
 const moved=intelligence.moveToStage(d.id,custom.id,actor);
 assert.equal(moved.stageId,custom.id);
 assert.equal(moved.stage,'QUALIFIED');
 assert.equal(intelligence.listStageMovements(d.id).at(-1).stageId,custom.id);
 assert.equal(db.prepare('SELECT COUNT(*) count FROM financial_entries').get().count,0);
 assert.throws(()=>intelligence.savePipelineStage({pipelineId:made.id,name:'Ruim',legacyStage:'WON',probabilityBps:5500},actor),/100|ganh|probabilid/i);
 db.close();
});

test('P2 goal progress counts only won deals closed in month and is scoped to seller',()=>{
 const {db,crm,intelligence}=setup();
 const won=deal(crm,'Ganhou',100000);
 const lost=deal(crm,'Perdeu',90000);
 const other=deal(crm,'Outro vendedor',30000,'seller-2');
 crm.moveOpportunity(won.id,'WON',actor);
 crm.moveOpportunity(lost.id,'LOST',actor,{lossReason:'Preço'});
 crm.moveOpportunity(other.id,'WON',actor);
 intelligence.saveGoal({ownerId:'seller-1',month:'2026-11',targetCents:150000},actor);
 const progress=intelligence.getGoalProgress({month:'2026-11',ownerId:'seller-1'});
 assert.equal(progress[0].targetCents,150000);
 assert.equal(progress[0].actualCents,100000);
 assert.equal(progress[0].achievementBps,6667);
 assert.equal(db.prepare('SELECT COUNT(*) count FROM financial_entries').get().count,0);
 db.close();
});

test('P2 forecast is weighted in integer cents, requires planned close dates and excludes closed deals',()=>{
 const {db,crm,intelligence}=setup();
 const open=deal(crm,'Probabilidade',10001);
 const closed=deal(crm,'Ganho não previsto',30000);
 intelligence.setExpectedClose(open.id,'2026-12-18',actor);
 crm.moveOpportunity(open.id,'QUALIFIED',actor);
 crm.moveOpportunity(closed.id,'WON',actor);
 const result=intelligence.getForecast({from:'2026-12-01',to:'2026-12-31'});
 assert.equal(result.openCents,10001);
 assert.equal(result.weightedCents,Math.round(10001*2500/10000));
 assert.equal(result.months.length,1);
 assert.equal(result.months[0].weightedCents,Math.round(10001*2500/10000));
 assert.equal(db.prepare('SELECT COUNT(*) count FROM financial_entries').get().count,0);
 db.close();
});

test('P2 conversion rates and lost reasons use distinct commercial events',()=>{
 const {db,crm,intelligence}=setup();
 const a=deal(crm,'Conversão',50000);
 const b=deal(crm,'Perda',10000);
 const c=deal(crm,'Em aberto',20000);
 crm.moveOpportunity(a.id,'WON',actor);
 crm.moveOpportunity(b.id,'LOST',actor,{lossReason:'Sem orçamento'});
 assert.equal(crm.getOpportunity(c.id).stage,'NEW');
 const report=intelligence.getSalesReport({from:'2026-11-01',to:'2026-11-30',ownerId:'seller-1'});
 assert.equal(report.wonCount,1);assert.equal(report.lostCount,1);
 assert.equal(report.winRateBps,5000);
 assert.equal(report.openPipelineCents,20000);
 assert.deepEqual(report.lossReasons,[{reason:'Sem orçamento',count:1,amountCents:10000}]);
 db.close();
});

test('P2 appointments, follow-ups and agenda preserve tasks without touching ledger',()=>{
 const {db,crm,intelligence}=setup();
 const d=deal(crm,'Retorno',20000);
 const task=crm.saveTask({opportunityId:d.id,title:'Enviar proposta',dueAt:'2026-11-12'},actor);
 const appointment=intelligence.saveAppointment({opportunityId:d.id,title:'Reunião comercial',scheduledDate:'2026-11-14',scheduledTime:'09:30',durationMinutes:45},actor);
 const agenda=intelligence.getAgenda({from:'2026-11-12',to:'2026-11-15'});
 assert.equal(agenda.length,2);
 assert.equal(intelligence.getFollowups({asOf:'2026-11-13'}).overdue.length,1);
 assert.equal(intelligence.getFollowups({asOf:'2026-11-14'}).today.length,1);
 assert.equal(intelligence.setAppointmentStatus(appointment.id,'DONE',actor).status,'DONE');
 assert.equal(intelligence.getFollowups({asOf:'2026-11-14'}).today.length,0);
 assert.equal(db.prepare('SELECT done_at FROM crm_tasks WHERE id=?').get(task.id).done_at,null);
 assert.equal(db.prepare('SELECT COUNT(*) count FROM financial_entries').get().count,0);
 db.close();
});

test('P2 CSV report escapes formulas and cells and does not create financial entries',()=>{
 const {db,crm,intelligence}=setup();
 const d=deal(crm,'=Malicious Company',9000);
 crm.moveOpportunity(d.id,'WON',actor);
 const result=intelligence.exportSalesCsv({from:'2026-11-01',to:'2026-11-30'});
 assert.ok(result.filename.endsWith('.csv'));
 assert.match(result.data,/^\uFEFF/);
 assert.match(result.data,/'=Malicious Company/);
 assert.match(result.data,/Negócio/);
 assert.equal(db.prepare('SELECT COUNT(*) count FROM financial_entries').get().count,0);
 db.close();
});

test('P2 legacy stage moves remain synchronized with the canonical custom stage and the FK guard',()=>{
 const {db,crm}=setup();
 const d=deal(crm,'Compatibilidade',15000);
 assert.equal(crm.getOpportunity(d.id).stageId,'crm-stage-new');
 const moved=crm.moveOpportunity(d.id,'QUALIFIED',actor);
 assert.equal(moved.stageId,'crm-stage-qualified');
 assert.equal(moved.pipelineId,'crm-pipeline-default');
 assert.throws(()=>db.prepare("UPDATE crm_opportunities SET stage='NEW' WHERE id=?").run(d.id),/mismatch/i);
 assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
 db.close();
});

test('P2 disallows moving invoiced opportunities back into negotiation',()=>{
 const {db,crm,intelligence}=setup();
 const d=deal(crm,'Venda faturada',12000);
 const quote=crm.createQuote({opportunityId:d.id,items:[{description:'Serviço',quantity:1,unitPriceCents:12000}]},actor);
 crm.moveOpportunity(d.id,'WON',actor);
 crm.convertLead(d.leadId,{},actor);
 const preview=crm.previewReceivables({quoteId:quote.id,installments:1,firstDueAt:'2026-12-10'});
 crm.confirmReceivables({quoteId:quote.id,installments:1,firstDueAt:'2026-12-10',expectedTotalCents:preview.totalCents},actor);
 assert.throws(()=>intelligence.moveToStage(d.id,'crm-stage-qualified',actor),/financeira/i);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM financial_entries').get().n,1);
 db.close();
});
