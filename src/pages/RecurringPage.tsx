import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Pause, Pencil, Play, Plus, RefreshCcw, Search } from 'lucide-react';
import { brl, can, toCents, today } from '../lib/format';

type Props = { token:string; session:FinanceiroSession; onNavigate:(page:'finance')=>void };
function ruleCompleted(rule:RecurringRule){
  return !rule.active && ((rule.maxOccurrences!=null && rule.generatedCount>=rule.maxOccurrences) ||
    (Boolean(rule.endDate)&&rule.nextDueAt>String(rule.endDate)));
}
function previewDates(start:string,day:number,interval:number,max:number|null,end:string|null,count=0):string[]{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!Number.isInteger(day)||day<1||day>31||!Number.isInteger(interval)||interval<1||interval>12)return [];
  const result:string[]=[];
  let d=new Date(`${start}T00:00:00Z`);
  if(Number.isNaN(d.valueOf()))return [];
  for(let i=0;result.length<3&&i<120;i++){
    const year=d.getUTCFullYear(),month=d.getUTCMonth();
    const last=new Date(Date.UTC(year,month+1,0)).getUTCDate();
    const due=`${year}-${String(month+1).padStart(2,'0')}-${String(Math.min(day,last)).padStart(2,'0')}`;
    if(due>=start){
      if(end&&due>end)break;
      if(max!=null&&count+result.length>=max)break;
      result.push(due);
    }
    d=new Date(Date.UTC(year,month+interval,1));
  }
  return result;
}
const initialForm = () => ({
  description:'',amount:'',startDate:today(),endDate:'',dueDay:String(new Date().getDate()),intervalMonths:'1',
  maxOccurrences:'',accountId:'',categoryId:'',counterpartyId:'',notes:'',
});
export default function RecurringPage({token,session,onNavigate}:Props){
  const api=window.financeiro!;
  const editable=can(session,'finance.manage');
  const [kind,setKind]=useState<FinanceiroKind>('PAYABLE');
  const [rules,setRules]=useState<RecurringRule[]>([]);
  const [accounts,setAccounts]=useState<FinanceAccount[]>([]);
  const [categories,setCategories]=useState<FinancialCategory[]>([]);
  const [parties,setParties]=useState<PartyRecord[]>([]);
  const [error,setError]=useState('');
  const [search,setSearch]=useState('');
  const [editingRule,setEditingRule]=useState<RecurringRule|null>(null);
  const [form,setForm]=useState(initialForm);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [historyRule,setHistoryRule]=useState<RecurringRule|null>(null);
  const [history,setHistory]=useState<FinanceEntry[]>([]);
  const reload=useCallback(async()=>{
    try {
      const [nextRules,nextAccounts,nextCategories,nextParties]=await Promise.all([
        api.recurrence.list(token),api.finance.listAccounts(token),
        api.registry.listCategories(token,{nature:kind==='PAYABLE'?'EXPENSE':'REVENUE'}),
        kind==='PAYABLE'?api.registry.listCreditors(token):api.registry.listCustomers(token)
      ]);
      setRules(nextRules);setAccounts(nextAccounts);setCategories(nextCategories);setParties(nextParties);setError('');
    } catch(err){setError(err instanceof Error?err.message:String(err));}
  },[api,token,kind]);
  useEffect(()=>{void reload();},[reload]);
  useEffect(()=>api.finance.onDataChanged(()=>{void reload();}),[api,reload]);

  function edit(rule:RecurringRule) {
    setKind(rule.kind);
    setEditingRule(rule);
    setForm({description:rule.description,amount:(rule.amountCents/100).toFixed(2).replace('.',','),
      startDate:rule.startDate,endDate:rule.endDate||'',dueDay:String(rule.dueDay),
      intervalMonths:String(rule.intervalMonths),maxOccurrences:rule.maxOccurrences==null?'':String(rule.maxOccurrences),
      accountId:rule.accountId||'',categoryId:rule.categoryId||'',
      counterpartyId:(rule.kind==='PAYABLE'?rule.creditorId:rule.customerId)||'',notes:rule.notes||''});
  }
  async function save(event:FormEvent){
    event.preventDefault();if(busy)return;setBusy(true);setError('');
    try{
      const input={kind,description:form.description,amountCents:toCents(form.amount),
        startDate:form.startDate,endDate:form.endDate||null,dueDay:Number(form.dueDay),
        intervalMonths:Number(form.intervalMonths),maxOccurrences:form.maxOccurrences?Number(form.maxOccurrences):null,
        accountId:form.accountId||null,categoryId:form.categoryId||null,notes:form.notes||null,
        ...(kind==='PAYABLE'?{creditorId:form.counterpartyId||null}:{customerId:form.counterpartyId||null})
      };
      if(editingRule) await api.recurrence.update(token,editingRule.id,input);
      else {await api.recurrence.create(token,input);await api.recurrence.generate(token,today());}
      setEditingRule(null);setForm(initialForm());await reload();setNotice('Recorrência salva. Alterações futuras preservam o histórico já gerado.');
    }catch(err){setError(err instanceof Error?err.message:String(err));}
    finally{setBusy(false);}
  }
  async function toggle(rule:RecurringRule){
    if(busy||ruleCompleted(rule))return;setBusy(true);setError('');
    try{await api.recurrence.setActive(token,rule.id,!rule.active);await reload();setNotice(rule.active?'Recorrência pausada.':'Recorrência reativada.');}
    catch(err){setError(err instanceof Error?err.message:String(err));}
    finally{setBusy(false);}
  }
  async function generate(){
    if(busy)return;setBusy(true);setError('');
    try{const records=await api.recurrence.generate(token,today());await reload();setNotice(records.length?`${records.length} lançamento(s) gerado(s).`:'Recorrências atualizadas. Nenhum lançamento duplicado.');}
    catch(err){setError(err instanceof Error?err.message:String(err));}
    finally{setBusy(false);}
  }
  async function viewHistory(rule:RecurringRule){
    try{const rows=await api.finance.listEntries(token,{recurrenceRuleId:rule.id});setHistory(rows);setHistoryRule(rule);}
    catch(err){setError(err instanceof Error?err.message:String(err));}
  }
  const upcoming=useMemo(()=>previewDates(editingRule?.nextDueAt||form.startDate,Number(form.dueDay),Number(form.intervalMonths),form.maxOccurrences?Number(form.maxOccurrences):null,form.endDate||null,editingRule?.generatedCount||0),[editingRule,form.startDate,form.dueDay,form.intervalMonths,form.maxOccurrences,form.endDate]);
  const filtered=useMemo(()=>{
    const term=search.trim().toLocaleLowerCase('pt-BR');
    return rules.filter(rule=>!term||[rule.description,rule.kind,rule.nextDueAt].some(value=>String(value||'').toLocaleLowerCase('pt-BR').includes(term)));
  },[rules,search]);
  return <section className="page-stack" data-testid="page-recurring">
    <div className="page-header"><div><p className="eyebrow">Recorrências</p>
      <h2>Contas automáticas</h2><p className="muted">Vencimentos gerados automaticamente na abertura e durante o uso do aplicativo.</p>
    </div>{editable&&<button type="button" className="secondary-button" disabled={busy} onClick={()=>void generate()}><RefreshCcw size={16}/> Atualizar vencimentos</button>}</div>
    {error&&<div className="error-box" role="alert">{error}</div>}
    {notice&&<div className="success-box" role="status">{notice}</div>}
    <div className="page-toolbar"><p className="section-caption">{rules.filter(rule=>rule.active).length} regras ativas</p>
      <label className="search-control"><Search size={16}/><input data-testid="recurring-search" aria-label="Buscar recorrências" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar descrição ou vencimento"/></label>
    </div>
    {editable&&<form className="panel form-grid" onSubmit={save} data-testid="recurring-form">
      <h3>{editingRule?<Pencil size={18}/>:<Plus size={18}/>} {editingRule?'Editar recorrência':'Nova recorrência'}</h3>
      <label>Tipo<select value={kind} disabled={Boolean(editingRule)} onChange={e=>{setKind(e.target.value as FinanceiroKind);setForm(old=>({...old,categoryId:'',counterpartyId:''}));}}>
        <option value="PAYABLE">A pagar</option><option value="RECEIVABLE">A receber</option></select></label>
      <label className="wide">Descrição<input required value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label>
      <label>Valor<input required value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})} placeholder="0,00"/></label>
      <label>Início<input type="date" required disabled={Boolean(editingRule?.generatedCount)} value={form.startDate} onChange={e=>setForm({...form,startDate:e.target.value})}/></label>
      <label>Dia do vencimento<input type="number" min="1" max="31" required value={form.dueDay} onChange={e=>setForm({...form,dueDay:e.target.value})}/></label>
      <label>Frequência<select value={form.intervalMonths} onChange={e=>setForm({...form,intervalMonths:e.target.value})}>
        <option value="1">Mensal</option><option value="2">Bimestral</option><option value="3">Trimestral</option><option value="6">Semestral</option><option value="12">Anual</option>
      </select></label>
      <label>Término (opcional)<input type="date" value={form.endDate} onChange={e=>setForm({...form,endDate:e.target.value})}/></label>
      <label>Nº máximo de parcelas<input type="number" min={editingRule?.generatedCount||1} value={form.maxOccurrences} onChange={e=>setForm({...form,maxOccurrences:e.target.value})} placeholder="Sem limite"/></label>
      <label>Conta<select value={form.accountId} onChange={e=>setForm({...form,accountId:e.target.value})}>
        <option value="">Definir no pagamento</option>{accounts.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
      </select></label>
      <label>Categoria<select value={form.categoryId} onChange={e=>setForm({...form,categoryId:e.target.value})}>
        <option value="">Sem categoria</option>{categories.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
      </select></label>
      <label>{kind==='PAYABLE'?'Credor':'Cliente'}<select value={form.counterpartyId} onChange={e=>setForm({...form,counterpartyId:e.target.value})}>
        <option value="">Não informado</option>{parties.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
      </select></label>
      <label className="wide">Observações<input value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></label>
      <section className="wide recurrence-preview" aria-label="Prévia de vencimentos"><strong>Próximas parcelas previstas</strong><p className="muted">Apenas uma prévia: os lançamentos são criados quando cada vencimento chega.</p><div className="chip-row">{upcoming.length?upcoming.map(date=><span className="badge" key={date}>{date.split('-').reverse().join('/')}{form.amount?' · '+form.amount:''}</span>):<span className="muted">Nenhuma parcela futura com esses limites.</span>}</div></section>
      <button className="primary-button" disabled={busy} type="submit">{busy?'Salvando…':editingRule?'Salvar alterações':'Salvar recorrência'}</button>
      {editingRule&&<button className="secondary-button" type="button" onClick={()=>{setEditingRule(null);setForm(initialForm());}}>Cancelar edição</button>}
    </form>}
    <div className="panel table-panel table-scroll"><table><thead><tr><th>Descrição</th><th>Tipo</th><th>Valor</th><th>Próximo</th><th>Geradas</th><th>Status</th><th>Ações</th></tr></thead>
      <tbody>{filtered.map(rule=><tr key={rule.id}>
        <td><strong>{rule.description}</strong></td><td>{rule.kind==='PAYABLE'?'Pagar':'Receber'}</td>
        <td>{brl(rule.amountCents)}</td><td>{rule.nextDueAt}</td>
        <td>{rule.generatedCount}{rule.maxOccurrences?` / ${rule.maxOccurrences}`:''}</td>
        <td><span className={`badge ${rule.active?'badge-settled':'badge-cancelled'}`}>{rule.active?'Ativa':ruleCompleted(rule)?'Concluída':'Pausada'}</span></td>
        <td>{editable&&<div className="row-actions">
          <button type="button" className="secondary-button small" onClick={()=>edit(rule)}><Pencil size={14}/> Editar</button>
          {!ruleCompleted(rule)&&<button type="button" disabled={busy} className="secondary-button small" onClick={()=>void toggle(rule)}>{rule.active?<Pause size={14}/>:<Play size={14}/>} {rule.active?'Pausar':'Ativar'}</button>}
        </div>}<button type="button" className="secondary-button small" onClick={()=>void viewHistory(rule)}>Ver lançamentos</button></td>
      </tr>)}</tbody></table>
      {filtered.length===0&&<div className="empty-state">Nenhuma recorrência encontrada.</div>}
    </div>
    {historyRule&&<section className="panel"><div className="panel-title"><div><h3>Histórico: {historyRule.description}</h3><p className="muted">Lançamentos desta regra; parcelas anteriores não são reescritas ao editar.</p></div><button className="secondary-button" type="button" onClick={()=>setHistoryRule(null)}>Fechar</button></div><div className="compact-list">{history.map(item=><div key={item.id}><strong>{item.dueAt.split('-').reverse().join('/')} · {brl(item.amountCents)}</strong><small>{item.status==='SETTLED'?'Quitado':item.status==='PARTIAL'?'Parcial':item.status==='OPEN'?'Em aberto':'Cancelado'}</small></div>)}{history.length===0&&<p className="muted">Ainda não há parcelas lançadas.</p>}</div><button className="secondary-button" type="button" onClick={()=>onNavigate('finance')}>Abrir contas a pagar/receber</button></section>}
  </section>;
}
