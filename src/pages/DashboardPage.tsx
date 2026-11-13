import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Plus, ReceiptText, WalletCards } from 'lucide-react';
import { FinanceMetricCard } from '../components/finance-ui';
import { brl } from '../lib/format';

type Props = { token: string; onOpenFinance?: (kind:FinanceiroKind)=>void; onOpenCashflow?:()=>void };

export default function DashboardPage({ token, onOpenFinance, onOpenCashflow }: Props) {
  const api = window.financeiro!;
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState<DashboardSnapshot | null>(null);
  const [error, setError] = useState('');
  const [onboardingDismissed,setOnboardingDismissed]=useState(()=>window.localStorage.getItem('financeiro-onboarding-dismissed')==='1');
  const [entryCount,setEntryCount]=useState(0);
  const reload = useCallback(async () => {
    try { const [dashboard,entries]=await Promise.all([api.analytics.dashboard(token, { year }),api.finance.listEntries(token)]); setData(dashboard); setEntryCount(entries.length); setError(''); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }, [api, token, year]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => api.finance.onDataChanged(() => { void reload(); }), [api, reload]);
  const maxFlow = useMemo(() => Math.max(1, ...(data?.monthly.flatMap((m) => [m.inCents, m.outCents]) || [1])), [data]);
  const overduePayable = data?.cards.overduePayableCents || 0;
  const overdueReceivable = data?.cards.overdueReceivableCents || 0;
  const result = data?.cards.resultCents || 0;
  const needsSetup = Boolean(data) && (!data?.accountBalances.length || entryCount===0);

  return <section className="page-stack" data-testid="page-dashboard">
    <div className="page-header"><div><p className="eyebrow">Dashboard</p><h2>Visão financeira</h2><p className="muted">O que entrou, o que saiu e o que precisa de atenção agora. Posição de saldos: {data?.balanceAsOf || 'carregando'}.</p></div><label className="year-control">Ano<input type="number" min="2000" max="2200" value={year} onChange={(e)=>setYear(Number(e.target.value))}/></label></div>
    <div className="dashboard-quick-actions" aria-label="Ações financeiras rápidas">
      <button type="button" className="primary-button" onClick={()=>onOpenFinance?.('PAYABLE')}><Plus size={16}/> Nova despesa</button>
      <button type="button" className="secondary-button" onClick={()=>onOpenFinance?.('RECEIVABLE')}><ReceiptText size={16}/> Nova receita</button>
      <button type="button" className="secondary-button" onClick={()=>onOpenCashflow?.()}><WalletCards size={16}/> Contas e saldos</button>
    </div>
    {needsSetup&&!onboardingDismissed&&<section className="panel first-use-guide" aria-label="Primeiros passos" data-testid="first-use-guide">
      <div className="panel-title"><div><h3>Configure suas finanças</h3><p className="muted">Siga as etapas no seu ritmo. Nenhuma configuração de pagamento automático é necessária.</p></div>
      <button type="button" className="secondary-button small" onClick={()=>{window.localStorage.setItem('financeiro-onboarding-dismissed','1');setOnboardingDismissed(true);}}>Pular guia</button></div>
      <ol className="setup-steps">
        <li><span>{data?.accountBalances.length?'Concluído':'1. Pendente'}: cadastre uma conta financeira (banco ou caixa).</span><button type="button" className="secondary-button small" onClick={()=>onOpenFinance?.('PAYABLE')}>Abrir contas</button></li>
        <li><span>2. Opcional: registre o saldo de abertura da conta.</span><button type="button" className="secondary-button small" onClick={()=>onOpenCashflow?.()}>Informar saldo</button></li>
        <li><span>{entryCount?'Concluído':'3. Pendente'}: registre a primeira receita ou despesa.</span><button type="button" className="secondary-button small" onClick={()=>onOpenFinance?.('PAYABLE')}>Novo lançamento</button></li>
      </ol>
    </section>}
    {error && <div className="error-box">{error}</div>}
    <div className="metric-grid">
      <FinanceMetricCard label="Saldo total das contas" value={brl(data?.cards.totalBalanceCents || 0)} helper={`Bancos: ${brl(data?.cards.bankBalanceCents || 0)} · em ${data?.balanceAsOf||'—'}`} tone="accent"/>
      <FinanceMetricCard label="A receber" value={brl(data?.cards.receivableOpenCents || 0)} helper={overdueReceivable ? `${brl(overdueReceivable)} vencido` : 'Sem valores vencidos'} tone={overdueReceivable ? 'warning' : 'neutral'}/>
      <FinanceMetricCard label="A pagar" value={brl(data?.cards.payableOpenCents || 0)} helper={overduePayable ? `${brl(overduePayable)} vencido` : 'Sem valores vencidos'} tone={overduePayable ? 'danger' : 'neutral'}/>
      <FinanceMetricCard label="Resultado do período" value={brl(result)} helper={`${brl(data?.cards.receivedCents || 0)} recebido · ${brl(data?.cards.paidCents || 0)} pago`} tone={result >= 0 ? 'positive' : 'danger'}/>
    </div>
    <div className="dashboard-attention" data-testid="dashboard-attention">
      <span className="dashboard-attention-title">Atenção financeira</span>
      {overduePayable > 0 && <span className="attention-chip danger"><AlertTriangle size={14}/>A pagar vencido: {brl(overduePayable)}</span>}
      {overdueReceivable > 0 && <span className="attention-chip"><AlertTriangle size={14}/>A receber vencido: {brl(overdueReceivable)}</span>}
      {overduePayable === 0 && overdueReceivable === 0 && <span className="attention-chip ok"><CheckCircle2 size={14}/>Nenhum valor vencido</span>}
    </div>
    <div className="dashboard-grid">
      <div className="panel chart-panel"><div className="panel-title"><div><h3>Fluxo de caixa</h3><p className="muted">Entradas e saídas realizadas mês a mês</p></div></div><div className="cash-chart">{data?.monthly.map((item)=><div className="chart-month" key={item.month}><div className="bar-pair"><i className="bar-in" style={{height:`${Math.max(2,(item.inCents/maxFlow)*100)}%`}} title={`Entradas ${brl(item.inCents)}`}/><i className="bar-out" style={{height:`${Math.max(2,(item.outCents/maxFlow)*100)}%`}} title={`Saídas ${brl(item.outCents)}`}/></div><span>{item.month.slice(5)}</span></div>)}</div><div className="chart-legend"><span><i className="legend-in"/>Entradas</span><span><i className="legend-out"/>Saídas</span></div></div>
      <div className="panel"><div className="panel-title"><div><h3>Saldos por conta</h3><p className="muted">Posição atual das contas financeiras</p></div></div><div className="balance-list">{data?.accountBalances.map((account)=><div key={account.id}><span><strong>{account.name}</strong><small>{account.type}</small></span><b>{brl(account.balanceCents)}</b></div>)}{!data?.accountBalances.length && <p className="muted">Nenhuma conta cadastrada.</p>}</div><div className="balance-total"><span>Saldo consolidado</span><strong>{brl(data?.cards.bankBalanceCents || 0)}</strong></div></div>
    </div>
    <div className="dashboard-grid lower">
      <div className="panel"><div className="panel-title"><div><h3>Maiores despesas</h3><p className="muted">Cinco maiores saídas realizadas</p></div></div><div className="expense-list">{data?.topExpenses.map((expense,index)=><div key={`${expense.description}-${index}`}><span>{expense.description}</span><strong>{brl(expense.amountCents)}</strong></div>)}{!data?.topExpenses.length && <p className="muted">Sem despesas realizadas no período.</p>}</div></div>
      <div className="panel"><div className="panel-title"><div><h3>DRE resumida</h3><p className="muted">Resultado realizado no período</p></div></div><div className="dre-mini"><div><span>Receitas</span><strong>{brl(data?.dre.totals.revenueCents || 0)}</strong></div><div><span>Despesas</span><strong>{brl(data?.dre.totals.expenseCents || 0)}</strong></div><div className="result"><span>Resultado</span><strong>{brl(data?.dre.totals.resultCents || 0)}</strong></div></div></div>
    </div>
  </section>;
}
