import { FormEvent, useCallback, useEffect, useState } from 'react';
import { can } from '../lib/format';

type Props = { token: string; session: FinanceiroSession };

export default function UsersPage({ token, session }: Props) {
  const api = window.financeiro!;
  const [users, setUsers] = useState<FinanceiroUser[]>([]);
  const [form, setForm] = useState<{name:string;login:string;password:string;role:FinanceiroRole}>({ name:'', login:'', password:'', role:'FINANCE' });
  const [error, setError] = useState('');
  const editable = can(session, 'users.manage');
  const reload = useCallback(async () => { try { setUsers(await api.auth.listUsers(token)); setError(''); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } }, [api, token]);
  useEffect(() => { void reload(); }, [reload]);
  async function create(event: FormEvent) { event.preventDefault(); try { await api.auth.createUser(token, form); setForm({ name:'', login:'', password:'', role:'FINANCE' }); await reload(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } }
  async function toggle(user: FinanceiroUser) { try { await api.auth.setUserActive(token, user.id, !user.active); await reload(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } }
  return <section className="page-stack"><div className="page-header"><div><p className="eyebrow">Acessos</p><h2>Usuários e permissões</h2><p className="muted">Perfis locais com autorização aplicada no processo principal.</p></div></div>{error && <div className="error-box">{error}</div>}
    {editable && <form className="panel inline-form" onSubmit={create}><label>Nome<input value={form.name} onChange={(e)=>setForm({...form,name:e.target.value})} required/></label><label>Login<input value={form.login} onChange={(e)=>setForm({...form,login:e.target.value})} required/></label><label>Senha<input type="password" minLength={10} value={form.password} onChange={(e)=>setForm({...form,password:e.target.value})} required/></label><label>Perfil<select value={form.role} onChange={(e)=>setForm({...form,role:e.target.value as FinanceiroRole})}><option value="FINANCE">Financeiro</option><option value="MANAGER">Gestor</option><option value="READONLY">Leitura</option><option value="ADMIN">Administrador</option></select></label><button className="primary-button">Criar usuário</button></form>}
    <div className="panel table-panel"><table><thead><tr><th>Nome</th><th>Login</th><th>Perfil</th><th>Status</th><th></th></tr></thead><tbody>{users.map((user)=><tr key={user.id}><td>{user.name}</td><td>{user.login}</td><td>{user.role}</td><td>{user.active?'Ativo':'Inativo'}</td><td>{editable && user.id!==session.user.id && <button className="secondary-button small" onClick={()=>void toggle(user)}>{user.active?'Desativar':'Ativar'}</button>}</td></tr>)}</tbody></table></div>
  </section>;
}
