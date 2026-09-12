'use strict';

const { randomUUID } = require('node:crypto');
const { writeAudit } = require('./audit.cjs');

function assertPositiveCents(value, name = 'amountCents') {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer in cents`);
  return value;
}
function assertDate(value, name = 'date') {
  const text = String(value || '').trim();
  if (!text || !Number.isFinite(Date.parse(text))) throw new Error(`invalid ${name}`);
  return text;
}
function previousDay(date) {
  const parsed = new Date(`${String(date).slice(0, 10)}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}
function withTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const value = fn(); db.exec('COMMIT'); return value; }
  catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
}

function createCashflowService({ db, now = () => new Date().toISOString(), idFactory = (prefix) => `${prefix}-${randomUUID()}` } = {}) {
  if (!db) throw new TypeError('Database is required.');
  const nowIso = () => String(now());

  function requireAccount(id) {
    const row = db.prepare('SELECT * FROM financial_accounts WHERE id=? AND active=1').get(String(id || ''));
    if (!row) throw new Error('financial account not found or inactive');
    return row;
  }
  function mapManual(row) {
    return {
      id: row.id, accountId: row.account_id, direction: row.direction, type: row.type,
      amountCents: Number(row.amount_cents), occurredAt: row.occurred_at, note: row.note,
      transferId: row.transfer_id, sourceType: 'MANUAL', sourceId: null, createdAt: row.created_at,
    };
  }
  function createManualMovement(input = {}, actor = null) {
    const account = requireAccount(input.accountId);
    const type = String(input.type || '').toUpperCase();
    if (!['OPENING', 'DEPOSIT', 'WITHDRAWAL', 'ADJUSTMENT'].includes(type)) throw new Error('invalid manual movement type');
    const direction = type === 'WITHDRAWAL' ? 'OUT' : type === 'ADJUSTMENT' ? String(input.direction || '').toUpperCase() : 'IN';
    if (!['IN', 'OUT'].includes(direction)) throw new Error('adjustment direction must be IN or OUT');
    const amountCents = assertPositiveCents(input.amountCents);
    const occurredAt = assertDate(input.occurredAt || nowIso().slice(0, 10), 'movement date');
    const id = String(input.id || idFactory('cash'));
    const timestamp = nowIso();
    db.prepare('INSERT INTO cash_movements(id,account_id,direction,type,amount_cents,occurred_at,note,transfer_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, account.id, direction, type, amountCents, occurredAt, input.note || null, null, timestamp);
    writeAudit(db, { action: 'cashflow.movement.create', entity: 'cash-movement', entityId: id, actor, context: { accountId: account.id, direction, type, amountCents } }, nowIso);
    return mapManual(db.prepare('SELECT * FROM cash_movements WHERE id=?').get(id));
  }
  function transfer(input = {}, actor = null) {
    const from = requireAccount(input.fromAccountId);
    const to = requireAccount(input.toAccountId);
    if (from.id === to.id) throw new Error('transfer accounts must be different');
    const amountCents = assertPositiveCents(input.amountCents);
    const occurredAt = assertDate(input.occurredAt || nowIso().slice(0, 10), 'transfer date');
    return withTransaction(db, () => {
      const transferId = String(input.transferId || idFactory('transfer'));
      const timestamp = nowIso();
      const outId = idFactory('cash');
      const inId = idFactory('cash');
      const insert = db.prepare('INSERT INTO cash_movements(id,account_id,direction,type,amount_cents,occurred_at,note,transfer_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)');
      insert.run(outId, from.id, 'OUT', 'TRANSFER', amountCents, occurredAt, input.note || null, transferId, timestamp);
      insert.run(inId, to.id, 'IN', 'TRANSFER', amountCents, occurredAt, input.note || null, transferId, timestamp);
      writeAudit(db, { action: 'cashflow.transfer', entity: 'cash-transfer', entityId: transferId, actor, context: { fromAccountId: from.id, toAccountId: to.id, amountCents } }, nowIso);
      return { transferId, out: mapManual(db.prepare('SELECT * FROM cash_movements WHERE id=?').get(outId)), in: mapManual(db.prepare('SELECT * FROM cash_movements WHERE id=?').get(inId)) };
    });
  }
  function listMovements(filters = {}) {
    const manual = db.prepare('SELECT * FROM cash_movements ORDER BY occurred_at,created_at,id').all().map(mapManual);
    const settlements = db.prepare(`SELECT fs.*,COALESCE(fs.account_id,fe.account_id) resolved_account_id,fe.kind,fe.description
      FROM financial_settlements fs JOIN financial_entries fe ON fe.id=fs.entry_id
      WHERE fs.reversed_at IS NULL AND fe.status<>'CANCELLED'
      ORDER BY fs.occurred_at,fs.created_at,fs.id`).all().filter((row) => row.resolved_account_id).map((row) => ({
        id: row.id, accountId: row.resolved_account_id, direction: row.kind === 'RECEIVABLE' ? 'IN' : 'OUT', type: 'SETTLEMENT',
        amountCents: Number(row.amount_cents), occurredAt: row.occurred_at, note: row.note || row.description,
        transferId: null, sourceType: 'SETTLEMENT', sourceId: row.entry_id, createdAt: row.created_at,
      }));
    return [...manual, ...settlements].filter((item) => {
      if (filters.accountId && item.accountId !== String(filters.accountId)) return false;
      if (filters.from && item.occurredAt < String(filters.from)) return false;
      if (filters.to && item.occurredAt > String(filters.to)) return false;
      return true;
    }).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }
  function getAccountBalances({ asOf = nowIso().slice(0, 10), includeInactive = false } = {}) {
    const accounts = db.prepare(`SELECT * FROM financial_accounts${includeInactive ? '' : ' WHERE active=1'} ORDER BY name COLLATE NOCASE,id`).all();
    const movements = listMovements({ to: String(asOf) });
    const totals = new Map();
    for (const item of movements) totals.set(item.accountId, (totals.get(item.accountId) || 0) + (item.direction === 'IN' ? item.amountCents : -item.amountCents));
    return accounts.map((account) => ({ id: account.id, name: account.name, type: account.type, active: Boolean(account.active), balanceCents: totals.get(account.id) || 0 }));
  }
  function getCashflowSummary({ from = null, to = nowIso().slice(0, 10), accountId = null } = {}) {
    const period = listMovements({ from, to, accountId });
    let inCents = 0; let outCents = 0;
    for (const item of period) item.direction === 'IN' ? inCents += item.amountCents : outCents += item.amountCents;
    let openingBalanceCents = 0;
    if (from) {
      const before = listMovements({ to: previousDay(from), accountId });
      for (const item of before) openingBalanceCents += item.direction === 'IN' ? item.amountCents : -item.amountCents;
    }
    return { openingBalanceCents, inCents, outCents, netCents: inCents - outCents, closingBalanceCents: openingBalanceCents + inCents - outCents };
  }

  return { createManualMovement, transfer, listMovements, getAccountBalances, getCashflowSummary };
}

module.exports = { createCashflowService };
