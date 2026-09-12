import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { FileDown, Landmark, Plus, Printer, RotateCcw, Search, XCircle } from 'lucide-react';
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
  const [form, setForm] = useState({ description:'', amount:'', dueAt:today(), accountId:'', categoryId:'', counterpartyId:'' });
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
  useEffect(() => { setForm((old) => ({ ...old, categoryId:'', counterpartyId:'' })); }, [kind]);
  const counterparties = kind === 'PAYABLE' ? creditors : customers;

  async function createEntry(event: FormEvent) {
    event.preventDefault();
    try {
      await api.finance.createEntry(token, {
        kind, description: form.description, amountCents: toCents(form.amount), dueAt: form.dueAt,
        accountId: form.accountId || null, categoryId: form.categoryId || null,
        ...(kind === 'PAYABLE' ? { creditorId: form.counterpartyId || null } : { customerId: form.counterpartyId || null }),
      });
      setForm({ description:'', amount:'', dueAt:today(), accountId:'', categoryId:'', counterpartyId:'' });
      await reload();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }

  async function createAccount(event: FormEvent) {
    event.preventDefault();
    try { await api.finance.createAccount(token, accountForm); setAccountForm({ name:'', type:'BANK' }); await reload(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }

  function chooseSettlementAccount(entry: FinanceEntry) {
    if (entry.accountId) return entry.accountId;
    if (accounts.length === 0) { setError('Cadastre uma conta financeira antes de realizar a baixa.'); return null; }
    const menu = accounts.map((account, index) => `${index + 1}. ${account.name}`).join('\n');
    const answer = window.prompt(`Escolha a conta da baixa:\n${menu}`, '1');
    if (!answer) return null;
    const byIndex = accounts[Number(answer) - 1];
    const byName = accounts.find((account) => account.name.toLowerCase() === answer.trim().toLowerCase());
    const account = byIndex || byName;
    if (!account) { setError('Conta inválida para a baixa.'); return null; }
    return account.id;
  }

  async function settle(entry: FinanceEntry) {
    const value = window.prompt(`Valor da baixa para ${entry.description}`, (entry.openCents / 100).toFixed(2).replace('.', ','));
    if (!value) return;
    const accountId = chooseSettlementAccount(entry); if (!accountId) return;
    try { await api.finance.settleEntry(token, entry.id, { amountCents: toCents(value), method: 'PIX', occurredAt: today(), accountId }); await reload(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }

  async function cancel(entry: FinanceEntry) {
    const reason = window.prompt('Motivo do cancelamento'); if (!reason) return;
    try { await api.finance.cancelEntry(token, entry.id, reason); await reload(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }

  async function reverse(entry: FinanceEntry) {
    const settlement = entry.settlements.at(-1); if (!settlement) return;
    const reason = window.prompt('Motivo do estorno da última baixa'); if (!reason) return;
    try { await api.finance.reverseSettlement(token, settlement.id, reason); await reload(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
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
    <div className="page-header"><div><p className="eyebrow">Financeiro</p><h2>Contas a pagar e receber</h2><p className="muted">Baixas parciais, estornos, cancelamentos e recibos preservam o histórico.</p></div></div>
    <div className="metric-grid">
      <div className="metric-card"><span>A receber em aberto</span><strong>{brl(summary.receivableOpenCents)}</strong></div>
      <div className="metric-card"><span>A pagar em aberto</span><strong>{brl(summary.payableOpenCents)}</strong></div>
      <div className="metric-card"><span>Vencidos</span><strong>{brl(summary.overduePayableCents + summary.overdueReceivableCents)}</strong></div>
      <div className="metric-card"><span>Filtro atual</span><strong>{brl(openTotal)}</strong></div>
    </div>
    {error && <div className="error-box">{error}</div>}
    <div className="page-toolbar"><div className="segmented"><button type="button" className={kind==='PAYABLE'?'active':''} onClick={() => setKind('PAYABLE')}>Contas a pagar</button><button type="button" className={kind==='RECEIVABLE'?'active':''} onClick={() => setKind('RECEIVABLE')}>Contas a receber</button></div><div className="toolbar-filters"><label className="search-control"><Search size={16}/><input data-testid="finance-search" aria-label="Buscar lançamentos" value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Buscar descrição, pessoa ou categoria"/></label><label className="filter-control"><span>Status</span><select aria-label="Filtrar status" value={statusFilter} onChange={(e)=>setStatusFilter(e.target.value as StatusFilter)}><option value="ALL">Todos</option><option value="OPEN">Em aberto</option><option value="PARTIAL">Parcial</option><option value="SETTLED">Quitado</option><option value="OVERDUE">Vencido</option><option value="CANCELLED">Cancelado</option></select></label></div></div>
    {editable && <div className="two-columns">
      <form className="panel form-grid" onSubmit={createEntry}><h3><Plus size={18}/> Novo lançamento</h3>
        <label className="wide">Descrição<input value={form.description} onChange={(e)=>setForm({...form,description:e.target.value})} required/></label>
        <label>Valor<input value={form.amount} onChange={(e)=>setForm({...form,amount:e.target.value})} placeholder="0,00" required/></label>
        <label>Vencimento<input type="date" value={form.dueAt} onChange={(e)=>setForm({...form,dueAt:e.target.value})} required/></label>
        <label>Categoria<select value={form.categoryId} onChange={(e)=>setForm({...form,categoryId:e.target.value})}><option value="">Sem categoria</option>{categories.map((x)=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label>{kind==='PAYABLE'?'Credor':'Cliente'}<select value={form.counterpartyId} onChange={(e)=>setForm({...form,counterpartyId:e.target.value})}><option value="">Não informado</option>{counterparties.map((x)=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label>Conta<select value={form.accountId} onChange={(e)=>setForm({...form,accountId:e.target.value})}><option value="">Definir na baixa</option>{accounts.map((x)=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <button className="primary-button">Salvar lançamento</button>
      </form>
      <form className="panel form-grid compact-form" onSubmit={createAccount}><h3><Landmark size={18}/> Conta financeira</h3><label>Nome<input value={accountForm.name} onChange={(e)=>setAccountForm({...accountForm,name:e.target.value})} required/></label><label>Tipo<select value={accountForm.type} onChange={(e)=>setAccountForm({...accountForm,type:e.target.value as FinanceAccount['type']})}><option value="BANK">Banco</option><option value="CASH">Caixa</option><option value="CARD">Cartão</option><option value="OTHER">Outro</option></select></label><button className="secondary-button">Adicionar conta</button></form>
    </div>}
    <div className="panel table-panel table-scroll"><table><thead><tr><th>Descrição</th><th>Vencimento</th><th>Status</th><th>Valor</th><th>Em aberto</th><th></th></tr></thead><tbody>{filteredEntries.map((entry)=>{const hasReceipt=entry.settlements.some((item)=>!item.reversedAt);return <tr key={entry.id}><td><strong>{entry.description}</strong>{entry.isOverdue && <small className="danger-text">Vencido</small>}</td><td>{entry.dueAt}</td><td><span className={`badge badge-${entry.status.toLowerCase()}`}>{entry.status}</span></td><td>{brl(entry.amountCents)}</td><td>{brl(entry.openCents)}</td><td>{(editable||hasReceipt)&&<div className="row-actions">{editable&&entry.status!=='CANCELLED'&&entry.openCents>0&&<button type="button" onClick={()=>void settle(entry)}>Baixar</button>}{editable&&entry.status!=='CANCELLED'&&entry.settlements.length>0&&<button type="button" title="Estornar última baixa" onClick={()=>void reverse(entry)}><RotateCcw size={15}/></button>}{editable&&entry.status!=='CANCELLED'&&entry.settlements.length===0&&<button type="button" title="Cancelar" onClick={()=>void cancel(entry)}><XCircle size={15}/></button>}{hasReceipt&&<button type="button" title="Salvar recibo em PDF" onClick={()=>void receiptPdf(entry)}><FileDown size={15}/></button>}{hasReceipt&&<button type="button" title="Imprimir recibo" onClick={()=>void receiptPrint(entry)}><Printer size={15}/></button>}</div>}</td></tr>})}</tbody></table>{filteredEntries.length===0 && <div className="empty-state">Nenhum lançamento encontrado com os filtros atuais.</div>}</div>
  </section>;
}
