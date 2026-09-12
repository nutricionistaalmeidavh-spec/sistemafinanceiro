import { type ReactNode, useEffect, useState } from 'react';
import { ArrowLeftRight, BarChart3, Database, LogOut, ReceiptText, Repeat2, Users, WalletCards } from 'lucide-react';
import AuthScreen from './components/AuthScreen';
import DashboardPage from './pages/DashboardPage';
import CashflowPage from './pages/CashflowPage';
import DrePage from './pages/DrePage';
import FinancePage from './pages/FinancePage';
import RecurringPage from './pages/RecurringPage';
import RegistryPage from './pages/RegistryPage';
import UsersPage from './pages/UsersPage';
import { can } from './lib/format';

type Page = 'dashboard' | 'finance' | 'cashflow' | 'dre' | 'recurring' | 'registry' | 'users';

function Preview() {
  return <main className="app-shell"><section className="hero-card"><div className="brand-mark"><Database size={28}/></div><div><p className="eyebrow">ArtiSys</p><h1>Sistema Financeiro</h1><p className="subtitle">Prévia web local. O aplicativo desktop concentra banco, regras financeiras e segurança.</p></div><span className="status status-ok">Base E01–E09</span></section></main>;
}

export default function App() {
  const api = window.financeiro;
  const [token, setToken] = useState('');
  const [session, setSession] = useState<FinanceiroSession | null>(null);
  const [restoring, setRestoring] = useState(Boolean(api));
  const [page, setPage] = useState<Page>('dashboard');

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
  const nav = (target: Page, label: string, icon: ReactNode) => <button className={page===target?'active':''} onClick={()=>setPage(target)}>{icon}{label}</button>;

  return <div className="workspace"><aside className="sidebar"><div className="sidebar-brand"><div className="brand-mark mini"><WalletCards size={20}/></div><div><strong>ArtiSys</strong><small>Financeiro</small></div></div><nav>
    {nav('dashboard','Dashboard',<Database size={18}/>)}
    {nav('cashflow','Fluxo de Caixa',<ArrowLeftRight size={18}/>)}
    {nav('finance','Pagar / Receber',<ReceiptText size={18}/>)}
    {nav('dre','DRE',<BarChart3 size={18}/>)}
    {nav('recurring','Recorrências',<Repeat2 size={18}/>)}
    {nav('registry','Cadastros',<Users size={18}/>)}
    {showUsers && nav('users','Acessos',<Users size={18}/>)}
  </nav><div className="sidebar-footer"><div><strong>{session.user.name}</strong><small>{session.user.role}</small></div><button title="Sair" onClick={()=>void logout()}><LogOut size={17}/></button></div></aside><main className="content">
    {page==='dashboard' && <DashboardPage token={token}/>} {page==='cashflow' && <CashflowPage token={token} session={session}/>} {page==='finance' && <FinancePage token={token} session={session}/>} {page==='dre' && <DrePage token={token}/>} {page==='recurring' && <RecurringPage token={token} session={session}/>} {page==='registry' && <RegistryPage token={token} session={session}/>} {page==='users' && showUsers && <UsersPage token={token} session={session}/>} 
  </main></div>;
}
