import { Profiler, type ReactNode, useEffect, useState } from 'react';
import { ArrowLeftRight, BarChart3, BellRing, Database, FileInput, FileText, Folder, LogOut, Menu, ReceiptText, Repeat2, Settings, Users, WalletCards } from 'lucide-react';
import AuthScreen from './components/AuthScreen';
import LicenseScreen from './components/LicenseScreen';
import UpdateNotice from './components/UpdateNotice';
import FirstUseGuide from './components/FirstUseGuide';
import AlertsPage from './pages/AlertsPage';
import CashflowPage from './pages/CashflowPage';
import DashboardPage from './pages/DashboardPage';
import DrePage from './pages/DrePage';
import FinancePage from './pages/FinancePage';
import PlanningPage from './pages/PlanningPage';
import RecurringPage from './pages/RecurringPage';
import RegistryPage from './pages/RegistryPage';
import ReportsPage from './pages/ReportsPage';
import StatementsPage from './pages/StatementsPage';
import SystemPage from './pages/SystemPage';
import UsersPage from './pages/UsersPage';
import WorkspacePage from './pages/WorkspacePage';
import { can } from './lib/format';

type Page = 'dashboard' | 'finance' | 'statements' | 'cashflow' | 'dre' | 'planning' | 'recurring' | 'alerts' | 'reports' | 'workspace' | 'registry' | 'users' | 'system';

function Preview() {
  return <main className="app-shell"><section className="hero-card"><div className="brand-mark"><Database size={28}/></div><div><p className="eyebrow">ArtiSys</p><h1>Sistema Financeiro</h1><p className="subtitle">Prévia web local. O aplicativo desktop concentra banco, regras financeiras e segurança.</p></div><span className="status status-ok">Base E01–E24</span></section></main>;
}

type QaRenderTotals = Record<string,{commits:number;totalMs:number;maxMs:number}>;
function measureQaRender(id:string, _phase:string, actualDuration:number) {
  // Development-only diagnostic. Production Electron builds do not mount a Profiler.
  const host=window as Window & { __ARTISYS_RENDER_STATS?:QaRenderTotals };
  const metrics=host.__ARTISYS_RENDER_STATS;
  if(!metrics)return;
  const previous=metrics[id]||{commits:0,totalMs:0,maxMs:0};
  metrics[id]={commits:previous.commits+1,totalMs:previous.totalMs+actualDuration,maxMs:Math.max(previous.maxMs,actualDuration)};
}
function qaProfile(id:string, component:ReactNode) {
  return import.meta.env.DEV
    ? <Profiler id={id} onRender={measureQaRender}>{component}</Profiler>
    : component;
}

