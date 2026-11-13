import {useState,type FormEvent} from 'react';
import {KeyRound} from 'lucide-react';

function formatCode(input:string){
  const raw=input.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g,'').slice(0,16);
  return raw.match(/.{1,4}/g)?.join('-')||'';
}
type Props={status:FinanceiroLicenseStatus;onActivated:(status:FinanceiroLicenseStatus)=>void};
export default function LicenseScreen({status,onActivated}:Props){
  const [code,setCode]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  async function activate(event:FormEvent){
    event.preventDefault();
    setBusy(true);setError('');
    try{
      const result=await window.financeiro!.license.activate(code.trim());
      if(!result.active)throw new Error(result.message||'Não foi possível ativar a licença.');
      onActivated(result);
    }catch(cause){setError(cause instanceof Error?cause.message:String(cause));}
    finally{setBusy(false);}
  }
  const length=code.replace(/-/g,'').length;
  return <main className="auth-shell"><form className="auth-card" onSubmit={activate}>
    <div className="brand-mark"><KeyRound size={26}/></div>
    <p className="eyebrow">ArtiSys</p>
    <h1>Ativar ArtiSys Financeiro</h1>
    <p className="muted">Insira o código fornecido pela ArtiSys. O tipo e a validade da licença são definidos pelo código.</p>
    {status.message&&<div className="error-box" role="alert">{status.message}</div>}
    <label htmlFor="finance-license-code">Código de ativação</label>
    <input id="finance-license-code" type="text" inputMode="text" className="license-input" autoComplete="off" spellCheck={false}
      value={code} onChange={event=>setCode(formatCode(event.target.value))} maxLength={19} required placeholder="XXXX-XXXX-XXXX-XXXX"/>
    {error&&<div className="error-box" role="alert">{error}</div>}
    <button className="primary-button" disabled={busy||![12,16].includes(length)}>{busy?'Validando…':'Ativar licença'}</button>
    <p className="muted">A primeira ativação de novos códigos precisa de internet. Após ativar, o sistema financeiro funciona offline.</p>
  </form></main>;
}
