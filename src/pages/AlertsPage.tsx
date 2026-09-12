import { FormEvent, useCallback, useEffect, useState } from 'react';
import { BellRing, Check, EyeOff, Gauge, Megaphone } from 'lucide-react';
import { brl, can, toCents, today } from '../lib/format';

type Props = { token:string; session:FinanceiroSession };

export default function AlertsPage({ token, session }: Props) {
  const api = window.financeiro!;
  const [alerts, setAlerts] = useState<FinanceAlert[]>([]);
  const [thresholds, setThresholds] = useState<AlertThreshold[]>([]);
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [error, setError] = useState('');
  const [thresholdForm, setThresholdForm] = useState({ accountId:'', amount:'' });
  const [notice, setNotice] = useState({ title:'', body:'', severity:'INFO' as 'INFO'|'WARNING'|'CRITICAL', startsAt:today(), endsAt:'' });
  const editable = can(session, 'finance.manage');
  const admin = can(session, 'system.manage');

  const reload = useCallback(async () => {
    try {
      const [nextAlerts,nextThresholds,nextAccounts] = await Promise.all([api.alerts.list(token,{asOf:today()}),api.alerts.listThresholds(token),api.finance.listAccounts(token)]);
      setAlerts(nextAlerts); setThresholds(nextThresholds); setAccounts(nextAccounts); setThresholdForm((old)=>({...old,accountId:old.accountId||nextAccounts[0]?.id||''})); setError('');
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }, [api,token]);
  useEffect(()=>{void reload();},[reload]);

  async function ack(item:FinanceAlert,state:'READ'|'DISMISSED'){ try{await api.alerts.acknowledge(token,item.key,state);await reload();}catch(err){setError(err instanceof Error?err.message:String(err));} }
  async function saveThreshold(event:FormEvent){event.preventDefault();try{await api.alerts.setThreshold(token,thresholdForm.accountId,toCents(thresholdForm.amount),true);setThresholdForm({...thresholdForm,amount:''});await reload();}catch(err){setError(err instanceof Error?err.message:String(err));}}
  async function saveNotice(event:FormEvent){event.preventDefault();try{await api.alerts.saveInternal(token,{...notice,endsAt:notice.endsAt||undefined});setNotice({title:'',body:'',severity:'INFO',startsAt:today(),endsAt:''});await reload();}catch(err){setError(err instanceof Error?err.message:String(err));}}

  return <section className="page-stack"><div className="page-header"><div><p className="eyebrow">Alertas</p><h2>Central de avisos</h2><p className="muted">Vencimentos, atrasos, saldos baixos e comunicados internos.</p></div><span className="status">{alerts.length} ativos</span></div>
    {error&&<div className="error-box">{error}</div>}
    <div className="alert-grid">{alerts.map((item)=><article key={item.key} className={`panel alert-card severity-${item.severity.toLowerCase()}`}><div className="alert-icon"><BellRing size={18}/></div><div><div className="alert-title"><strong>{item.title}</strong><span className="badge">{item.type}</span></div><p>{item.body}</p>{typeof item.amountCents==='number'&&<small>{brl(item.amountCents)}{typeof item.thresholdCents==='number'?` · limite ${brl(item.thresholdCents)}`:''}</small>}</div><div className="row-actions"><button title="Marcar como lido" onClick={()=>void ack(item,'READ')}><Check size={15}/></button><button title="Ocultar" onClick={()=>void ack(item,'DISMISSED')}><EyeOff size={15}/></button></div></article>)}{alerts.length===0&&<div className="panel empty-state">Nenhum alerta ativo.</div>}</div>
    {editable&&<div className="two-columns"><form className="panel form-grid" onSubmit={saveThreshold}><h3><Gauge size={18}/> Alerta de saldo baixo</h3><label>Conta<select required value={thresholdForm.accountId} onChange={(e)=>setThresholdForm({...thresholdForm,accountId:e.target.value})}><option value="">Selecione</option>{accounts.map((x)=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label>Limite<input required value={thresholdForm.amount} onChange={(e)=>setThresholdForm({...thresholdForm,amount:e.target.value})} placeholder="0,00"/></label><button className="primary-button">Salvar limite</button><div className="wide muted">{thresholds.map((x)=><span key={x.accountId} className="inline-chip">{x.accountName}: {brl(x.thresholdCents)}</span>)}</div></form>
      {admin&&<form className="panel form-grid" onSubmit={saveNotice}><h3><Megaphone size={18}/> Aviso interno</h3><label className="wide">Título<input required value={notice.title} onChange={(e)=>setNotice({...notice,title:e.target.value})}/></label><label className="wide">Mensagem<input value={notice.body} onChange={(e)=>setNotice({...notice,body:e.target.value})}/></label><label>Severidade<select value={notice.severity} onChange={(e)=>setNotice({...notice,severity:e.target.value as typeof notice.severity})}><option value="INFO">Informação</option><option value="WARNING">Atenção</option><option value="CRITICAL">Crítico</option></select></label><label>Início<input type="date" value={notice.startsAt} onChange={(e)=>setNotice({...notice,startsAt:e.target.value})}/></label><label>Fim opcional<input type="date" value={notice.endsAt} onChange={(e)=>setNotice({...notice,endsAt:e.target.value})}/></label><button className="secondary-button">Publicar aviso</button></form>}</div>}
  </section>;
}
