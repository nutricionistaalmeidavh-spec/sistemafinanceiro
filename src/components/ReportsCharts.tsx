import { memo, useEffect, useMemo, useRef } from 'react';
import * as echarts from 'echarts';

type Props = { report: FinancialReport };
type MonthData = { period: string; receivable: number; payable: number };

function ReportsCharts({ report }: Props) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const monthly = useMemo<MonthData[]>(() => {
    const groups = new Map<string, MonthData>();
    for (const row of report.rows) {
      const period = String(row.dueAt || '').slice(0,7);
      if (!/^\d{4}-\d{2}$/.test(period)) continue;
      const value = groups.get(period) || { period, receivable: 0, payable: 0 };
      if (row.kind === 'RECEIVABLE') value.receivable += row.amountCents;
      else value.payable += row.amountCents;
      groups.set(period, value);
    }
    return [...groups.values()].sort((a,b) => a.period.localeCompare(b.period));
  }, [report]);
  useEffect(() => {
    const element = chartRef.current;
    if (!element) return;
    const chart = echarts.init(element, undefined, { renderer: 'svg' });
    const moneyLabel = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
    chart.setOption({
      animation: false,
      aria: { enabled: true, description: 'Receitas e despesas dos lançamentos exibidos agrupadas por mês de vencimento' },
      grid: { left: 75, right: 18, top: 45, bottom: 36 },
      tooltip: { trigger: 'axis', valueFormatter: (value: unknown) => moneyLabel(Number(value)) },
      legend: { top: 0, data: ['Receitas', 'Despesas'] },
      xAxis: { type: 'category', data: monthly.map(item => item.period) },
      yAxis: { type: 'value', axisLabel: { formatter: (value: number) => 'R$ ' + value.toLocaleString('pt-BR') } },
      series: [
        { name: 'Receitas', type: 'bar', data: monthly.map(item => item.receivable / 100), itemStyle: { color: '#6151C5' } },
        { name: 'Despesas', type: 'bar', data: monthly.map(item => item.payable / 100), itemStyle: { color: '#C27E44' } },
      ]
    });
    const resize = new ResizeObserver(() => chart.resize());
    resize.observe(element);
    return () => { resize.disconnect(); chart.dispose(); };
  }, [monthly]);
  return <div className="panel" style={{ padding: 16 }}>
    <h3 style={{ marginTop: 0 }}>Receitas e despesas por vencimento</h3>
    <div ref={chartRef} role="img" aria-label="Comparativo mensal de receitas e despesas do relatório filtrado" style={{ width: '100%', height: 290 }} />
    {monthly.length === 0 && <p className="muted">Sem dados para o gráfico.</p>}
  </div>;
}
export default memo(ReportsCharts);
