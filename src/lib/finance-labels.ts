// Texto da interface. Valores canonicos no SQLite/API continuam inalterados.
const kinds:Record<string,string>={PAYABLE:'A pagar',RECEIVABLE:'A receber'};
const statuses:Record<string,string>={OPEN:'Em aberto',PARTIAL:'Parcial',SETTLED:'Quitado',CANCELLED:'Cancelado',PENDING:'Pendente',APPROVED:'Aprovado',REJECTED:'Rejeitado',AUTO_CLASSIFIED:'Classificado automaticamente',REVIEWED:'Revisado'};
const accountTypes:Record<string,string>={BANK:'Banco',CASH:'Dinheiro',CARD:'Cartão',OTHER:'Outra conta'};
const cashTypes:Record<string,string>={OPENING:'Saldo inicial',DEPOSIT:'Entrada',WITHDRAWAL:'Saída',ADJUSTMENT:'Ajuste',TRANSFER:'Transferência',SETTLEMENT:'Pagamento/recebimento'};
const sources:Record<string,string>={MANUAL:'Manual',SETTLEMENT:'Baixa de lançamento'};
export const kindLabel=(value:string)=>kinds[value]||value;
export const statusLabel=(value:string)=>statuses[value]||value;
export const accountLabel=(value:string)=>accountTypes[value]||value;
export const movementLabel=(value:string)=>cashTypes[value]||value;
export const sourceLabel=(value:string)=>sources[value]||value;
