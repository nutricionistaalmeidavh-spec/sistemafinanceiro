import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Pause, Pencil, Play, Plus, RefreshCcw, Search } from 'lucide-react';
import { brl, can, toCents, today } from '../lib/format';

type Props = { token:string; session:FinanceiroSession };
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
  const [search,setSearch]=useState('');
  const [editingRule,setEditingRule]=useState<RecurringRule|null>(null);
  const [form,setForm]=useState(initialForm);
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
    }catch(err){setError(err instanceof Error?err.message:String(err));}
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
    {error&&<div className="error-box">{error}</div>}
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
      <button className="primary-button" type="submit">{editingRule?'Salvar alterações':'Salvar recorrência'}</button>
      {editingRule&&<button className="secondary-button" type="button" onClick={()=>{setEditingRule(null);setForm(initialForm());}}>Cancelar edição</button>}
    </form>}
    <div className="panel table-panel table-scroll"><table><thead><tr><th>Descrição</th><th>Tipo</th><th>Valor</th><th>Próximo</th><th>Geradas</th><th>Status</th><th>Ações</th></tr></thead>
      <tbody>{filtered.map(rule=><tr key={rule.id}>
        <td><strong>{rule.description}</strong></td><td>{rule.kind==='PAYABLE'?'Pagar':'Receber'}</td>
        <td>{brl(rule.amountCents)}</td><td>{rule.nextDueAt}</td>
        <td>{rule.generatedCount}{rule.maxOccurrences?` / ${rule.maxOccurrences}`:''}</td>
        <td><span className={`badge ${rule.active?'badge-settled':'badge-cancelled'}`}>{rule.active?'ATIVA':'PAUSADA'}</span></td>
        <td>{editable&&<div className="row-actions">
          <button type="button" className="secondary-button small" onClick={()=>edit(rule)}><Pencil size={14}/> Editar</button>
          <button type="button" className="secondary-button small" onClick={()=>void toggle(rule)}>{rule.active?<Pause size={14}/>:<Play size={14}/>} {rule.active?'Pausar':'Ativar'}</button>
        </div>}</td>
      </tr>)}</tbody></table>
      {filtered.length===0&&<div className="empty-state">Nenhuma recorrência encontrada.</div>}
    </div>
  </section>;
}
