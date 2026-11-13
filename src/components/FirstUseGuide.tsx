import {FormEvent,useState} from 'react';
import {CheckCircle2,ChevronRight,WalletCards} from 'lucide-react';
import {brl,toCents,today} from '../lib/format';

type Props={token:string;userId:string;existingAccountId?:string;onDone:()=>void;onSkip:()=>void};
type Step='account'|'opening'|'entry'|'complete';
export const guideKey=(userId:string)=>`artisys-financeiro-guide-v1:${userId}`;
export default function FirstUseGuide({token,userId,existingAccountId,onDone,onSkip}:Props){
  const api=window.financeiro!;
  const [step,setStep]=useState<Step>(existingAccountId?'entry':'account');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [result,setResult]=useState('');
  const [accountId,setAccountId]=useState(existingAccountId||'');
  const [account,setAccount]=useState({name:'',type:'BANK' as FinanceAccount['type']});
  const [balance,setBalance]=useState('');
  const [entry,setEntry]=useState({description:'',amount:'',dueAt:today(),kind:'PAYABLE' as FinanceiroKind});

  function finish(){
    localStorage.setItem(guideKey(userId),'done');
    onDone();
  }
  async function saveAccount(event:FormEvent){
    event.preventDefault(); if(busy)return;setBusy(true);setError('');
    try{
      const created=await api.finance.createAccount(token,account);
      setAccountId(created.id);
      setResult(`Conta ${created.name} cadastrada.`);
      setStep('opening');
    }catch(cause){setError(cause instanceof Error?cause.message:String(cause));}
    finally{setBusy(false);}
  }
  async function saveOpening(event:FormEvent){
    event.preventDefault();if(busy)return;setBusy(true);setError('');
    try{
      const cents=balance.trim()?toCents(balance):0;
      if(cents<0)throw new Error('Informe um saldo maior ou igual a zero.');
      if(cents>0)await api.cashflow.createMovement(token,{accountId,type:'OPENING',amountCents:cents,occurredAt:today()});
      setResult(cents>0?`Saldo inicial ${brl(cents)} registrado.`:'Saldo inicial não informado.');
      setStep('entry');
    }catch(cause){setError(cause instanceof Error?cause.message:String(cause));}
    finally{setBusy(false);}
  }
  async function saveEntry(event:FormEvent){
    event.preventDefault();if(busy)return;setBusy(true);setError('');
    try{
      await api.finance.createEntry(token,{...entry,amountCents:toCents(entry.amount)});
      setResult(`Lançamento "${entry.description}" salvo.`);
      setStep('complete');
    }catch(cause){setError(cause instanceof Error?cause.message:String(cause));}
    finally{setBusy(false);}
  }
  const index=step==='account'?1:step==='opening'?2:step==='entry'?3:4;
  return <div className="first-use-layer" role="presentation">
    <section className="first-use-panel" role="dialog" aria-modal="true" aria-labelledby="first-use-title" data-testid="first-use-guide">
      <header className="first-use-header"><div><p className="eyebrow">Primeiro acesso</p><h2 id="first-use-title">Preparar o financeiro</h2>
        <p className="muted">Três passos para começar. Você pode sair e configurar depois.</p></div>
        <button className="secondary-button" type="button" onClick={onSkip} disabled={busy}>Configurar depois</button>
      </header>
      <ol className="first-use-steps" aria-label="Progresso da configuração">
        {['Conta financeira','Saldo inicial','Primeiro lançamento'].map((label,i)=><li key={label} aria-current={index===i+1?'step':undefined} className={index>i+1?'done':index===i+1?'current':''}>
          <span>{index>i+1?<CheckCircle2 size={16}/>:i+1}</span>{label}
        </li>)}
      </ol>
      {result&&<p className="success-box" role="status">{result}</p>}
      {error&&<p className="error-box" role="alert">{error} Confira os dados e tente novamente.</p>}
      {step==='account'&&<form onSubmit={saveAccount} className="form-grid first-use-form">
        <h3><WalletCards size={18}/> Onde o dinheiro fica?</h3>
        <p className="wide muted">Cadastre seu banco, caixa ou outra conta. Você pode criar outras contas depois.</p>
        <label className="wide">Nome da conta<input required value={account.name} onChange={e=>setAccount({...account,name:e.target.value})} placeholder="Ex.: Banco principal" autoFocus/></label>
        <label className="wide">Tipo<select value={account.type} onChange={e=>setAccount({...account,type:e.target.value as FinanceAccount['type']})}>
          <option value="BANK">Banco</option><option value="CASH">Dinheiro em caixa</option><option value="CARD">Cartão</option><option value="OTHER">Outra conta</option>
        </select></label>
        <button className="primary-button wide" disabled={busy} type="submit">{busy?'Salvando conta…':'Salvar e continuar'}<ChevronRight size={16}/></button>
      </form>}
      {step==='opening'&&<form onSubmit={saveOpening} className="form-grid first-use-form">
        <h3>Qual o saldo inicial desta conta?</h3><p className="wide muted">Informe o dinheiro que já existia antes de começar a registrar operações. Não é um recebimento novo.</p>
        <label className="wide">Saldo inicial (R$)<input value={balance} inputMode="decimal" onChange={e=>setBalance(e.target.value)} placeholder="0,00"/></label>
        <button className="primary-button wide" type="submit" disabled={busy}>{busy?'Registrando…':'Continuar'}<ChevronRight size={16}/></button>
        <button className="secondary-button wide" type="button" disabled={busy} onClick={()=>{setStep('entry');setError('');}}>Pular saldo inicial</button>
      </form>}
      {step==='entry'&&<form onSubmit={saveEntry} className="form-grid first-use-form">
        <h3>Registre sua primeira conta</h3>
        <label>Tipo<select value={entry.kind} onChange={e=>setEntry({...entry,kind:e.target.value as FinanceiroKind})}>
          <option value="PAYABLE">Despesa a pagar</option><option value="RECEIVABLE">Receita a receber</option></select></label>
        <label>Vencimento<input type="date" required value={entry.dueAt} onChange={e=>setEntry({...entry,dueAt:e.target.value})}/></label>
        <label className="wide">Descrição<input required value={entry.description} onChange={e=>setEntry({...entry,description:e.target.value})} placeholder="Ex.: Aluguel"/></label>
        <label className="wide">Valor (R$)<input required inputMode="decimal" value={entry.amount} onChange={e=>setEntry({...entry,amount:e.target.value})} placeholder="0,00"/></label>
        <p className="muted wide">Este lançamento ficará em aberto até você registrar o pagamento ou recebimento.</p>
        <button type="submit" className="primary-button wide" disabled={busy}>{busy?'Salvando…':'Concluir primeiro lançamento'}</button>
      </form>}
      {step==='complete'&&<div className="first-use-complete">
        <CheckCircle2 size={36}/><h3>Pronto para usar</h3><p>Sua conta financeira e o primeiro lançamento foram cadastrados. A visão geral passa a mostrar os dados reais.</p>
        <button type="button" className="primary-button" onClick={finish}>Ver meu financeiro</button>
      </div>}
    </section>
  </div>;
}
