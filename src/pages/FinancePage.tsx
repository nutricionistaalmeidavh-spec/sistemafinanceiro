import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Landmark, Plus, RotateCcw, XCircle } from 'lucide-react';
import { brl, can, toCents, today } from '../lib/format';

type Props = { token: string; session: FinanceiroSession };
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

  const openTotal = useMemo(() => entries.filter((x) => x.status !== 'CANCELLED').reduce((sum, x) => sum + x.openCents, 0), [entries]);

  return <section className="page-stack">
    <div className="page-header"><div><p className="eyebrow">Financeiro</p><h2>Contas a pagar e receber</h2><p className="muted">Baixas parciais, estornos e cancelamentos preservam o histórico.</p></div></div>
    <div className="metric-grid">
      <div className="metric-card"><span>A receber em aberto</span><strong>{brl(summary.receivableOpenCents)}</strong></div>
      <div className="metric-card"><span>A pagar em aberto</span><strong>{brl(summary.payableOpenCents)}</strong></div>
      <div className="metric-card"><span>Vencidos</span><strong>{brl(summary.overduePayableCents + summary.overdueReceivableCents)}</strong></div>
      <div className="metric-card"><span>Filtro atual</span><strong>{brl(openTotal)}</strong></div>
    </div>
    {error && <div className="error-box">{error}</div>}
    <div className="segmented"><button className={kind==='PAYABLE'?'active':''} onClick={() => setKind('PAYABLE')}>Contas a pagar</button><button className={kind==='RECEIVABLE'?'active':''} onClick={() => setKind('RECEIVABLE')}>Contas a receber</button></div>
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
    <div className="panel table-panel"><table><thead><tr><th>Descrição</th><th>Vencimento</th><th>Status</th><th>Valor</th><th>Em aberto</th><th></th></tr></thead><tbody>{entries.map((entry)=><tr key={entry.id}><td><strong>{entry.description}</strong>{entry.isOverdue && <small className="danger-text">Vencido</small>}</td><td>{entry.dueAt}</td><td><span className={`badge badge-${entry.status.toLowerCase()}`}>{entry.status}</span></td><td>{brl(entry.amountCents)}</td><td>{brl(entry.openCents)}</td><td>{editable && entry.status!=='CANCELLED' && <div className="row-actions">{entry.openCents>0 && <button onClick={()=>void settle(entry)}>Baixar</button>}{entry.settlements.length>0 && <button title="Estornar última baixa" onClick={()=>void reverse(entry)}><RotateCcw size={15}/></button>}{entry.settlements.length===0 && <button title="Cancelar" onClick={()=>void cancel(entry)}><XCircle size={15}/></button>}</div>}</td></tr>)}</tbody></table>{entries.length===0 && <div className="empty-state">Nenhum lançamento neste filtro.</div>}</div>
  </section>;
}
