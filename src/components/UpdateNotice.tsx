import {useEffect,useState} from 'react';
import {Download,RefreshCcw,RotateCcw,X} from 'lucide-react';
import './update-notice.css';

export default function UpdateNotice(){
  const api=window.financeiro?.updates;
  const [status,setStatus]=useState<FinanceiroUpdateStatus|null>(null);
  const [dismissed,setDismissed]=useState('');
  const [error,setError]=useState('');
  useEffect(()=>{
    if(!api)return;
    let alive=true;
    const unsubscribe=api.onStatus((next)=>{if(alive)setStatus(next);});
    void api.status().then(next=>{if(alive)setStatus(next);}).catch(()=>{});
    return ()=>{alive=false;unsubscribe();};
  },[api]);
  if(!api||!status||!['available','downloading','downloaded','error'].includes(status.state))return null;
  if(status.state==='available'&&dismissed===status.availableVersion)return null;
  async function run(action:()=>Promise<unknown>){
    setError('');
    try{await action();}
    catch(cause){setError(cause instanceof Error?cause.message:String(cause));}
  }
  const busy=status.state==='downloading';
  return <aside className="update-notice" role="status" aria-live="polite" data-testid="update-notice">
    <div className="update-notice-heading"><strong>{status.state==='downloaded'?'Atualização pronta':status.state==='error'?'Atualizações indisponíveis':'Nova atualização disponível'}</strong>
      {status.state==='available'&&<button type="button" aria-label="Agora não" title="Agora não" onClick={()=>setDismissed(status.availableVersion||'')}><X size={16}/></button>}
    </div>
    {status.availableVersion&&<p>ArtiSys Financeiro {status.currentVersion} → {status.availableVersion}</p>}
    {status.state==='available'&&status.releaseNotes&&<small>{status.releaseNotes.slice(0,220)}</small>}
    {busy&&<p>Baixando e verificando… {status.percent??0}%</p>}
    {(error||status.message)&&<p className="update-notice-error">{error||status.message}</p>}
    <div className="update-notice-actions">
      {status.state==='available'&&<button className="primary-button" type="button" onClick={()=>void run(()=>api.download())}><Download size={15}/> Baixar atualização</button>}
      {status.state==='downloaded'&&<button className="primary-button" type="button" onClick={()=>void run(()=>api.install())}><RotateCcw size={15}/> Instalar e reiniciar</button>}
      {status.state==='error'&&<button type="button" onClick={()=>void run(()=>api.check())}><RefreshCcw size={15}/> Tentar novamente</button>}
    </div>
  </aside>;
}
