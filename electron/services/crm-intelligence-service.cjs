'use strict';
const {randomUUID}=require('node:crypto');
const {writeAudit}=require('./audit.cjs');

const DEFAULT_STAGES=Object.freeze([
 {name:'Novo contato',legacyStage:'NEW',probabilityBps:1000},
 {name:'Qualificado',legacyStage:'QUALIFIED',probabilityBps:2500},
 {name:'Proposta',legacyStage:'PROPOSAL',probabilityBps:6500},
 {name:'Ganho',legacyStage:'WON',probabilityBps:10000},
 {name:'Perdido',legacyStage:'LOST',probabilityBps:0},
]);
const STAGES=new Set(['NEW','QUALIFIED','PROPOSAL','WON','LOST']);
const APPOINTMENT_KINDS=new Set(['MEETING','CALL','FOLLOWUP','OTHER']);
const APPOINTMENT_STATUSES=new Set(['PLANNED','DONE','CANCELLED']);

function required(value,name,max=240){
 const result=String(value??'').trim();
 if(!result||result.length>max)throw new Error(name+' obrigatório (máximo '+max+' caracteres)');
 return result;
}
function optional(value,max=2000){
 const text=String(value??'').trim();
 if(text.length>max)throw new Error('Tamanho máximo excedido');
 return text||null;
}
function safeAmount(value,name,canBeZero=false){
 if(!Number.isSafeInteger(value)||value<(canBeZero?0:1))throw new Error(name+' deve ser um valor positivo em centavos');
 return value;
}
function dateOnly(value){
 const date=String(value||'');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw new Error('Data inválida');
 return date;
}
function monthOnly(value){
 const month=String(value||'');
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new Error('Mês inválido (AAAA-MM)');
 return month;
}
function timeOnly(value){
 const time=String(value||'');
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw new Error('Horário inválido');
 return time;
}
function transaction(db,fn){
 db.exec('BEGIN IMMEDIATE');
 try{const result=fn();db.exec('COMMIT');return result;}
 catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
}
function reportRange(input){
 const from=dateOnly(input?.from),to=dateOnly(input?.to);
 if(to<from)throw new Error('Data inicial posterior à final');
 const duration=(Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/(86400000);
 if(duration>3652)throw new Error('O intervalo máximo de relatórios é de dez anos');
 return {from,to};
}
function assertProbability(legacyStage,probabilityBps){
 const stage=String(legacyStage||'').toUpperCase();
 if(!STAGES.has(stage))throw new Error('Etapa comercial inválida');
 if(!Number.isSafeInteger(probabilityBps)||probabilityBps<0||probabilityBps>10000)throw new Error('Probabilidade inválida');
 if((stage==='WON'&&probabilityBps!==10000)||(stage==='LOST'&&probabilityBps!==0))throw new Error('A probabilidade de ganho é 100% e de perda é 0%');
 return stage;
}
function safeCsv(value){
 let cell=String(value??'');
 // Leading formulas and control whitespace can execute in spreadsheet software.
 if(/^[\s]*[=+\-@]/.test(cell))cell="'"+cell;
 return '"'+cell.replace(/"/g,'""')+'"';
}
function createCrmIntelligenceService({db,crm,now=()=>new Date().toISOString(),idFactory=(type)=>type+'-'+randomUUID()}={}){
 if(!db||!crm)throw new TypeError('SQLite e CRM obrigatórios');
 const at=()=>String(now());
 const audit=(action,entity,id,actor,context={})=>writeAudit(db,{action,entity,entityId:id,actor,context},at);
 const get=(table,id,label)=>{
  const row=db.prepare('SELECT * FROM '+table+' WHERE id=?').get(String(id));
  if(!row)throw new Error((label||table)+' não encontrado');
  return row;
 };
 const mapStage=row=>({id:row.id,pipelineId:row.pipeline_id,name:row.name,legacyStage:row.legacy_stage,probabilityBps:row.probability_bps,position:row.position,active:!!row.active});
 const mapPipeline=row=>({
  id:row.id,name:row.name,isDefault:!!row.is_default,active:!!row.active,
  stages:db.prepare('SELECT * FROM crm_pipeline_stages WHERE pipeline_id=? ORDER BY position,id').all(row.id).map(mapStage)
 });
 const mapOpportunity=id=>{
  const row=get('crm_opportunities',id,'Oportunidade');
  return {...crm.getOpportunity(id),pipelineId:row.pipeline_id,stageId:row.stage_id,expectedCloseAt:row.expected_close_at};
 };
 const mapAppointment=row=>({
  id:row.id,opportunityId:row.opportunity_id,title:row.title,scheduledDate:row.scheduled_date,
  scheduledTime:row.scheduled_time,durationMinutes:row.duration_minutes,kind:row.kind,
  status:row.status,ownerId:row.owner_id,notes:row.notes,createdAt:row.created_at,updatedAt:row.updated_at
 });

 function listPipelines({includeInactive=false}={}){
  return db.prepare('SELECT * FROM crm_pipelines'+(includeInactive?'':' WHERE active=1')+' ORDER BY is_default DESC,name COLLATE NOCASE,id').all().map(mapPipeline);
 }
 function listOwners(){
  return db.prepare('SELECT id,name,role FROM users WHERE active=1 ORDER BY name COLLATE NOCASE,id').all();
 }
 function savePipeline(input={},actor=null){
  const name=required(input.name,'Nome do funil',120);
  if(input.id){
   const previous=get('crm_pipelines',input.id,'Funil');
   if(input.active===false){
    if(previous.is_default)throw new Error('O funil principal não pode ser desativado');
    if(db.prepare('SELECT 1 FROM crm_opportunities WHERE pipeline_id=? LIMIT 1').get(previous.id))
     throw new Error('Funil com oportunidades não pode ser desativado');
   }
   db.prepare('UPDATE crm_pipelines SET name=?,active=?,updated_at=? WHERE id=?')
    .run(name,input.active===false?0:1,at(),previous.id);
   audit('crm.pipeline.update','crm-pipeline',previous.id,actor,{name});
   return mapPipeline(get('crm_pipelines',previous.id));
  }
  const id=idFactory('crm-pipeline');
  return transaction(db,()=>{
   db.prepare('INSERT INTO crm_pipelines(id,name,is_default,active,created_at,updated_at) VALUES (?,?,0,1,?,?)').run(id,name,at(),at());
   const stmt=db.prepare('INSERT INTO crm_pipeline_stages(id,pipeline_id,name,legacy_stage,probability_bps,position,active,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?)');
   DEFAULT_STAGES.forEach((stage,i)=>stmt.run(idFactory('crm-stage'),id,stage.name,stage.legacyStage,stage.probabilityBps,i,at(),at()));
   audit('crm.pipeline.create','crm-pipeline',id,actor,{name});
   return mapPipeline(get('crm_pipelines',id));
  });
 }
 function setDefaultPipeline(pipelineId,actor=null){
  const pipeline=get('crm_pipelines',pipelineId,'Funil');
  if(!pipeline.active)throw new Error('Funil inativo');
  return transaction(db,()=>{
   db.prepare('UPDATE crm_pipelines SET is_default=0,updated_at=? WHERE is_default=1').run(at());
   db.prepare('UPDATE crm_pipelines SET is_default=1,updated_at=? WHERE id=?').run(at(),pipelineId);
   audit('crm.pipeline.default','crm-pipeline',pipelineId,actor);
   return mapPipeline(get('crm_pipelines',pipelineId));
  });
 }
 function savePipelineStage(input={},actor=null){
  const name=required(input.name,'Nome da etapa',100);
  const pipelineId=required(input.pipelineId,'Funil');
  const pipeline=get('crm_pipelines',pipelineId,'Funil');
  if(!pipeline.active)throw new Error('Funil inativo');
  if(input.id){
   const previous=get('crm_pipeline_stages',input.id,'Etapa');
   if(previous.pipeline_id!==pipelineId)throw new Error('Etapa pertence a outro funil');
   const newProbability=input.probabilityBps??previous.probability_bps;
   assertProbability(previous.legacy_stage,newProbability);
   if(input.active===false&&previous.active&&db.prepare('SELECT 1 FROM crm_opportunities WHERE stage_id=? LIMIT 1').get(previous.id))
    throw new Error('Etapa em uso não pode ser desativada');
   if(input.active===false&&['WON','LOST'].includes(previous.legacy_stage))
    throw new Error('Etapa de ganho ou perda não pode ser desativada');
   const position=input.position??previous.position;
   if(!Number.isSafeInteger(position)||position<0||position>1000)throw new Error('Ordem da etapa inválida');
   db.prepare('UPDATE crm_pipeline_stages SET name=?,probability_bps=?,position=?,active=?,updated_at=? WHERE id=?')
    .run(name,newProbability,position,input.active===false?0:1,at(),previous.id);
   audit('crm.stage.update','crm-stage',previous.id,actor,{name});
   return mapStage(get('crm_pipeline_stages',previous.id));
  }
  const stage=String(input.legacyStage||'QUALIFIED').toUpperCase();
  if(!['NEW','QUALIFIED','PROPOSAL'].includes(stage))throw new Error('Somente etapas abertas adicionais são permitidas');
  const probabilityBps=input.probabilityBps??2500;
  assertProbability(stage,probabilityBps);
  const max=db.prepare('SELECT COALESCE(MAX(position),-1)+1 AS p FROM crm_pipeline_stages WHERE pipeline_id=?').get(pipelineId);
  const position=input.position??max.p;
  if(!Number.isSafeInteger(position)||position<0||position>1000)throw new Error('Ordem da etapa inválida');
  const id=idFactory('crm-stage');
  db.prepare('INSERT INTO crm_pipeline_stages(id,pipeline_id,name,legacy_stage,probability_bps,position,active,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?)')
   .run(id,pipelineId,name,stage,probabilityBps,position,at(),at());
  audit('crm.stage.create','crm-stage',id,actor,{pipelineId,name});
  return mapStage(get('crm_pipeline_stages',id));
 }
 function assignPipeline(opportunityId,pipelineId,actor=null){
  const opportunity=get('crm_opportunities',opportunityId,'Oportunidade');
  const pipeline=get('crm_pipelines',pipelineId,'Funil');
  if(!pipeline.active)throw new Error('Funil inativo');
  const target=db.prepare('SELECT * FROM crm_pipeline_stages WHERE pipeline_id=? AND active=1 AND legacy_stage=? ORDER BY position,id LIMIT 1')
   .get(pipelineId,opportunity.stage);
  if(!target)throw new Error('O funil não possui uma etapa equivalente');
  if(opportunity.pipeline_id===pipelineId)return mapOpportunity(opportunityId);
  return transaction(db,()=>{
   db.prepare('UPDATE crm_opportunities SET pipeline_id=?,stage_id=?,updated_at=? WHERE id=?')
    .run(pipelineId,target.id,at(),opportunityId);
   audit('crm.opportunity.pipeline','crm-opportunity',opportunityId,actor,{from:opportunity.pipeline_id,to:pipelineId});
   return mapOpportunity(opportunityId);
  });
 }
 function moveToStage(opportunityId,stageId,actor=null,{lossReason=''}={}){
  const old=get('crm_opportunities',opportunityId,'Oportunidade');
  const next=get('crm_pipeline_stages',stageId,'Etapa');
  if(!next.active||next.pipeline_id!==old.pipeline_id)throw new Error('Etapa indisponível para este funil');
  if(old.stage_id===stageId)return mapOpportunity(opportunityId);
  if(next.legacy_stage!=='WON'&&db.prepare('SELECT 1 FROM crm_billing_links WHERE opportunity_id=? LIMIT 1').get(opportunityId))
   throw new Error('Recebíveis existentes exigem revisão financeira antes de reabrir venda');
  const reason=next.legacy_stage==='LOST'?required(lossReason,'Motivo da perda',800):null;
  return transaction(db,()=>{
   db.prepare('UPDATE crm_opportunities SET stage_id=?,stage=?,loss_reason=?,closed_at=?,updated_at=? WHERE id=?')
    .run(stageId,next.legacy_stage,reason,['WON','LOST'].includes(next.legacy_stage)?at():null,at(),opportunityId);
   db.prepare('INSERT INTO crm_stage_history(id,opportunity_id,from_stage,to_stage,actor_id,changed_at,from_custom_stage_id,to_custom_stage_id) VALUES (?,?,?,?,?,?,?,?)')
    .run(idFactory('crm-stage-history'),opportunityId,old.stage,next.legacy_stage,actor?.id||null,at(),old.stage_id,stageId);
   audit('crm.opportunity.move','crm-opportunity',opportunityId,actor,{from:old.stage_id,to:stageId,fromLegacy:old.stage,toLegacy:next.legacy_stage});
   return mapOpportunity(opportunityId);
  });
 }
 function listStageMovements(opportunityId){
  get('crm_opportunities',opportunityId,'Oportunidade');
  return db.prepare('SELECT * FROM crm_stage_history WHERE opportunity_id=? ORDER BY changed_at,rowid').all(opportunityId)
   .map(row=>({id:row.id,fromStageId:row.from_custom_stage_id,stageId:row.to_custom_stage_id,fromStage:row.from_stage,toStage:row.to_stage,changedAt:row.changed_at}));
 }
 function setExpectedClose(opportunityId,expectedCloseAt,actor=null){
  get('crm_opportunities',opportunityId,'Oportunidade');
  const date=expectedCloseAt?dateOnly(expectedCloseAt):null;
  db.prepare('UPDATE crm_opportunities SET expected_close_at=?,updated_at=? WHERE id=?').run(date,at(),opportunityId);
  audit('crm.opportunity.expected_close','crm-opportunity',opportunityId,actor,{date});
  return mapOpportunity(opportunityId);
 }
 function assignOwner(opportunityId,ownerId,actor=null){
  get('crm_opportunities',opportunityId,'Oportunidade');
  if(ownerId){
   const user=get('users',ownerId,'Vendedor');
   if(!user.active)throw new Error('Vendedor inativo');
  }
  db.prepare('UPDATE crm_opportunities SET owner_id=?,updated_at=? WHERE id=?').run(ownerId||null,at(),opportunityId);
  audit('crm.opportunity.owner','crm-opportunity',opportunityId,actor,{ownerId:ownerId||null});
  return mapOpportunity(opportunityId);
 }

 function saveGoal(input={},actor=null){
  const ownerId=required(input.ownerId,'Responsável');
  const user=get('users',ownerId,'Vendedor');
  if(!user.active)throw new Error('Vendedor inativo');
  const month=monthOnly(input.month);
  const target=safeAmount(input.targetCents,'Meta');
  const found=db.prepare('SELECT id FROM crm_sales_goals WHERE owner_id=? AND month=?').get(ownerId,month);
  if(found)db.prepare('UPDATE crm_sales_goals SET target_cents=?,updated_at=? WHERE id=?').run(target,at(),found.id);
  else db.prepare('INSERT INTO crm_sales_goals(id,owner_id,month,target_cents,created_at,updated_at) VALUES (?,?,?,?,?,?)')
   .run(idFactory('crm-goal'),ownerId,month,target,at(),at());
  audit('crm.goal.save','crm-goal',found?.id||ownerId+':'+month,actor,{ownerId,month,targetCents:target});
  return getGoalProgress({month,ownerId})[0];
 }
 function getGoalProgress({month=at().slice(0,7),ownerId=''}={}){
  const period=monthOnly(month);
  const rows=db.prepare("SELECT g.id,g.owner_id,g.month,g.target_cents,u.name owner_name FROM crm_sales_goals g JOIN users u ON u.id=g.owner_id WHERE g.month=? AND (?='' OR g.owner_id=?) ORDER BY u.name COLLATE NOCASE").all(period,ownerId,ownerId);
  return rows.map(row=>{
   const actual=Number(db.prepare("SELECT COALESCE(SUM(amount_cents),0) total FROM crm_opportunities WHERE stage='WON' AND owner_id=? AND SUBSTR(closed_at,1,7)=?").get(row.owner_id,period).total||0);
   return {id:row.id,ownerId:row.owner_id,ownerName:row.owner_name,month:row.month,targetCents:row.target_cents,actualCents:actual,
    achievementBps:Math.round(actual*10000/row.target_cents),remainingCents:Math.max(0,row.target_cents-actual)};
  });
 }

 function saveAppointment(input={},actor=null){
  const opportunityId=required(input.opportunityId,'Oportunidade');
  get('crm_opportunities',opportunityId,'Oportunidade');
  const title=required(input.title,'Compromisso');
  const scheduledDate=dateOnly(input.scheduledDate),scheduledTime=timeOnly(input.scheduledTime);
  const durationMinutes=Number(input.durationMinutes??30);
  if(!Number.isSafeInteger(durationMinutes)||durationMinutes<5||durationMinutes>1440)throw new Error('Duração inválida');
  const kind=String(input.kind||'MEETING').toUpperCase();
  if(!APPOINTMENT_KINDS.has(kind))throw new Error('Tipo de compromisso inválido');
  const ownerId=input.ownerId||null,notes=optional(input.notes,3000);
  if(ownerId){const user=get('users',ownerId,'Responsável');if(!user.active)throw new Error('Responsável inativo');}
  if(input.id){
   const old=get('crm_appointments',input.id,'Compromisso');
   if(old.opportunity_id!==opportunityId)throw new Error('Não é possível transferir compromisso para outra oportunidade');
   db.prepare('UPDATE crm_appointments SET title=?,scheduled_date=?,scheduled_time=?,duration_minutes=?,kind=?,owner_id=?,notes=?,status=?,updated_at=? WHERE id=?')
    .run(title,scheduledDate,scheduledTime,durationMinutes,kind,ownerId,notes,'PLANNED',at(),old.id);
   audit('crm.appointment.update','crm-appointment',old.id,actor);
   return mapAppointment(get('crm_appointments',old.id));
  }
  const id=idFactory('crm-appointment');
  db.prepare("INSERT INTO crm_appointments(id,opportunity_id,title,scheduled_date,scheduled_time,duration_minutes,kind,status,owner_id,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'PLANNED',?,?,?,?)")
   .run(id,opportunityId,title,scheduledDate,scheduledTime,durationMinutes,kind,ownerId,notes,at(),at());
  audit('crm.appointment.create','crm-appointment',id,actor,{opportunityId});
  return mapAppointment(get('crm_appointments',id));
 }
 function setAppointmentStatus(appointmentId,status,actor=null){
  const old=get('crm_appointments',appointmentId,'Compromisso');
  const next=String(status||'').toUpperCase();
  if(!APPOINTMENT_STATUSES.has(next))throw new Error('Situação do compromisso inválida');
  if(old.status===next)return mapAppointment(old);
  db.prepare('UPDATE crm_appointments SET status=?,updated_at=? WHERE id=?').run(next,at(),appointmentId);
  audit('crm.appointment.status','crm-appointment',appointmentId,actor,{from:old.status,to:next});
  return mapAppointment(get('crm_appointments',appointmentId));
 }
 function listAppointments({from='',to='',opportunityId='',ownerId=''}={}){
  if(from)dateOnly(from);if(to)dateOnly(to);if(from&&to&&from>to)throw new Error('Datas invertidas');
  return db.prepare("SELECT * FROM crm_appointments WHERE (?='' OR scheduled_date>=?) AND (?='' OR scheduled_date<=?) AND (?='' OR opportunity_id=?) AND (?='' OR owner_id=?) ORDER BY scheduled_date,scheduled_time,id")
   .all(from,from,to,to,opportunityId,opportunityId,ownerId,ownerId).map(mapAppointment);
 }
 function getAgenda(input={}){
  const {from,to}=reportRange(input);
  const ownerId=String(input.ownerId||'');
  const tasks=db.prepare("SELECT * FROM crm_tasks WHERE due_at>=? AND due_at<=? AND (?='' OR owner_id=?) ORDER BY due_at,id").all(from,to,ownerId,ownerId)
   .map(row=>({id:row.id,type:'TASK',opportunityId:row.opportunity_id,title:row.title,date:row.due_at,time:null,status:row.done_at?'DONE':'PLANNED',ownerId:row.owner_id}));
  const appts=listAppointments({from,to,ownerId}).map(item=>({id:item.id,type:'APPOINTMENT',opportunityId:item.opportunityId,title:item.title,date:item.scheduledDate,time:item.scheduledTime,status:item.status,ownerId:item.ownerId,kind:item.kind}));
  return [...tasks,...appts].sort((a,b)=>(a.date+(a.time||'')).localeCompare(b.date+(b.time||''))||a.id.localeCompare(b.id));
 }
 function getFollowups({asOf=at().slice(0,10),ownerId=''}={}){
  const date=dateOnly(asOf);
  const overdue=[],today=[],upcoming=[];
  const tasks=db.prepare("SELECT * FROM crm_tasks WHERE done_at IS NULL AND due_at IS NOT NULL AND (?='' OR owner_id=?)").all(ownerId,ownerId);
  const appointments=db.prepare("SELECT * FROM crm_appointments WHERE status='PLANNED' AND (?='' OR owner_id=?)").all(ownerId,ownerId);
  const assign=(row)=>{
   if(row.date<date)overdue.push(row);
   else if(row.date===date)today.push(row);
   else upcoming.push(row);
  };
  tasks.forEach(t=>assign({id:t.id,type:'TASK',opportunityId:t.opportunity_id,title:t.title,date:t.due_at,time:null,ownerId:t.owner_id}));
  appointments.forEach(a=>assign({id:a.id,type:'APPOINTMENT',opportunityId:a.opportunity_id,title:a.title,date:a.scheduled_date,time:a.scheduled_time,ownerId:a.owner_id}));
  for(const group of [overdue,today,upcoming])group.sort((a,b)=>a.date.localeCompare(b.date)||(a.time||'').localeCompare(b.time||''));
  return {overdue,today,upcoming};
 }

 function opportunityQuery({ownerId='',pipelineId=''}={}){
  const where=["(?='' OR o.owner_id=?)","(?='' OR o.pipeline_id=?)"];
  const params=[ownerId,ownerId,pipelineId,pipelineId];
  return {where:where.join(' AND '),params};
 }
 function getSalesReport(input={}){
  const {from,to}=reportRange(input);
  const {where,params}=opportunityQuery(input);
  const deals=db.prepare('SELECT o.* FROM crm_opportunities o WHERE '+where).all(...params);
  const created=deals.filter(o=>String(o.created_at||'').slice(0,10)>=from&&String(o.created_at||'').slice(0,10)<=to);
  const closed=deals.filter(o=>['WON','LOST'].includes(o.stage)&&o.closed_at?.slice(0,10)>=from&&o.closed_at?.slice(0,10)<=to);
  const won=closed.filter(o=>o.stage==='WON'),lost=closed.filter(o=>o.stage==='LOST');
  const open=deals.filter(o=>!['WON','LOST'].includes(o.stage));
  const reasons=new Map();
  lost.forEach(o=>{
   const reason=o.loss_reason||'Não informado';
   const previous=reasons.get(reason)||{reason,count:0,amountCents:0};
   previous.count++;
   previous.amountCents+=Number(o.amount_cents);
   reasons.set(reason,previous);
  });
  const filters=["l.created_at>=?","l.created_at<?"];
  const endNext=new Date(Date.parse(to+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  const leadParams=[from,endNext];
  if(input.ownerId){filters.push('l.owner_id=?');leadParams.push(String(input.ownerId));}
  const leads=db.prepare('SELECT status FROM crm_leads l WHERE '+filters.join(' AND ')).all(...leadParams);
  const sum=rows=>rows.reduce((acc,o)=>acc+Number(o.amount_cents),0);
  return {from,to,ownerId:input.ownerId||null,pipelineId:input.pipelineId||null,
   leadCount:leads.length,leadConvertedCount:leads.filter(l=>l.status==='CONVERTED').length,
   createdCount:created.length,wonCount:won.length,lostCount:lost.length,
   winRateBps:closed.length?Math.round(won.length*10000/closed.length):0,
   leadConversionBps:leads.length?Math.round(leads.filter(l=>l.status==='CONVERTED').length*10000/leads.length):0,
   wonCents:sum(won),lostCents:sum(lost),openPipelineCents:sum(open),
   lossReasons:[...reasons.values()].sort((a,b)=>b.count-a.count||a.reason.localeCompare(b.reason))
  };
 }
 function getForecast(input={}){
  const {from,to}=reportRange(input);
  const {where,params}=opportunityQuery(input);
  const deals=db.prepare('SELECT o.*,s.probability_bps FROM crm_opportunities o LEFT JOIN crm_pipeline_stages s ON s.id=o.stage_id WHERE '+where+" AND o.stage NOT IN ('WON','LOST')").all(...params);
  const plan=deals.filter(d=>d.expected_close_at>=from&&d.expected_close_at<=to);
  const unscheduled=deals.filter(d=>!d.expected_close_at);
  const months=new Map();
  let weightedCents=0,openCents=0;
  for(const d of plan){
   const weight=Math.round(Number(d.amount_cents)*Number(d.probability_bps||0)/10000);
   if(!Number.isSafeInteger(weight))throw new Error('Previsão excede intervalo monetário');
   const month=d.expected_close_at.slice(0,7);
   const old=months.get(month)||{month,openCents:0,weightedCents:0,count:0};
   old.openCents+=Number(d.amount_cents);old.weightedCents+=weight;old.count++;
   months.set(month,old);openCents+=Number(d.amount_cents);weightedCents+=weight;
  }
  return {from,to,openCents,weightedCents,unscheduledCents:unscheduled.reduce((s,d)=>s+Number(d.amount_cents),0),
   months:[...months.values()].sort((a,b)=>a.month.localeCompare(b.month))};
 }
 function exportSalesCsv(input={}){
  const {from,to}=reportRange(input);
  const {where,params}=opportunityQuery(input);
  const rows=db.prepare("SELECT o.*,COALESCE(l.name,c.name,'') AS customer_name,COALESCE(u.name,'') owner_name,COALESCE(p.name,'') pipeline_name,COALESCE(s.name,'') stage_name FROM crm_opportunities o LEFT JOIN crm_leads l ON l.id=o.lead_id LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN users u ON u.id=o.owner_id LEFT JOIN crm_pipelines p ON p.id=o.pipeline_id LEFT JOIN crm_pipeline_stages s ON s.id=o.stage_id WHERE "+where+" AND SUBSTR(o.created_at,1,10)<=? ORDER BY o.created_at,o.id").all(...params,to);
  const columns=['Oportunidade','Cliente/lead','Vendedor','Funil','Etapa','Situação','Valor (R$)','Criada em','Fechada em','Previsão de fechamento','Motivo da perda'];
  const line=[columns.map(safeCsv).join(';')];
  for(const row of rows){
   if(row.created_at?.slice(0,10)<from)continue;
   const cells=[row.title,row.customer_name,row.owner_name,row.pipeline_name,row.stage_name,row.stage,(Number(row.amount_cents)/100).toFixed(2),
    row.created_at,row.closed_at||'',row.expected_close_at||'',row.loss_reason||''];
   line.push(cells.map(safeCsv).join(';'));
  }
  return {filename:'artisys-crm-vendas-'+from+'-a-'+to+'.csv',mime:'text/csv;charset=utf-8',data:'\uFEFF'+line.join('\r\n')+'\r\n'};
 }
 return {listPipelines,listOwners,savePipeline,setDefaultPipeline,savePipelineStage,
  assignPipeline,moveToStage,listStageMovements,setExpectedClose,assignOwner,
  saveGoal,getGoalProgress,saveAppointment,setAppointmentStatus,listAppointments,getAgenda,getFollowups,
  getSalesReport,getForecast,exportSalesCsv};
}
module.exports={createCrmIntelligenceService};
