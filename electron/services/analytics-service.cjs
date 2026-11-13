'use strict';
const { localDay } = require('./date-utils.cjs');
const {scopedSplitCents}=require('./allocation-service.cjs');

function monthKey(value) { return String(value).slice(0, 7); }
function yearRange(year) { const y = Number(year); if (!Number.isInteger(y) || y < 2000 || y > 2200) throw new Error('invalid year'); return { from: `${y}-01-01`, to: `${y}-12-31` }; }
function proportionalCents(value, total, share) {
  const denominator = Number(total || 0);
  if (denominator <= 0) return 0;
  return Math.round((Number(value || 0) * Number(share || 0)) / denominator);
}

function createAnalyticsService({ db, finance, cashflow, now = () => new Date().toISOString() } = {}) {
  if (!db || !finance || !cashflow) throw new TypeError('db, finance and cashflow are required');
  const nowIso = () => String(now());

  function getDre({ from, to, basis = 'realized', costCenterId = null, tagId = null } = {}) {
    const start = String(from || `${nowIso().slice(0, 4)}-01-01`);
    const end = String(to || `${nowIso().slice(0, 4)}-12-31`);
    const cutoff=end<localDay(nowIso())?end:localDay(nowIso());
    const center = costCenterId ? String(costCenterId) : null;
    const tag = tagId ? String(tagId) : null;
    const tagClause = tag ? ' AND EXISTS (SELECT 1 FROM entry_tags et WHERE et.entry_id=fe.id AND et.tag_id=?)' : '';
    const centerJoin = center ? ' JOIN entry_allocations ea ON ea.entry_id=fe.id AND ea.cost_center_id=?' : '';
    let rows;
    if (basis === 'accrual') {
      const params = [];
      if (center) params.push(center);
      params.push(cutoff,cutoff,start,cutoff);
      if (tag) params.push(tag);
      rows = db.prepare(`SELECT fe.id,COALESCE(fc.dre_group,'UNCLASSIFIED') dre_group,fe.kind,fe.amount_cents entry_amount_cents,${center ? 'ea.amount_cents' : 'fe.amount_cents'} scoped_amount_cents
        FROM financial_entries fe LEFT JOIN financial_categories fc ON fc.id=fe.category_id${centerJoin}
        WHERE (fe.status<>'CANCELLED' OR (fe.cancelled_at IS NOT NULL AND substr(fe.cancelled_at,1,10)>?))
          AND substr(fe.created_at,1,10)<=? AND fe.due_at>=? AND fe.due_at<=?${tagClause}`).all(...params)
        .map((row) => ({ ...row, total: Number(row.scoped_amount_cents || 0) }));
    } else if (basis === 'realized') {
      const params = [];
      if (center) params.push(center);
      params.push(cutoff,cutoff,start,cutoff);
      if (tag) params.push(tag);
      rows = db.prepare(`SELECT fe.id,COALESCE(fc.dre_group,'UNCLASSIFIED') dre_group,fe.kind,fe.amount_cents entry_amount_cents,${center ? 'ea.amount_cents allocation_amount_cents,' : ''}SUM(fs.amount_cents) settled_cents
        FROM financial_settlements fs JOIN financial_entries fe ON fe.id=fs.entry_id
        LEFT JOIN financial_categories fc ON fc.id=fe.category_id${centerJoin}
        WHERE (fs.reversed_at IS NULL OR substr(fs.reversed_at,1,10)>?)
          AND (fe.status<>'CANCELLED' OR (fe.cancelled_at IS NOT NULL AND substr(fe.cancelled_at,1,10)>?))
          AND fs.occurred_at>=? AND fs.occurred_at<=?${tagClause}
        GROUP BY fe.id,COALESCE(fc.dre_group,'UNCLASSIFIED'),fe.kind,fe.amount_cents${center ? ',ea.amount_cents' : ''}`).all(...params)
        .map((row) => ({ ...row, total: center ? 0 : Number(row.settled_cents || 0) }));
    } else throw new Error('basis must be realized or accrual');
    if(center&&rows.length) {
      // One allocation of every individual payment is the canonical answer.
      // Summing fractional SQL shares rounds differently and invents/loses cents.
      const byEntry=new Map(),paymentsByEntry=new Map();
      const ids=[...new Set(rows.map(row=>String(row.id)))];
      for(let offset=0;offset<ids.length;offset+=400){
        const batch=ids.slice(offset,offset+400),params=batch.map(()=>'?').join(',');
        const allocations=db.prepare(`SELECT entry_id,cost_center_id,amount_cents FROM entry_allocations WHERE entry_id IN (${params})`).all(...batch);
        for(const allocation of allocations){
          const list=byEntry.get(allocation.entry_id)||[];list.push(allocation);byEntry.set(allocation.entry_id,list);
        }
        if(basis==='realized'){
          const settlements=db.prepare(`SELECT id,entry_id,amount_cents,occurred_at FROM financial_settlements
            WHERE entry_id IN (${params}) AND occurred_at<=?
              AND (reversed_at IS NULL OR substr(reversed_at,1,10)>?)
            ORDER BY occurred_at,created_at,id`).all(...batch,cutoff,cutoff);
          for(const settlement of settlements){
            const list=paymentsByEntry.get(settlement.entry_id)||[];list.push(settlement);paymentsByEntry.set(settlement.entry_id,list);
          }
        }
      }
      rows=rows.map(row=>{
        const allocations=byEntry.get(row.id)||[];
        let total=0;
        if(basis==='realized'){
          let cumulative=0;
          for(const payment of paymentsByEntry.get(row.id)||[]){
            const previous=scopedSplitCents(cumulative,Number(row.entry_amount_cents),allocations).get(center)||0;
            cumulative+=Number(payment.amount_cents);
            const current=scopedSplitCents(cumulative,Number(row.entry_amount_cents),allocations).get(center)||0;
            if(payment.occurred_at>=start)total+=current-previous;
          }
        }else total=scopedSplitCents(Number(row.entry_amount_cents),Number(row.entry_amount_cents),allocations).get(center)||0;
        return {...row,total};
      });
    }
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

  function getIndicators({ from = null, to = null, summaryTo = to, asOf = localDay(nowIso()) } = {}) {
    // Obligations reflect the requested period; realization and cash respect the effective date.
    const asOfDay=String(asOf).slice(0,10);
    const effectiveTo=[asOfDay,localDay(nowIso()),...(to?[String(to)]:[])].sort()[0];
    const summary = finance.getSummary({ from, to:summaryTo, asOf:effectiveTo });
    const clauses = ['(fs.reversed_at IS NULL OR substr(fs.reversed_at,1,10)>?)',
      "(fe.status<>'CANCELLED' OR (fe.cancelled_at IS NOT NULL AND substr(fe.cancelled_at,1,10)>?))"];
    const params = [effectiveTo,effectiveTo];
    if (from) { clauses.push('fs.occurred_at>=?'); params.push(String(from)); }
    clauses.push('fs.occurred_at<=?'); params.push(effectiveTo);
    const realized = db.prepare(`SELECT fe.kind,SUM(fs.amount_cents) total FROM financial_settlements fs JOIN financial_entries fe ON fe.id=fs.entry_id WHERE ${clauses.join(' AND ')} GROUP BY fe.kind`).all(...params);
    let receivedCents = 0; let paidCents = 0;
    for (const row of realized) row.kind === 'RECEIVABLE' ? receivedCents += Number(row.total || 0) : paidCents += Number(row.total || 0);
    const balances = cashflow.getAccountBalances({ asOf:effectiveTo });
    const bankBalanceCents = balances.filter((item) => item.type === 'BANK').reduce((sum, item) => sum + item.balanceCents, 0);
    const totalBalanceCents = balances.reduce((sum, item) => sum + item.balanceCents, 0);
    return { ...summary, receivedCents, paidCents, resultCents: receivedCents - paidCents, bankBalanceCents, totalBalanceCents };
  }

  function getDashboardSnapshot({ year = Number(nowIso().slice(0, 4)) } = {}) {
    const range = yearRange(year);
    const currentDay = localDay(nowIso());
    // Ano anterior e foto de 31/12; ano atual e futuro nunca antecipam disponibilidade.
    const balanceAsOf = range.to < currentDay ? range.to : currentDay;
    const periodTo = range.to < currentDay ? range.to : currentDay;
    const indicators = getIndicators({ from: range.from, to: periodTo, summaryTo:range.to, asOf: balanceAsOf });
    const accountBalances = cashflow.getAccountBalances({ asOf: balanceAsOf });
    const buckets = Array.from({ length: 12 }, (_, index) => ({ month: `${year}-${String(index + 1).padStart(2, '0')}`, inCents: 0, outCents: 0, netCents: 0 }));
    const byMonth = new Map(buckets.map((item) => [item.month, item]));
    for (const movement of cashflow.listMovements({ from:range.from,to:periodTo })) {
      const bucket = byMonth.get(monthKey(movement.occurredAt)); if (!bucket) continue;
      movement.direction === 'IN' ? bucket.inCents += movement.amountCents : bucket.outCents += movement.amountCents;
      bucket.netCents = bucket.inCents - bucket.outCents;
    }
    const topExpenses = db.prepare(`SELECT fe.description,SUM(fs.amount_cents) amount_cents
      FROM financial_settlements fs JOIN financial_entries fe ON fe.id=fs.entry_id
      WHERE (fs.reversed_at IS NULL OR substr(fs.reversed_at,1,10)>?)
        AND (fe.status<>'CANCELLED' OR (fe.cancelled_at IS NOT NULL AND substr(fe.cancelled_at,1,10)>?))
        AND fe.kind='PAYABLE' AND fs.occurred_at>=? AND fs.occurred_at<=?
      GROUP BY fe.description ORDER BY amount_cents DESC,fe.description LIMIT 5`).all(periodTo,periodTo,range.from,periodTo).map((row) => ({ description: row.description, amountCents: Number(row.amount_cents || 0) }));
    return { year: Number(year), range, balanceAsOf, cards: indicators, accountBalances, monthly: buckets, topExpenses, dre: getDre({ ...range, to:periodTo, basis: 'realized' }) };
  }

  return { getDre, getIndicators, getDashboardSnapshot };
}

module.exports = { createAnalyticsService, proportionalCents };