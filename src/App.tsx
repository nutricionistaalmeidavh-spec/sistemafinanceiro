import { useEffect, useState } from 'react';
import { Database, LogOut, ReceiptText, Users, WalletCards } from 'lucide-react';
import AuthScreen from './components/AuthScreen';
import FinancePage from './pages/FinancePage';
import RegistryPage from './pages/RegistryPage';
import UsersPage from './pages/UsersPage';
import { can } from './lib/format';

type Page = 'finance' | 'registry' | 'users';

function Preview() {
  return <main className="app-shell"><section className="hero-card"><div className="brand-mark"><Database size={28}/></div><div><p className="eyebrow">ArtiSys</p><h1>Sistema Financeiro</h1><p className="subtitle">Prévia web local. Autenticação, SQLite e financeiro operam no aplicativo desktop.</p></div><span className="status status-ok">Base E01–E05</span></section></main>;
}

export default function App() {
  const api = window.financeiro;
  const [token, setToken] = useState('');
  const [session, setSession] = useState<FinanceiroSession | null>(null);
  const [restoring, setRestoring] = useState(Boolean(api));
  const [page, setPage] = useState<Page>('finance');

  useEffect(() => {
    if (!api) return;
    const saved = sessionStorage.getItem('financeiro-token');
    if (!saved) { setRestoring(false); return; }
    api.auth.session(saved).then((current) => { setToken(saved); setSession(current); }).catch(() => sessionStorage.removeItem('financeiro-token')).finally(() => setRestoring(false));
  }, [api]);

  if (!api) return <Preview/>;
  if (restoring) return <main className="auth-shell"><div className="auth-card"><h1>Sistema Financeiro</h1><p className="muted">Restaurando sessão local…</p></div></main>;
  if (!session || !token) return <AuthScreen onAuthenticated={(nextToken, nextSession) => { setToken(nextToken); setSession(nextSession); }}/>

  const showUsers = can(session, 'users.view');
  async function logout() { await window.financeiro!.auth.logout(token); sessionStorage.removeItem('financeiro-token'); setToken(''); setSession(null); }

  return <div className="workspace"><aside className="sidebar"><div className="sidebar-brand"><div className="brand-mark mini"><WalletCards size={20}/></div><div><strong>ArtiSys</strong><small>Financeiro</small></div></div><nav><button className={page==='finance'?'active':''} onClick={()=>setPage('finance')}><ReceiptText size={18}/>Financeiro</button><button className={page==='registry'?'active':''} onClick={()=>setPage('registry')}><Users size={18}/>Cadastros</button>{showUsers && <button className={page==='users'?'active':''} onClick={()=>setPage('users')}><Users size={18}/>Acessos</button>}</nav><div className="sidebar-footer"><div><strong>{session.user.name}</strong><small>{session.user.role}</small></div><button title="Sair" onClick={()=>void logout()}><LogOut size={17}/></button></div></aside><main className="content">{page==='finance' && <FinancePage token={token} session={session}/>} {page==='registry' && <RegistryPage token={token} session={session}/>} {page==='users' && showUsers && <UsersPage token={token} session={session}/>}</main></div>;
}
