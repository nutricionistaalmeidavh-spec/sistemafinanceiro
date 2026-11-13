'use strict';
const {randomUUID}=require('node:crypto');
const {writeAudit}=require('./audit.cjs');

const STAGES=new Set(['NEW','QUALIFIED','PROPOSAL','WON','LOST']);
const ACTIVITY_TYPES=new Set(['CALL','EMAIL','WHATSAPP','MEETING','NOTE']);
const QUOTE_STATUSES=new Set(['DRAFT','SENT','ACCEPTED','REJECTED']);
function required(value,name,max=240){const s=String(value??'').trim();if(!s||s.length>max)throw new Error(name+' obrigatório (máximo '+max+' caracteres)');return s;}
function optional(value,max=2000){const s=String(value??'').trim();if(s.length>max)throw new Error('Texto excede limite de '+max);return s||null;}
function cents(value,allowZero=false){if(!Number.isSafeInteger(value)||value<(allowZero?0:1))throw new Error('valor em centavos inválido');return value;}
function dateOnly(v){const s=String(v||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s)throw new Error('data inválida');return s;}
function nextMonth(date,n){
 const [y,m,d]=date.split('-').map(Number);
 const first=new Date(Date.UTC(y,m-1+n,1));
 const last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
 first.setUTCDate(Math.min(d,last));
 return first.toISOString().slice(0,10);
}
function tx(db,fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){try{db.exec('ROLLBACK');}catch{}throw e;}}
function createCrmService({db,finance,registry,now=()=>new Date().toISOString(),idFactory=(prefix)=>prefix+'-'+randomUUID()}={}){
 if(!db||!finance||!registry)throw new TypeError('db, finance e registry obrigatórios');
 const at=()=>String(now());
 const audit=(action,entity,entityId,actor,context={})=>writeAudit(db,{action,entity,entityId,actor,context},at);
 const lookup=(table,id,label)=>{const row=db.prepare('SELECT * FROM '+table+' WHERE id=?').get(String(id));if(!row)throw new Error((label||table)+' não encontrado');return row;};
 const person=row=>row?{id:row.id,name:row.name,document:row.document,phone:row.phone,email:row.email,source:row.source,status:row.status,customerId:row.customer_id,notes:row.notes,ownerId:row.owner_id,createdAt:row.created_at,updatedAt:row.updated_at}:null;
 const deal=row=>row?{id:row.id,leadId:row.lead_id,customerId:row.customer_id,title:row.title,amountCents:row.amount_cents,stage:row.stage,ownerId:row.owner_id,lossReason:row.loss_reason,closedAt:row.closed_at,createdAt:row.created_at,updatedAt:row.updated_at}:null;
 const task=row=>row?{id:row.id,opportunityId:row.opportunity_id,title:row.title,dueAt:row.due_at,doneAt:row.done_at,done:!!row.done_at,createdAt:row.created_at,updatedAt:row.updated_at}:null;
 const activity=row=>row?{id:row.id,opportunityId:row.opportunity_id,kind:row.kind,note:row.note,occurredAt:row.occurred_at,createdAt:row.created_at}:null;
 const getLead=id=>person(lookup('crm_leads',id,'Lead'));
 function listLeads({query='',status=''}={}){
  const q='%'+String(query).trim().toLowerCase()+'%';
  return db.prepare("SELECT * FROM crm_leads WHERE (LOWER(name) LIKE ? OR LOWER(COALESCE(email,'')) LIKE ? OR LOWER(COALESCE(phone,'')) LIKE ?) AND (?='' OR status=?) ORDER BY updated_at DESC,id DESC").all(q,q,q,status,status).map(person);
 }
 function saveLead(input={},actor=null){
  const name=required(input.name,'Nome');const rawDocument=optional(input.document,40);const document=rawDocument?rawDocument.replace(/\D/g,''):null;
  if(rawDocument&&!document)throw new Error('Documento deve conter dígitos');
  const email=optional(input.email,240)?.toLowerCase()||null;
  const phone=optional(input.phone,45),source=required(input.source||'MANUAL','Origem',64),notes=optional(input.notes);
  const ownerId=input.ownerId||null;
  if(ownerId)lookup('users',ownerId,'Responsável');
  const id=input.id?String(input.id):idFactory('crm-lead'),old=input.id?lookup('crm_leads',id,'Lead'):null;
  if(old?.status==='CONVERTED' && document!==old.document)throw new Error('Documento de lead convertido deve ser atualizado no cliente canônico');
  const existing=db.prepare('SELECT id FROM crm_leads WHERE id<>? AND ((? IS NOT NULL AND document=?) OR (? IS NOT NULL AND LOWER(email)=?)) LIMIT 1').get(id,document,document,email,email);
  if(existing)throw new Error('Lead duplicado: contato já existente');
  if(old) db.prepare('UPDATE crm_leads SET name=?,document=?,phone=?,email=?,source=?,notes=?,owner_id=?,updated_at=? WHERE id=?')
   .run(name,document,phone,email,source,notes,ownerId,at(),id);
  else db.prepare('INSERT INTO crm_leads(id,name,document,phone,email,source,notes,owner_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
   .run(id,name,document,phone,email,source,notes,ownerId,at(),at());
  audit(old?'crm.lead.update':'crm.lead.create','crm-lead',id,actor,{name});
  return getLead(id);
 }
 function getOpportunity(id){return deal(lookup('crm_opportunities',id,'Oportunidade'));}
 function listOpportunities({stage='',query=''}={}){
  const q='%'+String(query).trim().toLowerCase()+'%';
  return db.prepare("SELECT * FROM crm_opportunities WHERE (?='' OR stage=?) AND LOWER(title) LIKE ? ORDER BY updated_at DESC,id DESC").all(stage,stage,q).map(deal);
 }
 function saveOpportunity(input={},actor=null){
  const title=required(input.title,'Título');
  const amountCents=cents(input.amountCents??0,true);
  const id=input.id?String(input.id):idFactory('crm-deal');
  const old=input.id?lookup('crm_opportunities',id,'Oportunidade'):null;
  const leadId=input.leadId??old?.lead_id??null;
  let customerId=input.customerId??old?.customer_id??null;
  if(leadId){const lead=getLead(leadId);if(lead.customerId){if(customerId && customerId!==lead.customerId)throw new Error('Cliente conflitante');customerId=lead.customerId;}}
  if(customerId)lookup('customers',customerId,'Cliente');
  if(!leadId&&!customerId)throw new Error('Lead ou cliente necessário');
  const ownerId=input.ownerId??old?.owner_id??null;
  if(ownerId)lookup('users',ownerId,'Responsável');
  if(old){
   if(db.prepare('SELECT 1 FROM crm_billing_links WHERE opportunity_id=? LIMIT 1').get(id)&&Number(old.amount_cents)!==amountCents)
    throw new Error('Oportunidade faturada não permite alterar valor da venda');
   db.prepare('UPDATE crm_opportunities SET title=?,amount_cents=?,lead_id=?,customer_id=?,owner_id=?,updated_at=? WHERE id=?')
    .run(title,amountCents,leadId,customerId,ownerId,at(),id);
  }else{
   db.prepare('INSERT INTO crm_opportunities(id,title,amount_cents,lead_id,customer_id,owner_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id,title,amountCents,leadId,customerId,ownerId,at(),at());
  }
  audit(old?'crm.opportunity.update':'crm.opportunity.create','crm-opportunity',id,actor,{title});
  return getOpportunity(id);
 }
 function moveOpportunity(id,stage,actor=null,{lossReason=''}={}){
  const to=String(stage).toUpperCase();
  if(!STAGES.has(to))throw new Error('Etapa inválida');
  const current=lookup('crm_opportunities',id,'Oportunidade');
  if(current.stage===to)return deal(current);
  if(db.prepare('SELECT 1 FROM crm_billing_links WHERE opportunity_id=? LIMIT 1').get(id)&&to!=='WON')
   throw new Error('Venda com recebíveis já emitidos exige revisão financeira antes de reabrir');
  const reason=to==='LOST'?required(lossReason,'Motivo da perda',800):null;
  const changed=at();
  db.prepare('UPDATE crm_opportunities SET stage=?,loss_reason=?,closed_at=?,updated_at=? WHERE id=?').run(to,reason,['WON','LOST'].includes(to)?changed:null,changed,id);
  db.prepare('INSERT INTO crm_stage_history(id,opportunity_id,from_stage,to_stage,actor_id,changed_at) VALUES (?,?,?,?,?,?)')
   .run(idFactory('crm-stage'),id,current.stage,to,actor?.id||null,changed);
  audit('crm.opportunity.move','crm-opportunity',id,actor,{from:current.stage,to});
  return getOpportunity(id);
 }
 function listStageHistory(opportunityId){
  return db.prepare('SELECT * FROM crm_stage_history WHERE opportunity_id=? ORDER BY changed_at,id').all(String(opportunityId))
   .map(r=>({id:r.id,opportunityId:r.opportunity_id,fromStage:r.from_stage,toStage:r.to_stage,actorId:r.actor_id,changedAt:r.changed_at}));
 }
 function addActivity(input={},actor=null){
  const opportunityId=required(input.opportunityId,'Oportunidade'),kind=String(input.kind||'NOTE').toUpperCase();
  lookup('crm_opportunities',opportunityId,'Oportunidade');
  if(!ACTIVITY_TYPES.has(kind))throw new Error('Tipo de atividade inválido');
  const note=required(input.note,'Observação',4000),id=idFactory('crm-activity');
  const occurredAt=input.occurredAt?dateOnly(input.occurredAt):at().slice(0,10);
  db.prepare('INSERT INTO crm_activities(id,opportunity_id,kind,note,actor_id,occurred_at,created_at) VALUES (?,?,?,?,?,?,?)')
   .run(id,opportunityId,kind,note,actor?.id||null,occurredAt,at());
  audit('crm.activity.create','crm-activity',id,actor,{opportunityId});
  return activity(lookup('crm_activities',id));
 }
 function listActivities(opportunityId){return db.prepare('SELECT * FROM crm_activities WHERE opportunity_id=? ORDER BY occurred_at DESC,created_at DESC,id DESC').all(String(opportunityId)).map(activity);}
 function saveTask(input={},actor=null){
  const title=required(input.title,'Tarefa'),opportunityId=required(input.opportunityId,'Oportunidade');
  lookup('crm_opportunities',opportunityId,'Oportunidade');
  const dueAt=input.dueAt?dateOnly(input.dueAt):null;
  const id=input.id?String(input.id):idFactory('crm-task');
  const old=input.id?lookup('crm_tasks',id,'Tarefa'):null;
  if(old)db.prepare('UPDATE crm_tasks SET title=?,due_at=?,updated_at=? WHERE id=?').run(title,dueAt,at(),id);
  else db.prepare('INSERT INTO crm_tasks(id,opportunity_id,title,due_at,owner_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(id,opportunityId,title,dueAt,actor?.id||null,at(),at());
  audit(old?'crm.task.update':'crm.task.create','crm-task',id,actor,{opportunityId});
  return task(lookup('crm_tasks',id));
 }
 function setTaskDone(id,done,actor=null){
  lookup('crm_tasks',id,'Tarefa');
  db.prepare('UPDATE crm_tasks SET done_at=?,updated_at=? WHERE id=?').run(done?at():null,at(),id);
  audit('crm.task.status','crm-task',id,actor,{done:!!done});
  return task(lookup('crm_tasks',id));
 }
 function listTasks({opportunityId='',pending=false}={}){
  const sql="SELECT * FROM crm_tasks WHERE (?='' OR opportunity_id=?) AND (?=0 OR done_at IS NULL) ORDER BY CASE WHEN due_at IS NULL THEN 1 ELSE 0 END,due_at,created_at";
  return db.prepare(sql).all(opportunityId,opportunityId,pending?1:0).map(task);
 }
 function convertLead(leadId,{customerId=null}={},actor=null){
  return tx(db,()=>{
   const lead=lookup('crm_leads',leadId,'Lead');
   if(lead.customer_id)return lookup('customers',lead.customer_id,'Cliente');
   let customer=null;
   if(customerId){
    customer=lookup('customers',customerId,'Cliente');
    if(!customer.active)throw new Error('Cliente inativo');
    if(lead.document&&customer.document&&lead.document!==String(customer.document).replace(/\D/g,''))throw new Error('Documento conflitante, revise o cadastro');
   }else{
    let candidates=[];
    if(lead.document)candidates=db.prepare("SELECT * FROM customers WHERE REPLACE(REPLACE(REPLACE(document,'.',''),'-',''),'/','')=? AND active=1").all(lead.document);
    if(!candidates.length&&lead.email)candidates=db.prepare('SELECT * FROM customers WHERE LOWER(email)=LOWER(?) AND active=1').all(lead.email);
    if(candidates.length>1)throw new Error('Vários clientes compatíveis. Selecione um cliente existente.');
    customer=candidates[0]||null;
   }
   if(!customer)customer=registry.saveCustomer({name:lead.name,document:lead.document,phone:lead.phone,email:lead.email,notes:lead.notes},actor);
   db.prepare("UPDATE crm_leads SET status='CONVERTED',customer_id=?,updated_at=? WHERE id=?").run(customer.id,at(),leadId);
   db.prepare('UPDATE crm_opportunities SET customer_id=?,updated_at=? WHERE lead_id=? AND customer_id IS NULL').run(customer.id,at(),leadId);
   audit('crm.lead.convert','crm-lead',leadId,actor,{customerId:customer.id});
   return customer;
  });
 }
 function getQuote(id){
  const q=lookup('crm_quotes',id,'Proposta');
  return {id:q.id,opportunityId:q.opportunity_id,version:q.version,status:q.status,totalCents:q.total_cents,notes:q.notes,createdAt:q.created_at,items:db.prepare('SELECT id,description,quantity,unit_price_cents unitPriceCents,total_cents totalCents,position FROM crm_quote_items WHERE quote_id=? ORDER BY position').all(q.id)};
 }
 function listQuotes(opportunityId){
  return db.prepare('SELECT id FROM crm_quotes WHERE opportunity_id=? ORDER BY version DESC').all(String(opportunityId)).map(row=>getQuote(row.id));
 }
 function createQuote(input={},actor=null){
  const opp=lookup('crm_opportunities',required(input.opportunityId,'Oportunidade'));
  if(opp.stage==='LOST')throw new Error('Não é possível propor em uma oportunidade perdida');
  const items=input.items;
  if(!Array.isArray(items)||items.length<1||items.length>100)throw new Error('A proposta exige entre 1 e 100 itens');
  const parts=items.map((line,i)=>{
   const quantity=Number(line.quantity),price=Number(line.unitPriceCents);
   if(!Number.isSafeInteger(quantity)||quantity<1||quantity>100000)throw new Error('Quantidade inválida no item '+(i+1));
   cents(price);
   const total=quantity*price;
   if(!Number.isSafeInteger(total))throw new Error('Total inválido');
   return {description:required(line.description,'Descrição do item',500),quantity,price,total};
  });
  const total=parts.reduce((s,p)=>s+p.total,0);cents(total);
  const id=idFactory('crm-quote');
  return tx(db,()=>{
   const version=Number(db.prepare('SELECT COALESCE(MAX(version),0)+1 v FROM crm_quotes WHERE opportunity_id=?').get(opp.id).v);
   db.prepare("INSERT INTO crm_quotes(id,opportunity_id,version,status,total_cents,notes,created_by,created_at) VALUES (?,?,?,'DRAFT',?,?,?,?)")
    .run(id,opp.id,version,total,optional(input.notes),actor?.id||null,at());
   const insert=db.prepare('INSERT INTO crm_quote_items(id,quote_id,description,quantity,unit_price_cents,total_cents,position) VALUES (?,?,?,?,?,?,?)');
   parts.forEach((p,i)=>insert.run(idFactory('crm-item'),id,p.description,p.quantity,p.price,p.total,i));
   if(['NEW','QUALIFIED'].includes(opp.stage))moveOpportunity(opp.id,'PROPOSAL',actor);
   db.prepare('UPDATE crm_opportunities SET amount_cents=?,updated_at=? WHERE id=?').run(total,at(),opp.id);
   audit('crm.quote.create','crm-quote',id,actor,{opportunityId:opp.id,version,totalCents:total});
   return getQuote(id);
  });
 }
 function setQuoteStatus(id,status,actor=null){
  const quote=getQuote(id),s=String(status).toUpperCase();
  if(!QUOTE_STATUSES.has(s))throw new Error('Status da proposta inválido');
  if(db.prepare('SELECT 1 FROM crm_billing_links WHERE quote_id=? LIMIT 1').get(id)&&s==='REJECTED')throw new Error('Proposta com recebível não pode ser rejeitada silenciosamente');
  db.prepare('UPDATE crm_quotes SET status=? WHERE id=?').run(s,id);
  audit('crm.quote.status','crm-quote',id,actor,{status:s});
  return getQuote(id);
 }
 function previewReceivables({quoteId,installments=1,firstDueAt}={}){
  const quote=getQuote(quoteId),opp=getOpportunity(quote.opportunityId);
  if(opp.stage!=='WON')throw new Error('Somente venda ganha pode sugerir recebíveis');
  if(!opp.customerId)throw new Error('Converta o lead em cliente antes de criar recebível');
  if(quote.status==='REJECTED')throw new Error('Proposta rejeitada não pode gerar recebível');
  const customer=lookup('customers',opp.customerId,'Cliente');
  if(!customer.active)throw new Error('Cliente inativo');
  const n=Number(installments),first=dateOnly(firstDueAt);
  if(!Number.isSafeInteger(n)||n<1||n>48)throw new Error('Quantidade de parcelas inválida (1 a 48)');
  const base=Math.floor(quote.totalCents/n),remainder=quote.totalCents%n;
  if(base<1)throw new Error('Valor insuficiente para essa quantidade de parcelas');
  return {quoteId:quote.id,quoteVersion:quote.version,opportunityId:opp.id,customerId:customer.id,customerName:customer.name,totalCents:quote.totalCents,installments:Array.from({length:n},(_,i)=>({number:i+1,amountCents:base+(i<remainder?1:0),dueAt:nextMonth(first,i)}))};
 }
 function listBillingLinks(opportunityId){
  return db.prepare('SELECT * FROM crm_billing_links WHERE opportunity_id=? ORDER BY installment_no').all(String(opportunityId))
   .map(l=>({...l,entry:finance.getEntry(l.financial_entry_id)}));
 }
 function confirmReceivables(input={},actor=null){
  const preview=previewReceivables(input);
  if(!Number.isSafeInteger(input.expectedTotalCents)||input.expectedTotalCents!==preview.totalCents)
   throw new Error('Valor da proposta alterado; gere uma nova prévia antes de confirmar');
  return tx(db,()=>{
   const previous=listBillingLinks(preview.opportunityId);
   if(previous.length){
    const identical=previous.length===preview.installments.length&&previous.every((l,i)=>
     l.quote_id===preview.quoteId&&l.amount_cents===preview.installments[i].amountCents&&l.due_at===preview.installments[i].dueAt);
    if(!identical)throw new Error('Recebíveis já confirmados com condições diferentes. Revise os existentes no Financeiro.');
    return {alreadyConfirmed:true,entries:previous.map(l=>l.entry)};
   }
   const categoryId=input.categoryId||null,accountId=input.accountId||null;
   const entries=[];
   for(const part of preview.installments){
    const entry=finance.createEntry({
     kind:'RECEIVABLE',
     description:'Proposta '+preview.quoteVersion+' — parcela '+part.number+'/'+preview.installments.length,
     customerId:preview.customerId,amountCents:part.amountCents,dueAt:part.dueAt,
     categoryId,accountId,sourceType:'CRM_QUOTE_INSTALLMENT',sourceId:preview.quoteId+':'+part.number,
    },actor);
    db.prepare('INSERT INTO crm_billing_links(id,opportunity_id,quote_id,installment_no,financial_entry_id,amount_cents,due_at,created_at) VALUES (?,?,?,?,?,?,?,?)')
     .run(idFactory('crm-billing'),preview.opportunityId,preview.quoteId,part.number,entry.id,part.amountCents,part.dueAt,at());
    entries.push(entry);
   }
   audit('crm.billing.confirm','crm-opportunity',preview.opportunityId,actor,{quoteId:preview.quoteId,entries:entries.map(e=>e.id),totalCents:preview.totalCents});
   return {alreadyConfirmed:false,entries};
  });
 }

 function previewLeadImport(rows){
  if(!Array.isArray(rows)||rows.length>5000)throw new Error('CSV limitado a 5.000 linhas por operação');
  const seen=new Set();
  const output=rows.map((original,index)=>{
   const raw=original&&typeof original==='object'?original:{};
   const item={
    name:String(raw.name||'').trim(),email:String(raw.email||'').trim().toLowerCase(),
    phone:String(raw.phone||'').trim(),document:String(raw.document||'').trim().replace(/\D/g,''),
    source:String(raw.source||'CSV').trim()||'CSV',notes:String(raw.notes||'').trim()
   };
   const itemError=!item.name||item.name.length>240||item.email.length>240||item.document.length>40||
    item.phone.length>45||item.notes.length>2000||item.source.length>64||
    (item.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.email));
   if(itemError)return {index:index+1,...item,status:'INVALID',reason:'Campos obrigatórios ou formatos inválidos'};
   const keys=[item.email?'e:'+item.email:'',item.document?'d:'+item.document:''].filter(Boolean);
   if(!keys.length&&item.phone)keys.push('p:'+item.phone.replace(/\D/g,''));
   const inFile=keys.some(k=>seen.has(k));
   const inDb=!!db.prepare("SELECT 1 FROM crm_leads WHERE (?<>'' AND document=?) OR (?<>'' AND LOWER(email)=?) LIMIT 1")
    .get(item.document,item.document,item.email,item.email);
   keys.forEach(k=>seen.add(k));
   return {index:index+1,...item,status:inFile||inDb?'DUPLICATE':'READY',reason:inFile?'Duplicado dentro do arquivo':inDb?'Lead já cadastrado':''};
  });
  return {rows:output,ready:output.filter(r=>r.status==='READY').length,duplicates:output.filter(r=>r.status==='DUPLICATE').length,invalid:output.filter(r=>r.status==='INVALID').length};
 }
 function commitLeadImport(rows,actor=null){
  return tx(db,()=>{
   const preview=previewLeadImport(rows);
   for(const row of preview.rows.filter(r=>r.status==='READY')){
    saveLead({name:row.name,email:row.email,phone:row.phone,document:row.document,source:row.source,notes:row.notes},actor);
   }
   audit('crm.leads.import','crm-lead',null,actor,{created:preview.ready,skipped:preview.invalid+preview.duplicates});
   return {created:preview.ready,skipped:preview.invalid+preview.duplicates};
  });
 }

 function getMetrics(){
  const rows=db.prepare('SELECT stage,COUNT(*) count,COALESCE(SUM(amount_cents),0) total FROM crm_opportunities GROUP BY stage').all();
  const out={NEW:0,QUALIFIED:0,PROPOSAL:0,WON:0,LOST:0};
  for(const r of rows)out[r.stage]=r.total;
  return {stageTotalsCents:out,wonCount:Number(rows.find(r=>r.stage==='WON')?.count||0),leadCount:Number(db.prepare('SELECT COUNT(*) n FROM crm_leads').get().n),
   overdueTasks:Number(db.prepare("SELECT COUNT(*) n FROM crm_tasks WHERE done_at IS NULL AND due_at<?").get(at().slice(0,10)).n)};
 }
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function quoteHtml(quoteId){
  const q=getQuote(quoteId),opp=getOpportunity(q.opportunityId);
  const lead=opp.leadId?getLead(opp.leadId):null;
  const customer=opp.customerId?lookup('customers',opp.customerId):null;
  const money=n=>(n/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const trs=q.items.map(i=>'<tr><td>'+escape(i.description)+'</td><td>'+i.quantity+'</td><td>'+money(i.unitPriceCents)+'</td><td>'+money(i.totalCents)+'</td></tr>').join('');
  return '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;padding:36px;color:#222}h1{color:#4f46e5}table{width:100%;border-collapse:collapse;margin-top:28px}td,th{border-bottom:1px solid #ddd;padding:12px;text-align:left}.total{text-align:right;font-size:22px;font-weight:bold;margin-top:24px}small{color:#777}</style><h1>Proposta comercial</h1><p>ArtiSys Financeiro — Proposta v'+q.version+'</p><p><b>Cliente:</b> '+escape(customer?.name||lead?.name||'Não identificado')+'</p><p><b>Negócio:</b> '+escape(opp.title)+'</p><table><thead><tr><th>Descrição</th><th>Qtd.</th><th>Unitário</th><th>Total</th></tr></thead><tbody>'+trs+'</tbody></table><p class="total">'+money(q.totalCents)+'</p><p>'+escape(q.notes||'')+'</p><small>Documento comercial. Não representa pagamento ou recibo.</small></html>';
 }
 return {listLeads,saveLead,previewLeadImport,commitLeadImport,getLead,listOpportunities,getOpportunity,saveOpportunity,moveOpportunity,
  listStageHistory,addActivity,listActivities,saveTask,setTaskDone,listTasks,convertLead,createQuote,getQuote,listQuotes,
  setQuoteStatus,previewReceivables,confirmReceivables,listBillingLinks,getMetrics,quoteHtml};
}
module.exports={createCrmService};
