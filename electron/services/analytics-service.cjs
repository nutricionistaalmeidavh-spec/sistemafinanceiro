'use strict';

function monthKey(value) { return String(value).slice(0, 7); }
function yearRange(year) { const y = Number(year); if (!Number.isInteger(y) || y < 2000 || y > 2200) throw new Error('invalid year'); return { from: `${y}-01-01`, to: `${y}-12-31` }; }

function createAnalyticsService({ db, finance, cashflow, now = () => new Date().toISOString() } = {}) {
  if (!db || !finance || !cashflow) throw new TypeError('db, finance and cashflow are required');
  const nowIso = () => String(now());

  function getDre({ from, to, basis = 'realized' } = {}) {
    const start = String(from || `${nowIso().slice(0, 4)}-01-01`);
    const end = String(to || `${nowIso().slice(0, 4)}-12-31`);
    let rows;
    if (basis === 'accrual') {
      rows = db.prepare(`SELECT COALESCE(fc.dre_group,'UNCLASSIFIED') dre_group,fe.kind,SUM(fe.amount_cents) total
        FROM financial_entries fe LEFT JOIN financial_categories fc ON fc.id=fe.category_id
        WHERE fe.status<>'CANCELLED' AND fe.due_at>=? AND fe.due_at<=?
        GROUP BY COALESCE(fc.dre_group,'UNCLASSIFIED'),fe.kind`).all(start, end);
    } else if (basis === 'realized') {
      rows = db.prepare(`SELECT COALESCE(fc.dre_group,'UNCLASSIFIED') dre_group,fe.kind,SUM(fs.amount_cents) total
        FROM financial_settlements fs JOIN financial_entries fe ON fe.id=fs.entry_id
        LEFT JOIN financial_categories fc ON fc.id=fe.category_id
        WHERE fs.reversed_at IS NULL AND fe.status<>'CANCELLED' AND fs.occurred_at>=? AND fs.occurred_at<=?
        GROUP BY COALESCE(fc.dre_group,'UNCLASSIFIED'),fe.kind`).all(start, end);
    } else throw new Error('basis must be realized or accrual');
    const groups = new Map();
    for (const row of rows) {
      const group = groups.get(row.dre_group) || { group: row.dre_group, revenueCents: 0, expenseCents: 0, resultCents: 0 };
      if (row.kind === 'RECEIVABLE') group.revenueCents += Number(row.total || 0); else group.expenseCents += Number(row.total || 0);
      group.resultCents = group.revenueCents - group.expenseCents;
      groups.set(row.dre_group, group);
    }
    const items = [...groups.values()].sort((a, b) => a.group.localeCompare(b.group));
    const totals = items.reduce((acc, item) => ({ revenueCents: acc.revenueCents + item.revenueCents, expenseCents: acc.expenseCents + item.expenseCents, resultCents: acc.resultCents + item.resultCents }), { revenueCents: 0, expenseCents: 0, resultCents: 0 });
    return { basis, from: start, to: end, groups: items, totals };
  }

  function getIndicators({ from = null, to = null, asOf = nowIso().slice(0, 10) } = {}) {
    const summary = finance.getSummary({ from, to, asOf });
    const clauses = ['fs.reversed_at IS NULL', "fe.status<>'CANCELLED'"]; const params = [];
    if (from) { clauses.push('fs.occurred_at>=?'); params.push(String(from)); }
    if (to) { clauses.push('fs.occurred_at<=?'); params.push(String(to)); }
    const realized = db.prepare(`SELECT fe.kind,SUM(fs.amount_cents) total FROM financial_settlements fs JOIN financial_entries fe ON fe.id=fs.entry_id WHERE ${clauses.join(' AND ')} GROUP BY fe.kind`).all(...params);
    let receivedCents = 0; let paidCents = 0;
    for (const row of realized) row.kind === 'RECEIVABLE' ? receivedCents += Number(row.total || 0) : paidCents += Number(row.total || 0);
    const balances = cashflow.getAccountBalances({ asOf });
    const bankBalanceCents = balances.filter((item) => item.type === 'BANK').reduce((sum, item) => sum + item.balanceCents, 0);
    const totalBalanceCents = balances.reduce((sum, item) => sum + item.balanceCents, 0);
    return { ...summary, receivedCents, paidCents, resultCents: receivedCents - paidCents, bankBalanceCents, totalBalanceCents };
  }

  function getDashboardSnapshot({ year = Number(nowIso().slice(0, 4)) } = {}) {
    const range = yearRange(year);
    const indicators = getIndicators({ from: range.from, to: range.to, asOf: range.to });
    const accountBalances = cashflow.getAccountBalances({ asOf: range.to });
    const buckets = Array.from({ length: 12 }, (_, index) => ({ month: `${year}-${String(index + 1).padStart(2, '0')}`, inCents: 0, outCents: 0, netCents: 0 }));
    const byMonth = new Map(buckets.map((item) => [item.month, item]));
    for (const movement of cashflow.listMovements(range)) {
      const bucket = byMonth.get(monthKey(movement.occurredAt)); if (!bucket) continue;
      movement.direction === 'IN' ? bucket.inCents += movement.amountCents : bucket.outCents += movement.amountCents;
      bucket.netCents = bucket.inCents - bucket.outCents;
    }
    const topExpenses = db.prepare(`SELECT fe.description,SUM(fs.amount_cents) amount_cents
      FROM financial_settlements fs JOIN financial_entries fe ON fe.id=fs.entry_id
      WHERE fs.reversed_at IS NULL AND fe.status<>'CANCELLED' AND fe.kind='PAYABLE' AND fs.occurred_at>=? AND fs.occurred_at<=?
      GROUP BY fe.description ORDER BY amount_cents DESC,fe.description LIMIT 5`).all(range.from, range.to).map((row) => ({ description: row.description, amountCents: Number(row.amount_cents || 0) }));
    return { year: Number(year), range, cards: indicators, accountBalances, monthly: buckets, topExpenses, dre: getDre({ ...range, basis: 'realized' }) };
  }

  return { getDre, getIndicators, getDashboardSnapshot };
}

module.exports = { createAnalyticsService };
