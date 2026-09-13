import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Check, FileUp, Link2, RefreshCw, UploadCloud, X } from 'lucide-react';
import { brl, can, toCents, today } from '../lib/format';

type Props = { token: string; session: FinanceiroSession };
type SourceType = 'CSV'|'OFX'|'PDF'|'MANUAL';
type StatementTransaction = {
  id:string; accountId:string; date:string; description:string; amountCents:number; direction:'credit'|'debit';
  counterparty?:string; normalized?:string; category?:string; sourceFingerprint:string; businessFingerprint:string;
  classification:{matched:boolean;ruleId:string|null;confidence:number;reason:string};
};
type Preview = { sourceType:SourceType; documentId:string; transactions:StatementTransaction[]; duplicates:StatementTransaction[]; summary:{parsed:number;accepted:number;duplicates:number;classified:number;needsReview:number} };
type StoredTransaction = { id:string; account_id:string; account_name:string; occurred_at:string; description:string; amount_cents:number; direction:'credit'|'debit'; category_label?:string|null; review_status:string; rule_reason?:string|null };
type EntrySuggestion = { transactionId:string; allocations:Array<{obligationId:string;amountCents:number}>; confidence:number; kind:string; reason:string };
type StatementInput = { sourceType:SourceType; accountId:string; documentId:string; filename?:string; content?:string; dataBase64?:string; rows?:Array<Record<string,unknown>> };
type StatementApi = {
  preview(token:string,input:StatementInput):Promise<Preview>;
  commit(token:string,input:StatementInput):Promise<{batchId:string;inserted:number;duplicates:number;summary:Preview['summary']}>;
  list(token:string,filters?:Record<string,unknown>):Promise<StoredTransaction[]>;
  suggestEntries(token:string,filters?:Record<string,unknown>):Promise<EntrySuggestion[]>;
  suggestTransfers(token:string,filters?:Record<string,unknown>):Promise<{internalTransfers:unknown[];withdrawals:unknown[];returns:unknown[]}>;
  decision(token:string,input:{transactionId:string;entryId:string;decision:'accepted'|'rejected'|'manual';amountCents?:number}):Promise<unknown>;
};
type FinanceBridge = NonNullable<Window['financeiro']> & { statements:StatementApi };

function fileToBase64(file: File) {
  return new Promise<string>((resolve,reject)=>{
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(reader.error || new Error('Falha ao ler o PDF.'));
    reader.readAsDataURL(file);
  });
}
function confidence(value:number){return `${Math.round(Number(value||0)*100)}%`;}