export default function App() {
  const api = window.financeiro;
  const [token, setToken] = useState('');
  const [session, setSession] = useState<FinanceiroSession | null>(null);
  const [restoring, setRestoring] = useState(Boolean(api));
  const [licenseStatus,setLicenseStatus] = useState<FinanceiroLicenseStatus | null>(null);
  useEffect(() => {
    if (!api) return;
    api.license.status().then(setLicenseStatus).catch((err) => setLicenseStatus({active:false,mode:'licensed',reason:'unavailable',message:String(err?.message||err)}));
  }, [api]);
  const [page, setPage] = useState<Page>('dashboard');
  const [financeIntent,setFinanceIntent]=useState<FinanceiroKind|null>(null);
  const [browseFinanceKind,setBrowseFinanceKind]=useState<FinanceiroKind|null>(null);
  const [approvalEntryIntent,setApprovalEntryIntent]=useState<string|null>(null);
  const [focusedFinanceEntry,setFocusedFinanceEntry]=useState<FinanceEntry|null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [showFirstUse,setShowFirstUse] = useState(false);
  const [firstUseContext,setFirstUseContext] = useState({existingAccountId:'',hasOpening:false});
  const [firstUseError,setFirstUseError] = useState('');
  const [dashboardVersion,setDashboardVersion] = useState(0);

  useEffect(() => {
    if (!api) return;
    const saved = sessionStorage.getItem('financeiro-token');
    if (!saved) { setRestoring(false); return; }
    api.auth.session(saved).then((current) => { setToken(saved); setSession(current); }).catch(() => sessionStorage.removeItem('financeiro-token')).finally(() => setRestoring(false));
  }, [api]);

  if (!api) return <Preview/>;
  if (!licenseStatus) return <><UpdateNotice/><main className="auth-shell"><div className="auth-card"><h1>Sistema Financeiro</h1><p className="muted">Verificando ativação…</p></div></main></>;
  if (!licenseStatus.active) return <><UpdateNotice/><LicenseScreen status={licenseStatus} onActivated={setLicenseStatus}/></>;
  if (restoring) return <><UpdateNotice/><main className="auth-shell"><div className="auth-card"><h1>Sistema Financeiro</h1><p className="muted">Restaurando sessão local…</p></div></main></>;
  if (!session || !token) return <><UpdateNotice/><AuthScreen onAuthenticated={(nextToken, nextSession) => { setToken(nextToken); setSession(nextSession); }}/></>;

  async function openFirstUse(){
    if(!api||!session||!token||!can(session,'finance.manage'))return;
    setFirstUseError('');
    try{
      const [accounts,entries]=await Promise.all([api.finance.listAccounts(token),api.finance.listEntries(token)]);
      if(entries.length){setPage('finance');return;}
      const accountId=accounts[0]?.id||'';
      const hasOpening=Boolean(accountId && (await api.cashflow.listMovements(token,{accountId}))
        .some(x=>x.type==='OPENING'));
      setFirstUseContext({existingAccountId:accountId,hasOpening});
      setShowFirstUse(true);
    }catch(error){setFirstUseError(error instanceof Error?error.message:String(error));}
  }
  function closeFirstUse(){setShowFirstUse(false);setDashboardVersion(v=>v+1);}
  const showUsers = can(session, 'users.view');
  const showSystem = can(session, 'system.manage');
  async function logout() { await window.financeiro!.auth.logout(token); sessionStorage.removeItem('financeiro-token'); setToken(''); setSession(null); }
  const nav = (target: Page, label: string, icon: ReactNode) => <button type="button" data-testid={`nav-${target}`} aria-current={page===target?'page':undefined} className={page===target?'active':''} onClick={()=>{ setFinanceIntent(null); setFocusedFinanceEntry(null); setPage(target); setMobileNavOpen(false); }}>{icon}<span>{label}</span></button>;
  const group = (label: string, children: ReactNode) => <div className="nav-group"><div className="nav-group-label">{label}</div>{children}</div>;

  return <><UpdateNotice/><div className="workspace" data-testid="app-shell">
    <header className="mobile-shellbar">
      <div className="mobile-shell-brand"><div className="brand-mark mini"><WalletCards size={18}/></div><div><strong>ArtiSys</strong><small>Financeiro</small></div></div>
      <button type="button" className="mobile-nav-toggle" data-testid="mobile-nav-toggle" aria-label="Abrir navegação" aria-expanded={mobileNavOpen} onClick={()=>setMobileNavOpen((open)=>!open)}><Menu size={19}/></button>
    </header>
    <button type="button" aria-label="Fechar navegação" className={`mobile-nav-backdrop ${mobileNavOpen?'visible':''}`} onClick={()=>setMobileNavOpen(false)}/>
    <aside className={`sidebar ${mobileNavOpen?'mobile-open':''}`} data-testid="app-sidebar">
      <div className="sidebar-brand"><div className="brand-mark mini"><WalletCards size={20}/></div><div><strong>ArtiSys</strong><small>Financeiro</small></div></div>
      <nav aria-label="Navegação principal">
        {group('Visão geral', <>{nav('dashboard','Dashboard',<Database size={18}/>)}{nav('alerts','Alertas',<BellRing size={18}/>)}</>)}
        {group('Lançamentos', <>{nav('finance','Pagar / Receber',<ReceiptText size={18}/>)}{nav('recurring','Recorrências',<Repeat2 size={18}/>)}</>)}
        {group('Contas e caixa', <>{nav('cashflow','Contas e saldos',<ArrowLeftRight size={18}/>)}{nav('statements','Extratos',<FileInput size={18}/>)}</>)}
        {group('Análises', <>{nav('dre','DRE',<BarChart3 size={18}/>)}{nav('reports','Relatórios',<FileText size={18}/>)}</>)}
        {group('Configuração e avançado', <>{nav('registry','Cadastros',<Users size={18}/>)}{nav('planning','Planejamento',<BarChart3 size={18}/>)}{nav('workspace','Workspace',<Folder size={18}/>)}</>)}
        {(showUsers || showSystem) && group('Administração', <>{showUsers && nav('users','Acessos',<Users size={18}/>)}{showSystem && nav('system','Sistema',<Settings size={18}/>)}</>)}
      </nav>
      <div className="sidebar-footer"><div><strong>{session.user.name}</strong><small>{session.user.role}</small></div><button type="button" title="Sair" aria-label="Sair" data-testid="logout" onClick={()=>void logout()}><LogOut size={17}/></button></div>
    </aside>
    <main className="content">
      {firstUseError&&<div role="alert" className="error-box">Não foi possível abrir o guia: {firstUseError} <button type="button" onClick={()=>void openFirstUse()}>Tentar novamente</button></div>}
      {page==='dashboard' && qaProfile('dashboard', <DashboardPage key={dashboardVersion} token={token} canManage={can(session,'finance.manage')} onOpenGuide={()=>void openFirstUse()} onViewFinance={(kind)=>{setFinanceIntent(null);setBrowseFinanceKind(kind);setPage('finance');}} onOpenFinance={(kind)=>{setFinanceIntent(kind);setPage('finance');}} onOpenCashflow={()=>setPage('cashflow')}/>)} {page==='alerts' && <AlertsPage token={token} session={session}/>} {page==='cashflow' && <CashflowPage token={token} session={session}/>} {page==='finance' && qaProfile('finance', <FinancePage token={token} session={session} intent={financeIntent} browseKind={browseFinanceKind} onBrowseHandled={()=>setBrowseFinanceKind(null)} onIntentHandled={()=>setFinanceIntent(null)} onOpenPlanning={(entryId)=>{setApprovalEntryIntent(entryId);setPage('planning');}} focusEntry={focusedFinanceEntry}/>)} {page==='statements' && <StatementsPage token={token} session={session} onOpenFinance={()=>setPage('finance')}/>} {page==='dre' && <DrePage token={token}/>} {page==='planning' && qaProfile('planning', <PlanningPage token={token} session={session} focusApprovalEntryId={approvalEntryIntent} onApprovalFocusHandled={()=>setApprovalEntryIntent(null)}/>)} {page==='reports' && <ReportsPage token={token}/>} {page==='recurring' && <RecurringPage token={token} session={session} onOpenEntry={entry=>{setFocusedFinanceEntry(entry);setBrowseFinanceKind(entry.kind);setPage('finance');}}/>} {page==='workspace' && <WorkspacePage token={token} session={session}/>} {page==='registry' && <RegistryPage token={token} session={session}/>} {page==='users' && showUsers && <UsersPage token={token} session={session}/>} {page==='system' && showSystem && <SystemPage token={token}/>} 
    </main>
    {showFirstUse&&<FirstUseGuide token={token} userId={session.user.id} existingAccountId={firstUseContext.existingAccountId} hasOpening={firstUseContext.hasOpening} onDone={closeFirstUse} onSkip={closeFirstUse}/>}
  </div></>;
}