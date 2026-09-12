import { useCallback, useEffect, useMemo, useState } from 'react';
import { brl } from '../lib/format';

type Props = { token: string };

export default function DashboardPage({ token }: Props) {
  const api = window.financeiro!;
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState<DashboardSnapshot | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    try { setData(await api.analytics.dashboard(token, { year })); setError(''); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }, [api, token, year]);
  useEffect(() => { void reload(); }, [reload]);
  const maxFlow = useMemo(() => Math.max(1, ...(data?.monthly.flatMap((m) => [m.inCents, m.outCents]) || [1])), [data]);

  return <section className="page-stack">
    <div className="page-header"><div><p className="eyebrow">Dashboard</p><h2>Visão financeira</h2><p className="muted">Indicadores calculados no banco local.</p></div><label className="year-control">Ano<input type="number" min="2000" max="2200" value={year} onChange={(e)=>setYear(Number(e.target.value))}/></label></div>
    {error && <div className="error-box">{error}</div>}
    <div className="metric-grid">
      <div className="metric-card"><span>Contas a receber</span><strong>{brl(data?.cards.receivableOpenCents || 0)}</strong><small>{brl(data?.cards.overdueReceivableCents || 0)} vencido</small></div>
      <div className="metric-card"><span>Contas a pagar</span><strong>{brl(data?.cards.payableOpenCents || 0)}</strong><small>{brl(data?.cards.overduePayableCents || 0)} vencido</small></div>
      <div className="metric-card"><span>Entradas realizadas</span><strong>{brl(data?.cards.receivedCents || 0)}</strong><small>Ano selecionado</small></div>
      <div className="metric-card"><span>Saídas realizadas</span><strong>{brl(data?.cards.paidCents || 0)}</strong><small>Resultado {brl(data?.cards.resultCents || 0)}</small></div>
    </div>
    <div className="dashboard-grid">
      <div className="panel chart-panel"><div className="panel-title"><div><h3>Fluxo de caixa mensal</h3><p className="muted">Entradas e saídas por mês</p></div></div><div className="cash-chart">{data?.monthly.map((item)=><div className="chart-month" key={item.month}><div className="bar-pair"><i className="bar-in" style={{height:`${Math.max(2,(item.inCents/maxFlow)*100)}%`}} title={`Entradas ${brl(item.inCents)}`}/><i className="bar-out" style={{height:`${Math.max(2,(item.outCents/maxFlow)*100)}%`}} title={`Saídas ${brl(item.outCents)}`}/></div><span>{item.month.slice(5)}</span></div>)}</div><div className="chart-legend"><span><i className="legend-in"/>Entradas</span><span><i className="legend-out"/>Saídas</span></div></div>
      <div className="panel"><h3>Saldo em contas</h3><div className="balance-list">{data?.accountBalances.map((account)=><div key={account.id}><span><strong>{account.name}</strong><small>{account.type}</small></span><b>{brl(account.balanceCents)}</b></div>)}{!data?.accountBalances.length && <p className="muted">Nenhuma conta cadastrada.</p>}</div><div className="balance-total"><span>Saldo bancário</span><strong>{brl(data?.cards.bankBalanceCents || 0)}</strong></div></div>
    </div>
    <div className="dashboard-grid lower">
      <div className="panel"><h3>5 maiores despesas</h3><div className="expense-list">{data?.topExpenses.map((expense,index)=><div key={`${expense.description}-${index}`}><span>{expense.description}</span><strong>{brl(expense.amountCents)}</strong></div>)}{!data?.topExpenses.length && <p className="muted">Sem despesas realizadas no período.</p>}</div></div>
      <div className="panel"><h3>DRE realizada</h3><div className="dre-mini"><div><span>Receitas</span><strong>{brl(data?.dre.totals.revenueCents || 0)}</strong></div><div><span>Despesas</span><strong>{brl(data?.dre.totals.expenseCents || 0)}</strong></div><div className="result"><span>Resultado</span><strong>{brl(data?.dre.totals.resultCents || 0)}</strong></div></div></div>
    </div>
  </section>;
}
