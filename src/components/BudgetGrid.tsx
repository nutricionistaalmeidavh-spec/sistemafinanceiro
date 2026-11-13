import { memo, useEffect, useState } from 'react';
import { brl } from '../lib/format';

type Props = {
  budgets: PlanningBudget[];
  editable: boolean;
  onSave: (budget: PlanningBudget, amountCents: number) => Promise<void>;
  onError: (error: unknown) => void;
};

export function parseBudgetAmount(value: string): number {
  const raw = value.trim().replace(/^R\$\s*/, '');
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(raw)) {
    throw new TypeError('Informe valor em reais no formato 0,00 (sem sinal negativo).');
  }
  const [whole, decimal = ''] = raw.replace(/\./g, '').split(',');
  const amount = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
  if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError('Valor do orçamento inválido.');
  return amount;
}
function initialValue(cents: number) {
  return (cents / 100).toFixed(2).replace('.', ',');
}
function BudgetRow({ budget, editable, onSave, onError }: { budget: PlanningBudget } & Omit<Props, 'budgets'>) {
  const [draft, setDraft] = useState(() => initialValue(budget.amount_cents));
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(initialValue(budget.amount_cents)), [budget.amount_cents]);
  const dirty = (() => { try { return parseBudgetAmount(draft) !== budget.amount_cents; } catch { return true; } })();
  async function persist() {
    if (!editable || busy) return;
    setBusy(true);
    try { await onSave(budget, parseBudgetAmount(draft)); }
    catch (error) { onError(error); }
    finally { setBusy(false); }
  }
  return <tr>
    <td>{String(budget.month).padStart(2, '0')}/{budget.year}</td>
    <td>{budget.scenario_name || budget.scenario_id}</td>
    <td>{budget.nature === 'REVENUE' ? 'Receita' : 'Despesa'}</td>
    <td>
      {editable ? <input
        aria-label={`Valor planejado — ${budget.month}/${budget.year} ${budget.scenario_name || ''}`}
        inputMode="decimal" value={draft} onChange={event => setDraft(event.target.value)}
        style={{ minWidth: 105, width: 118 }} /> : brl(budget.amount_cents)}
    </td>
    <td>{budget.category_name || 'Todas'}</td>
    <td>{budget.cost_center_name || 'Todos'}</td>
    {editable && <td><button type="button" className="secondary-button small" disabled={busy || !dirty} onClick={() => void persist()}>{busy ? 'Salvando…' : 'Salvar'}</button></td>}
  </tr>;
}
function BudgetGrid({ budgets, editable, onSave, onError }: Props) {
  return <div className="panel table-panel table-scroll">
    <div className="panel-title"><div><strong>Planilha de orçamentos</strong><small>A edição altera apenas o orçamento registrado no SQLite, não cria lançamentos nem liquida pagamentos.</small></div></div>
    <table><thead><tr><th>Período</th><th>Cenário</th><th>Natureza</th><th>Planejado</th><th>Categoria</th><th>Centro</th>{editable && <th>Ação</th>}</tr></thead>
      <tbody>{budgets.map(budget => <BudgetRow key={budget.id} budget={budget} editable={editable} onSave={onSave} onError={onError} />)}
      {budgets.length === 0 && <tr><td colSpan={editable ? 7 : 6}>Nenhum orçamento neste ano.</td></tr>}</tbody>
    </table>
  </div>;
}
export default memo(BudgetGrid);
