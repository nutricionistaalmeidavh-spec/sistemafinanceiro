import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Pause, Pencil, Play, Plus, RefreshCcw, Search } from 'lucide-react';
import { brl, can, toCents, today } from '../lib/format';

type Props = { token:string; session:FinanceiroSession };
function forecast(rule:RecurringRule,count=3){
  if(rule.lifecycleStatus==='COMPLETED')return [];
  const dates:string[]=[];let cursor=rule.nextDueAt;
  for(let index=0;index<count;index++){
    if(rule.maxOccurrences!=null&&rule.generatedCount+index>=rule.maxOccurrences)break;
    if(rule.endDate&&cursor>rule.endDate)break;
    dates.push(cursor);
    const d=new Date(cursor+'T00:00:00Z');
    const absolute=d.getUTCFullYear()*12+d.getUTCMonth()+rule.intervalMonths;
    const year=Math.floor(absolute/12);const month=absolute%12;
    const last=new Date(Date.UTC(year,month+1,0)).getUTCDate();
    cursor=`${year}-${String(month+1).padStart(2,'0')}-${String(Math.min(rule.dueDay,last)).padStart(2,'0')}`;
  }
  return dates;
}
function previewDraft(startDate:string,dueDay:number,intervalMonths:number,maxOccurrences:number|null,endDate:string|null,alreadyGenerated=0){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate)||!Number.isInteger(dueDay)||dueDay<1||dueDay>31||
    !Number.isInteger(intervalMonths)||intervalMonths<1||intervalMonths>12)return [] as string[];
  const start=new Date(startDate+'T00:00:00Z');
  if(Number.isNaN(start.getTime()))return [] as string[];
  const dates:string[]=[];
  let year=start.getUTCFullYear(),month=start.getUTCMonth();
  for(let attempt=0;attempt<48 && dates.length<3;attempt++){
    const last=new Date(Date.UTC(year,month+1,0)).getUTCDate();
    const due=`${year}-${String(month+1).padStart(2,'0')}-${String(Math.min(last,dueDay)).padStart(2,'0')}`;
    if(endDate&&due>endDate)break;
    if(due>=startDate){
      if(maxOccurrences!=null&&alreadyGenerated+dates.length>=maxOccurrences)break;
      dates.push(due);
    }
    const next=year*12+month+intervalMonths;
    year=Math.floor(next/12);month=next%12;
  }
  return dates;
}
const initialForm = () => ({
  description:'',amount:'',startDate:today(),endDate:'',dueDay:String(new Date().getDate()),intervalMonths:'1',
  maxOccurrences:'',accountId:'',categoryId:'',counterpartyId:'',notes:'',
});
export default function RecurringPage({token,session}:Props){
  const api=window.financeiro!;
  const editable=can(session,'finance.manage');
  const [kind,setKind]=useState<FinanceiroKind>('PAYABLE');
  const [rules,setRules]=useState<RecurringRule[]>([]);
  const [accounts,setAccounts]=useState<FinanceAccount[]>([]);
  const [categories,setCategories]=useState<FinancialCategory[]>([]);
  const [parties,setParties]=useState<PartyRecord[]>([]);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const [search,setSearch]=useState('');
  const [editingRule,setEditingRule]=useState<RecurringRule|null>(null);
  const [form,setForm]=useState(initialForm);
  const [historyRule,setHistoryRule]=useState<RecurringRule|null>(null);
  const [history,setHistory]=useState<FinanceEntry[]>([]);
  const [historyBusy,setHistoryBusy]=useState(false);
  const draftDates=useMemo(()=>previewDraft(
    editingRule?.nextDueAt||form.startDate,Number(form.dueDay),Number(form.intervalMonths),
    form.maxOccurrences?Number(form.maxOccurrences):null,form.endDate||null,editingRule?.generatedCount||0
  ),[editingRule,form.startDate,form.dueDay,form.intervalMonths,form.maxOccurrences,form.endDate]);
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
    event.preventDefault();
    if(busy)return;
    setBusy(true);
    try{
      const input={kind,description:form.description,amountCents:toCents(form.amount),
        startDate:form.startDate,endDate:form.endDate||null,dueDay:Number(form.dueDay),
        intervalMonths:Number(form.intervalMonths),maxOccurrences:form.maxOccurrences?Number(form.maxOccurrences):null,
        accountId:form.accountId||null,categoryId:form.categoryId||null,notes:form.notes||null,
        ...(kind==='PAYABLE'?{creditorId:form.counterpartyId||null}:{customerId:form.counterpartyId||null})
      };
      if(editingRule) await api.recurrence.update(token,editingRule.id,input);
      else {await api.recurrence.create(token,input);await api.recurrence.generate(token,today());}
      setEditingRule(null);setForm(initialForm());await reload();
      setNotice('Recorrência salva. As parcelas já geradas permanecem inalteradas.');
    }catch(err){setError(err instanceof Error?err.message:String(err));}
    finally{setBusy(false);}
  }
  async function viewHistory(rule:RecurringRule){
    if(historyBusy)return;
    setHistoryBusy(true);setError('');
    try {
      const entries=await api.finance.listEntries(token,{recurrenceRuleId:rule.id});
      setHistoryRule(rule);
      setHistory(entries.sort((a,b)=>a.dueAt.localeCompare(b.dueAt)));
    } catch(err) {setError(err instanceof Error?err.message:String(err));}
    finally{setHistoryBusy(false);}
  }
  async function toggle(rule:RecurringRule){
    try{await api.recurrence.setActive(token,rule.id,!rule.active);await reload();}
    catch(err){setError(err instanceof Error?err.message:String(err));}
  }
  async function generate(){
    try{await api.recurrence.generate(token,today());await reload();}
    catch(err){setError(err instanceof Error?err.message:String(err));}
  }
  const filtered=useMemo(()=>{
    const term=search.trim().toLocaleLowerCase('pt-BR');
    return rules.filter(rule=>!term||[rule.description,rule.kind,rule.nextDueAt].some(value=>String(value||'').toLocaleLowerCase('pt-BR').includes(term)));
  },[rules,search]);
  return <section className="page-stack" data-testid="page-recurring">
    <div className="page-header"><div><p className="eyebrow">Recorrências</p>
      <h2>Contas automáticas</h2><p className="muted">Vencimentos gerados automaticamente na abertura e durante o uso do aplicativo.</p>
    </div>{editable&&<button type="button" className="secondary-button" onClick={()=>void generate()}><RefreshCcw size={16}/> Atualizar vencimentos</button>}</div>
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
      <div className="wide recurrence-preview" aria-label="Próximas parcelas"><strong>Próximas parcelas previstas</strong>
        <p className="muted">Esta prévia não cria lançamentos. As parcelas são geradas quando o vencimento chega.</p>
        <div className="chip-row">{draftDates.length?draftDates.map(date=><span className="badge" key={date}>{date.split('-').reverse().join('/')} · {form.amount||'Valor não informado'}</span>):
          <span className="muted">Não há parcelas previstas com esses limites.</span>}</div>
      </div>
      <button className="primary-button" type="submit" disabled={busy}>{busy?'Salvando…':editingRule?'Salvar alterações':'Salvar recorrência'}</button>
      {editingRule&&<button className="secondary-button" type="button" onClick={()=>{setEditingRule(null);setForm(initialForm());}}>Cancelar edição</button>}
    </form>}
    <div className="panel table-panel table-scroll"><table><thead><tr><th>Descrição</th><th>Tipo</th><th>Valor</th><th>Próximo</th><th>Geradas</th><th>Status</th><th>Próximas ocorrências</th><th>Ações</th></tr></thead>
      <tbody>{filtered.map(rule=><tr key={rule.id}>
        <td><strong>{rule.description}</strong></td><td>{rule.kind==='PAYABLE'?'Pagar':'Receber'}</td>
        <td>{brl(rule.amountCents)}</td><td>{rule.nextDueAt}</td>
        <td>{rule.generatedCount}{rule.maxOccurrences?` / ${rule.maxOccurrences}`:''}</td>
        <td><span className={`badge ${rule.lifecycleStatus==='ACTIVE'?'badge-settled':'badge-cancelled'}`}>{rule.lifecycleStatus==='ACTIVE'?'Ativa':rule.lifecycleStatus==='PAUSED'?'Pausada':'Concluída'}</span></td>
        <td>{forecast(rule).join(' · ')||'Sem próximas parcelas'}</td>
        <td><div className="row-actions">
          <button type="button" className="secondary-button small" disabled={historyBusy} onClick={()=>void viewHistory(rule)}>Ver lançamentos</button>
          {editable&&<button type="button" className="secondary-button small" onClick={()=>edit(rule)}><Pencil size={14}/> Editar</button>}
          {editable&&rule.lifecycleStatus!=='COMPLETED'&&<button type="button" className="secondary-button small" disabled={busy} onClick={()=>void toggle(rule)}>{rule.active?<Pause size={14}/>:<Play size={14}/>} {rule.active?'Pausar':'Ativar'}</button>}
        </div></td>
      </tr>)}</tbody></table>
      {filtered.length===0&&<div className="empty-state">Nenhuma recorrência encontrada.</div>}
    </div>
    {historyRule&&<section className="panel" data-testid="recurrence-history" aria-label="Histórico da recorrência">
      <div className="panel-title"><div><h3>Histórico: {historyRule.description}</h3>
      <p className="muted">{history.length} lançamento(s) vinculado(s). Alterar a regra não reescreve parcelas anteriores.</p></div>
      <button type="button" className="secondary-button" onClick={()=>setHistoryRule(null)}>Fechar histórico</button></div>
      <div className="compact-list">{history.map(entry=><div key={entry.id}>
        <strong>{entry.dueAt.split('-').reverse().join('/')} · {brl(entry.amountCents)}</strong>
        <small>{entry.status==='SETTLED'?'Quitado':entry.status==='PARTIAL'?'Pago parcialmente':entry.status==='CANCELLED'?'Cancelado':'Em aberto'} · Saldo: {brl(entry.openCents)}</small>
      </div>)}{history.length===0&&<p className="muted">Nenhuma parcela gerada até o momento.</p>}</div>
    </section>}
  </section>;
}
