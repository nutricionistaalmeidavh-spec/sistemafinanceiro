import { type ReactNode, useEffect, useState } from 'react';
import { ArrowLeftRight, BarChart3, BellRing, Database, FileText, LogOut, Menu, ReceiptText, Repeat2, Settings, Users, WalletCards } from 'lucide-react';
import AuthScreen from './components/AuthScreen';
import AlertsPage from './pages/AlertsPage';
import CashflowPage from './pages/CashflowPage';
import DashboardPage from './pages/DashboardPage';
import DrePage from './pages/DrePage';
import FinancePage from './pages/FinancePage';
import RecurringPage from './pages/RecurringPage';
import RegistryPage from './pages/RegistryPage';
import ReportsPage from './pages/ReportsPage';
import SystemPage from './pages/SystemPage';
import UsersPage from './pages/UsersPage';
import { can } from './lib/format';

type Page = 'dashboard' | 'finance' | 'cashflow' | 'dre' | 'recurring' | 'alerts' | 'reports' | 'registry' | 'users' | 'system';

function Preview() {
  return <main className="app-shell"><section className="hero-card"><div className="brand-mark"><Database size={28}/></div><div><p className="eyebrow">ArtiSys</p><h1>Sistema Financeiro</h1><p className="subtitle">Prévia web local. O aplicativo desktop concentra banco, regras financeiras e segurança.</p></div><span className="status status-ok">Base E01–E16</span></section></main>;
}

export default function App() {
  const api = window.financeiro;
  const [token, setToken] = useState('');
  const [session, setSession] = useState<FinanceiroSession | null>(null);
  const [restoring, setRestoring] = useState(Boolean(api));
  const [page, setPage] = useState<Page>('dashboard');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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
  const showSystem = can(session, 'system.manage');
  async function logout() { await window.financeiro!.auth.logout(token); sessionStorage.removeItem('financeiro-token'); setToken(''); setSession(null); }
  const nav = (target: Page, label: string, icon: ReactNode) => <button type="button" data-testid={`nav-${target}`} aria-current={page===target?'page':undefined} className={page===target?'active':''} onClick={()=>{ setPage(target); setMobileNavOpen(false); }}>{icon}<span>{label}</span></button>;
  const group = (label: string, children: ReactNode) => <div className="nav-group"><div className="nav-group-label">{label}</div>{children}</div>;

  return <div className="workspace" data-testid="app-shell">
    <header className="mobile-shellbar">
      <div className="mobile-shell-brand"><div className="brand-mark mini"><WalletCards size={18}/></div><div><strong>ArtiSys</strong><small>Financeiro</small></div></div>
      <button type="button" className="mobile-nav-toggle" data-testid="mobile-nav-toggle" aria-label="Abrir navegação" aria-expanded={mobileNavOpen} onClick={()=>setMobileNavOpen((open)=>!open)}><Menu size={19}/></button>
    </header>
    <button type="button" aria-label="Fechar navegação" className={`mobile-nav-backdrop ${mobileNavOpen?'visible':''}`} onClick={()=>setMobileNavOpen(false)}/>
    <aside className={`sidebar ${mobileNavOpen?'mobile-open':''}`} data-testid="app-sidebar">
      <div className="sidebar-brand"><div className="brand-mark mini"><WalletCards size={20}/></div><div><strong>ArtiSys</strong><small>Financeiro</small></div></div>
      <nav aria-label="Navegação principal">
        {group('Visão geral', <>{nav('dashboard','Dashboard',<Database size={18}/>)}{nav('alerts','Alertas',<BellRing size={18}/>)}</>)}
        {group('Financeiro', <>{nav('cashflow','Fluxo de Caixa',<ArrowLeftRight size={18}/>)}{nav('finance','Pagar / Receber',<ReceiptText size={18}/>)}{nav('dre','DRE',<BarChart3 size={18}/>)}{nav('reports','Relatórios',<FileText size={18}/>)}{nav('recurring','Recorrências',<Repeat2 size={18}/>)}</>)}
        {group('Dados', <>{nav('registry','Cadastros',<Users size={18}/>)}</>)}
        {(showUsers || showSystem) && group('Administração', <>{showUsers && nav('users','Acessos',<Users size={18}/>)}{showSystem && nav('system','Sistema',<Settings size={18}/>)}</>)}
      </nav>
      <div className="sidebar-footer"><div><strong>{session.user.name}</strong><small>{session.user.role}</small></div><button type="button" title="Sair" aria-label="Sair" data-testid="logout" onClick={()=>void logout()}><LogOut size={17}/></button></div>
    </aside>
    <main className="content">
      {page==='dashboard' && <DashboardPage token={token}/>} {page==='alerts' && <AlertsPage token={token} session={session}/>} {page==='cashflow' && <CashflowPage token={token} session={session}/>} {page==='finance' && <FinancePage token={token} session={session}/>} {page==='dre' && <DrePage token={token}/>} {page==='reports' && <ReportsPage token={token}/>} {page==='recurring' && <RecurringPage token={token} session={session}/>} {page==='registry' && <RegistryPage token={token} session={session}/>} {page==='users' && showUsers && <UsersPage token={token} session={session}/>} {page==='system' && showSystem && <SystemPage token={token}/>} 
    </main>
  </div>;
}
