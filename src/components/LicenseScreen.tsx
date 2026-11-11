import { useState, type FormEvent } from 'react';
import { KeyRound } from 'lucide-react';

function formatCode(input:string) {
  const raw=input.toUpperCase().replace(/[^A-Z2-9]/g,'').slice(0,12);
  return raw.match(/.{1,4}/g)?.join('-') || '';
}

type Props = { status: FinanceiroLicenseStatus; onActivated: (status:FinanceiroLicenseStatus)=>void };

export default function LicenseScreen({status,onActivated}:Props) {
  const [code,setCode]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  async function activate(event:FormEvent) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const result=await window.financeiro!.license.activate(code.trim());
      if (!result.active) throw new Error(result.message || 'Não foi possível ativar a licença.');
      onActivated(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  }
  return <main className="auth-shell"><form className="auth-card" onSubmit={activate}>
    <div className="brand-mark"><KeyRound size={26}/></div>
    <p className="eyebrow">ArtiSys</p>
    <h1>Ativar avaliação</h1>
    <p className="muted">Sistema Financeiro · Licença de teste por até 14 dias, validada no próprio computador.</p>
    {status.message && <div className="error-box" role="alert">{status.message}</div>}
    <label htmlFor="trial-license-code">Código de licença</label>
    <input id="trial-license-code" type="text" inputMode="text" className="license-input" autoComplete="off" spellCheck={false} value={code} onChange={event=>setCode(formatCode(event.target.value))} maxLength={14} required placeholder="XXXX-XXXX-XXXX"/>
    {error && <div className="error-box" role="alert">{error}</div>}
    <button className="primary-button" disabled={busy || code.replace(/-/g,'').length!==12}>{busy ? 'Validando…':'Ativar licença'}</button>
    <p className="muted">Digite os 12 caracteres enviados pela ArtiSys. Não é necessário estar conectado à internet.</p>
  </form></main>;
}