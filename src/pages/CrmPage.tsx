import {useCallback,useEffect,useMemo,useState,type FormEvent,type DragEvent,type ChangeEvent} from 'react';
import {ArrowRight,Check,Clock,FileDown,Handshake,Plus,Search,Users} from 'lucide-react';
import {brl,toCents,today,can} from '../lib/format';
import Papa from 'papaparse';

type Props={token:string;session:FinanceiroSession};
type Tab='pipeline'|'leads'|'tasks'|'quotes';
const stages:CrmStage[]=['NEW','QUALIFIED','PROPOSAL','WON','LOST'];
const names:Record<CrmStage,string>={NEW:'Contato',QUALIFIED:'Qualificado',PROPOSAL:'Proposta',WON:'Ganho',LOST:'Perdido'};
const emptyLead={name:'',document:'',phone:'',email:'',source:'MANUAL',notes:''};
const firstItem={description:'',quantity:'1',price:''};
type ItemDraft=typeof firstItem;
function errorMessage(error:unknown){return error instanceof Error?error.message:String(error);}
function niceDate(iso:string|null){if(!iso)return 'Sem prazo';const [y,m,d]=iso.slice(0,10).split('-');return [d,m,y].join('/');}

export default function CrmPage({token,session}:Props){
 const api=window.financeiro!;
 const editable=can(session,'crm.manage'),quotesAllowed=can(session,'crm.quotes');
 const convertible=can(session,'crm.convert'),billingAllowed=can(session,'crm.billing.confirm');
 const [tab,setTab]=useState<Tab>('pipeline');
 const [leads,setLeads]=useState<CrmLead[]>([]);
 const [opportunities,setOpportunities]=useState<CrmOpportunity[]>([]);
 const [tasks,setTasks]=useState<CrmTask[]>([]);
 const [customers,setCustomers]=useState<PartyRecord[]>([]);
 const [accounts,setAccounts]=useState<FinanceAccount[]>([]);
 const [categories,setCategories]=useState<FinancialCategory[]>([]);
 const [metrics,setMetrics]=useState<CrmMetrics|null>(null);
 const [selectedId,setSelectedId]=useState<string|null>(null);
 const [activities,setActivities]=useState<CrmActivity[]>([]);
 const [history,setHistory]=useState<CrmStageHistory[]>([]);
 const [quotes,setQuotes]=useState<CrmQuote[]>([]);
 const [billingLinks,setBillingLinks]=useState<CrmBillingLink[]>([]);
 const [selectedQuoteId,setSelectedQuoteId]=useState('');
 const [preview,setPreview]=useState<CrmBillingPreview|null>(null);
 const [query,setQuery]=useState('');
 const [leadForm,setLeadForm]=useState(emptyLead);
 const [editingLeadId,setEditingLeadId]=useState<string|null>(null);
 const [importRows,setImportRows]=useState<CrmImportRow[]>([]);
 const [importPreview,setImportPreview]=useState<CrmImportPreview|null>(null);
 const [dealForm,setDealForm]=useState({party:'',title:'',amount:'0'});
 const [note,setNote]=useState('');
 const [activityKind,setActivityKind]=useState<CrmActivity['kind']>('NOTE');
 const [taskForm,setTaskForm]=useState({title:'',dueAt:''});
 const [quoteItems,setQuoteItems]=useState<ItemDraft[]>([firstItem]);
 const [quoteNotes,setQuoteNotes]=useState('');
 const [billing,setBilling]=useState({installments:'1',firstDueAt:today(),accountId:'',categoryId:''});
 const [message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const deal=useMemo(()=>opportunities.find(o=>o.id===selectedId)||null,[opportunities,selectedId]);
 const selectedQuote=quotes.find(q=>q.id===selectedQuoteId)||quotes[0]||null;

 const load=useCallback(async()=>{
  const [l,o,t,c,a,cats,m]=await Promise.all([
   api.crm.listLeads(token),api.crm.listOpportunities(token),api.crm.listTasks(token),
   api.registry.listCustomers(token),api.finance.listAccounts(token),api.registry.listCategories(token),
   api.crm.metrics(token)
  ]);
  setLeads(l);setOpportunities(o);setTasks(t);setCustomers(c);setAccounts(a);
  setCategories(cats.filter(x=>x.nature==='REVENUE'));setMetrics(m);
 },[api,token]);
 const loadDetail=useCallback(async(id:string)=>{
  const [a,q,b,h]=await Promise.all([
   api.crm.listActivities(token,id),api.crm.listQuotes(token,id),api.crm.listBillingLinks(token,id),api.crm.listStageHistory(token,id)
  ]);
  setActivities(a);setQuotes(q);setBillingLinks(b);setHistory(h);
 },[api,token]);
 useEffect(()=>{void load().catch(e=>setError(errorMessage(e)));},[load]);
 useEffect(()=>{
  setPreview(null);setSelectedQuoteId('');
  if(!selectedId){setActivities([]);setQuotes([]);setBillingLinks([]);setHistory([]);return;}
  void loadDetail(selectedId).catch(e=>setError(errorMessage(e)));
 },[selectedId,loadDetail]);
 async function run(fn:()=>Promise<unknown>,success:string){
  setBusy(true);setError('');setMessage('');
  try{await fn();await load();if(selectedId)await loadDetail(selectedId);setMessage(success);}
  catch(e){setError(errorMessage(e));}finally{setBusy(false);}
 }

 async function loadCsv(e:ChangeEvent<HTMLInputElement>){
  const file=e.target.files?.[0];setError('');setMessage('');setImportPreview(null);setImportRows([]);
  if(!file)return;
  if(file.size>2*1024*1024){setError('O arquivo CSV deve ter até 2 MB.');return;}
  try{
   const text=await file.text();
   const parsed=Papa.parse(text,{header:true,skipEmptyLines:true,transformHeader:(h)=>h.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[\s_-]/g,'')});
   if(parsed.errors.length)throw new Error('CSV inválido: '+parsed.errors[0].message);
   const rows=parsed.data.map(r=>({
    name:r.nome||r.name||'',email:r.email||r.correio||'',
    phone:r.telefone||r.celular||r.phone||'',
    document:r.cpfcnpj||r.documento||r.document||'',
    source:r.origem||r.source||'CSV',notes:r.observacoes||r.notes||''
   }));
   const preview=await api.crm.previewLeadImport(token,rows);
   setImportRows(rows);setImportPreview(preview);
  }catch(e){setError(errorMessage(e));}
 }
 async function importCsv(){
  if(!importPreview?.ready)return;
  await run(async()=>{
   await api.crm.commitLeadImport(token,importRows);
   setImportRows([]);setImportPreview(null);
  },'Importação concluída; apenas leads válidos e inéditos foram cadastrados.');
 }

 async function addLead(e:FormEvent){
  e.preventDefault();
  await run(async()=>{await api.crm.saveLead(token,{...leadForm,id:editingLeadId||undefined});setLeadForm(emptyLead);setEditingLeadId(null);},'Lead cadastrado.');
 }
 async function addDeal(e:FormEvent){
  e.preventDefault();
  await run(async()=>{
   const [kind,id]=dealForm.party.split(':');
   const created=await api.crm.saveOpportunity(token,{
    ...(kind==='lead'?{leadId:id}:{customerId:id}),
    title:dealForm.title,amountCents:dealForm.amount.trim()?toCents(dealForm.amount):0
   });
   setSelectedId(created.id);setDealForm({party:'',title:'',amount:'0'});setTab('pipeline');
  },'Oportunidade criada.');
 }
 async function changeStage(id:string,stage:CrmStage){
  const item=opportunities.find(o=>o.id===id);
  if(!item||item.stage===stage)return;
  let lossReason='';
  if(stage==='LOST'){
   const reason=window.prompt('Qual o motivo da perda?');
   if(!reason?.trim())return;
   lossReason=reason;
  }
  await run(()=>api.crm.moveOpportunity(token,id,stage,{lossReason}),
   stage==='WON'?'Venda marcada como ganha. O recebível continua pendente de confirmação.':'Etapa atualizada.');
 }
 async function addActivity(e:FormEvent){
  e.preventDefault();if(!deal)return;
  await run(async()=>{await api.crm.addActivity(token,{opportunityId:deal.id,kind:activityKind,note});setNote('');},'Atividade registrada.');
 }
 async function addTask(e:FormEvent){
  e.preventDefault();if(!deal)return;
  await run(async()=>{await api.crm.saveTask(token,{opportunityId:deal.id,title:taskForm.title,dueAt:taskForm.dueAt||undefined});setTaskForm({title:'',dueAt:''});},'Tarefa adicionada.');
 }
 async function createQuote(e:FormEvent){
  e.preventDefault();if(!deal)return;
  await run(async()=>{
   const q=await api.crm.createQuote(token,{opportunityId:deal.id,
    items:quoteItems.map(i=>({description:i.description,quantity:Number(i.quantity),unitPriceCents:toCents(i.price)})),
    notes:quoteNotes});
   setQuoteItems([firstItem]);setQuoteNotes('');setSelectedQuoteId(q.id);
  },'Proposta criada. Revise e salve o PDF.');
 }
 async function previewBilling(){
  if(!selectedQuote)return;
  setBusy(true);setError('');
  try{
   setPreview(await api.crm.previewReceivables(token,{
    quoteId:selectedQuote.id,installments:Number(billing.installments),firstDueAt:billing.firstDueAt
   }));
  }catch(e){setError(errorMessage(e));}finally{setBusy(false);}
 }
 async function confirmBilling(){
  if(!preview)return;
  await run(async()=>{
   const result=await api.crm.confirmReceivables(token,{
    quoteId:preview.quoteId,installments:preview.installments.length,firstDueAt:billing.firstDueAt,
    expectedTotalCents:preview.totalCents,categoryId:billing.categoryId||undefined,accountId:billing.accountId||undefined
   });
   setMessage(result.alreadyConfirmed?'Recebíveis já existiam; nenhuma duplicação.':'Recebíveis criados no Financeiro.');
   setPreview(null);
  },'Recebíveis vinculados ao Financeiro.');
 }
 function dragStart(e:DragEvent<HTMLElement>,id:string){e.dataTransfer.setData('text/plain',id);e.dataTransfer.effectAllowed='move';}
 function dropStage(e:DragEvent<HTMLElement>,stage:CrmStage){e.preventDefault();if(!editable)return;const id=e.dataTransfer.getData('text/plain');if(opportunities.some(x=>x.id===id))void changeStage(id,stage);}
 const filtered=opportunities.filter(o=>{
  const lead=leads.find(l=>l.id===o.leadId);
  return [o.title,lead?.name,customers.find(c=>c.id===o.customerId)?.name].some(s=>String(s||'').toLowerCase().includes(query.toLowerCase()));
 });
 return <section className="page-stack crm-page" data-testid="page-crm">
  <div className="page-header"><div><p className="eyebrow">Comercial</p><h2>CRM — Vendas e prospecção</h2><p className="muted">Relacionamentos e propostas conectados ao Financeiro, sem gerar recebíveis automaticamente.</p></div></div>
  {error&&<div role="alert" className="error-box">{error}</div>}
  {message&&<div role="status" className="success-box">{message}</div>}
  <div className="crm-metrics">
   <div className="metric-card"><span>Leads cadastrados</span><strong>{metrics?.leadCount??leads.length}</strong></div>
   <div className="metric-card"><span>Em negociação</span><strong>{brl((metrics?.stageTotalsCents.NEW||0)+(metrics?.stageTotalsCents.QUALIFIED||0)+(metrics?.stageTotalsCents.PROPOSAL||0))}</strong></div>
   <div className="metric-card"><span>Vendas ganhas</span><strong>{brl(metrics?.stageTotalsCents.WON||0)}</strong><small>Indicador comercial, não saldo bancário</small></div>
   <div className="metric-card"><span>Tarefas atrasadas</span><strong>{metrics?.overdueTasks||0}</strong></div>
  </div>
  <div className="page-toolbar crm-toolbar">
   <div className="segmented" role="tablist" aria-label="Áreas do CRM">
    {([['pipeline','Funil'],['leads','Leads'],['tasks','Tarefas'],['quotes','Propostas']] as const).map(([value,label])=><button key={value} type="button" role="tab" aria-selected={tab===value} className={tab===value?'active':''} onClick={()=>setTab(value)}>{label}</button>)}
   </div>
   <label className="search-control"><Search size={16}/><input aria-label="Buscar oportunidades" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar oportunidades"/></label>
  </div>
  {tab==='leads'&&<div className="panel crm-import">
   <div><h3>Importar leads por CSV</h3><p className="muted">Colunas aceitas: nome, email, telefone, cpfcnpj, origem e observacoes. Prévia antes de qualquer cadastro.</p></div>
   <input type="file" accept=".csv,text/csv" aria-label="Arquivo CSV de leads" onChange={e=>void loadCsv(e)}/>
   {importPreview&&<div className="crm-import-preview">
    <span>Prontos: <strong>{importPreview.ready}</strong></span>
    <span>Duplicados: <strong>{importPreview.duplicates}</strong></span>
    <span>Inválidos: <strong>{importPreview.invalid}</strong></span>
    {importPreview.rows.filter(r=>r.status!=='READY').slice(0,5).map(r=><small key={r.index}>Linha {r.index}: {r.reason}</small>)}
    {editable&&<button type="button" className="primary-button" disabled={busy||importPreview.ready===0} onClick={()=>void importCsv()}>Confirmar importação de {importPreview.ready} lead(s)</button>}
   </div>}
  </div>}
  {tab==='leads'&&<div className="crm-split">
   {editable&&<form className="panel crm-form" onSubmit={e=>void addLead(e)}><h3><Users size={18}/> {editingLeadId?"Editar lead":"Novo lead"}</h3>
    <label>Nome<input required maxLength={240} value={leadForm.name} onChange={e=>setLeadForm({...leadForm,name:e.target.value})}/></label>
    <label>Telefone<input value={leadForm.phone} onChange={e=>setLeadForm({...leadForm,phone:e.target.value})}/></label>
    <label>E-mail<input type="email" value={leadForm.email} onChange={e=>setLeadForm({...leadForm,email:e.target.value})}/></label>
    <label>CPF/CNPJ<input value={leadForm.document} onChange={e=>setLeadForm({...leadForm,document:e.target.value})}/></label>
    <label>Origem<select value={leadForm.source} onChange={e=>setLeadForm({...leadForm,source:e.target.value})}>{['MANUAL','INDICACAO','SITE','INSTAGRAM','WHATSAPP','OUTROS'].map(x=><option key={x} value={x}>{x}</option>)}</select></label>
    <label>Observações<textarea value={leadForm.notes} onChange={e=>setLeadForm({...leadForm,notes:e.target.value})}/></label>
    <button disabled={busy} className="primary-button">{editingLeadId?"Salvar alterações":"Cadastrar lead"}</button>
    {editingLeadId&&<button type="button" className="secondary-button" onClick={()=>{setEditingLeadId(null);setLeadForm(emptyLead);}}>Cancelar edição</button>}
   </form>}
   <div className="panel table-panel table-scroll"><table><thead><tr><th>Lead</th><th>Contato</th><th>Origem</th><th>Situação</th><th>Ações</th></tr></thead><tbody>
    {leads.filter(l=>[l.name,l.email,l.phone].some(x=>String(x||'').toLowerCase().includes(query.toLowerCase()))).map(l=><tr key={l.id}><td><strong>{l.name}</strong><small>{l.document||'Sem documento'}</small></td><td>{l.phone||l.email||'—'}</td><td>{l.source}</td><td>{l.status==='CONVERTED'?'Cliente convertido':l.status}</td><td><div className="crm-lead-actions">
      {editable&&<button type="button" className="secondary-button small" onClick={()=>{setEditingLeadId(l.id);setLeadForm({name:l.name,document:l.document||'',phone:l.phone||'',email:l.email||'',source:l.source,notes:l.notes||''});}}>Editar</button>}
      {editable&&l.status!=='CONVERTED'&&<select aria-label={'Status de '+l.name} disabled={busy} value={l.status} onChange={e=>void run(()=>api.crm.setLeadStatus(token,l.id,e.target.value as 'NEW'|'QUALIFIED'|'DISCARDED'),'Status do lead atualizado.')}><option value="NEW">Novo</option><option value="QUALIFIED">Qualificado</option><option value="DISCARDED">Descartado</option></select>}
      {convertible&&!l.customerId&&l.status!=='DISCARDED'&&<button type="button" className="secondary-button small" disabled={busy} onClick={()=>void run(()=>api.crm.convertLead(token,l.id,{}),'Lead convertido usando o cadastro canônico.')}>Converter</button>}
    </div></td></tr>)}
   </tbody></table>{!leads.length&&<div className="empty-state">Cadastre o primeiro lead para começar a prospecção.</div>}</div>
  </div>}
  {tab==='pipeline'&&<>
   {editable&&<form className="panel crm-newdeal" onSubmit={e=>void addDeal(e)}>
    <h3><Plus size={18}/> Nova oportunidade</h3>
    <label>Lead ou cliente<select required value={dealForm.party} onChange={e=>setDealForm({...dealForm,party:e.target.value})}><option value="">Selecione</option><optgroup label="Leads">{leads.map(l=><option key={l.id} value={'lead:'+l.id}>{l.name}</option>)}</optgroup><optgroup label="Clientes">{customers.map(c=><option key={c.id} value={'customer:'+c.id}>{c.name}</option>)}</optgroup></select></label>
    <label>Nome da oportunidade<input required value={dealForm.title} onChange={e=>setDealForm({...dealForm,title:e.target.value})}/></label>
    <label>Estimativa (R$)<input value={dealForm.amount} onChange={e=>setDealForm({...dealForm,amount:e.target.value})} inputMode="decimal"/></label>
    <button className="primary-button" disabled={busy}>Adicionar</button>
   </form>}
   <div className="crm-kanban" aria-label="Funil de vendas">
    {stages.map(stage=><section key={stage} className="crm-stage" aria-label={names[stage]} onDragOver={e=>{if(editable)e.preventDefault();}} onDrop={e=>dropStage(e,stage)}>
     <header><strong>{names[stage]}</strong><span>{filtered.filter(o=>o.stage===stage).length}</span></header>
     <small>{brl(filtered.filter(o=>o.stage===stage).reduce((s,o)=>s+o.amountCents,0))}</small>
     {filtered.filter(o=>o.stage===stage).map(o=><button key={o.id} type="button" draggable={editable} onDragStart={e=>dragStart(e,o.id)} className={'crm-deal '+(selectedId===o.id?'crm-deal-selected':'')} onClick={()=>setSelectedId(o.id)}>
      <strong>{o.title}</strong><span>{brl(o.amountCents)}</span><small>{leads.find(l=>l.id===o.leadId)?.name||customers.find(c=>c.id===o.customerId)?.name||'Cliente'}</small>
     </button>)}
    </section>)}
   </div>
  </>}
  {tab==='tasks'&&<div className="panel table-panel"><table><thead><tr><th>Concluída</th><th>Tarefa</th><th>Oportunidade</th><th>Prazo</th></tr></thead><tbody>
   {tasks.map(t=><tr key={t.id}><td><input type="checkbox" checked={t.done} disabled={!editable||busy} aria-label={'Concluir '+t.title} onChange={e=>void run(()=>api.crm.setTaskDone(token,t.id,e.target.checked),'Tarefa atualizada.')}/></td><td>{t.title}</td><td><button type="button" className="secondary-button small" onClick={()=>{setSelectedId(t.opportunityId);setTab('pipeline');}}>{opportunities.find(o=>o.id===t.opportunityId)?.title||'Abrir'}</button></td><td>{niceDate(t.dueAt)}</td></tr>)}
   </tbody></table>{!tasks.length&&<div className="empty-state">Nenhuma tarefa cadastrada.</div>}</div>}
  {tab==='quotes'&&<div className="panel"><h3>Propostas comerciais</h3><p className="muted">Selecione uma oportunidade no funil para criar, revisar, baixar em PDF ou faturar uma proposta.</p>
   <div className="crm-quote-list">{opportunities.filter(o=>o.stage==='PROPOSAL'||o.stage==='WON').map(o=><button type="button" className="crm-quote-row" key={o.id} onClick={()=>{setSelectedId(o.id);setTab('pipeline');}}>{o.title}<span>{brl(o.amountCents)} <ArrowRight size={15}/></span></button>)}</div>
  </div>}
  {deal&&tab==='pipeline'&&<div className="panel crm-detail" data-testid="crm-opportunity-detail">
   <div className="crm-detail-heading"><div><p className="eyebrow">Oportunidade</p><h3>{deal.title}</h3><p className="muted">{brl(deal.amountCents)} · {names[deal.stage]}</p></div><button type="button" className="secondary-button small" onClick={()=>setSelectedId(null)}>Fechar</button></div>
   <div className="crm-detail-grid">
    <div className="crm-detail-left">
     <div className="crm-section">
      <h3><Handshake size={18}/> Etapa comercial</h3>
      <label>Mover oportunidade<select value={deal.stage} disabled={!editable||busy} onChange={e=>void changeStage(deal.id,e.target.value as CrmStage)}>{stages.map(s=><option key={s} value={s}>{names[s]}</option>)}</select></label>
      {deal.stage==='WON'&&<p className="success-box">Venda ganha. Nenhum recebível é criado sem sua confirmação.</p>}
      {history.length>0&&<div className="crm-stage-history"><strong>Histórico do funil</strong>{history.map(h=><p key={h.id}>{h.fromStage?names[h.fromStage]:'Novo'} → {names[h.toStage]} · {niceDate(h.changedAt)}</p>)}</div>}
      {deal.leadId&&!deal.customerId&&convertible&&<button type="button" disabled={busy} className="secondary-button" onClick={()=>void run(()=>api.crm.convertLead(token,deal.leadId!,{}),'Cliente vinculado ao Financeiro.')}>Converter lead em cliente</button>}
     </div>
     <div className="crm-section"><h3><Clock size={18}/> Atividades e retornos</h3>
      {editable&&<form onSubmit={e=>void addActivity(e)} className="crm-form">
       <select value={activityKind} onChange={e=>setActivityKind(e.target.value as CrmActivity['kind'])}>{([['NOTE','Nota'],['CALL','Ligação'],['WHATSAPP','WhatsApp'],['EMAIL','E-mail'],['MEETING','Reunião']] as const).map(([v,t])=><option key={v} value={v}>{t}</option>)}</select>
       <textarea required value={note} onChange={e=>setNote(e.target.value)} placeholder="Registre uma interação com o cliente"/>
       <button disabled={busy} className="secondary-button">Registrar interação</button>
      </form>}
      <div className="crm-timeline">{activities.map(a=><div key={a.id}><strong>{a.kind}</strong><small>{niceDate(a.occurredAt)}</small><p>{a.note}</p></div>)}{!activities.length&&<p className="muted">Sem interações registradas.</p>}</div>
      {editable&&<form className="crm-task-entry" onSubmit={e=>void addTask(e)}><input required value={taskForm.title} onChange={e=>setTaskForm({...taskForm,title:e.target.value})} placeholder="Próxima tarefa"/><input type="date" value={taskForm.dueAt} onChange={e=>setTaskForm({...taskForm,dueAt:e.target.value})}/><button className="secondary-button" disabled={busy}>Adicionar tarefa</button></form>}
     </div>
    </div>
    <div className="crm-detail-right">
     <div className="crm-section">
      <h3>Propostas</h3>
      {quotes.length>0&&<label>Versão<select value={selectedQuote?.id||''} onChange={e=>{setSelectedQuoteId(e.target.value);setPreview(null);}}>{quotes.map(q=><option key={q.id} value={q.id}>v{q.version} — {brl(q.totalCents)} ({q.status})</option>)}</select></label>}
      {selectedQuote&&<div className="crm-quote-actions">
       <strong>{brl(selectedQuote.totalCents)}</strong>
       <button type="button" className="secondary-button small" disabled={busy} onClick={()=>void run(()=>api.crm.saveQuotePdf(token,selectedQuote.id),'PDF processado; confira a janela de salvamento.')}><FileDown size={16}/> Salvar PDF</button>
       {quotesAllowed&&<select aria-label="Situação da proposta" disabled={busy} value={selectedQuote.status} onChange={e=>void run(()=>api.crm.setQuoteStatus(token,selectedQuote.id,e.target.value as CrmQuoteStatus),'Status da proposta atualizado.')}>{(['DRAFT','SENT','ACCEPTED','REJECTED'] as const).map(status=><option key={status} value={status}>{status}</option>)}</select>}
      </div>}
      {quotesAllowed&&<form className="crm-form" onSubmit={e=>void createQuote(e)}>
       <strong>Nova versão de proposta</strong>
       {quoteItems.map((item,i)=><div className="crm-item" key={i}>
        <input required placeholder="Produto ou serviço" value={item.description} onChange={e=>setQuoteItems(v=>v.map((x,j)=>j===i?{...x,description:e.target.value}:x))}/>
        <input required type="number" min="1" max="100000" aria-label="Quantidade" value={item.quantity} onChange={e=>setQuoteItems(v=>v.map((x,j)=>j===i?{...x,quantity:e.target.value}:x))}/>
        <input required placeholder="Preço (R$)" aria-label="Valor unitário" inputMode="decimal" value={item.price} onChange={e=>setQuoteItems(v=>v.map((x,j)=>j===i?{...x,price:e.target.value}:x))}/>
        {quoteItems.length>1&&<button type="button" className="secondary-button small" aria-label="Remover item" onClick={()=>setQuoteItems(v=>v.filter((_,j)=>i!==j))}>Remover</button>}
       </div>)}
       <button type="button" className="secondary-button small" onClick={()=>setQuoteItems(v=>[...v,{...firstItem}])}><Plus size={14}/> Item</button>
       <textarea placeholder="Condições e observações" value={quoteNotes} onChange={e=>setQuoteNotes(e.target.value)}/>
       <button className="primary-button" disabled={busy}>Criar proposta</button>
      </form>}
     </div>
     {deal.stage==='WON'&&selectedQuote&&<div className="crm-section">
      <h3>Gerar recebível com confirmação</h3>
      {billingLinks.length>0?<><p className="success-box"><Check size={15}/> {billingLinks.length} parcela(s) já vinculada(s) ao Financeiro.</p>{billingLinks.map(l=><div key={l.id} className="crm-billing-row"><span>Parcela {l.installment_no} · {niceDate(l.due_at)}</span><strong>{brl(l.amount_cents)}</strong></div>)}</>:<>
       {!deal.customerId&&<p className="muted">Converta o lead em cliente antes de preparar a cobrança.</p>}
       <div className="crm-billing-inputs">
        <label>Parcelas<select value={billing.installments} onChange={e=>{setBilling({...billing,installments:e.target.value});setPreview(null);}}>{Array.from({length:24},(_,i)=>i+1).map(v=><option key={v} value={v}>{v}x</option>)}</select></label>
        <label>Primeiro vencimento<input type="date" value={billing.firstDueAt} onChange={e=>{setBilling({...billing,firstDueAt:e.target.value});setPreview(null);}}/></label>
        <label>Conta financeira<select value={billing.accountId} onChange={e=>{setBilling({...billing,accountId:e.target.value});setPreview(null);}}><option value="">Selecionar depois</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label>Categoria de receita<select value={billing.categoryId} onChange={e=>{setBilling({...billing,categoryId:e.target.value});setPreview(null);}}><option value="">Sem categoria</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
       </div>
       <button type="button" className="secondary-button" disabled={busy||!deal.customerId} onClick={()=>void previewBilling()}>Visualizar recebíveis</button>
       {preview&&<div className="crm-preview"><strong>Prévia, sem lançamento financeiro</strong><p>{preview.customerName} · {brl(preview.totalCents)}</p>{preview.installments.map(p=><div key={p.number} className="crm-billing-row"><span>{p.number}ª · {niceDate(p.dueAt)}</span><strong>{brl(p.amountCents)}</strong></div>)}
        {billingAllowed?<button className="primary-button" type="button" disabled={busy} onClick={()=>void confirmBilling()}>Confirmar e criar {preview.installments.length} recebível(is)</button>:<p className="muted">Seu perfil não tem permissão para confirmar cobranças.</p>}
        <button type="button" className="secondary-button" onClick={()=>setPreview(null)}>Agora não</button>
       </div>}
      </>}
     </div>}
    </div>
   </div>
  </div>}
 </section>;
}
