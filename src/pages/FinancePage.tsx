import { FormEvent, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Landmark, Plus, Search } from 'lucide-react';
import { FinanceButton, FinanceDrawer, FinanceToolbar } from '../components/finance-ui';
import FinanceEntriesTable from '../components/FinanceEntriesTable';
import { qaProfile } from '../components/QaProfiler';
import { brl, can, toCents, today } from '../lib/format';

type Props = { token: string; session: FinanceiroSession; intent?:FinanceiroKind|null; browseKind?:FinanceiroKind|null; onBrowseHandled?:()=>void; onIntentHandled?:()=>void; onOpenPlanning?:(entryId:string)=>void; focusEntry?:FinanceEntry|null };
type StatusFilter = 'ALL' | FinanceEntry['status'] | 'OVERDUE';
function qaFinanceIpc(name:string){
  if(!import.meta.env.DEV)return;
  const host=window as Window & { __ARTISYS_FINANCE_IPC_STATS?:Record<string,number> };
  const counters=host.__ARTISYS_FINANCE_IPC_STATS;
  if(counters)counters[name]=(counters[name]||0)+1;
}
const emptySummary: FinancialSummary = { payableTotalCents:0,payableSettledCents:0,payableOpenCents:0,receivableTotalCents:0,receivableSettledCents:0,receivableOpenCents:0,overduePayableCents:0,overdueReceivableCents:0 };

