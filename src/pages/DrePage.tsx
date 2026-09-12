import { useCallback, useEffect, useState } from 'react';
import { brl } from '../lib/format';

type Props = { token: string };
export default function DrePage({ token }: Props) {
  const api = window.financeiro!;
  const [year,setYear] = useState(new Date().getFullYear());
  const [basis,setBasis] = useState<'realized'|'accrual'>('realized');
  const [dre,setDre] = useState<DreReport | null>(null);
  const [error,setError] = useState('');
  const reload = useCallback(async()=>{try{setDre(await api.analytics.dre(token,{from:`${year}-01-01`,to:`${year}-12-31`,basis}));setError('');}catch(err){setError(err instanceof Error?err.message:String(err));}},[api,token,year,basis]);
  useEffect(()=>{void reload();},[reload]);
  return <section className="page-stack"><div className="page-header"><div><p className="eyebrow">DRE</p><h2>Demonstração de resultado</h2><p className="muted">Visão realizada por baixas ou competência por vencimento.</p></div><label className="year-control">Ano<input type="number" value={year} onChange={(e)=>setYear(Number(e.target.value))}/></label></div>{error&&<div className="error-box">{error}</div>}<div className="segmented"><button className={basis==='realized'?'active':''} onClick={()=>setBasis('realized')}>Realizado</button><button className={basis==='accrual'?'active':''} onClick={()=>setBasis('accrual')}>Competência</button></div><div className="metric-grid"><div className="metric-card"><span>Receita</span><strong>{brl(dre?.totals.revenueCents||0)}</strong></div><div className="metric-card"><span>Despesa</span><strong>{brl(dre?.totals.expenseCents||0)}</strong></div><div className="metric-card"><span>Resultado</span><strong>{brl(dre?.totals.resultCents||0)}</strong></div><div className="metric-card"><span>Margem</span><strong>{dre?.totals.revenueCents?`${((dre.totals.resultCents/dre.totals.revenueCents)*100).toFixed(1)}%`:'0,0%'}</strong></div></div><div className="panel table-panel"><table><thead><tr><th>Grupo DRE</th><th>Receitas</th><th>Despesas</th><th>Resultado</th></tr></thead><tbody>{dre?.groups.map((item)=><tr key={item.group}><td><strong>{item.group}</strong></td><td>{brl(item.revenueCents)}</td><td>{brl(item.expenseCents)}</td><td>{brl(item.resultCents)}</td></tr>)}</tbody></table>{!dre?.groups.length&&<div className="empty-state">Sem movimentação no período.</div>}</div></section>;
}
