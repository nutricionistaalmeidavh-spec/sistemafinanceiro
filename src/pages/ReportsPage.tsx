import { useCallback, useEffect, useState } from 'react';
import { Download, FileDown, FileSpreadsheet, Printer } from 'lucide-react';
import { brl, today } from '../lib/format';

type Props={token:string};
function firstDay(){return `${today().slice(0,7)}-01`;}
function saveBlob(filename:string,blob:Blob){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function fromBase64(value:string){const raw=atob(value);const bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i+=1)bytes[i]=raw.charCodeAt(i);return bytes;}

export default function ReportsPage({token}:Props){
  const api=window.financeiro!;
  const [filters,setFilters]=useState({from:firstDay(),to:today(),kind:'' as ''|FinanceiroKind,status:''});
  const [report,setReport]=useState<FinancialReport|null>(null);
  const [error,setError]=useState('');
  const load=useCallback(async()=>{try{const payload:Record<string,unknown>={from:filters.from,to:filters.to};if(filters.kind)payload.kind=filters.kind;if(filters.status)payload.status=filters.status;setReport(await api.reports.financial(token,payload));setError('');}catch(err){setError(err instanceof Error?err.message:String(err));}},[api,token,filters]);
  useEffect(()=>{void load();},[load]);
  function payload(){const result:Record<string,unknown>={from:filters.from,to:filters.to};if(filters.kind)result.kind=filters.kind;if(filters.status)result.status=filters.status;return result;}
  async function csv(){try{const file=await api.reports.csv(token,payload());saveBlob(file.filename,new Blob([file.data],{type:file.mime}));}catch(err){setError(err instanceof Error?err.message:String(err));}}
  async function xlsx(){try{const file=await api.reports.xlsx(token,payload());saveBlob(file.filename,new Blob([fromBase64(file.dataBase64)],{type:file.mime}));}catch(err){setError(err instanceof Error?err.message:String(err));}}
  async function pdf(){try{await api.reports.savePdf(token,payload());}catch(err){setError(err instanceof Error?err.message:String(err));}}
  async function print(){try{await api.reports.print(token,payload());}catch(err){setError(err instanceof Error?err.message:String(err));}}
  return <section className="page-stack"><div className="page-header"><div><p className="eyebrow">Relatórios</p><h2>Financeiro e exportações</h2><p className="muted">Filtre, imprima ou exporte localmente em CSV, XLSX e PDF.</p></div></div>
    {error&&<div className="error-box">{error}</div>}
    <div className="panel report-toolbar"><label>De<input type="date" value={filters.from} onChange={(e)=>setFilters({...filters,from:e.target.value})}/></label><label>Até<input type="date" value={filters.to} onChange={(e)=>setFilters({...filters,to:e.target.value})}/></label><label>Tipo<select value={filters.kind} onChange={(e)=>setFilters({...filters,kind:e.target.value as typeof filters.kind})}><option value="">Todos</option><option value="PAYABLE">A pagar</option><option value="RECEIVABLE">A receber</option></select></label><label>Status<select value={filters.status} onChange={(e)=>setFilters({...filters,status:e.target.value})}><option value="">Todos</option><option value="OPEN">Aberto</option><option value="PARTIAL">Parcial</option><option value="SETTLED">Baixado</option><option value="CANCELLED">Cancelado</option></select></label><div className="report-actions"><button className="secondary-button" onClick={()=>void csv()}><Download size={16}/>CSV</button><button className="secondary-button" onClick={()=>void xlsx()}><FileSpreadsheet size={16}/>XLSX</button><button className="secondary-button" onClick={()=>void pdf()}><FileDown size={16}/>PDF</button><button className="primary-button" onClick={()=>void print()}><Printer size={16}/>Imprimir</button></div></div>
    {report&&<><div className="metric-grid"><div className="metric-card"><span>Total</span><strong>{brl(report.totals.amountCents)}</strong></div><div className="metric-card"><span>Baixado</span><strong>{brl(report.totals.settledCents)}</strong></div><div className="metric-card"><span>Em aberto</span><strong>{brl(report.totals.openCents)}</strong></div><div className="metric-card"><span>Lançamentos</span><strong>{report.rows.length}</strong></div></div><div className="panel table-panel"><table><thead><tr><th>Vencimento</th><th>Descrição</th><th>Tipo</th><th>Status</th><th>Conta</th><th>Categoria</th><th>Contraparte</th><th>Valor</th><th>Aberto</th></tr></thead><tbody>{report.rows.map((row)=><tr key={row.id}><td>{row.dueAt}</td><td>{row.description}</td><td>{row.kind}</td><td>{row.status}</td><td>{row.account||'-'}</td><td>{row.category||'-'}</td><td>{row.counterparty||'-'}</td><td>{brl(row.amountCents)}</td><td className={row.isOverdue?'danger-text':''}>{brl(row.openCents)}</td></tr>)}</tbody></table>{report.rows.length===0&&<div className="empty-state">Nenhum lançamento no período.</div>}</div></>}
  </section>;
}
