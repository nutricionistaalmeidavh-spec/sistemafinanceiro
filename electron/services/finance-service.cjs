'use strict';

const { randomUUID } = require('node:crypto');
const { writeAudit } = require('./audit.cjs');

function assertCents(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer in cents`);
  return value;
}
function withTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
}

function createFinanceService({ db, now = () => new Date().toISOString(), idFactory = (prefix) => `${prefix}-${randomUUID()}` } = {}) {
  if (!db) throw new TypeError('Database is required.');
  const nowIso = () => String(now());

  function mapAccount(row) {
    return row && { id: row.id, name: row.name, type: row.type, active: Boolean(row.active), createdAt: row.created_at, updatedAt: row.updated_at };
  }
  function getAccount(id) { return mapAccount(db.prepare('SELECT * FROM financial_accounts WHERE id=?').get(String(id))); }
  function createAccount(input = {}, actor = null) {
    const name = String(input.name || '').trim();
    if (!name) throw new Error('financial account name is required');
    const type = String(input.type || 'OTHER').toUpperCase();
    if (!['CASH', 'BANK', 'CARD', 'OTHER'].includes(type)) throw new Error('invalid financial account type');
    const id = String(input.id || idFactory('finacc'));
    const timestamp = nowIso();
    db.prepare('INSERT INTO financial_accounts(id,name,type,active,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .run(id, name, type, input.active === false ? 0 : 1, timestamp, timestamp);
    writeAudit(db, { action: 'finance.account.create', entity: 'financial-account', entityId: id, actor, context: { name, type } }, nowIso);
    return getAccount(id);
  }
  function listAccounts({ includeInactive = false } = {}) {
    return db.prepare(`SELECT * FROM financial_accounts${includeInactive ? '' : ' WHERE active=1'} ORDER BY name COLLATE NOCASE,id`).all().map(mapAccount);
  }
  function activeSettlements(entryId) {
    return db.prepare('SELECT * FROM financial_settlements WHERE entry_id=? AND reversed_at IS NULL ORDER BY occurred_at,created_at,id').all(String(entryId));
  }
  function mapSettlement(row) {
    return row && { id: row.id, entryId: row.entry_id, amountCents: row.amount_cents, method: row.method, note: row.note, occurredAt: row.occurred_at, createdAt: row.created_at, reversedAt: row.reversed_at };
  }
  function mapEntry(row, asOf = nowIso()) {
    if (!row) return null;
    const settlements = activeSettlements(row.id).map(mapSettlement);
    const settledCents = settlements.reduce((sum, item) => sum + Number(item.amountCents || 0), 0);
    const openCents = Math.max(Number(row.amount_cents) - settledCents, 0);
    const isOverdue = ['OPEN', 'PARTIAL'].includes(row.status) && Date.parse(row.due_at) < Date.parse(String(asOf));
    return {
      id: row.id, kind: row.kind, description: row.description, categoryId: row.category_id, accountId: row.account_id,
      customerId: row.customer_id, creditorId: row.creditor_id, amountCents: row.amount_cents, issueAt: row.issue_at,
      dueAt: row.due_at, status: row.status, sourceType: row.source_type, sourceId: row.source_id, notes: row.notes,
      createdAt: row.created_at, updatedAt: row.updated_at, cancelledAt: row.cancelled_at,
      settledCents, openCents, isOverdue, settlements,
    };
  }
  function getEntry(id, { asOf } = {}) { return mapEntry(db.prepare('SELECT * FROM financial_entries WHERE id=?').get(String(id)), asOf || nowIso()); }
  function requireEntry(id) { const row = db.prepare('SELECT * FROM financial_entries WHERE id=?').get(String(id)); if (!row) throw new Error('financial entry not found'); return row; }
  function assertRelation(table, id, label) {
    if (!id) return;
    const row = db.prepare(`SELECT id,active FROM ${table} WHERE id=?`).get(String(id));
    if (!row || !Boolean(row.active)) throw new Error(`${label} not found or inactive`);
  }
  function validateCategory(kind, categoryId) {
    if (!categoryId) return;
    const row = db.prepare('SELECT id,nature,active FROM financial_categories WHERE id=?').get(String(categoryId));
    if (!row || !Boolean(row.active)) throw new Error('category not found or inactive');
    const expected = kind === 'PAYABLE' ? 'EXPENSE' : 'REVENUE';
    if (row.nature !== expected) throw new Error(`category nature must be ${expected}`);
  }
  function createEntry(input = {}, actor = null) {
    const kind = String(input.kind || '').toUpperCase();
    if (!['PAYABLE', 'RECEIVABLE'].includes(kind)) throw new Error('invalid financial entry kind');
    const description = String(input.description || '').trim();
    if (!description) throw new Error('financial entry description is required');
    const amountCents = assertCents(input.amountCents, 'amountCents');
    if (amountCents <= 0) throw new Error('amountCents must be greater than zero');
    const dueAt = String(input.dueAt || '').trim();
    if (!dueAt || !Number.isFinite(Date.parse(dueAt))) throw new Error('invalid due date');
    if (kind === 'PAYABLE' && input.customerId) throw new Error('payable cannot reference customer');
    if (kind === 'RECEIVABLE' && input.creditorId) throw new Error('receivable cannot reference creditor');
    if (input.accountId) assertRelation('financial_accounts', input.accountId, 'financial account');
    if (input.customerId) assertRelation('customers', input.customerId, 'customer');
    if (input.creditorId) assertRelation('creditors', input.creditorId, 'creditor');
    validateCategory(kind, input.categoryId);
    const id = String(input.id || idFactory('fin'));
    const timestamp = nowIso();
    const issueAt = input.issueAt ? String(input.issueAt) : timestamp.slice(0, 10);
    db.prepare(`INSERT INTO financial_entries
      (id,kind,description,category_id,account_id,customer_id,creditor_id,amount_cents,issue_at,due_at,status,source_type,source_id,notes,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,'OPEN',?,?,?,?,?)`).run(
        id, kind, description, input.categoryId || null, input.accountId || null, input.customerId || null, input.creditorId || null,
        amountCents, issueAt, dueAt, input.sourceType || null, input.sourceId || null, input.notes || null, timestamp, timestamp,
      );
    writeAudit(db, { action: 'finance.entry.create', entity: 'financial-entry', entityId: id, actor, context: { kind, amountCents, dueAt } }, nowIso);
    return getEntry(id);
  }
  function recalculateStatus(entryId) {
    const row = requireEntry(entryId);
    if (row.status === 'CANCELLED') return row.status;
    const settled = Number(db.prepare('SELECT COALESCE(SUM(amount_cents),0) total FROM financial_settlements WHERE entry_id=? AND reversed_at IS NULL').get(String(entryId)).total || 0);
    const status = settled <= 0 ? 'OPEN' : settled < row.amount_cents ? 'PARTIAL' : 'SETTLED';
    db.prepare('UPDATE financial_entries SET status=?,updated_at=? WHERE id=?').run(status, nowIso(), String(entryId));
    return status;
  }
  function settleEntry(entryId, input = {}, actor = null) {
    return withTransaction(db, () => {
      const row = requireEntry(entryId);
      if (row.status === 'CANCELLED') throw new Error('cancelled entry cannot be settled');
      const current = getEntry(entryId);
      if (current.openCents <= 0) throw new Error('entry has no open balance');
      const amountCents = assertCents(input.amountCents, 'amountCents');
      if (amountCents <= 0) throw new Error('settlement must be greater than zero');
      if (amountCents > current.openCents) throw new Error('settlement exceeds open balance');
      const occurredAt = String(input.occurredAt || nowIso().slice(0, 10));
      if (!Number.isFinite(Date.parse(occurredAt))) throw new Error('invalid settlement date');
      const id = String(input.id || idFactory('settlement'));
      const timestamp = nowIso();
      db.prepare('INSERT INTO financial_settlements(id,entry_id,amount_cents,method,note,occurred_at,created_at) VALUES (?,?,?,?,?,?,?)')
        .run(id, String(entryId), amountCents, input.method || null, input.note || null, occurredAt, timestamp);
      recalculateStatus(entryId);
      writeAudit(db, { action: 'finance.settle', entity: 'financial-entry', entityId: entryId, actor, context: { settlementId: id, amountCents, method: input.method || null } }, nowIso);
      return { settlement: mapSettlement(db.prepare('SELECT * FROM financial_settlements WHERE id=?').get(id)), entry: getEntry(entryId) };
    });
  }
  function reverseSettlement(settlementId, { reason = '', actor = null } = {}) {
    return withTransaction(db, () => {
      const row = db.prepare('SELECT * FROM financial_settlements WHERE id=?').get(String(settlementId));
      if (!row) throw new Error('settlement not found');
      if (row.reversed_at) throw new Error('settlement already reversed');
      const text = String(reason || '').trim();
      if (!text) throw new Error('reversal reason is required');
      const timestamp = nowIso();
      const note = [row.note, `REVERSAL: ${text}`].filter(Boolean).join(' | ');
      db.prepare('UPDATE financial_settlements SET reversed_at=?,note=? WHERE id=? AND reversed_at IS NULL').run(timestamp, note, String(settlementId));
      recalculateStatus(row.entry_id);
      writeAudit(db, { action: 'finance.settlement.reverse', entity: 'financial-entry', entityId: row.entry_id, actor, context: { settlementId: String(settlementId), reason: text } }, nowIso);
      return { settlement: mapSettlement(db.prepare('SELECT * FROM financial_settlements WHERE id=?').get(String(settlementId))), entry: getEntry(row.entry_id) };
    });
  }
  function cancelEntry(entryId, { reason = '', actor = null } = {}) {
    return withTransaction(db, () => {
      const row = requireEntry(entryId);
      if (row.status === 'CANCELLED') return getEntry(entryId);
      if (activeSettlements(entryId).length) throw new Error('reverse settlements before cancelling entry');
      const text = String(reason || '').trim();
      if (!text) throw new Error('cancellation reason is required');
      const timestamp = nowIso();
      const notes = [row.notes, `CANCELLATION: ${text}`].filter(Boolean).join(' | ');
      db.prepare("UPDATE financial_entries SET status='CANCELLED',notes=?,cancelled_at=?,updated_at=? WHERE id=?")
        .run(notes, timestamp, timestamp, String(entryId));
      writeAudit(db, { action: 'finance.entry.cancel', entity: 'financial-entry', entityId: entryId, actor, context: { reason: text } }, nowIso);
      return getEntry(entryId);
    });
  }
  function listEntries(filters = {}) {
    const clauses = [];
    const params = [];
    if (filters.kind) { clauses.push('kind=?'); params.push(String(filters.kind).toUpperCase()); }
    if (filters.status) { clauses.push('status=?'); params.push(String(filters.status).toUpperCase()); }
    if (filters.from) { clauses.push('due_at>=?'); params.push(String(filters.from)); }
    if (filters.to) { clauses.push('due_at<=?'); params.push(String(filters.to)); }
    if (filters.accountId) { clauses.push('account_id=?'); params.push(String(filters.accountId)); }
    if (filters.customerId) { clauses.push('customer_id=?'); params.push(String(filters.customerId)); }
    if (filters.creditorId) { clauses.push('creditor_id=?'); params.push(String(filters.creditorId)); }
    if (filters.categoryId) { clauses.push('category_id=?'); params.push(String(filters.categoryId)); }
    if (filters.query) { clauses.push('LOWER(description) LIKE ?'); params.push(`%${String(filters.query).trim().toLowerCase()}%`); }
    return db.prepare(`SELECT * FROM financial_entries${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''} ORDER BY due_at,id`).all(...params)
      .map((row) => mapEntry(row, filters.asOf || nowIso()))
      .filter((entry) => filters.overdue === true ? entry.isOverdue : true);
  }
  function getSummary({ from = null, to = null, asOf = nowIso() } = {}) {
    const entries = listEntries({ from, to, asOf });
    const summary = { payableTotalCents: 0, payableSettledCents: 0, payableOpenCents: 0, receivableTotalCents: 0, receivableSettledCents: 0, receivableOpenCents: 0, overduePayableCents: 0, overdueReceivableCents: 0 };
    for (const entry of entries) {
      if (entry.status === 'CANCELLED') continue;
      const prefix = entry.kind === 'PAYABLE' ? 'payable' : 'receivable';
      summary[`${prefix}TotalCents`] += entry.amountCents;
      summary[`${prefix}SettledCents`] += entry.settledCents;
      summary[`${prefix}OpenCents`] += entry.openCents;
      if (entry.isOverdue) summary[entry.kind === 'PAYABLE' ? 'overduePayableCents' : 'overdueReceivableCents'] += entry.openCents;
    }
    return summary;
  }

  return { createAccount, getAccount, listAccounts, createEntry, getEntry, listEntries, settleEntry, reverseSettlement, cancelEntry, getSummary };
}

module.exports = { createFinanceService };
