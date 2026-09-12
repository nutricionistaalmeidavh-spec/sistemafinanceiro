import { FormEvent, useEffect, useState } from 'react';
import { LockKeyhole } from 'lucide-react';

type Props = { onAuthenticated: (token: string, session: FinanceiroSession) => void };

export default function AuthScreen({ onAuthenticated }: Props) {
  const [bootstrap, setBootstrap] = useState<boolean | null>(null);
  const [name, setName] = useState('Administrador');
  const [login, setLogin] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.financeiro!.auth.needsBootstrap().then(setBootstrap).catch((err) => setError(String(err?.message || err)));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      if (bootstrap) await window.financeiro!.auth.bootstrap({ name, password });
      const result = await window.financeiro!.auth.login(bootstrap ? 'admin' : login, password);
      sessionStorage.setItem('financeiro-token', result.token);
      onAuthenticated(result.token, { user: result.user, permissions: result.permissions });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setBusy(false); }
  }

  return <main className="auth-shell">
    <form className="auth-card" onSubmit={submit}>
      <div className="brand-mark"><LockKeyhole size={26}/></div>
      <p className="eyebrow">ArtiSys</p>
      <h1>Sistema Financeiro</h1>
      <p className="muted">{bootstrap === null ? 'Preparando acesso…' : bootstrap ? 'Defina o administrador local para iniciar.' : 'Entre com seu usuário local.'}</p>
      {bootstrap && <label>Nome<input value={name} onChange={(e) => setName(e.target.value)} required /></label>}
      {!bootstrap && <label>Usuário<input value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" required /></label>}
      <label>Senha<input type="password" minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={bootstrap ? 'new-password' : 'current-password'} required /></label>
      {error && <div className="error-box">{error}</div>}
      <button className="primary-button" disabled={busy || bootstrap === null}>{busy ? 'Aguarde…' : bootstrap ? 'Criar administrador' : 'Entrar'}</button>
    </form>
  </main>;
}
