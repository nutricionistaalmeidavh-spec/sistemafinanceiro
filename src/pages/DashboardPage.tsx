import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { FinanceMetricCard } from '../components/finance-ui';
import { brl } from '../lib/format';

type Props = { token: string; onNavigate:(page:'finance'|'cashflow'|'recurring')=>void; onOpenGuide:()=>void };

export default function DashboardPage({ token, onNavigate, onOpenGuide }: Props) {
  const api = window.financeiro!;
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState<DashboardSnapshot | null>(null);
  const [error, setError] = useState('');
  const [upcoming,setUpcoming] = useState<FinanceEntry[]>([]);
  const reload = useCallback(async () => {
    try { const [snapshot,entries]=await Promise.all([api.analytics.dashboard(token, { year }),api.finance.listEntries(token)]);
      setData(snapshot);setUpcoming(entries.filter(e=>e.status!=='CANCELLED'&&e.openCents>0&&e.dueAt>=new Date().toLocaleDateString('en-CA')).sort((a,b)=>a.dueAt.localeCompare(b.dueAt)).slice(0,5));setError(''); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }, [api, token, year]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => api.finance.onDataChanged(() => { void reload(); }), [api, reload]);
  const maxFlow = useMemo(() => Math.max(1, ...(data?.monthly.flatMap((m) => [m.inCents, m.outCents]) || [1])), [data]);
  const overduePayable = data?.cards.overduePayableCents || 0;
  const overdueReceivable = data?.cards.overdueReceivableCents || 0;
  const result = data?.cards.resultCents || 0;

  return <section className="page-stack" data-testid="page-dashboard">
    <div className="page-header"><div><p className="eyebrow">Dashboard</p><h2>Visão financeira</h2><p className="muted">O que entrou, o que saiu e o que precisa de atenção agora.</p></div><label className="year-control">Ano<input type="number" min="2000" max="2200" value={year} onChange={(e)=>setYear(Number(e.target.value))}/></label></div>
    {error && <div className="error-box" role="alert">{error} <button type="button" onClick={()=>void reload()}>Tentar novamente</button></div>}
    <div className="dashboard-actions" aria-label="Ações rápidas"><button type="button" className="primary-button" onClick={()=>onNavigate('finance')}>Novo lançamento</button><button className="secondary-button" type="button" onClick={()=>onNavigate('cashflow')}>Contas e saldos</button><button className="secondary-button" type="button" onClick={()=>onNavigate('recurring')}>Recorrências</button></div>
    {data&&<p className="dashboard-asof" role="status">Posição financeira até {data.asOf.split('-').reverse().join('/')} · Realizado, sem antecipar movimentações futuras.</p>}
    {data?.accountBalances.length===0&&<div className="panel first-use-prompt"><strong>Comece cadastrando sua primeira conta financeira.</strong><p className="muted">Depois informe o saldo inicial e registre a primeira despesa ou receita.</p><button className="primary-button" type="button" onClick={onOpenGuide}>Começar configuração guiada</button></div>}
    <div className="metric-grid">
      <FinanceMetricCard label="Saldo disponível" value={brl(data?.cards.availableBalanceCents || 0)} helper="Bancos + dinheiro em caixa; data informada acima" tone="accent"/>
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
      <div className="panel"><div className="panel-title"><div><h3>Saldos por conta</h3><p className="muted">Posição das contas na data indicada acima</p></div></div><div className="balance-list">{data?.accountBalances.map((account)=><div key={account.id}><span><strong>{account.name}</strong><small>{account.type}</small></span><b>{brl(account.balanceCents)}</b></div>)}{!data?.accountBalances.length && <p className="muted">Nenhuma conta cadastrada.</p>}</div><div className="balance-total"><span>Saldo total de todas as contas</span><strong>{brl(data?.cards.totalBalanceCents || 0)}</strong></div></div>
    </div>
    {year===new Date().getFullYear()&&<section className="panel"><div className="panel-title"><div><h3>Próximos vencimentos</h3><p className="muted">Despesas e receitas em aberto; clique para visualizar os lançamentos.</p></div><button type="button" className="secondary-button" onClick={()=>onNavigate('finance')}>Ver todos</button></div><div className="upcoming-list">{upcoming.map(entry=><button type="button" className="upcoming-item" key={entry.id} onClick={()=>onNavigate('finance')}><span>{entry.description}<small>{entry.kind==='PAYABLE'?'A pagar':'A receber'} · {entry.dueAt.split('-').reverse().join('/')}</small></span><strong>{brl(entry.openCents)}</strong></button>)}{upcoming.length===0&&<p className="muted">Nenhuma conta futura em aberto.</p>}</div></section>}
    <div className="dashboard-grid lower">
      <div className="panel"><div className="panel-title"><div><h3>Maiores despesas</h3><p className="muted">Cinco maiores saídas realizadas</p></div></div><div className="expense-list">{data?.topExpenses.map((expense,index)=><div key={`${expense.description}-${index}`}><span>{expense.description}</span><strong>{brl(expense.amountCents)}</strong></div>)}{!data?.topExpenses.length && <p className="muted">Sem despesas realizadas no período.</p>}</div></div>
      <div className="panel"><div className="panel-title"><div><h3>DRE resumida</h3><p className="muted">Resultado realizado no período</p></div></div><div className="dre-mini"><div><span>Receitas</span><strong>{brl(data?.dre.totals.revenueCents || 0)}</strong></div><div><span>Despesas</span><strong>{brl(data?.dre.totals.expenseCents || 0)}</strong></div><div className="result"><span>Resultado</span><strong>{brl(data?.dre.totals.resultCents || 0)}</strong></div></div></div>
    </div>
  </section>;
}
