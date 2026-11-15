import { memo } from 'react';
import { FileDown, Pencil, Printer, RotateCcw, XCircle } from 'lucide-react';
import { brl } from '../lib/format';
import { FinanceStatusBadge } from './finance-ui';

type Props={
  visibleEntries:FinanceEntry[];
  filteredCount:number;
  visibleLimit:number;
  focusedEntryId:string|null;
  editable:boolean;
  onPayment:(entry:FinanceEntry)=>void;
  onEdit:(entry:FinanceEntry)=>void;
  onDecision:(entry:FinanceEntry,action:'CANCEL'|'REVERSE')=>void;
  onReceiptPdf:(entry:FinanceEntry)=>void;
  onReceiptPrint:(entry:FinanceEntry)=>void;
  onOpenPlanning?:(entryId:string)=>void;
  onMore:()=>void;
};

// Form typing must not re-render unchanged ledger rows. Rows retain their canonical source objects.
const FinanceEntriesTable=memo(function FinanceEntriesTable({
  visibleEntries,filteredCount,visibleLimit,focusedEntryId,editable,
  onPayment,onEdit,onDecision,onReceiptPdf,onReceiptPrint,onOpenPlanning,onMore
}:Props){
  return <div className="panel table-panel table-scroll">
    <table><thead><tr><th>Descrição</th><th>Vencimento</th><th>Status</th><th>Valor</th><th>Em aberto</th><th></th></tr></thead>
      <tbody>{visibleEntries.map(entry=>{
        const hasReceipt=entry.settlements.some(item=>!item.reversedAt);
        return <tr key={entry.id} data-testid={entry.id===focusedEntryId?'finance-focused-row':undefined}>
          <td><strong>{entry.description}</strong>{entry.isOverdue&&<small className="danger-text">Vencido</small>}</td>
          <td>{entry.dueAt}</td>
          <td><FinanceStatusBadge status={entry.isOverdue&&entry.status!=='SETTLED'?'OVERDUE':entry.status}/></td>
          <td>{brl(entry.amountCents)}</td><td>{brl(entry.openCents)}</td>
          <td>{(editable||hasReceipt)&&<div className="row-actions">
            {editable&&entry.status!=='CANCELLED'&&entry.openCents>0&&<button type="button" onClick={()=>entry.approval.status==='NOT_REQUIRED'||entry.approval.status==='APPROVED'?onPayment(entry):onOpenPlanning?.(entry.id)}>{entry.approval.status==='REQUIRED'?'Solicitar aprovação':entry.approval.status==='PENDING'?'Aguardando aprovação':(entry.kind==='PAYABLE'?'Registrar pagamento':'Registrar recebimento')}</button>}
            {editable&&entry.status!=='CANCELLED'&&<button type="button" title="Editar lançamento" aria-label={'Editar '+entry.description} onClick={()=>onEdit(entry)}><Pencil size={15}/></button>}
            {editable&&entry.status!=='CANCELLED'&&entry.settlements.length>0&&<button type="button" title="Estornar última baixa" onClick={()=>onDecision(entry,'REVERSE')}><RotateCcw size={15}/></button>}
            {editable&&entry.status!=='CANCELLED'&&entry.settlements.length===0&&<button type="button" title="Cancelar" onClick={()=>onDecision(entry,'CANCEL')}><XCircle size={15}/></button>}
            {hasReceipt&&<button type="button" title="Salvar recibo em PDF" onClick={()=>onReceiptPdf(entry)}><FileDown size={15}/></button>}
            {hasReceipt&&<button type="button" title="Imprimir recibo" onClick={()=>onReceiptPrint(entry)}><Printer size={15}/></button>}
          </div>}</td>
        </tr>;
      })}</tbody>
    </table>
    {filteredCount===0&&<div className="empty-state">Nenhum lançamento encontrado com os filtros atuais.</div>}
    {filteredCount>visibleLimit&&<div className="table-more"><button type="button" className="secondary-button" onClick={onMore}>Carregar mais ({visibleEntries.length} de {filteredCount})</button></div>}
  </div>;
});
export default FinanceEntriesTable;
