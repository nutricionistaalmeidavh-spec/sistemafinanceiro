import { FormEvent, useCallback, useEffect, useState } from 'react';
import { DatabaseBackup, Network, RefreshCcw, ShieldCheck } from 'lucide-react';

type Props={token:string};
function size(bytes:number){if(bytes<1024)return `${bytes} B`;if(bytes<1024*1024)return `${(bytes/1024).toFixed(1)} KB`;return `${(bytes/1024/1024).toFixed(1)} MB`;}

export default function SystemPage({token}:Props){
  const api=window.financeiro!;
  const [backups,setBackups]=useState<BackupRecord[]>([]);
  const [lan,setLan]=useState<LanStatus|null>(null);
  const [form,setForm]=useState({enabled:false,host:'127.0.0.1',port:'4175'});
  const [pairing,setPairing]=useState<LanPairingCode|null>(null);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const reload=useCallback(async()=>{try{const [nextBackups,nextLan]=await Promise.all([api.backup.list(token),api.lan.status(token)]);setBackups(nextBackups);setLan(nextLan);setForm({enabled:nextLan.enabled,host:nextLan.host,port:String(nextLan.port)});setError('');}catch(err){setError(err instanceof Error?err.message:String(err));}},[api,token]);
  useEffect(()=>{void reload();},[reload]);
  async function createBackup(){try{const result=await api.backup.create(token);setMessage(`Backup criado: ${result.path}`);await reload();}catch(err){setError(err instanceof Error?err.message:String(err));}}
  async function restore(){if(!window.confirm('Restaurar um backup substituirá o banco atual e reiniciará o aplicativo. Um backup de segurança será criado antes. Continuar?'))return;try{const result=await api.backup.restoreSelect(token);if(!result.canceled)setMessage(result.restarting?'Backup restaurado. Reiniciando…':'Backup restaurado.');}catch(err){setError(err instanceof Error?err.message:String(err));}}
  async function configureLan(event:FormEvent){event.preventDefault();try{const result=await api.lan.configure(token,{enabled:form.enabled,host:form.host,port:Number(form.port)});setLan(result);setMessage(result.enabled?'Acesso LAN atualizado.':'Acesso LAN desativado.');setPairing(null);}catch(err){setError(err instanceof Error?err.message:String(err));}}
  async function pair(){try{setPairing(await api.lan.pairingCode(token));}catch(err){setError(err instanceof Error?err.message:String(err));}}
  return <section className="page-stack"><div className="page-header"><div><p className="eyebrow">Sistema</p><h2>Backup e acesso local</h2><p className="muted">Recuperação do banco e acesso opcional por celular/tablet na mesma rede.</p></div><span className="status status-ok"><ShieldCheck size={16}/>Local-first</span></div>
    {error&&<div className="error-box">{error}</div>}{message&&<div className="success-box">{message}</div>}
    <div className="two-columns"><section className="panel"><div className="section-heading"><h3><DatabaseBackup size={18}/> Backups</h3><div className="row-actions"><button onClick={()=>void createBackup()}>Criar agora</button><button onClick={()=>void restore()}><RefreshCcw size={15}/>Restaurar</button></div></div><p className="muted">Backup automático diário, cópia pré-migração e cópia de segurança antes de qualquer restauração.</p><div className="backup-list">{backups.slice(0,12).map((item)=><div className="backup-row" key={item.id}><div><strong>{item.kind}</strong><small>{item.created_at||item.createdAt||''}</small><small className="path-text">{item.path}</small></div><div><span className="badge">{item.status||'VERIFIED'}</span><small>{size(item.bytes)}</small></div></div>)}{backups.length===0&&<div className="empty-state">Nenhum backup registrado.</div>}</div></section>
      <form className="panel form-grid" onSubmit={configureLan}><h3><Network size={18}/> Rede local</h3><label className="toggle-row wide"><input type="checkbox" checked={form.enabled} onChange={(e)=>setForm({...form,enabled:e.target.checked})}/>Permitir acesso pela rede local</label><label>Escuta<select value={form.host} onChange={(e)=>setForm({...form,host:e.target.value})}><option value="127.0.0.1">Somente este PC</option><option value="0.0.0.0">Celular/tablet na LAN</option></select></label><label>Porta<input type="number" min="0" max="65535" value={form.port} onChange={(e)=>setForm({...form,port:e.target.value})}/></label><button className="primary-button">Aplicar</button>{lan?.running&&<div className="wide lan-info"><strong>Servidor ativo</strong>{lan.urls.map((url)=><code key={url}>{url}</code>)}<button type="button" className="secondary-button" onClick={()=>void pair()}>Gerar código de pareamento</button>{pairing&&<div className="pairing-code"><span>Código</span><strong>{pairing.code}</strong><small>Expira em {new Date(pairing.expiresAt).toLocaleTimeString('pt-BR')}</small></div>}</div>}<div className="wide muted">LAN vem desativada. O código é temporário e de uso único; o celular recebe um token local com expiração.</div></form></div>
  </section>;
}