export default function StatementsPage({ token, session }: Props) {
  const bridge = window.financeiro as FinanceBridge;
  const api = bridge.statements;
  const canManage = can(session,'finance.manage');
  const [accounts,setAccounts] = useState<FinanceAccount[]>([]);
  const [stored,setStored] = useState<StoredTransaction[]>([]);
  const [suggestions,setSuggestions] = useState<EntrySuggestion[]>([]);
  const [sourceType,setSourceType] = useState<SourceType>('CSV');
  const [accountId,setAccountId] = useState('');
  const [file,setFile] = useState<File|null>(null);
  const [manual,setManual] = useState({date:today(),description:'',amount:'',direction:'debit' as 'debit'|'credit'});
  const [preview,setPreview] = useState<Preview|null>(null);
  const [pendingInput,setPendingInput] = useState<StatementInput|null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');

  const reload = useCallback(async()=>{
    const [nextAccounts,nextStored] = await Promise.all([bridge.finance.listAccounts(token),api.list(token)]);
    setAccounts(nextAccounts); setStored(nextStored);
    setAccountId((current)=>current || nextAccounts[0]?.id || '');
  },[api,bridge.finance,token]);
  useEffect(()=>{void reload().catch((err)=>setError(err instanceof Error?err.message:String(err)));},[reload]);

  const visible = useMemo(()=>stored.slice(0,100),[stored]);
  async function buildInput():Promise<StatementInput>{
    if(!accountId) throw new Error('Cadastre ou selecione uma conta financeira.');
    if(sourceType==='MANUAL') return {sourceType,accountId,documentId:`manual-${Date.now()}`,rows:[{date:manual.date,description:manual.description,amountCents:toCents(manual.amount),direction:manual.direction}]};
    if(!file) throw new Error('Selecione um arquivo para analisar.');
    const base = {sourceType,accountId,documentId:`${file.name}:${file.size}:${file.lastModified}`,filename:file.name};
    if(sourceType==='PDF') return {...base,dataBase64:await fileToBase64(file)};
    return {...base,content:await file.text()};
  }
  async function runPreview(event?:FormEvent){
    event?.preventDefault(); setBusy(true); setError(''); setNotice('');
    try{const input=await buildInput(); const result=await api.preview(token,input); setPendingInput(input); setPreview(result);}
    catch(err){setError(err instanceof Error?err.message:String(err));}
    finally{setBusy(false);}
  }
  async function commit(){
    if(!pendingInput||!canManage)return; setBusy(true); setError('');
    try{const result=await api.commit(token,pendingInput); setNotice(`${result.inserted} transação(ões) importada(s); ${result.duplicates} duplicidade(s) ignorada(s).`); setPreview(null); setPendingInput(null); setFile(null); await reload();}
    catch(err){setError(err instanceof Error?err.message:String(err));}
    finally{setBusy(false);}
  }
  async function loadSuggestions(){
    setBusy(true); setError('');
    try{setSuggestions(await api.suggestEntries(token,{minConfidence:0.65}));}
    catch(err){setError(err instanceof Error?err.message:String(err));}
    finally{setBusy(false);}
  }
  async function decide(item:EntrySuggestion,decision:'accepted'|'rejected'){
    if(!canManage)return;
    const allocation=item.allocations[0]; if(!allocation)return;
    setBusy(true); setError('');
    try{await api.decision(token,{transactionId:item.transactionId,entryId:allocation.obligationId,amountCents:allocation.amountCents,decision}); await loadSuggestions(); await reload();}
    catch(err){setError(err instanceof Error?err.message:String(err)); setBusy(false);}
  }
  function onSource(next:SourceType){setSourceType(next);setPreview(null);setPendingInput(null);setFile(null);setError('');setNotice('');}
  function onFile(event:ChangeEvent<HTMLInputElement>){setFile(event.target.files?.[0]||null);setPreview(null);setPendingInput(null);}

  return <section className="page-stack" data-testid="page-statements">
    <div className="page-header"><div><p className="eyebrow">Extratos</p><h2>Importação e conciliação bancária</h2><p className="muted">CSV, OFX, PDF e lançamento manual entram no mesmo modelo canônico e passam por revisão antes de afetar o financeiro.</p></div><button type="button" className="secondary" onClick={()=>void reload()}><RefreshCw size={16}/>Atualizar</button></div>
    {error&&<div className="error-box">{error}</div>}{notice&&<div className="success-box">{notice}</div>}

    <form className="panel form-panel" onSubmit={(event)=>void runPreview(event)}>
      <div className="panel-title"><div><strong>Analisar extrato</strong><small>O arquivo é analisado localmente. Nada é lançado antes da confirmação.</small></div></div>
      <div className="segmented">{(['CSV','OFX','PDF','MANUAL'] as SourceType[]).map(type=><button key={type} type="button" className={sourceType===type?'active':''} onClick={()=>onSource(type)}>{type==='MANUAL'?'Manual':type}</button>)}</div>
      <div className="form-grid">
        <label><span>Conta</span><select value={accountId} onChange={(e)=>setAccountId(e.target.value)} required><option value="">Selecione</option>{accounts.map(account=><option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
        {sourceType!=='MANUAL'&&<label><span>Arquivo {sourceType}</span><input type="file" accept={sourceType==='CSV'?'.csv,text/csv':sourceType==='OFX'?'.ofx,.qfx,application/x-ofx':'.pdf,application/pdf'} onChange={onFile}/></label>}
        {sourceType==='MANUAL'&&<><label><span>Data</span><input type="date" value={manual.date} onChange={(e)=>setManual({...manual,date:e.target.value})} required/></label><label><span>Descrição</span><input value={manual.description} onChange={(e)=>setManual({...manual,description:e.target.value})} required/></label><label><span>Valor</span><input inputMode="decimal" placeholder="0,00" value={manual.amount} onChange={(e)=>setManual({...manual,amount:e.target.value})} required/></label><label><span>Tipo</span><select value={manual.direction} onChange={(e)=>setManual({...manual,direction:e.target.value as 'debit'|'credit'})}><option value="debit">Saída</option><option value="credit">Entrada</option></select></label></>}
      </div>
      {file&&<p className="muted"><FileUp size={15}/> {file.name} — {(file.size/1024).toFixed(1)} KB</p>}
      <div className="actions"><button type="submit" disabled={busy}><UploadCloud size={16}/>{busy?'Analisando…':'Gerar prévia'}</button></div>
    </form>

    {preview&&<div className="panel table-panel table-scroll">
      <div className="panel-title"><div><strong>Prévia</strong><small>{preview.summary.parsed} lidas · {preview.summary.classified} classificadas · {preview.summary.needsReview} para revisar · {preview.summary.duplicates} duplicadas</small></div>{canManage&&<button type="button" onClick={()=>void commit()} disabled={busy||preview.summary.accepted===0}><Check size={16}/>Confirmar importação</button>}</div>
      <table><thead><tr><th>Data</th><th>Descrição</th><th>Tipo</th><th>Categoria sugerida</th><th>Valor</th><th>Regra</th></tr></thead><tbody>{preview.transactions.map(tx=><tr key={tx.sourceFingerprint}><td>{tx.date}</td><td>{tx.description}</td><td>{tx.direction==='credit'?'Entrada':'Saída'}</td><td>{tx.category||'Revisar'}</td><td>{brl(tx.amountCents)}</td><td>{tx.classification.matched?tx.classification.reason:'Sem regra automática'}</td></tr>)}{preview.transactions.length===0&&<tr><td colSpan={6} className="muted">Nenhuma transação nova para importar.</td></tr>}</tbody></table>
    </div>}

    <div className="panel table-panel table-scroll">
      <div className="panel-title"><div><strong>Transações importadas</strong><small>Últimas {visible.length} movimentações do extrato.</small></div><button type="button" className="secondary" onClick={()=>void loadSuggestions()} disabled={busy}><Link2 size={16}/>Buscar conciliações</button></div>
      <table><thead><tr><th>Data</th><th>Conta</th><th>Descrição</th><th>Categoria</th><th>Status</th><th>Valor</th></tr></thead><tbody>{visible.map(tx=><tr key={tx.id}><td>{tx.occurred_at}</td><td>{tx.account_name}</td><td>{tx.description}</td><td>{tx.category_label||'—'}</td><td>{tx.review_status}</td><td>{tx.direction==='debit'?'-':''}{brl(tx.amount_cents)}</td></tr>)}{!visible.length&&<tr><td colSpan={6} className="muted">Nenhum extrato importado.</td></tr>}</tbody></table>
    </div>

    {suggestions.length>0&&<div className="panel table-panel table-scroll"><div className="panel-title"><div><strong>Sugestões de conciliação</strong><small>O motor determinístico compara valor, beneficiário, data, categoria e feedback anterior.</small></div></div><table><thead><tr><th>Transação</th><th>Lançamento sugerido</th><th>Valor</th><th>Confiança</th><th>Motivo</th><th></th></tr></thead><tbody>{suggestions.map(item=>{const allocation=item.allocations[0];return <tr key={`${item.transactionId}-${allocation?.obligationId}`}><td>{item.transactionId}</td><td>{allocation?.obligationId}</td><td>{brl(allocation?.amountCents||0)}</td><td>{confidence(item.confidence)}</td><td>{item.reason}</td><td>{canManage&&<div className="actions"><button type="button" className="secondary" onClick={()=>void decide(item,'rejected')} disabled={busy}><X size={15}/>Rejeitar</button><button type="button" onClick={()=>void decide(item,'accepted')} disabled={busy}><Check size={15}/>Aceitar</button></div>}</td></tr>})}</tbody></table></div>}
  </section>;
}
