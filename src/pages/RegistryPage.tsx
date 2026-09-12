import { FormEvent, useCallback, useEffect, useState } from 'react';
import { can } from '../lib/format';

type Props = { token: string; session: FinanceiroSession };
type Tab = 'customers' | 'creditors' | 'categories';
const emptyParty = { name:'', document:'', phone:'', email:'', notes:'' };

export default function RegistryPage({ token, session }: Props) {
  const api = window.financeiro!;
  const [tab, setTab] = useState<Tab>('customers');
  const [customers, setCustomers] = useState<PartyRecord[]>([]);
  const [creditors, setCreditors] = useState<PartyRecord[]>([]);
  const [categories, setCategories] = useState<FinancialCategory[]>([]);
  const [party, setParty] = useState(emptyParty);
  const [category, setCategory] = useState<{name:string;nature:CategoryNature;dreGroup:string}>({ name:'', nature:'EXPENSE', dreGroup:'OPERATING' });
  const [error, setError] = useState('');
  const editable = can(session, 'registry.manage');

  const reload = useCallback(async () => {
    try { const [c, cr, cats] = await Promise.all([api.registry.listCustomers(token), api.registry.listCreditors(token), api.registry.listCategories(token)]); setCustomers(c); setCreditors(cr); setCategories(cats); setError(''); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }, [api, token]);
  useEffect(() => { void reload(); }, [reload]);

  async function saveParty(event: FormEvent) {
    event.preventDefault();
    try { if (tab === 'customers') await api.registry.saveCustomer(token, party); else await api.registry.saveCreditor(token, party); setParty(emptyParty); await reload(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }
  async function saveCategory(event: FormEvent) {
    event.preventDefault();
    try { await api.registry.saveCategory(token, category); setCategory({ name:'', nature:'EXPENSE', dreGroup:'OPERATING' }); await reload(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }
  const rows = tab === 'customers' ? customers : creditors;

  return <section className="page-stack"><div className="page-header"><div><p className="eyebrow">Cadastros</p><h2>Clientes, credores e categorias</h2><p className="muted">Base compartilhada pelos lançamentos financeiros.</p></div></div>{error && <div className="error-box">{error}</div>}
    <div className="segmented"><button className={tab==='customers'?'active':''} onClick={()=>setTab('customers')}>Clientes</button><button className={tab==='creditors'?'active':''} onClick={()=>setTab('creditors')}>Credores</button><button className={tab==='categories'?'active':''} onClick={()=>setTab('categories')}>Categorias</button></div>
    {editable && tab !== 'categories' && <form className="panel inline-form" onSubmit={saveParty}><label>Nome<input value={party.name} onChange={(e)=>setParty({...party,name:e.target.value})} required/></label><label>CPF/CNPJ<input value={party.document} onChange={(e)=>setParty({...party,document:e.target.value})}/></label><label>Telefone<input value={party.phone} onChange={(e)=>setParty({...party,phone:e.target.value})}/></label><label>E-mail<input type="email" value={party.email} onChange={(e)=>setParty({...party,email:e.target.value})}/></label><button className="primary-button">Adicionar</button></form>}
    {editable && tab === 'categories' && <form className="panel inline-form" onSubmit={saveCategory}><label>Nome<input value={category.name} onChange={(e)=>setCategory({...category,name:e.target.value})} required/></label><label>Natureza<select value={category.nature} onChange={(e)=>setCategory({...category,nature:e.target.value as CategoryNature})}><option value="EXPENSE">Despesa</option><option value="REVENUE">Receita</option></select></label><label>Grupo DRE<input value={category.dreGroup} onChange={(e)=>setCategory({...category,dreGroup:e.target.value})}/></label><button className="primary-button">Adicionar</button></form>}
    <div className="panel table-panel">{tab === 'categories' ? <table><thead><tr><th>Categoria</th><th>Natureza</th><th>Grupo DRE</th><th>Status</th></tr></thead><tbody>{categories.map((row)=><tr key={row.id}><td>{row.name}</td><td>{row.nature==='EXPENSE'?'Despesa':'Receita'}</td><td>{row.dreGroup}</td><td>{row.active?'Ativa':'Inativa'}</td></tr>)}</tbody></table> : <table><thead><tr><th>Nome</th><th>Documento</th><th>Telefone</th><th>E-mail</th><th>Status</th></tr></thead><tbody>{rows.map((row)=><tr key={row.id}><td>{row.name}</td><td>{row.document||'—'}</td><td>{row.phone||'—'}</td><td>{row.email||'—'}</td><td>{row.active?'Ativo':'Inativo'}</td></tr>)}</tbody></table>}</div>
  </section>;
}
