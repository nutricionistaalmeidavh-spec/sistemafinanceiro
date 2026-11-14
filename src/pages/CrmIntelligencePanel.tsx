import {useCallback,useEffect,useMemo,useState,type FormEvent} from 'react';
import {CalendarDays,Download,LineChart,Plus,Target,Settings2,CheckCircle2} from 'lucide-react';
import {brl,can,today,toCents} from '../lib/format';

type P2Tab='agenda'|'reports'|'goals'|'pipelines';
type Props={mode:P2Tab;token:string;session:FinanceiroSession;opportunities:CrmOpportunity[];pipelines:CrmPipeline[];owners:CrmOwner[];refresh:()=>Promise<void>};
const messageOf=(error:unknown)=>error instanceof Error?error.message:String(error);
const dateRange=()=>{
 const date=today(),month=date.slice(0,7);
 const [year,mon]=month.split('-').map(Number);
 return {from:month+'-01',to:month+'-'+String(new Date(year,mon,0).getDate()).padStart(2,'0')};
};
const formatDay=(date:string)=>date?date.split('-').reverse().join('/'):'—';
export default function CrmIntelligencePanel({mode,token,session,opportunities,pipelines,owners,refresh}:Props){
 const api=window.financeiro!.crmIntelligence;
 const editable=can(session,'crm.manage'),goalManager=can(session,'crm.goals.manage'),pipelineManager=can(session,'crm.pipeline.manage');
 const [range,setRange]=useState(dateRange);
 const [filterOwner,setFilterOwner]=useState('');
 const [filterPipeline,setFilterPipeline]=useState('');
 const [report,setReport]=useState<CrmSalesReport|null>(null);
 const [forecast,setForecast]=useState<CrmForecast|null>(null);
 const [followups,setFollowups]=useState<CrmFollowups|null>(null);
 const [agenda,setAgenda]=useState<CrmAgendaItem[]>([]);
 const [goals,setGoals]=useState<CrmGoalProgress[]>([]);
 const [month,setMonth]=useState(today().slice(0,7));
 const [selectedPipeline,setSelectedPipeline]=useState('');
 const [newPipeline,setNewPipeline]=useState('');
 const [stageDraft,setStageDraft]=useState({name:'',legacyStage:'QUALIFIED' as CrmStage,probability:'35'});
 const [goalDraft,setGoalDraft]=useState({ownerId:'',value:''});
 const [appointment,setAppointment]=useState({opportunityId:'',title:'',scheduledDate:today(),scheduledTime:'09:00',durationMinutes:'30',kind:'MEETING' as CrmAppointment['kind'],notes:''});
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const filters=useMemo(()=>({...range,ownerId:filterOwner||undefined,pipelineId:filterPipeline||undefined}),[range,filterOwner,filterPipeline]);
 const activePipeline=pipelines.find(p=>p.id===selectedPipeline)||pipelines.find(p=>p.isDefault)||pipelines[0];
 const reload=useCallback(async()=>{
  if(range.to<range.from)throw new Error('Intervalo de datas inválido');
  if(mode==='reports'){
   const [r,f]=await Promise.all([api.report(token,filters),api.forecast(token,filters)]);
   setReport(r);setForecast(f);
  }else if(mode==='agenda'){
   const [agendaRows,f]=await Promise.all([api.agenda(token,{from:range.from,to:range.to,ownerId:filterOwner}),api.followups(token,{asOf:today(),ownerId:filterOwner})]);
   setAgenda(agendaRows);setFollowups(f);
  }else if(mode==='goals'){
   setGoals(await api.listGoals(token,{month,ownerId:filterOwner}));
  }
 },[api,token,mode,filters,filterOwner,month,range.from,range.to]);
 useEffect(()=>{void reload().catch(error=>setError(messageOf(error)));},[reload]);
 async function submit(operation:()=>Promise<unknown>,message:string){
  setBusy(true);setError('');setNotice('');
  try{
   await operation();await refresh();await reload();setNotice(message);
  }catch(error){setError(messageOf(error));}finally{setBusy(false);}
 }
 async function saveAppointment(event:FormEvent){
  event.preventDefault();
  await submit(()=>api.saveAppointment(token,{...appointment,durationMinutes:Number(appointment.durationMinutes),ownerId:filterOwner||undefined}), 'Compromisso salvo na agenda local.');
  setAppointment(old=>({...old,title:'',notes:''}));
 }
 async function saveGoal(event:FormEvent){
  event.preventDefault();
  await submit(()=>api.saveGoal(token,{ownerId:goalDraft.ownerId,month,targetCents:toCents(goalDraft.value)}),'Meta comercial atualizada.');
  setGoalDraft(old=>({...old,value:''}));
 }
 async function addPipeline(event:FormEvent){
  event.preventDefault();
  await submit(async()=>{const p=await api.savePipeline(token,{name:newPipeline});setSelectedPipeline(p.id);setNewPipeline('');},'Funil criado com cinco etapas iniciais.');
 }
 async function addStage(event:FormEvent){
  event.preventDefault();
  if(!activePipeline)return;
  await submit(async()=>{await api.saveStage(token,{pipelineId:activePipeline.id,name:stageDraft.name,legacyStage:stageDraft.legacyStage,probabilityBps:Math.round(Number(stageDraft.probability)*100)});setStageDraft({name:'',legacyStage:'QUALIFIED',probability:'35'});},'Etapa personalizada adicionada.');
 }
 async function exportCsv(){
  setBusy(true);setError('');
  try{
   const result=await api.exportCsv(token,filters);
   const blob=new Blob([result.data],{type:result.mime});
   const url=URL.createObjectURL(blob);
   const a=document.createElement('a');a.href=url;a.download=result.filename;
   document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
   setNotice('Relatório CSV exportado localmente.');
  }catch(e){setError(messageOf(e));}finally{setBusy(false);}
 }
 return <div className="crm-p2" data-testid={'crm-p2-'+mode}>
  {error&&<div role="alert" className="error-box">{error}</div>}
  {notice&&<div role="status" className="success-box">{notice}</div>}
  {mode!=='pipelines'&&<div className="panel crm-p2-filters">
   <label>{mode==='goals'?'Mês da meta':'Data inicial'}
    {mode==='goals'?<input type="month" value={month} onChange={e=>setMonth(e.target.value)}/>:<input type="date" value={range.from} onChange={e=>setRange(old=>({...old,from:e.target.value}))}/>}
   </label>
   {mode!=='goals'&&<label>Data final<input type="date" value={range.to} onChange={e=>setRange(old=>({...old,to:e.target.value}))}/></label>}
   <label>Vendedor<select value={filterOwner} onChange={e=>setFilterOwner(e.target.value)}><option value="">Todos</option>{owners.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
   {mode==='reports'&&<label>Funil<select value={filterPipeline} onChange={e=>setFilterPipeline(e.target.value)}><option value="">Todos</option>{pipelines.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
  </div>}
  {mode==='agenda'&&<>
   <div className="crm-p2-metrics">
    <div className="metric-card"><span>Retornos atrasados</span><strong>{followups?.overdue.length||0}</strong></div>
    <div className="metric-card"><span>Para hoje</span><strong>{followups?.today.length||0}</strong></div>
    <div className="metric-card"><span>Próximos retornos</span><strong>{followups?.upcoming.length||0}</strong></div>
   </div>
   <div className="crm-p2-columns">
    {editable&&<form data-testid="crm-p2-appointment-form" className="panel crm-p2-form" onSubmit={e=>void saveAppointment(e)}>
     <h3><CalendarDays size={18}/> Agendar compromisso</h3>
     <label>Oportunidade<select data-testid="crm-p2-opportunity-select" required value={appointment.opportunityId} onChange={e=>setAppointment({...appointment,opportunityId:e.target.value})}><option value="">Selecione</option>{opportunities.map(o=><option key={o.id} value={o.id}>{o.title}</option>)}</select></label>
     <label>Assunto<input required maxLength={240} value={appointment.title} onChange={e=>setAppointment({...appointment,title:e.target.value})}/></label>
     <div className="crm-p2-two">
      <label>Data<input required type="date" value={appointment.scheduledDate} onChange={e=>setAppointment({...appointment,scheduledDate:e.target.value})}/></label>
      <label>Horário<input required type="time" value={appointment.scheduledTime} onChange={e=>setAppointment({...appointment,scheduledTime:e.target.value})}/></label>
     </div>
     <div className="crm-p2-two">
      <label>Tipo<select value={appointment.kind} onChange={e=>setAppointment({...appointment,kind:e.target.value as CrmAppointment['kind']})}><option value="MEETING">Reunião</option><option value="CALL">Ligação</option><option value="FOLLOWUP">Follow-up</option><option value="OTHER">Outro</option></select></label>
      <label>Minutos<input required type="number" min={5} max={1440} value={appointment.durationMinutes} onChange={e=>setAppointment({...appointment,durationMinutes:e.target.value})}/></label>
     </div>
     <label>Anotações<textarea value={appointment.notes} onChange={e=>setAppointment({...appointment,notes:e.target.value})}/></label>
     <button className="primary-button" disabled={busy}>Salvar compromisso</button>
    </form>}
    <div className="panel"><h3>Agenda comercial e follow-ups</h3>
     <p className="muted">Compromissos e tarefas do CRM, organizados por data. Sem conexão obrigatória com serviços externos.</p>
     <div className="crm-p2-agenda">{agenda.map(item=><div className="crm-p2-event" key={item.type+'-'+item.id}>
      <div><strong>{item.title}</strong><small>{formatDay(item.date)} {item.time||''} · {item.type==='TASK'?'Tarefa':'Compromisso'} · {opportunities.find(o=>o.id===item.opportunityId)?.title||''}</small></div>
      <span className={'badge '+(item.status==='DONE'?'badge-settled':'badge-open')}>{item.status==='DONE'?'Concluído':item.status==='CANCELLED'?'Cancelado':'Pendente'}</span>
      {editable&&item.type==='APPOINTMENT'&&item.status==='PLANNED'&&<button type="button" className="secondary-button small" disabled={busy} onClick={()=>void submit(()=>api.setAppointmentStatus(token,item.id,'DONE'),'Compromisso concluído.')}><CheckCircle2 size={15}/> Concluir</button>}
     </div>)}
     {!agenda.length&&<div className="empty-state">Nenhuma atividade no período.</div>}</div>
     {!!followups?.overdue.length&&<p className="crm-p2-warning">Há {followups.overdue.length} retorno(s) atrasado(s). Verifique suas tarefas e reuniões.</p>}
    </div>
   </div>
  </>}
  {mode==='reports'&&report&&forecast&&<>
   <div className="crm-p2-metrics">
    <div className="metric-card"><span>Vendas ganhas no período</span><strong>{brl(report.wonCents)}</strong><small>Comercial, não significa receita recebida</small></div>
    <div className="metric-card"><span>Taxa de fechamento</span><strong>{(report.winRateBps/100).toLocaleString('pt-BR')}%</strong><small>{report.wonCount} ganhas / {report.wonCount+report.lostCount} encerradas</small></div>
    <div className="metric-card"><span>Funil aberto</span><strong>{brl(report.openPipelineCents)}</strong></div>
    <div className="metric-card"><span>Previsão ponderada</span><strong>{brl(forecast.weightedCents)}</strong><small>Somente oportunidades com data prevista</small></div>
   </div>
   <div className="crm-p2-columns">
    <div className="panel"><h3><LineChart size={18}/> Previsão por mês</h3>
     <p className="muted">Probabilidade configurada por etapa. Não compõe contas a receber, caixa ou DRE.</p>
     <div className="crm-p2-forecast">{forecast.months.map(m=><div key={m.month}>
      <div className="crm-p2-forecast-head"><strong>{m.month}</strong><span>{brl(m.weightedCents)} de {brl(m.openCents)}</span></div>
      <div className="crm-p2-progress"><i style={{width:(m.openCents?100*m.weightedCents/m.openCents:0)+'%'}}/></div>
     </div>)}
     {!forecast.months.length&&<div className="empty-state">Nenhuma oportunidade com fechamento previsto nesse período.</div>}</div>
     <p className="muted">Oportunidades sem data de previsão: {brl(forecast.unscheduledCents)}</p>
    </div>
    <div className="panel"><h3>Conversão e perdas</h3>
     <div className="crm-p2-tally"><span>Leads criados no período</span><strong>{report.leadCount}</strong></div>
     <div className="crm-p2-tally"><span>Conversão de leads (coorte)</span><strong>{(report.leadConversionBps/100).toLocaleString('pt-BR')}%</strong></div>
     <div className="crm-p2-tally"><span>Oportunidades criadas</span><strong>{report.createdCount}</strong></div>
     <div className="crm-p2-tally"><span>Negócios perdidos</span><strong>{report.lostCount} · {brl(report.lostCents)}</strong></div>
     {report.lossReasons.map(r=><div key={r.reason} className="crm-p2-tally"><span>{r.reason}</span><strong>{r.count} · {brl(r.amountCents)}</strong></div>)}
     <button type="button" disabled={busy} className="secondary-button" onClick={()=>void exportCsv()}><Download size={17}/> Exportar vendas em CSV</button>
    </div>
   </div>
  </>}
  {mode==='goals'&&<div className="crm-p2-columns">
   {goalManager&&<form className="panel crm-p2-form" onSubmit={e=>void saveGoal(e)}>
    <h3><Target size={18}/> Meta por vendedor</h3>
    <label>Responsável<select required value={goalDraft.ownerId} onChange={e=>setGoalDraft({...goalDraft,ownerId:e.target.value})}><option value="">Selecione</option>{owners.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
    <label>Meta em reais (R$)<input required placeholder="15000,00" inputMode="decimal" value={goalDraft.value} onChange={e=>setGoalDraft({...goalDraft,value:e.target.value})}/></label>
    <button className="primary-button" disabled={busy}>Salvar meta de {month}</button>
   </form>}
   <div className="panel"><h3>Realização comercial</h3><p className="muted">Somente oportunidades ganhas no mês da meta; recebimentos não entram nesse cálculo.</p>
    {goals.map(g=><div className="crm-p2-goal" key={g.id}>
     <div className="crm-p2-forecast-head"><strong>{g.ownerName}</strong><span>{(g.achievementBps/100).toLocaleString('pt-BR')}%</span></div>
     <div className="crm-p2-progress"><i style={{width:Math.min(100,g.achievementBps/100)+'%'}}/></div>
     <small>{brl(g.actualCents)} / {brl(g.targetCents)} · Falta {brl(g.remainingCents)}</small>
    </div>)}
    {!goals.length&&<div className="empty-state">Nenhuma meta cadastrada para esse mês.</div>}
   </div>
  </div>}
  {mode==='pipelines'&&<>
   <div className="crm-p2-columns">
    <div className="panel crm-p2-form">
     <h3><Settings2 size={18}/> Funis de vendas</h3>
     <label>Selecionar funil<select value={activePipeline?.id||''} onChange={e=>setSelectedPipeline(e.target.value)}>{pipelines.map(p=><option key={p.id} value={p.id}>{p.name}{p.isDefault?' (principal)':''}</option>)}</select></label>
     {pipelineManager&&<>
      <form className="crm-p2-form" onSubmit={e=>void addPipeline(e)}>
       <label>Nome do novo funil<input required maxLength={120} value={newPipeline} onChange={e=>setNewPipeline(e.target.value)}/></label>
       <button disabled={busy} className="primary-button"><Plus size={16}/> Criar funil</button>
      </form>
      {activePipeline&&!activePipeline.isDefault&&<button type="button" disabled={busy} className="secondary-button" onClick={()=>void submit(()=>api.setDefaultPipeline(token,activePipeline.id),'Novo funil principal definido.')}>Definir como principal</button>}
     </>}
    </div>
    <div className="panel crm-p2-form">
     <h3>Etapas e probabilidades</h3>
     <p className="muted">Ganho e perdido são etapas terminais; outras etapas podem ser adicionadas sem alterar a contabilidade.</p>
     {activePipeline?.stages.filter(s=>s.active).sort((a,b)=>a.position-b.position).map(stage=><div className="crm-p2-stage" key={stage.id}>
      <div><strong>{stage.name}</strong><small>{stage.legacyStage} · {(stage.probabilityBps/100).toLocaleString('pt-BR')}% de chance de ganho</small></div>
      {pipelineManager&&<button type="button" disabled={busy} className="secondary-button small" onClick={()=>{
       const name=window.prompt('Nome da etapa',stage.name);if(!name?.trim())return;
       const chance=window.prompt('Probabilidade de ganho (%)',(stage.probabilityBps/100).toString());
       if(chance===null)return;
       const probability=Number(chance.replace(',','.'));
       if(!Number.isFinite(probability)){setError('Probabilidade inválida');return;}
       void submit(()=>api.saveStage(token,{id:stage.id,pipelineId:activePipeline.id,name,probabilityBps:Math.round(probability*100)}),'Etapa atualizada.');
      }}>Editar</button>}
     </div>)}
     {pipelineManager&&activePipeline&&<form className="crm-p2-form" onSubmit={e=>void addStage(e)}>
      <h3>Adicionar etapa ao funil</h3>
      <label>Nome<input required value={stageDraft.name} onChange={e=>setStageDraft({...stageDraft,name:e.target.value})}/></label>
      <div className="crm-p2-two">
       <label>Categoria<select value={stageDraft.legacyStage} onChange={e=>setStageDraft({...stageDraft,legacyStage:e.target.value as CrmStage})}><option value="NEW">Contato</option><option value="QUALIFIED">Qualificação</option><option value="PROPOSAL">Negociação</option></select></label>
       <label>Probabilidade (%)<input required type="number" min="0" max="100" step="0.01" value={stageDraft.probability} onChange={e=>setStageDraft({...stageDraft,probability:e.target.value})}/></label>
      </div>
      <button className="primary-button" disabled={busy}>Adicionar etapa</button>
     </form>}
    </div>
   </div>
  </>}
 </div>;
}
