import { type ChangeEvent, type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Check, FileUp, Link2, RefreshCw, UploadCloud, X } from 'lucide-react';
import { brl, can, toCents, today } from '../lib/format';

type Props = { token: string; session: FinanceiroSession; onOpenFinance?:()=>void };
type SourceType = 'CSV'|'OFX'|'PDF'|'XLSX'|'ODS'|'QIF'|'MANUAL';
type StatementTransaction = {
  id:string; accountId:string; date:string; description:string; amountCents:number; direction:'credit'|'debit';
  counterparty?:string; normalized?:string; category?:string; sourceFingerprint:string; businessFingerprint:string;
  classification:{matched:boolean;ruleId:string|null;confidence:number;reason:string};
};
type Preview = { sourceType:SourceType; documentId:string; transactions:StatementTransaction[]; duplicates:StatementTransaction[]; summary:{parsed:number;accepted:number;duplicates:number;classified:number;needsReview:number} };
type StoredTransaction = { id:string; account_id:string; account_name:string; occurred_at:string; description:string; amount_cents:number; direction:'credit'|'debit'; category_label?:string|null; review_status:string; has_registered_payment?:number; rule_reason?:string|null };
type EntrySuggestion = { transactionId:string; allocations:Array<{obligationId:string;amountCents:number}>; confidence:number; kind:string; reason:string };
type StatementInput = { sourceType:SourceType; accountId:string; documentId:string; filename?:string; content?:string; dataBase64?:string; rows?:Array<Record<string,unknown>>; columnMapping?:Record<string,string> };
type StatementApi = {
  preview(token:string,input:StatementInput):Promise<Preview>;
  inspectXlsx(token:string,dataBase64:string):Promise<{headers:string[];rowCount:number;previewRows:string[][]}>;
  inspectOds(token:string,dataBase64:string):Promise<{headers:string[];rowCount:number;previewRows:string[][]}>;
  inspectCnab(token:string,content:string):Promise<{layout:number;bankCode:string;records:number;transactionImportSupported:boolean;note:string}>;
  commit(token:string,input:StatementInput):Promise<{batchId:string;inserted:number;duplicates:number;summary:Preview['summary']}>;
  list(token:string,filters?:Record<string,unknown>):Promise<StoredTransaction[]>;
  suggestEntries(token:string,filters?:Record<string,unknown>):Promise<EntrySuggestion[]>;
  suggestTransfers(token:string,filters?:Record<string,unknown>):Promise<{internalTransfers:unknown[];withdrawals:unknown[];returns:unknown[]}>;
  decision(token:string,input:{transactionId:string;entryId:string;decision:'accepted'|'rejected'|'manual';amountCents?:number;registerSettlement?:boolean}):Promise<{settlementId?:string|null;alreadyRegistered?:boolean}>;
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

export default function StatementsPage({ token, session, onOpenFinance }: Props) {
  const bridge = window.financeiro as FinanceBridge;
  const api = bridge.statements;
  const canManage = can(session,'finance.manage');
  const [accounts,setAccounts] = useState<FinanceAccount[]>([]);
  const [stored,setStored] = useState<StoredTransaction[]>([]);
  const [entries,setEntries]=useState<FinanceEntry[]>([]);
  const [suggestions,setSuggestions] = useState<EntrySuggestion[]>([]);
  const [sourceType,setSourceType] = useState<SourceType>('CSV');
  const [accountId,setAccountId] = useState('');
  const [file,setFile] = useState<File|null>(null);
  const [xlsxInfo,setXlsxInfo] = useState<{headers:string[];rowCount:number;previewRows:string[][]}|null>(null);
  const [columnMapping,setColumnMapping] = useState<Record<string,string>>({});
  const [manual,setManual] = useState({date:today(),description:'',amount:'',direction:'debit' as 'debit'|'credit'});
  const [preview,setPreview] = useState<Preview|null>(null);
  const [pendingInput,setPendingInput] = useState<StatementInput|null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [cnabReport,setCnabReport]=useState<{layout:number;bankCode:string;records:number;note:string}|null>(null);

  const reload = useCallback(async()=>{
    const [nextAccounts,nextStored,nextEntries] = await Promise.all([bridge.finance.listAccounts(token),api.list(token),bridge.finance.listEntries(token)]);
    setAccounts(nextAccounts); setStored(nextStored);setEntries(nextEntries);
    setAccountId((current)=>current || nextAccounts[0]?.id || '');
  },[api,bridge.finance,token]);
  useEffect(()=>{void reload().catch((err)=>setError(err instanceof Error?err.message:String(err)));},[reload]);

  const visible = useMemo(()=>stored.slice(0,100),[stored]);
  async function buildInput():Promise<StatementInput>{
    if(!accountId) throw new Error('Cadastre ou selecione uma conta financeira.');
    if(sourceType==='MANUAL') return {sourceType,accountId,documentId:`manual-${Date.now()}`,rows:[{date:manual.date,description:manual.description,amountCents:toCents(manual.amount),direction:manual.direction}]};
    if(!file) throw new Error('Selecione um arquivo para analisar.');
    const base = {sourceType,accountId,documentId:`${file.name}:${file.size}:${file.lastModified}`,filename:file.name};
    if(sourceType==='PDF'||sourceType==='XLSX'||sourceType==='ODS') { if(file.size>12*1024*1024)throw new Error('Arquivo maior que 12 MB.'); return {...base,dataBase64:await fileToBase64(file),...(['XLSX','ODS'].includes(sourceType)?{columnMapping}:{})}; }
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
  async function decide(item:EntrySuggestion,decision:'accepted'|'rejected',registerSettlement=false){
    if(!canManage||busy)return;
    const allocation=item.allocations[0];if(!allocation)return;
    if(registerSettlement&&!window.confirm(
      `Confirmar baixa de ${brl(allocation.amountCents)} e vincular ao extrato? A operação altera caixa e DRE, sujeita às aprovações financeiras.`
    ))return;
    setBusy(true);setError('');setNotice('');
    try{
      const result=await api.decision(token,{
        transactionId:item.transactionId,entryId:allocation.obligationId,
        amountCents:allocation.amountCents,decision,registerSettlement
      });
      const [nextSuggestions]=await Promise.all([api.suggestEntries(token,{minConfidence:0.65}),reload()]);
      setSuggestions(nextSuggestions);
      if(decision==='rejected')setNotice('Sugestão rejeitada; o lançamento não foi alterado.');
      else if(registerSettlement)setNotice(result.alreadyRegistered
        ?'Baixa já existente; nenhum pagamento duplicado.':'Conciliação e baixa registradas no mesmo lançamento financeiro.');
      else setNotice('Extrato vinculado ao lançamento. Nenhuma baixa automática foi realizada.');
    }catch(err){setError(err instanceof Error?err.message:String(err));}
    finally{setBusy(false);}
  }
  function onSource(next:SourceType){setSourceType(next);setPreview(null);setPendingInput(null);setFile(null);setXlsxInfo(null);setColumnMapping({});setError('');setNotice('');}
  async function onFile(event:ChangeEvent<HTMLInputElement>){
    const selected=event.target.files?.[0]||null;
    setFile(selected);setPreview(null);setPendingInput(null);setXlsxInfo(null);setColumnMapping({});
    if((sourceType==='XLSX'||sourceType==='ODS')&&selected){try{
      if(selected.size>12*1024*1024)throw new Error('XLSX maior que 12 MB');
      setXlsxInfo(sourceType==='XLSX'?await api.inspectXlsx(token,await fileToBase64(selected)):await api.inspectOds(token,await fileToBase64(selected)));
    }catch(error){setError(error instanceof Error?error.message:String(error));}}
  }

  async function onCnabFile(event:ChangeEvent<HTMLInputElement>){
    const selected=event.target.files?.[0];if(!selected)return;
    try{setCnabReport(await api.inspectCnab(token,await selected.text()));setError('');}
    catch(err){setError(err instanceof Error?err.message:String(err));}
  }
  return <section className="page-stack" data-testid="page-statements">
    <div className="page-header"><div><p className="eyebrow">Extratos</p><h2>Importação e conciliação bancária</h2><p className="muted">CSV, XLSX, ODS, QIF, OFX, PDF e lançamento manual entram no mesmo modelo canônico e passam por revisão antes de afetar o financeiro.</p></div><button type="button" className="secondary-button" onClick={()=>void reload()}><RefreshCw size={16}/>Atualizar</button></div>
    {error&&<div className="error-box">{error}</div>}{notice&&<div className="status status-ok">{notice}</div>}

    <div className="panel" style={{padding:16}}><strong>Validar arquivo CNAB 240/400</strong>
      <p className="muted">Inspeção de layout: CNAB de cobrança/remessa/retorno não é extrato bancário e não gera lançamentos sem homologação do banco.</p>
      <label>Arquivo CNAB<input type="file" accept=".ret,.rem,.cnab,.txt" onChange={event=>void onCnabFile(event)}/></label>
      {cnabReport&&<p>{cnabReport.layout} posições · Banco {cnabReport.bankCode} · {cnabReport.records} registros. {cnabReport.note}</p>}
    </div>
    <form className="panel form-grid" onSubmit={(event)=>void runPreview(event)}>
      <div className="wide panel-title"><div><strong>Analisar extrato</strong><small>O arquivo é analisado localmente. Nada é lançado antes da confirmação.</small></div></div>
      <div className="wide segmented">{(['CSV','XLSX','ODS','QIF','OFX','PDF','MANUAL'] as SourceType[]).map(type=><button key={type} type="button" className={sourceType===type?'active':''} onClick={()=>onSource(type)}>{type==='MANUAL'?'Manual':type}</button>)}</div>
      <label><span>Conta</span><select value={accountId} onChange={(e)=>setAccountId(e.target.value)} required><option value="">Selecione</option>{accounts.map(account=><option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
      {sourceType!=='MANUAL'&&<label><span>Arquivo {sourceType}</span><input type="file" accept={sourceType==='CSV'?'.csv,text/csv':sourceType==='OFX'?'.ofx,.qfx,application/x-ofx':sourceType==='XLSX'?'.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':sourceType==='ODS'?'.ods,application/vnd.oasis.opendocument.spreadsheet':sourceType==='QIF'?'.qif,text/plain':'.pdf,application/pdf'} onChange={(event)=>void onFile(event)}/></label>}
      {(sourceType==='XLSX'||sourceType==='ODS')&&xlsxInfo&&<div className="wide panel nested-form">
        <strong>Mapeamento das colunas do extrato</strong>
        <p className="muted">Escolha as colunas reais do banco. Quando o cabeçalho for padrão, mantenha detecção automática. Nenhuma transação será criada antes da prévia e confirmação.</p>
        <div className="form-grid">{([
          ['date','Data *'],['description','Descrição *'],['amount','Valor'],['direction','Entrada/saída'],['debit','Débito'],['credit','Crédito']
        ] as Array<[string,string]>).map(([key,label])=><label key={key}><span>{label}</span>
          <select value={columnMapping[key]||''} onChange={event=>{setColumnMapping(current=>({...current,[key]:event.target.value}));setPreview(null);setPendingInput(null);}}>
            <option value="">Detectar automaticamente</option>
            {xlsxInfo.headers.map((name,i)=><option key={i} value={name}>{name||'Coluna '+(i+1)}</option>)}
          </select>
        </label>)}</div>
        <small className="muted">{xlsxInfo.rowCount} linhas detectadas. Amostra: {xlsxInfo.previewRows[0]?.join(' | ')||'Sem amostra'}</small>
      </div>}
      {sourceType==='MANUAL'&&<><label><span>Data</span><input type="date" value={manual.date} onChange={(e)=>setManual({...manual,date:e.target.value})} required/></label><label><span>Descrição</span><input value={manual.description} onChange={(e)=>setManual({...manual,description:e.target.value})} required/></label><label><span>Valor</span><input inputMode="decimal" placeholder="0,00" value={manual.amount} onChange={(e)=>setManual({...manual,amount:e.target.value})} required/></label><label><span>Tipo</span><select value={manual.direction} onChange={(e)=>setManual({...manual,direction:e.target.value as 'debit'|'credit'})}><option value="debit">Saída</option><option value="credit">Entrada</option></select></label></>}
      {file&&<p className="wide muted"><FileUp size={15}/> {file.name} — {(file.size/1024).toFixed(1)} KB</p>}
      <button className="primary-button" type="submit" disabled={busy}><UploadCloud size={16}/>{busy?'Analisando…':'Gerar prévia'}</button>
    </form>

    {preview&&<div className="panel table-panel table-scroll">
      <div className="panel-title"><div><strong>Prévia</strong><small>{preview.summary.parsed} lidas · {preview.summary.classified} classificadas · {preview.summary.needsReview} para revisar · {preview.summary.duplicates} duplicadas</small></div>{canManage&&<button className="primary-button" type="button" onClick={()=>void commit()} disabled={busy||preview.summary.accepted===0}><Check size={16}/>Confirmar importação</button>}</div>
      <table><thead><tr><th>Data</th><th>Descrição</th><th>Tipo</th><th>Categoria sugerida</th><th>Valor</th><th>Regra</th></tr></thead><tbody>{preview.transactions.map(tx=><tr key={tx.sourceFingerprint}><td>{tx.date}</td><td>{tx.description}</td><td>{tx.direction==='credit'?'Entrada':'Saída'}</td><td>{tx.category||'Revisar'}</td><td>{brl(tx.amountCents)}</td><td>{tx.classification.matched?tx.classification.reason:'Sem regra automática'}</td></tr>)}{preview.transactions.length===0&&<tr><td colSpan={6} className="muted">Nenhuma transação nova para importar.</td></tr>}</tbody></table>
    </div>}

    <div className="panel table-panel table-scroll">
      <div className="panel-title"><div><strong>Transações importadas</strong><small>Últimas {visible.length} movimentações do extrato.</small></div><button type="button" className="secondary-button" onClick={()=>void loadSuggestions()} disabled={busy}><Link2 size={16}/>Buscar conciliações</button></div>
      <table><thead><tr><th>Data</th><th>Conta</th><th>Descrição</th><th>Categoria</th><th>Status</th><th>Valor</th></tr></thead><tbody>{visible.map(tx=><tr key={tx.id}><td>{tx.occurred_at}</td><td>{tx.account_name}</td><td>{tx.description}</td><td>{tx.category_label||'—'}</td><td>{(tx.review_status==='MATCHED'?(tx.has_registered_payment?'Conciliado e baixado':'Vinculado, sem baixa'):({PENDING:'Pendente',AUTO_CLASSIFIED:'Classificada automaticamente',REVIEWED:'Revisada'} as Record<string,string>)[tx.review_status]||tx.review_status)}</td><td>{tx.direction==='debit'?'-':''}{brl(tx.amount_cents)}</td></tr>)}{!visible.length&&<tr><td colSpan={6} className="muted">Nenhum extrato importado.</td></tr>}</tbody></table>
    </div>

    {suggestions.length>0&&<div className="panel table-panel table-scroll"><div className="panel-title"><div><strong>Sugestões de conciliação</strong><small>Vincular ao lançamento não registra pagamento; Vincular e baixar registra o pagamento confirmado após autorização. Revise data, beneficiário e valor.</small></div><button type="button" className="secondary-button small" onClick={()=>onOpenFinance?.()}>Abrir lançamentos</button></div><table><thead><tr><th>Transação</th><th>Lançamento sugerido</th><th>Valor</th><th>Confiança</th><th>Motivo</th><th></th></tr></thead><tbody>{suggestions.map(item=>{const allocation=item.allocations[0];return <tr key={`${item.transactionId}-${allocation?.obligationId}`}><td>{stored.find(tx=>tx.id===item.transactionId)?.description||'Transação bancária'}<small className="muted">{stored.find(tx=>tx.id===item.transactionId)?.occurred_at||''}</small></td><td>{entries.find(entry=>entry.id===allocation?.obligationId)?.description||'Lançamento não localizado'}<small className="muted">{entries.find(entry=>entry.id===allocation?.obligationId)?.status==='SETTLED'?'Já quitado':`Vence em ${entries.find(entry=>entry.id===allocation?.obligationId)?.dueAt||'—'} · Aberto: ${brl(entries.find(entry=>entry.id===allocation?.obligationId)?.openCents||0)}`}</small></td><td>{brl(allocation?.amountCents||0)}</td><td>{confidence(item.confidence)}</td><td>{item.reason}</td><td>{canManage&&<div className="row-actions"><button type="button" className="secondary-button small" onClick={()=>void decide(item,'rejected')} disabled={busy}><X size={15}/>Rejeitar</button><button className="primary-button" type="button" onClick={()=>void decide(item,'accepted')} disabled={busy}><Check size={15}/>Vincular ao lançamento</button><button className="primary-button" type="button" onClick={()=>void decide(item,'accepted',true)} disabled={busy}><Check size={15}/>Vincular e baixar</button></div>}</td></tr>})}</tbody></table></div>}
  </section>;
}
