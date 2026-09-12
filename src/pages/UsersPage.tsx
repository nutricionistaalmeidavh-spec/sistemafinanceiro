import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { can } from '../lib/format';

type Props = { token: string; session: FinanceiroSession };

export default function UsersPage({ token, session }: Props) {
  const api = window.financeiro!;
  const [users, setUsers] = useState<FinanceiroUser[]>([]);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<{name:string;login:string;password:string;role:FinanceiroRole}>({ name:'', login:'', password:'', role:'FINANCE' });
  const [error, setError] = useState('');
  const editable = can(session, 'users.manage');
  const reload = useCallback(async () => { try { setUsers(await api.auth.listUsers(token)); setError(''); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } }, [api, token]);
  useEffect(() => { void reload(); }, [reload]);
  async function create(event: FormEvent) { event.preventDefault(); try { await api.auth.createUser(token, form); setForm({ name:'', login:'', password:'', role:'FINANCE' }); await reload(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } }
  async function toggle(user: FinanceiroUser) { try { await api.auth.setUserActive(token, user.id, !user.active); await reload(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } }
  const filteredUsers = useMemo(()=>{const term=search.trim().toLocaleLowerCase('pt-BR');return users.filter((user)=>!term||[user.name,user.login,user.role].some((value)=>String(value).toLocaleLowerCase('pt-BR').includes(term)));},[users,search]);
  return <section className="page-stack" data-testid="page-users"><div className="page-header"><div><p className="eyebrow">Acessos</p><h2>Usuários e permissões</h2><p className="muted">Perfis locais com autorização aplicada no processo principal.</p></div></div>{error && <div className="error-box">{error}</div>}
    <div className="page-toolbar"><p className="section-caption">{users.filter((user)=>user.active).length} usuários ativos</p><label className="search-control"><Search size={16}/><input data-testid="users-search" aria-label="Buscar usuários" value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Buscar nome, login ou perfil"/></label></div>
    {editable && <form className="panel inline-form" onSubmit={create}><label>Nome<input value={form.name} onChange={(e)=>setForm({...form,name:e.target.value})} required/></label><label>Login<input value={form.login} onChange={(e)=>setForm({...form,login:e.target.value})} required/></label><label>Senha<input type="password" minLength={10} value={form.password} onChange={(e)=>setForm({...form,password:e.target.value})} required/></label><label>Perfil<select value={form.role} onChange={(e)=>setForm({...form,role:e.target.value as FinanceiroRole})}><option value="FINANCE">Financeiro</option><option value="MANAGER">Gestor</option><option value="READONLY">Leitura</option><option value="ADMIN">Administrador</option></select></label><button className="primary-button">Criar usuário</button></form>}
    <div className="panel table-panel table-scroll"><table><thead><tr><th>Nome</th><th>Login</th><th>Perfil</th><th>Status</th><th></th></tr></thead><tbody>{filteredUsers.map((user)=><tr key={user.id}><td>{user.name}</td><td>{user.login}</td><td>{user.role}</td><td><span className={`badge ${user.active?'badge-settled':'badge-cancelled'}`}>{user.active?'Ativo':'Inativo'}</span></td><td>{editable && user.id!==session.user.id && <button type="button" className="secondary-button small" onClick={()=>void toggle(user)}>{user.active?'Desativar':'Ativar'}</button>}</td></tr>)}</tbody></table>{filteredUsers.length===0&&<div className="empty-state">Nenhum usuário encontrado.</div>}</div>
  </section>;
}
