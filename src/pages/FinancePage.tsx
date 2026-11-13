import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { FileDown, Landmark, Pencil, Plus, Printer, RotateCcw, Search, XCircle } from 'lucide-react';
import { FinanceButton, FinanceDrawer, FinanceStatusBadge, FinanceToolbar } from '../components/finance-ui';
import { brl, can, toCents, today } from '../lib/format';

type Props = { token: string; session: FinanceiroSession };
type StatusFilter = 'ALL' | FinanceEntry['status'] | 'OVERDUE';
const emptySummary: FinancialSummary = { payableTotalCents:0,payableSettledCents:0,payableOpenCents:0,receivableTotalCents:0,receivableSettledCents:0,receivableOpenCents:0,overduePayableCents:0,overdueReceivableCents:0 };

export default function FinancePage({ token, session }: Props) {
  const api = window.financeiro!;
  const [kind, setKind] = useState<FinanceiroKind>('PAYABLE');
  const [entries, setEntries] = useState<FinanceEntry[]>([]);
  const [summary, setSummary] = useState<FinancialSummary>(emptySummary);
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [categories, setCategories] = useState<FinancialCategory[]>([]);
  const [customers, setCustomers] = useState<PartyRecord[]>([]);
  const [creditors, setCreditors] = useState<PartyRecord[]>([]);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [entryDrawerOpen, setEntryDrawerOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<FinanceEntry | null>(null);
  const [recurring, setRecurring] = useState(false);
  const [payingEntry, setPayingEntry] = useState<FinanceEntry | null>(null);
  const [paymentForm, setPaymentForm] = useState({amount:'',occurredAt:today(),accountId:'',method:'PIX',note:''});
  const [form, setForm] = useState({ description:'', amount:'', dueAt:today(), accountId:'', categoryId:'', counterpartyId:'' });
  const [busy,setBusy] = useState(false);
  const [notice,setNotice] = useState('');
  const [dialogError,setDialogError] = useState('');
  const [decision,setDecision] = useState<{entry:FinanceEntry;action:'CANCEL'|'REVERSE'}|null>(null);
  const [reason,setReason] = useState('');
  const [newParty,setNewParty] = useState('');
  const [accountForm, setAccountForm] = useState({ name:'', type:'BANK' as FinanceAccount['type'] });
  const editable = can(session, 'finance.manage');

  const reload = useCallback(async () => {
    try {
      const [nextEntries, nextSummary, nextAccounts, nextCategories, nextCustomers, nextCreditors] = await Promise.all([
        api.finance.listEntries(token, { kind }), api.finance.summary(token), api.finance.listAccounts(token),
        api.registry.listCategories(token, { nature: kind === 'PAYABLE' ? 'EXPENSE' : 'REVENUE' }), api.registry.listCustomers(token), api.registry.listCreditors(token),
      ]);
      setEntries(nextEntries); setSummary(nextSummary); setAccounts(nextAccounts); setCategories(nextCategories); setCustomers(nextCustomers); setCreditors(nextCreditors); setError('');
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }, [api, token, kind]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => api.finance.onDataChanged(() => { void reload(); }), [api, reload]);
  useEffect(() => { setForm((old) => ({ ...old, categoryId:'', counterpartyId:'' })); }, [kind]);
  const counterparties = kind === 'PAYABLE' ? creditors : customers;

  function openNewEntry() {
    setDialogError('');setNewParty('');
    setEditingEntry(null);
    setRecurring(false);
    setForm({description:'',amount:'',dueAt:today(),accountId:'',categoryId:'',counterpartyId:''});
    setEntryDrawerOpen(true);
  }
  function openEditEntry(entry:FinanceEntry) {
    setDialogError('');setNewParty('');
    setEditingEntry(entry);
    setRecurring(false);
    setForm({description:entry.description,amount:(entry.amountCents/100).toFixed(2).replace('.',','),
      dueAt:entry.dueAt,accountId:entry.accountId||'',categoryId:entry.categoryId||'',
      counterpartyId:(entry.kind==='PAYABLE'?entry.creditorId:entry.customerId)||''});
    setEntryDrawerOpen(true);
  }
  async function createEntry(event: FormEvent) {
    event.preventDefault();if(busy)return;
    setBusy(true);setDialogError('');
    try {
      const input = {
        kind, description: form.description, amountCents: toCents(form.amount), dueAt: form.dueAt,
        accountId: form.accountId || null, categoryId: form.categoryId || null,
        ...(kind === 'PAYABLE' ? { creditorId: form.counterpartyId || null } : { customerId: form.counterpartyId || null }),
      };
      if (editingEntry) await api.finance.updateEntry(token, editingEntry.id, input);
      else if (recurring) {
        await api.recurrence.create(token, {...input, startDate:form.dueAt,dueDay:Number(form.dueAt.slice(-2))});
        await api.recurrence.generate(token,today());
      } else await api.finance.createEntry(token,input);
      setForm({ description:'', amount:'', dueAt:today(), accountId:'', categoryId:'', counterpartyId:'' });
      setEntryDrawerOpen(false);
      setEditingEntry(null);
      setRecurring(false);
      await reload();setNotice(editingEntry?'Lançamento atualizado.':recurring?'Recorrência cadastrada.':'Lançamento cadastrado.');
    } catch (err) { setDialogError(err instanceof Error ? err.message : String(err)); }
    finally{setBusy(false);}
  }

  async function createAccount(event: FormEvent) {
    event.preventDefault();
    try { await api.finance.createAccount(token, accountForm); setAccountForm({ name:'', type:'BANK' }); await reload(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }

  function openPayment(entry:FinanceEntry) {
    setDialogError('');
    if (!accounts.length) { setError('Cadastre uma conta financeira abaixo antes de registrar o pagamento.'); return; }
    const cents = entry.openCents;
    setPaymentForm({amount:(cents/100).toFixed(2).replace('.',','),occurredAt:today(),
      accountId:entry.accountId || accounts[0].id,method:'PIX',note:''});
    setPayingEntry(entry);
  }
  async function savePayment(event:FormEvent) {
    event.preventDefault();
    if (!payingEntry||busy) return;
    setBusy(true);setDialogError('');
    try {
      const result=await api.finance.settleEntry(token,payingEntry.id,{
        amountCents:toCents(paymentForm.amount),occurredAt:paymentForm.occurredAt,
        accountId:paymentForm.accountId,method:paymentForm.method,note:paymentForm.note
      });
      setPayingEntry(null);
      await reload();
      setNotice(`${result.entry.kind==='PAYABLE'?'Pagamento':'Recebimento'} de ${brl(result.settlement.amountCents)} registrado em ${result.settlement.occurredAt}. Saldo em aberto: ${brl(result.entry.openCents)}.`);
    } catch(err) {setDialogError(err instanceof Error?err.message:String(err));}
    finally{setBusy(false);}
  }

  function openDecision(entry:FinanceEntry,action:'CANCEL'|'REVERSE'){
    setDecision({entry,action});setReason('');setDialogError('');
  }
  async function confirmDecision(event:FormEvent){
    event.preventDefault();if(!decision||busy)return;
    setBusy(true);setDialogError('');
    try{
      if(decision.action==='CANCEL')await api.finance.cancelEntry(token,decision.entry.id,reason.trim());
      else{
        const settlement=[...decision.entry.settlements].reverse().find(s=>!s.reversedAt);
        if(!settlement)throw new Error('Não há baixa ativa para estornar.');
        await api.finance.reverseSettlement(token,settlement.id,reason.trim());
      }
      const action=decision.action;setDecision(null);setReason('');await reload();
      setNotice(action==='CANCEL'?'Lançamento cancelado com histórico preservado.':'Última baixa estornada e saldo recalculado.');
    }catch(cause){setDialogError(cause instanceof Error?cause.message:String(cause));}
    finally{setBusy(false);}
  }
  async function createCounterparty(){
    if(!newParty.trim()||busy)return;
    setBusy(true);setDialogError('');
    try{
      const record=kind==='PAYABLE'
        ? await api.registry.saveCreditor(token,{name:newParty.trim()})
        : await api.registry.saveCustomer(token,{name:newParty.trim()});
      await reload();setForm(old=>({...old,counterpartyId:record.id}));
      setNewParty('');setNotice(`${kind==='PAYABLE'?'Credor':'Cliente'} cadastrado: ${record.name}`);
    }catch(cause){setDialogError(cause instanceof Error?cause.message:String(cause));}
    finally{setBusy(false);}
  }

  async function receiptPdf(entry: FinanceEntry) {
    const settlement = [...entry.settlements].reverse().find((item)=>!item.reversedAt); if (!settlement) return;
    try { await api.reports.saveReceiptPdf(token, settlement.id); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }
  async function receiptPrint(entry: FinanceEntry) {
    const settlement = [...entry.settlements].reverse().find((item)=>!item.reversedAt); if (!settlement) return;
    try { await api.reports.printReceipt(token, settlement.id); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }

  const filteredEntries = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR');
    return entries.filter((entry) => {
      const counterparty = entry.kind === 'PAYABLE' ? creditors.find((item)=>item.id===entry.creditorId) : customers.find((item)=>item.id===entry.customerId);
      const category = categories.find((item)=>item.id===entry.categoryId);
      const matchesTerm = !term || [entry.description, counterparty?.name, category?.name, entry.dueAt].some((value)=>String(value||'').toLocaleLowerCase('pt-BR').includes(term));
      const matchesStatus = statusFilter === 'ALL' || (statusFilter === 'OVERDUE' ? entry.isOverdue : entry.status === statusFilter);
      return matchesTerm && matchesStatus;
    });
  }, [entries, search, statusFilter, creditors, customers, categories]);
  const openTotal = useMemo(() => filteredEntries.filter((x) => x.status !== 'CANCELLED').reduce((sum, x) => sum + x.openCents, 0), [filteredEntries]);

  return <section className="page-stack" data-testid="page-finance">
    <div className="page-header"><div><p className="eyebrow">Financeiro</p><h2>Contas a pagar e receber</h2><p className="muted">Acompanhe vencimentos, baixas e histórico sem poluir a área de trabalho.</p></div></div>
    <div className="metric-grid">
      <div className="metric-card"><span>A receber em aberto</span><strong>{brl(summary.receivableOpenCents)}</strong></div>
      <div className="metric-card"><span>A pagar em aberto</span><strong>{brl(summary.payableOpenCents)}</strong></div>
      <div className="metric-card"><span>Vencidos</span><strong>{brl(summary.overduePayableCents + summary.overdueReceivableCents)}</strong></div>
      <div className="metric-card"><span>Filtro atual</span><strong>{brl(openTotal)}</strong></div>
    </div>
    {error && <div role="alert" className="error-box">{error}</div>}
    {notice&&<div role="status" className="success-box">{notice}</div>}
    <div className="segmented"><button type="button" className={kind==='PAYABLE'?'active':''} onClick={() => setKind('PAYABLE')}>Contas a pagar</button><button type="button" className={kind==='RECEIVABLE'?'active':''} onClick={() => setKind('RECEIVABLE')}>Contas a receber</button></div>
    <FinanceToolbar
      filters={<><label className="finance-search-control"><Search size={16}/><input data-testid="finance-search" aria-label="Buscar lançamentos" value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Buscar descrição, pessoa ou categoria"/></label><label className="filter-control"><span>Status</span><select aria-label="Filtrar status" value={statusFilter} onChange={(e)=>setStatusFilter(e.target.value as StatusFilter)}><option value="ALL">Todos os status</option><option value="OPEN">Em aberto</option><option value="PARTIAL">Parcial</option><option value="SETTLED">Quitado</option><option value="OVERDUE">Vencido</option><option value="CANCELLED">Cancelado</option></select></label></>}
      actions={editable ? <FinanceButton type="button" data-testid="finance-new-entry" onClick={openNewEntry}><Plus size={16}/>Novo lançamento</FinanceButton> : undefined}
    />

    <div className="panel table-panel table-scroll"><table><thead><tr><th>Descrição</th><th>Vencimento</th><th>Status</th><th>Valor</th><th>Em aberto</th><th></th></tr></thead><tbody>{filteredEntries.map((entry)=>{const hasReceipt=entry.settlements.some((item)=>!item.reversedAt);return <tr key={entry.id}><td><strong>{entry.description}</strong>{entry.isOverdue && <small className="danger-text">Vencido</small>}</td><td>{entry.dueAt}</td><td><FinanceStatusBadge status={entry.isOverdue && entry.status!=='SETTLED' ? 'OVERDUE' : entry.status}/></td><td>{brl(entry.amountCents)}</td><td>{brl(entry.openCents)}</td><td>{(editable||hasReceipt)&&<div className="row-actions">{editable&&entry.status!=='CANCELLED'&&entry.openCents>0&&<button type="button" onClick={()=>openPayment(entry)}>Registrar pagamento</button>}{editable&&entry.status!=='CANCELLED'&&entry.openCents>1&&<button type="button" {editable&&entry.status!=='CANCELLED'&&<button type="button" title="Editar lançamento" aria-label={`Editar ${entry.description}`} onClick={()=>openEditEntry(entry)}><Pencil size={15}/></button>}{editable&&entry.status!=='CANCELLED'&&entry.settlements.length>0&&<button type="button" title="Estornar última baixa" onClick={()=>openDecision(entry,'REVERSE')}><RotateCcw size={15}/></button>}{editable&&entry.status!=='CANCELLED'&&entry.settlements.length===0&&<button type="button" title="Cancelar" onClick={()=>openDecision(entry,'CANCEL')}><XCircle size={15}/></button>}{hasReceipt&&<button type="button" title="Salvar recibo em PDF" onClick={()=>void receiptPdf(entry)}><FileDown size={15}/></button>}{hasReceipt&&<button type="button" title="Imprimir recibo" onClick={()=>void receiptPrint(entry)}><Printer size={15}/></button>}</div>}</td></tr>})}</tbody></table>{filteredEntries.length===0 && <div className="empty-state">Nenhum lançamento encontrado com os filtros atuais.</div>}</div>

    {editable && <section className="panel finance-secondary-panel">
      <div><div className="panel-title"><div><h3><Landmark size={18}/>Contas financeiras</h3><p className="muted">Cadastre contas sem misturar essa tarefa com um novo lançamento.</p></div></div><div className="finance-account-summary">{accounts.map((account)=><span className="finance-account-chip" key={account.id}>{account.name}<small>{account.type}</small></span>)}{accounts.length===0&&<span className="muted">Nenhuma conta cadastrada.</span>}</div></div>
      <form className="inline-account-form" onSubmit={createAccount}><label>Nome<input value={accountForm.name} onChange={(e)=>setAccountForm({...accountForm,name:e.target.value})} required/></label><label>Tipo<select value={accountForm.type} onChange={(e)=>setAccountForm({...accountForm,type:e.target.value as FinanceAccount['type']})}><option value="BANK">Banco</option><option value="CASH">Caixa</option><option value="CARD">Cartão</option><option value="OTHER">Outro</option></select></label><FinanceButton variant="secondary">Adicionar conta</FinanceButton></form>
    </section>}

    <FinanceDrawer open={entryDrawerOpen} title={editingEntry?'Editar lançamento':kind==='PAYABLE'?'Nova conta a pagar':'Nova conta a receber'} description="Preencha os dados financeiros. Todas as alterações ficam auditadas." onClose={()=>{setEntryDrawerOpen(false);setEditingEntry(null);}}>
      <div data-testid="finance-entry-drawer">
        <form className="form-grid drawer-form" onSubmit={createEntry}>
          {dialogError&&<p className="wide error-box" role="alert">{dialogError}</p>}
          <label className="wide">Descrição<input value={form.description} onChange={(e)=>setForm({...form,description:e.target.value})} required autoFocus/></label>
          <label>Valor<input value={form.amount} onChange={(e)=>setForm({...form,amount:e.target.value})} placeholder="0,00" required/></label>
          <label>Vencimento<input type="date" value={form.dueAt} onChange={(e)=>setForm({...form,dueAt:e.target.value})} required/></label>
          <label>Categoria<select value={form.categoryId} onChange={(e)=>setForm({...form,categoryId:e.target.value})}><option value="">Sem categoria</option>{categories.map((x)=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label>{kind==='PAYABLE'?'Credor':'Cliente'}<select value={form.counterpartyId} onChange={(e)=>setForm({...form,counterpartyId:e.target.value})}><option value="">Não informado</option>{counterparties.map((x)=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          {can(session,'registry.manage')&&<div className="wide inline-account-form"><label>Novo {kind==='PAYABLE'?'credor':'cliente'}<input value={newParty} onChange={e=>setNewParty(e.target.value)} placeholder="Cadastrar sem sair"/></label><button type="button" disabled={busy||!newParty.trim()} className="secondary-button" onClick={()=>void createCounterparty()}>Adicionar {kind==='PAYABLE'?'credor':'cliente'}</button></div>}
          <label className="wide">Conta<select value={form.accountId} onChange={(e)=>setForm({...form,accountId:e.target.value})}><option value="">Definir na baixa</option>{accounts.map((x)=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          {!editingEntry && <label className="wide"><input type="checkbox" checked={recurring} onChange={(e)=>setRecurring(e.target.checked)}/> Repetir mensalmente a partir do vencimento (geração automática)</label>}
          <FinanceButton type="submit" disabled={busy}>{busy?'Salvando…':editingEntry?'Salvar alterações':recurring?'Criar conta recorrente':'Salvar lançamento'}</FinanceButton>
        </form>
      </div>
    </FinanceDrawer>
    <FinanceDrawer open={Boolean(payingEntry)} title={kind==='PAYABLE'?'Registrar pagamento':'Registrar recebimento'} description="Registre o valor efetivamente pago ou recebido; não envia dinheiro ao banco." onClose={()=>{if(!busy)setPayingEntry(null);}}>
      <form className="form-grid drawer-form" data-testid="finance-payment-form" onSubmit={savePayment}>
        <p className="wide">{payingEntry?.description} — aberto: {brl(payingEntry?.openCents||0)}</p>
        {dialogError&&<p className="wide error-box" role="alert">{dialogError} Corrija os dados ou solicite a aprovação necessária.</p>}
        <p className="wide muted">Altere o valor para registrar um pagamento parcial. A operação apenas registra a baixa, sem transferir dinheiro.</p>
        <label>Valor pago/recebido<input required value={paymentForm.amount} onChange={(e)=>setPaymentForm({...paymentForm,amount:e.target.value})} /></label>
        <label>Data<input required type="date" value={paymentForm.occurredAt} onChange={(e)=>setPaymentForm({...paymentForm,occurredAt:e.target.value})}/></label>
        <label>Conta financeira<select required value={paymentForm.accountId} onChange={(e)=>setPaymentForm({...paymentForm,accountId:e.target.value})}>{accounts.map((x)=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label>Forma de pagamento<select value={paymentForm.method} onChange={(e)=>setPaymentForm({...paymentForm,method:e.target.value})}>
          <option value="PIX">PIX</option><option value="CASH">Dinheiro</option><option value="TRANSFER">Transferência</option><option value="BOLETO">Boleto</option><option value="DEBIT_CARD">Cartão de débito</option><option value="CREDIT_CARD">Cartão de crédito</option><option value="OTHER">Outro</option>
        </select></label>
        <label className="wide">Observação<input value={paymentForm.note} onChange={(e)=>setPaymentForm({...paymentForm,note:e.target.value})}/></label>
        <FinanceButton type="submit" disabled={busy}>{busy?'Registrando…':'Confirmar registro'}</FinanceButton>
      </form>
    </FinanceDrawer>
    <FinanceDrawer open={Boolean(decision)} title={decision?.action==='CANCEL'?'Cancelar lançamento':'Estornar pagamento'} description="A alteração será registrada no histórico financeiro." onClose={()=>{if(!busy)setDecision(null);}}>
      <form className="form-grid drawer-form" onSubmit={confirmDecision}>
        <p className="wide">{decision?.entry.description} — {brl(decision?.entry.amountCents||0)}</p>
        {dialogError&&<p className="error-box wide" role="alert">{dialogError}</p>}
        <label className="wide">Motivo obrigatório<textarea value={reason} required minLength={3} onChange={e=>setReason(e.target.value)} placeholder="Explique a correção para a auditoria"/></label>
        <button className="primary-button wide" type="submit" disabled={busy||reason.trim().length<3}>{busy?'Processando…':decision?.action==='CANCEL'?'Confirmar cancelamento':'Confirmar estorno'}</button>
      </form>
    </FinanceDrawer>
  </section>;
}