export default function FinancePage({ token, session, intent, browseKind, onBrowseHandled, onIntentHandled, onOpenPlanning, focusEntry }: Props) {
  const api = window.financeiro!;
  const [kind, setKind] = useState<FinanceiroKind>('PAYABLE');
  const [entries, setEntries] = useState<FinanceEntry[]>([]);
  const [summary, setSummary] = useState<FinancialSummary>(emptySummary);
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [categories, setCategories] = useState<FinancialCategory[]>([]);
  const [customers, setCustomers] = useState<PartyRecord[]>([]);
  const [creditors, setCreditors] = useState<PartyRecord[]>([]);
  const [error, setError] = useState('');
  const [notice,setNotice]=useState('');
  const [drawerError,setDrawerError]=useState('');
  const [busy,setBusy]=useState(false);
  const [decision,setDecision]=useState<{entry:FinanceEntry;action:'CANCEL'|'REVERSE'}|null>(null);
  const [reason,setReason]=useState('');
  const [showPartyForm,setShowPartyForm]=useState(false);
  const [partyName,setPartyName]=useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [entryDrawerOpen, setEntryDrawerOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<FinanceEntry | null>(null);
  const [recurring, setRecurring] = useState(false);
  const [focusedEntryId,setFocusedEntryId]=useState<string|null>(null);
  const [recurrenceOptions,setRecurrenceOptions]=useState({intervalMonths:'1',intervalDays:'',endDate:'',maxOccurrences:'',annualAdjustmentPct:'0'});
  const [payingEntry, setPayingEntry] = useState<FinanceEntry | null>(null);
  const [paymentForm, setPaymentForm] = useState({amount:'',occurredAt:today(),accountId:'',method:'PIX',note:''});
  const [form, setForm] = useState({ description:'', amount:'', dueAt:today(), accountId:'', categoryId:'', counterpartyId:'' });
  const [accountForm, setAccountForm] = useState({ name:'', type:'BANK' as FinanceAccount['type'] });
  const editable = can(session, 'finance.manage');
  const [nextCursor,setNextCursor]=useState<string|null>(null);
  const [hasMore,setHasMore]=useState(false);
  const [loadingMore,setLoadingMore]=useState(false);
  const deferredSearch=useDeferredValue(search);
  const ledgerRequest=useRef(0);
  const catalogRequest=useRef(0);
  const categoryRequest=useRef(0);

  const reloadEntries = useCallback(async () => {
    const request=++ledgerRequest.current;
    try {
      qaFinanceIpc('listEntries');qaFinanceIpc('summary');
      const [page,nextSummary]=await Promise.all([
        api.finance.listEntriesPage(token,{kind,query:deferredSearch,status:statusFilter,focusedEntryId:focusedEntryId||undefined,limit:100}),api.finance.summary(token),
      ]);
      if(request!==ledgerRequest.current)return;
      setEntries(page.items);setNextCursor(page.nextCursor);setHasMore(page.hasMore);setLoadingMore(false);
      setSummary(nextSummary);setError('');
    }catch(err){if(request===ledgerRequest.current)setError(err instanceof Error?err.message:String(err));}
  },[api,token,kind,deferredSearch,statusFilter,focusedEntryId]);

  const reloadCatalogs = useCallback(async () => {
    const request=++catalogRequest.current;
    try {
      qaFinanceIpc('listAccounts');qaFinanceIpc('listCustomers');qaFinanceIpc('listCreditors');
      const [nextAccounts,nextCustomers,nextCreditors]=await Promise.all([
        api.finance.listAccounts(token),api.registry.listCustomers(token),api.registry.listCreditors(token)
      ]);
      if(request!==catalogRequest.current)return;
      setAccounts(nextAccounts);setCustomers(nextCustomers);setCreditors(nextCreditors);
    }catch(err){if(request===catalogRequest.current)setError(err instanceof Error?err.message:String(err));}
  },[api,token]);

  const reloadCategories = useCallback(async () => {
    const request=++categoryRequest.current;
    try {
      qaFinanceIpc('listCategories');
      const rows=await api.registry.listCategories(token,{nature:kind==='PAYABLE'?'EXPENSE':'REVENUE'});
      if(request!==categoryRequest.current)return;
      setCategories(rows);
    }catch(err){if(request===categoryRequest.current)setError(err instanceof Error?err.message:String(err));}
  },[api,token,kind]);

  useEffect(()=>{void reloadEntries();},[reloadEntries]);
  useEffect(()=>{void reloadCatalogs();},[reloadCatalogs]);
  useEffect(()=>{void reloadCategories();},[reloadCategories]);
  useEffect(()=>api.finance.onDataChanged(()=>{void reloadEntries();}),[api,reloadEntries]);
  useEffect(() => { if(!editingEntry)setForm((old) => old.categoryId===''&&old.counterpartyId===''?old:({ ...old, categoryId:'', counterpartyId:'' })); }, [kind,editingEntry]);
  useEffect(()=>{if(!browseKind)return;setKind(browseKind);onBrowseHandled?.();},[browseKind,onBrowseHandled]);
  useEffect(()=>{if(focusEntry){setKind(focusEntry.kind);setSearch('');setStatusFilter('ALL');setFocusedEntryId(focusEntry.id);}else setFocusedEntryId(null);},[focusEntry]);
  useEffect(()=>{if(!intent)return;setKind(intent);setEditingEntry(null);setRecurring(false);setForm({description:'',amount:'',dueAt:today(),accountId:'',categoryId:'',counterpartyId:''});setEntryDrawerOpen(true);onIntentHandled?.();},[intent,onIntentHandled]);
  const counterparties = kind === 'PAYABLE' ? creditors : customers;

  function openNewEntry() {
    setFocusedEntryId(null);
    setDrawerError('');
    setEditingEntry(null);
    setRecurring(false);
    setRecurrenceOptions({intervalMonths:'1',intervalDays:'',endDate:'',maxOccurrences:'',annualAdjustmentPct:'0'});
    setForm({description:'',amount:'',dueAt:today(),accountId:'',categoryId:'',counterpartyId:''});
    setEntryDrawerOpen(true);
  }
  const openEditEntry=useCallback((entry:FinanceEntry) => {
    setDrawerError('');
    setEditingEntry(entry);
    setKind(entry.kind);
    setRecurring(false);
    setForm({description:entry.description,amount:(entry.amountCents/100).toFixed(2).replace('.',','),
      dueAt:entry.dueAt,accountId:entry.accountId||'',categoryId:entry.categoryId||'',
      counterpartyId:(entry.kind==='PAYABLE'?entry.creditorId:entry.customerId)||''});
    setEntryDrawerOpen(true);
  },[]);
  async function createEntry(event: FormEvent) {
    event.preventDefault();
    if(busy)return;
    setBusy(true);setDrawerError('');
    try {
      const input = {
        kind, description: form.description, amountCents: toCents(form.amount), dueAt: form.dueAt,
        accountId: form.accountId || null, categoryId: form.categoryId || null,
        ...(kind === 'PAYABLE' ? { creditorId: form.counterpartyId || null } : { customerId: form.counterpartyId || null }),
      };
      if (editingEntry) await api.finance.updateEntry(token, editingEntry.id, input);
      else if (recurring) {
        await api.recurrence.create(token, {...input, startDate:form.dueAt,dueDay:Number(form.dueAt.slice(-2)),
          intervalMonths:Number(recurrenceOptions.intervalMonths),intervalDays:recurrenceOptions.intervalDays?Number(recurrenceOptions.intervalDays):null,
          endDate:recurrenceOptions.endDate||null,maxOccurrences:recurrenceOptions.maxOccurrences?Number(recurrenceOptions.maxOccurrences):null,
          annualAdjustmentBps:Math.round(Number(recurrenceOptions.annualAdjustmentPct.replace(',','.'))*100)});
        await api.recurrence.generate(token,today());
      } else await api.finance.createEntry(token,input);
      setForm({ description:'', amount:'', dueAt:today(), accountId:'', categoryId:'', counterpartyId:'' });
      setEntryDrawerOpen(false);
      setEditingEntry(null);
      setRecurring(false);
      setNotice(editingEntry?'Lançamento atualizado e auditado.':recurring?'Recorrência cadastrada. Próximos vencimentos serão gerados automaticamente.':'Lançamento salvo.');
      
    } catch (err) { setDrawerError(err instanceof Error ? err.message : String(err)); }
    finally{setBusy(false);}
  }

  async function createParty(event:FormEvent){
    event.preventDefault();
    if(!partyName.trim()||busy)return;
    setBusy(true);setDrawerError('');
    try{
      const item=kind==='PAYABLE'?await api.registry.saveCreditor(token,{name:partyName.trim()}):await api.registry.saveCustomer(token,{name:partyName.trim()});
      setForm(old=>({...old,counterpartyId:item.id}));
      await reloadCatalogs();
      setPartyName('');setShowPartyForm(false);
    }catch(err){setDrawerError(err instanceof Error?err.message:String(err));}
    finally{setBusy(false);}
  }

  async function createAccount(event: FormEvent) {
    event.preventDefault();
    if(busy)return;setBusy(true);
    try{await api.finance.createAccount(token,accountForm);setAccountForm({name:'',type:'BANK'});await reloadCatalogs();setNotice('Conta financeira cadastrada.');}
    catch(err){setError(err instanceof Error?err.message:String(err));}
    finally{setBusy(false);}
  }

  const openPayment=useCallback((entry:FinanceEntry) => {
    if (!accounts.length) { setError('Para registrar o pagamento, cadastre primeiro uma conta financeira no formulário abaixo.'); return; }
    setDrawerError('');
    const cents = entry.openCents;
    setPaymentForm({amount:(cents/100).toFixed(2).replace('.',','),occurredAt:today(),
      accountId:entry.accountId || accounts[0].id,method:'PIX',note:''});
    setPayingEntry(entry);
  },[accounts]);
  async function savePayment(event:FormEvent) {
    event.preventDefault();
    if (!payingEntry||busy) return;
    setBusy(true);setDrawerError('');
    try {
      const result=await api.finance.settleEntry(token,payingEntry.id,{
        amountCents:toCents(paymentForm.amount),occurredAt:paymentForm.occurredAt,
        accountId:paymentForm.accountId,method:paymentForm.method,note:paymentForm.note
      });
      setPayingEntry(null);
      setNotice(`${payingEntry.kind==='PAYABLE'?'Pagamento':'Recebimento'} de ${brl(result.settlement.amountCents)} registrado em ${payingEntry.description}. Restante: ${brl(result.entry.openCents)}.`);
      
    } catch(err) {setDrawerError(err instanceof Error?err.message:String(err));}
    finally{setBusy(false);}
  }

  const openDecision=useCallback((entry:FinanceEntry,action:'CANCEL'|'REVERSE')=>{
    setDecision({entry,action});setReason('');setDrawerError('');
  },[]);
  async function confirmDecision(event:FormEvent){
    event.preventDefault();
    if(!decision||busy||reason.trim().length<3)return;
    setBusy(true);setDrawerError('');
    try{
      if(decision.action==='CANCEL')await api.finance.cancelEntry(token,decision.entry.id,reason.trim());
      else{
        const settlement=[...decision.entry.settlements].reverse().find(s=>!s.reversedAt);
        if(!settlement)throw new Error('Não há baixa ativa para estornar.');
        await api.finance.reverseSettlement(token,settlement.id,reason.trim());
      }
      const action=decision.action;setDecision(null);setReason('');
      // Canonical IPC notification triggers the single ledger refresh after mutation.
      setNotice(action==='CANCEL'?'Lançamento cancelado com histórico preservado.':'Baixa estornada e saldo recalculado.');
    }catch(cause){setDrawerError(cause instanceof Error?cause.message:String(cause));}
    finally{setBusy(false);}
  }

  const receiptPdf=useCallback(async (entry: FinanceEntry) => {
    const settlement = [...entry.settlements].reverse().find((item)=>!item.reversedAt); if (!settlement) return;
    try { await api.reports.saveReceiptPdf(token, settlement.id); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  },[api,token]);
  const receiptPrint=useCallback(async (entry: FinanceEntry) => {
    const settlement = [...entry.settlements].reverse().find((item)=>!item.reversedAt); if (!settlement) return;
    try { await api.reports.printReceipt(token, settlement.id); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  },[api,token]);
  const showMore=useCallback(async()=>{
    if(!hasMore||!nextCursor||loadingMore)return;
    const request=ledgerRequest.current;
    setLoadingMore(true);
    try{
      qaFinanceIpc('listEntries');
      const page=await api.finance.listEntriesPage(token,{kind,query:deferredSearch,status:statusFilter,focusedEntryId:focusedEntryId||undefined,limit:100,cursor:nextCursor});
      if(request!==ledgerRequest.current)return;
      setEntries(previous=>{
        const ids=new Set(previous.map(row=>row.id));
        return [...previous,...page.items.filter(row=>!ids.has(row.id))];
      });
      setNextCursor(page.nextCursor);setHasMore(page.hasMore);
    }catch(err){if(request===ledgerRequest.current)setError(err instanceof Error?err.message:String(err));}
    finally{setLoadingMore(false);}
  },[api,token,kind,deferredSearch,statusFilter,focusedEntryId,nextCursor,hasMore,loadingMore]);

  // Search and status are resolved against the complete canonical SQLite dataset.
  // The client receives one bounded page; no full-table fetch or client-side slicing.
  const visibleEntries=entries;
  const openTotal=useMemo(()=>entries.filter(row=>row.status!=='CANCELLED').reduce((sum,row)=>sum+row.openCents,0),[entries]);

  return <section className="page-stack" data-testid="page-finance">
    <div className="page-header"><div><p className="eyebrow">Financeiro</p><h2>Contas a pagar e receber</h2><p className="muted">Acompanhe vencimentos, baixas e histórico sem poluir a área de trabalho.</p></div></div>
    <div className="metric-grid">
      <div className="metric-card"><span>A receber em aberto</span><strong>{brl(summary.receivableOpenCents)}</strong></div>
      <div className="metric-card"><span>A pagar em aberto</span><strong>{brl(summary.payableOpenCents)}</strong></div>
      <div className="metric-card"><span>Vencidos</span><strong>{brl(summary.overduePayableCents + summary.overdueReceivableCents)}</strong></div>
      <div className="metric-card"><span>Saldo dos carregados</span><strong>{brl(openTotal)}</strong></div>
    </div>
    {error && <div className="error-box" role="alert">{error}</div>}
    {notice&&<div className="success-box" role="status">{notice}</div>}
    {focusEntry&&focusedEntryId&&<div className="panel" data-testid="finance-recurring-focus">
      <strong>Parcela selecionada: {focusEntry.description}</strong>
      <p className="muted">Vencimento {focusEntry.dueAt.split('-').reverse().join('/')} · {brl(focusEntry.amountCents)} · saldo em aberto {brl(focusEntry.openCents)}</p>
      <p className="muted">A parcela exata está selecionada abaixo, com suas ações de pagamento, recebimento e comprovante.</p>
      <button type="button" className="secondary-button small" onClick={()=>setFocusedEntryId(null)}>Ver todos os lançamentos</button>
    </div>}
    <div className="segmented"><button type="button" className={kind==='PAYABLE'?'active':''} onClick={() => {setFocusedEntryId(null);setKind('PAYABLE');}}>Contas a pagar</button><button type="button" className={kind==='RECEIVABLE'?'active':''} onClick={() => {setFocusedEntryId(null);setKind('RECEIVABLE');}}>Contas a receber</button></div>
    <FinanceToolbar
      filters={<><label className="finance-search-control"><Search size={16}/><input data-testid="finance-search" aria-label="Buscar lançamentos" value={search} onChange={(e)=>{setFocusedEntryId(null);setSearch(e.target.value);}} placeholder="Buscar descrição, pessoa ou categoria"/></label><label className="filter-control"><span>Status</span><select aria-label="Filtrar status" value={statusFilter} onChange={(e)=>{setFocusedEntryId(null);setStatusFilter(e.target.value as StatusFilter);}}><option value="ALL">Todos os status</option><option value="OPEN">Em aberto</option><option value="PARTIAL">Parcial</option><option value="SETTLED">Quitado</option><option value="OVERDUE">Vencido</option><option value="CANCELLED">Cancelado</option></select></label></>}
      actions={editable ? <FinanceButton type="button" data-testid="finance-new-entry" onClick={openNewEntry}><Plus size={16}/>Novo lançamento</FinanceButton> : undefined}
    />

    {qaProfile('finance-table', <FinanceEntriesTable visibleEntries={visibleEntries} filteredCount={visibleEntries.length}
      hasMore={hasMore} focusedEntryId={focusedEntryId} editable={editable}
      onPayment={openPayment} onEdit={openEditEntry} onDecision={openDecision}
      onReceiptPdf={receiptPdf} onReceiptPrint={receiptPrint} onOpenPlanning={onOpenPlanning} onMore={showMore}/>)}

    {editable && <section className="panel finance-secondary-panel">
      <div><div className="panel-title"><div><h3><Landmark size={18}/>Contas financeiras</h3><p className="muted">Cadastre contas sem misturar essa tarefa com um novo lançamento.</p></div></div><div className="finance-account-summary">{accounts.map((account)=><span className="finance-account-chip" key={account.id}>{account.name}<small>{account.type}</small></span>)}{accounts.length===0&&<span className="muted">Nenhuma conta cadastrada.</span>}</div></div>
      <form className="inline-account-form" onSubmit={createAccount}><label>Nome<input value={accountForm.name} onChange={(e)=>setAccountForm({...accountForm,name:e.target.value})} required/></label><label>Tipo<select value={accountForm.type} onChange={(e)=>setAccountForm({...accountForm,type:e.target.value as FinanceAccount['type']})}><option value="BANK">Banco</option><option value="CASH">Caixa</option><option value="CARD">Cartão</option><option value="OTHER">Outro</option></select></label><FinanceButton variant="secondary">Adicionar conta</FinanceButton></form>
    </section>}

    <FinanceDrawer open={entryDrawerOpen} title={editingEntry?'Editar lançamento':kind==='PAYABLE'?'Nova conta a pagar':'Nova conta a receber'} description="Preencha os dados financeiros. Todas as alterações ficam auditadas." onClose={()=>{setEntryDrawerOpen(false);setEditingEntry(null);}}>
      <div data-testid="finance-entry-drawer">
{qaProfile('finance-entry-form', <form className="form-grid drawer-form" onSubmit={createEntry}>
          {editingEntry?.sourceType==='CRM_QUOTE_INSTALLMENT'&&<p className="wide muted" role="status">Recebível vinculado a proposta CRM. Valor, vencimento e cliente são preservados. Para mudar condições comerciais, faça uma revisão financeira explícita; descrição, categoria e conta continuam editáveis.</p>}
          <label className="wide">Descrição<input value={form.description} onChange={(e)=>setForm({...form,description:e.target.value})} required autoFocus/></label>
          <label>Valor<input disabled={editingEntry?.sourceType==='CRM_QUOTE_INSTALLMENT'} value={form.amount} onChange={(e)=>setForm({...form,amount:e.target.value})} placeholder="0,00" required/></label>
          <label>Vencimento<input disabled={editingEntry?.sourceType==='CRM_QUOTE_INSTALLMENT'} type="date" value={form.dueAt} onChange={(e)=>setForm({...form,dueAt:e.target.value})} required/></label>
          <label>Categoria<select value={form.categoryId} onChange={(e)=>setForm({...form,categoryId:e.target.value})}><option value="">Sem categoria</option>{categories.map((x)=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label>{kind==='PAYABLE'?'Credor':'Cliente'}<select disabled={editingEntry?.sourceType==='CRM_QUOTE_INSTALLMENT'} value={form.counterpartyId} onChange={(e)=>setForm({...form,counterpartyId:e.target.value})}><option value="">Não informado</option>{counterparties.map((x)=><option key={x.id} value={x.id}>{x.name}</option>)}</select>{editingEntry?.sourceType!=='CRM_QUOTE_INSTALLMENT'&&<button type="button" className="secondary-button small" onClick={()=>setShowPartyForm(v=>!v)}>Cadastrar {kind==='PAYABLE'?'credor':'cliente'}</button>}</label>
          {showPartyForm&&<div className="wide inline-fields"><label className="wide">Nome da contraparte<input value={partyName} onChange={e=>setPartyName(e.target.value)}/></label><button type="button" className="secondary-button" disabled={busy||!partyName.trim()} onClick={()=>void createParty({preventDefault:()=>{}} as FormEvent)}>Salvar cadastro</button></div>}
          <label className="wide">Conta<select value={form.accountId} onChange={(e)=>setForm({...form,accountId:e.target.value})}><option value="">Definir na baixa</option>{accounts.map((x)=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          {!editingEntry && <label className="wide"><input type="checkbox" checked={recurring} onChange={(e)=>setRecurring(e.target.checked)}/> Repetir automaticamente a partir do vencimento</label>}
          {!editingEntry&&recurring&&<>
            <label>Frequência<select value={recurrenceOptions.intervalDays?'D'+recurrenceOptions.intervalDays:'M'+recurrenceOptions.intervalMonths}
              onChange={e=>{const option=e.target.value;setRecurrenceOptions(x=>({...x,
                intervalDays:option.startsWith('D')?option.slice(1):'',intervalMonths:option.startsWith('M')?option.slice(1):'1'}));}}>
              <option value="D7">Semanal</option><option value="D14">Quinzenal (14 dias)</option>
              <option value="M1">Mensal</option><option value="M2">Bimestral</option>
              <option value="M3">Trimestral</option><option value="M6">Semestral</option><option value="M12">Anual</option>
            </select></label>
            <label>Encerrar em (opcional)<input type="date" min={form.dueAt} value={recurrenceOptions.endDate} onChange={e=>setRecurrenceOptions({...recurrenceOptions,endDate:e.target.value})}/></label>
            <label>Máximo de parcelas<input type="number" min="1" placeholder="Sem limite" value={recurrenceOptions.maxOccurrences} onChange={e=>setRecurrenceOptions({...recurrenceOptions,maxOccurrences:e.target.value})}/></label>
            <label>Reajuste anual (%)<input type="number" min="0" max="100" step="0.01" value={recurrenceOptions.annualAdjustmentPct}
              onChange={e=>setRecurrenceOptions({...recurrenceOptions,annualAdjustmentPct:e.target.value})}/></label>
            <p className="wide muted">Geração de obrigações, nunca de pagamentos. Consulte parcelas futuras em Recorrências.</p>
          </>}
          {drawerError&&<div className="error-box wide" role="alert">{drawerError}</div>}
          <FinanceButton type="submit" disabled={busy}>{busy?'Salvando…':editingEntry?'Salvar alterações':recurring?'Criar conta recorrente':'Salvar lançamento'}</FinanceButton>
</form>)}
      </div>
    </FinanceDrawer>
    <FinanceDrawer open={Boolean(payingEntry)} title={kind==='PAYABLE'?'Registrar pagamento':'Registrar recebimento'} description="Registre o valor efetivamente pago ou recebido; não envia dinheiro ao banco." onClose={()=>setPayingEntry(null)}>
{qaProfile('finance-payment-form', <form className="form-grid drawer-form" data-testid="finance-payment-form" onSubmit={savePayment}>
        <p className="wide">{payingEntry?.description} — aberto: {brl(payingEntry?.openCents||0)}</p>
        <label>Valor pago/recebido<input required value={paymentForm.amount} onChange={(e)=>setPaymentForm({...paymentForm,amount:e.target.value})} /></label>
        <label>Data<input required type="date" max={today()} value={paymentForm.occurredAt} onChange={(e)=>setPaymentForm({...paymentForm,occurredAt:e.target.value})}/></label>
        <label>Conta financeira<select required value={paymentForm.accountId} onChange={(e)=>setPaymentForm({...paymentForm,accountId:e.target.value})}>{accounts.map((x)=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label>Forma de pagamento<select value={paymentForm.method} onChange={(e)=>setPaymentForm({...paymentForm,method:e.target.value})}>
          <option value="PIX">PIX</option><option value="CASH">Dinheiro</option><option value="TRANSFER">Transferência</option><option value="BOLETO">Boleto</option><option value="DEBIT_CARD">Cartão de débito</option><option value="CREDIT_CARD">Cartão de crédito</option><option value="OTHER">Outro</option>
        </select></label>
        <label className="wide">Observação<input value={paymentForm.note} onChange={(e)=>setPaymentForm({...paymentForm,note:e.target.value})}/></label>
        <p className="wide muted">Informe um valor menor que o saldo aberto para registrar um pagamento parcial.</p>
        {drawerError&&<div className="error-box wide" role="alert">{drawerError}</div>}
        <FinanceButton type="submit" disabled={busy}>{busy?'Registrando…':'Confirmar registro'}</FinanceButton>
</form>)}
    </FinanceDrawer>
    <FinanceDrawer open={Boolean(decision)} title={decision?.action==='CANCEL'?'Cancelar lançamento':'Estornar baixa'} description="Informe o motivo; a ação será auditada e o histórico mantido." onClose={()=>{if(!busy)setDecision(null);}}>
{qaProfile('finance-decision-form', <form className="form-grid drawer-form" data-testid="finance-decision-form" onSubmit={confirmDecision}>
        <p className="wide">{decision?.entry.description} — {brl(decision?.entry.amountCents||0)}</p>
        {drawerError&&<div className="error-box wide" role="alert">{drawerError}</div>}
        <label className="wide">Motivo obrigatório<textarea required minLength={3} value={reason} onChange={event=>setReason(event.target.value)} placeholder="Descreva por que esta operação deve ser corrigida"/></label>
        <FinanceButton type="submit" disabled={busy||reason.trim().length<3}>{busy?'Processando…':decision?.action==='CANCEL'?'Confirmar cancelamento':'Confirmar estorno'}</FinanceButton>
</form>)}
    </FinanceDrawer>
  </section>;
}
