import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ArrowLeftRight, Plus } from 'lucide-react';
import { brl, can, toCents, today } from '../lib/format';

type Props = { token: string; session: FinanceiroSession };
function firstDayOfMonth() { return `${today().slice(0, 7)}-01`; }

export default function CashflowPage({ token, session }: Props) {
  const api = window.financeiro!;
  const editable = can(session, 'finance.manage');
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [balances, setBalances] = useState<AccountBalance[]>([]);
  const [movements, setMovements] = useState<CashflowMovement[]>([]);
  const [summary, setSummary] = useState<CashflowSummary>({ openingBalanceCents:0,inCents:0,outCents:0,netCents:0,closingBalanceCents:0 });
  const [error, setError] = useState('');
  const [form, setForm] = useState({ accountId:'', type:'DEPOSIT' as CashMovementType, direction:'IN' as CashDirection, amount:'', occurredAt:today(), note:'' });
  const [transfer, setTransfer] = useState({ fromAccountId:'', toAccountId:'', amount:'', occurredAt:today(), note:'' });
  const reload = useCallback(async () => {
    try {
      const [nextAccounts,nextBalances,nextMovements,nextSummary] = await Promise.all([api.finance.listAccounts(token),api.cashflow.balances(token,{asOf:today()}),api.cashflow.listMovements(token),api.cashflow.summary(token,{from:firstDayOfMonth(),to:today()})]);
      setAccounts(nextAccounts); setBalances(nextBalances); setMovements([...nextMovements].reverse().slice(0,100)); setSummary(nextSummary); setError('');
      setForm((old)=>({...old,accountId:old.accountId || nextAccounts[0]?.id || ''}));
      setTransfer((old)=>({...old,fromAccountId:old.fromAccountId || nextAccounts[0]?.id || '',toAccountId:old.toAccountId || nextAccounts[1]?.id || ''}));
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }, [api, token]);
  useEffect(()=>{void reload();},[reload]);

  async function createMovement(event: FormEvent) { event.preventDefault(); try { await api.cashflow.createMovement(token,{...form,amountCents:toCents(form.amount),direction:form.type==='ADJUSTMENT'?form.direction:undefined}); setForm({...form,amount:'',note:''}); await reload(); } catch(err){setError(err instanceof Error?err.message:String(err));} }
  async function doTransfer(event: FormEvent) { event.preventDefault(); try { await api.cashflow.transfer(token,{...transfer,amountCents:toCents(transfer.amount)}); setTransfer({...transfer,amount:'',note:''}); await reload(); } catch(err){setError(err instanceof Error?err.message:String(err));} }

  return <section className="page-stack"><div className="page-header"><div><p className="eyebrow">Fluxo de Caixa</p><h2>Movimentações e saldos</h2><p className="muted">Livro-caixa consolidado com baixas financeiras e movimentos manuais.</p></div></div>
    <div className="metric-grid"><div className="metric-card"><span>Saldo inicial do mês</span><strong>{brl(summary.openingBalanceCents)}</strong></div><div className="metric-card"><span>Entradas</span><strong>{brl(summary.inCents)}</strong></div><div className="metric-card"><span>Saídas</span><strong>{brl(summary.outCents)}</strong></div><div className="metric-card"><span>Saldo final</span><strong>{brl(summary.closingBalanceCents)}</strong></div></div>
    {error && <div className="error-box">{error}</div>}
    <div className="panel"><h3>Saldos por conta</h3><div className="account-balance-grid">{balances.map((item)=><div className="account-balance" key={item.id}><span>{item.name}<small>{item.type}</small></span><strong>{brl(item.balanceCents)}</strong></div>)}</div></div>
    {editable && <div className="two-columns"><form className="panel form-grid" onSubmit={createMovement}><h3><Plus size={18}/> Movimento manual</h3><label>Conta<select required value={form.accountId} onChange={(e)=>setForm({...form,accountId:e.target.value})}><option value="">Selecione</option>{accounts.map((x)=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label>Tipo<select value={form.type} onChange={(e)=>setForm({...form,type:e.target.value as CashMovementType})}><option value="OPENING">Saldo de abertura</option><option value="DEPOSIT">Entrada</option><option value="WITHDRAWAL">Saída</option><option value="ADJUSTMENT">Ajuste</option></select></label>{form.type==='ADJUSTMENT' && <label>Direção<select value={form.direction} onChange={(e)=>setForm({...form,direction:e.target.value as CashDirection})}><option value="IN">Entrada</option><option value="OUT">Saída</option></select></label>}<label>Valor<input required value={form.amount} onChange={(e)=>setForm({...form,amount:e.target.value})} placeholder="0,00"/></label><label>Data<input type="date" required value={form.occurredAt} onChange={(e)=>setForm({...form,occurredAt:e.target.value})}/></label><label className="wide">Observação<input value={form.note} onChange={(e)=>setForm({...form,note:e.target.value})}/></label><button className="primary-button">Registrar</button></form>
      <form className="panel form-grid" onSubmit={doTransfer}><h3><ArrowLeftRight size={18}/> Transferência</h3><label>De<select required value={transfer.fromAccountId} onChange={(e)=>setTransfer({...transfer,fromAccountId:e.target.value})}><option value="">Selecione</option>{accounts.map((x)=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label>Para<select required value={transfer.toAccountId} onChange={(e)=>setTransfer({...transfer,toAccountId:e.target.value})}><option value="">Selecione</option>{accounts.map((x)=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label>Valor<input required value={transfer.amount} onChange={(e)=>setTransfer({...transfer,amount:e.target.value})} placeholder="0,00"/></label><label>Data<input type="date" value={transfer.occurredAt} onChange={(e)=>setTransfer({...transfer,occurredAt:e.target.value})}/></label><label className="wide">Observação<input value={transfer.note} onChange={(e)=>setTransfer({...transfer,note:e.target.value})}/></label><button className="secondary-button">Transferir</button></form></div>}
    <div className="panel table-panel"><table><thead><tr><th>Data</th><th>Conta</th><th>Origem</th><th>Tipo</th><th>Valor</th></tr></thead><tbody>{movements.map((item)=><tr key={`${item.sourceType}-${item.id}`}><td>{item.occurredAt}</td><td>{accounts.find((x)=>x.id===item.accountId)?.name || item.accountId}</td><td>{item.sourceType}</td><td>{item.type}</td><td className={item.direction==='OUT'?'danger-text':''}>{item.direction==='OUT'?'-':'+'}{brl(item.amountCents)}</td></tr>)}</tbody></table>{movements.length===0 && <div className="empty-state">Nenhuma movimentação registrada.</div>}</div>
  </section>;
}
