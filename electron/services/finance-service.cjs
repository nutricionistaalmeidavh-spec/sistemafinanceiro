'use strict';

const { randomUUID } = require('node:crypto');
const { writeAudit } = require('./audit.cjs');
const { assertDateOnly, localDay } = require('./date-utils.cjs');

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
    return row && { id: row.id, entryId: row.entry_id, accountId: row.account_id || null, amountCents: row.amount_cents, method: row.method, note: row.note, occurredAt: row.occurred_at, createdAt: row.created_at, reversedAt: row.reversed_at };
  }
  const approvalSchemaAvailable=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='approval_policies'").get());
  function paymentApproval(row) {
    if (!approvalSchemaAvailable || row.kind !== 'PAYABLE' || row.status === 'CANCELLED') return { status:'NOT_REQUIRED', policyId:null };
    const policy = db.prepare('SELECT id FROM approval_policies WHERE active=1 AND min_amount_cents<=? ORDER BY min_amount_cents DESC,id LIMIT 1').get(row.amount_cents);
    if (!policy) return { status:'NOT_REQUIRED', policyId:null };
    const request = db.prepare(`SELECT status FROM approval_requests
      WHERE entry_id=? AND policy_id=? AND entry_amount_cents_at_request=? AND status IN ('APPROVED','PENDING')
      ORDER BY CASE status WHEN 'APPROVED' THEN 0 ELSE 1 END, updated_at DESC LIMIT 1`)
      .get(row.id,policy.id,row.amount_cents);
    return { status:request?.status || 'REQUIRED',policyId:policy.id };
  }
  function mapEntry(row, asOf = localDay(nowIso()), prefetchedSettlements = null) {
    if (!row) return null;
    const day=assertDateOnly(String(asOf).slice(0,10),'asOf');
    // Reuse a batch when listing entries while keeping point lookups historically correct.
    const settlements=prefetchedSettlements ?? db.prepare(`SELECT * FROM financial_settlements WHERE entry_id=? AND occurred_at<=?
      AND (reversed_at IS NULL OR substr(reversed_at,1,10)>?) ORDER BY occurred_at,created_at,id`)
      .all(String(row.id),day,day).map(mapSettlement);
    const settledCents = settlements.reduce((sum, item) => sum + Number(item.amountCents || 0), 0);
    const openCents = Math.max(Number(row.amount_cents) - settledCents, 0);
    const cancelledAt=row.cancelled_at?localDay(row.cancelled_at):null;
    const isCancelled=row.status==='CANCELLED'&&(!cancelledAt||cancelledAt<=day);
    const status=isCancelled?'CANCELLED':openCents===0?'SETTLED':settledCents>0?'PARTIAL':'OPEN';
    const isOverdue = ['OPEN', 'PARTIAL'].includes(status) && row.due_at < day;
    return {
      id: row.id, kind: row.kind, description: row.description, categoryId: row.category_id, accountId: row.account_id,
      customerId: row.customer_id, creditorId: row.creditor_id, amountCents: row.amount_cents, issueAt: row.issue_at,
      dueAt: row.due_at, status, sourceType: row.source_type, sourceId: row.source_id, notes: row.notes,
      recurrenceRuleId: row.recurrence_rule_id || null, recurrenceKey: row.recurrence_key || null,
      createdAt: row.created_at, updatedAt: row.updated_at, cancelledAt: row.cancelled_at,
      settledCents, openCents, isOverdue, settlements, approval: paymentApproval(row),
    };
  }
  function getEntry(id, { asOf } = {}) { return mapEntry(db.prepare('SELECT * FROM financial_entries WHERE id=?').get(String(id)), asOf || localDay(nowIso())); }
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
    const dueAt = assertDateOnly(input.dueAt, 'due date');
    if (kind === 'PAYABLE' && input.customerId) throw new Error('payable cannot reference customer');
    if (kind === 'RECEIVABLE' && input.creditorId) throw new Error('receivable cannot reference creditor');
    if (input.accountId) assertRelation('financial_accounts', input.accountId, 'financial account');
    if (input.customerId) assertRelation('customers', input.customerId, 'customer');
    if (input.creditorId) assertRelation('creditors', input.creditorId, 'creditor');
    validateCategory(kind, input.categoryId);
    const id = String(input.id || idFactory('fin'));
    const timestamp = nowIso();
    const issueAt = assertDateOnly(input.issueAt || localDay(timestamp), 'issue date');
    db.prepare(`INSERT INTO financial_entries
      (id,kind,description,category_id,account_id,customer_id,creditor_id,amount_cents,issue_at,due_at,status,source_type,source_id,notes,recurrence_rule_id,recurrence_key,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,'OPEN',?,?,?,?,?,?,?)`).run(
        id, kind, description, input.categoryId || null, input.accountId || null, input.customerId || null, input.creditorId || null,
        amountCents, issueAt, dueAt, input.sourceType || null, input.sourceId || null, input.notes || null,
        input.recurrenceRuleId || null, input.recurrenceKey || null, timestamp, timestamp,
      );
    writeAudit(db, { action: 'finance.entry.create', entity: 'financial-entry', entityId: id, actor, context: { kind, amountCents, dueAt, recurrenceRuleId: input.recurrenceRuleId || null } }, nowIso);
    return getEntry(id);
  }
  function updateEntry(entryId, input = {}, actor = null) {
    return withTransaction(db, () => {
      const row = requireEntry(entryId);
      if (row.status === 'CANCELLED') throw new Error('cancelled entry cannot be edited');
      if (input.kind != null && input.kind !== row.kind) throw new Error('entry kind cannot change');
      const description = input.description == null ? row.description : String(input.description).trim();
      if (!description) throw new Error('financial entry description is required');
      const amountCents = input.amountCents == null ? row.amount_cents : assertCents(input.amountCents,'amountCents');
      if (amountCents <= 0) throw new Error('amountCents must be greater than zero');
      if (amountCents < getEntry(entryId).settledCents) throw new Error('amount cannot be lower than settled total');
      const dueAt = assertDateOnly(input.dueAt ?? row.due_at, 'due date');
      const accountId = input.accountId === undefined ? row.account_id : input.accountId || null;
      const categoryId = input.categoryId === undefined ? row.category_id : input.categoryId || null;
      const customerId = input.customerId === undefined ? row.customer_id : input.customerId || null;
      const creditorId = input.creditorId === undefined ? row.creditor_id : input.creditorId || null;
      if (row.kind === 'PAYABLE' && customerId) throw new Error('payable cannot reference customer');
      if (row.kind === 'RECEIVABLE' && creditorId) throw new Error('receivable cannot reference creditor');
      assertRelation('financial_accounts', accountId, 'financial account');
      assertRelation('customers', customerId, 'customer');
      assertRelation('creditors', creditorId, 'creditor');
      validateCategory(row.kind, categoryId);
      const notes = input.notes === undefined ? row.notes : input.notes || null;
      // Preserve historical account attribution for pre-v3 settlements on entry edits.
      if (accountId !== row.account_id) {
        const legacy = db.prepare('SELECT COUNT(*) AS total FROM financial_settlements WHERE entry_id=? AND account_id IS NULL AND reversed_at IS NULL').get(String(entryId));
        if (legacy.total > 0 && !row.account_id) throw new Error('legacy payments have no original account; choose an account before editing');
        if (legacy.total > 0) db.prepare('UPDATE financial_settlements SET account_id=? WHERE entry_id=? AND account_id IS NULL').run(row.account_id, String(entryId));
      }
      db.prepare(`UPDATE financial_entries SET description=?,amount_cents=?,due_at=?,account_id=?,category_id=?,customer_id=?,creditor_id=?,notes=?,updated_at=? WHERE id=?`)
        .run(description,amountCents,dueAt,accountId,categoryId,customerId,creditorId,notes,nowIso(),String(entryId));
      recalculateStatus(entryId);
      writeAudit(db,{action:'finance.entry.update',entity:'financial-entry',entityId:String(entryId),actor,
        context:{before:{description:row.description,amountCents:row.amount_cents,dueAt:row.due_at},
                 after:{description,amountCents,dueAt}}},nowIso);
      return getEntry(entryId);
    });
  }
  function recalculateStatus(entryId) {
    const row = requireEntry(entryId);
    if (row.status === 'CANCELLED') return row.status;
    const settled = Number(db.prepare('SELECT COALESCE(SUM(amount_cents),0) total FROM financial_settlements WHERE entry_id=? AND reversed_at IS NULL').get(String(entryId)).total || 0);
    const status = settled <= 0 ? 'OPEN' : settled < row.amount_cents ? 'PARTIAL' : 'SETTLED';
    db.prepare('UPDATE financial_entries SET status=?,updated_at=? WHERE id=?').run(status, nowIso(), String(entryId));
    return status;
  }
  function settleEntry(entryId, input = {}, actor = null, { withinTransaction = false } = {}) {
    const execute = () => {
      const row = requireEntry(entryId);
      if (row.status === 'CANCELLED') throw new Error('cancelled entry cannot be settled');
      const current = getEntry(entryId);
      const settledBooked=activeSettlements(entryId).reduce((sum,item)=>sum+Number(item.amount_cents),0);
      const bookOpen=Math.max(0,Number(row.amount_cents)-settledBooked);
      if (bookOpen <= 0) throw new Error('entry has no open balance');
      const amountCents = assertCents(input.amountCents, 'amountCents');
      if (amountCents <= 0) throw new Error('settlement must be greater than zero');
      if (amountCents > bookOpen) throw new Error('settlement exceeds open balance');
      const approval = paymentApproval(row);
      if (approval.status !== 'NOT_REQUIRED' && approval.status !== 'APPROVED') {
        throw new Error('Pagamento exige aprovação. Solicite ou conclua a aprovação em Planejamento > Aprovações antes de registrar a baixa.');
      }
      const occurredAt = assertDateOnly(input.occurredAt || localDay(nowIso()), 'settlement date');
      if(occurredAt>localDay(nowIso()))throw new Error('settlement date cannot be in the future');
      const method = String(input.method || 'OTHER').toUpperCase();
      if (!['PIX','CASH','TRANSFER','BOLETO','DEBIT_CARD','CREDIT_CARD','OTHER'].includes(method)) throw new Error('invalid payment method');
      const accountId = String(input.accountId || row.account_id || '').trim();
      if (!accountId) throw new Error('financial account is required for settlement');
      assertRelation('financial_accounts', accountId, 'financial account');
      const id = String(input.id || idFactory('settlement'));
      const timestamp = nowIso();
      db.prepare('INSERT INTO financial_settlements(id,entry_id,account_id,amount_cents,method,note,occurred_at,created_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(id, String(entryId), accountId, amountCents, method, input.note || null, occurredAt, timestamp);
      recalculateStatus(entryId);
      writeAudit(db, { action: 'finance.settle', entity: 'financial-entry', entityId: entryId, actor, context: { settlementId: id, accountId, amountCents, method } }, nowIso);
      return { settlement: mapSettlement(db.prepare('SELECT * FROM financial_settlements WHERE id=?').get(id)), entry: getEntry(entryId) };
    };
    return withinTransaction ? execute() : withTransaction(db, execute);
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
    if (filters.recurrenceRuleId) { clauses.push('recurrence_rule_id=?'); params.push(String(filters.recurrenceRuleId)); }
    if (filters.query) { clauses.push('LOWER(description) LIKE ?'); params.push(`%${String(filters.query).trim().toLowerCase()}%`); }
    const day = assertDateOnly(String(filters.asOf || localDay(nowIso())).slice(0,10),'asOf');
    clauses.push('substr(created_at,1,10)<=?');
    params.push(day);
    const rows = db.prepare(`SELECT * FROM financial_entries${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''} ORDER BY due_at,id`).all(...params);
    const byEntry = new Map();
    for (let offset = 0; offset < rows.length; offset += 400) {
      const ids = rows.slice(offset,offset+400).map(row=>row.id);
      const placeholders = ids.map(()=>'?').join(',');
      const payments = db.prepare(`SELECT * FROM financial_settlements
        WHERE entry_id IN (${placeholders}) AND occurred_at<=?
          AND (reversed_at IS NULL OR substr(reversed_at,1,10)>?)
        ORDER BY occurred_at,created_at,id`).all(...ids,day,day);
      for (const payment of payments) {
        if (!byEntry.has(payment.entry_id)) byEntry.set(payment.entry_id,[]);
        byEntry.get(payment.entry_id).push(mapSettlement(payment));
      }
    }
    return rows.map(row=>mapEntry(row,day,byEntry.get(row.id)||[]))
      .filter(entry=>filters.overdue===true?entry.isOverdue:true);
  }
  function getSummary({ from = null, to = null, asOf = localDay(nowIso()) } = {}) {
    const day=assertDateOnly(String(asOf).slice(0,10),'asOf');
    const where=["substr(fe.created_at,1,10)<=?", "(fe.status<>'CANCELLED' OR substr(fe.cancelled_at,1,10)>?)"];
    const params=[day,day];
    if (from) {where.push('fe.due_at>=?');params.push(String(from));}
    if (to) {where.push('fe.due_at<=?');params.push(String(to));}
    // A snapshot is derived from payments effective as of the cut-off, not
    // the current status or payments reversed after that historical date.
    const rows=db.prepare(`WITH paid AS (
      SELECT entry_id,SUM(amount_cents) paid_cents FROM financial_settlements
      WHERE occurred_at<=? AND (reversed_at IS NULL OR substr(reversed_at,1,10)>?)
      GROUP BY entry_id
    )
    SELECT fe.kind, SUM(fe.amount_cents) total_cents,
      SUM(COALESCE(p.paid_cents,0)) settled_cents,
      SUM(MAX(0,fe.amount_cents-COALESCE(p.paid_cents,0))) open_cents,
      SUM(CASE WHEN fe.due_at<? AND fe.amount_cents>COALESCE(p.paid_cents,0)
        THEN MAX(0,fe.amount_cents-COALESCE(p.paid_cents,0)) ELSE 0 END) overdue_cents
    FROM financial_entries fe LEFT JOIN paid p ON p.entry_id=fe.id
    WHERE ${where.join(' AND ')} GROUP BY fe.kind`).all(day,day,day,...params);
    const summary={payableTotalCents:0,payableSettledCents:0,payableOpenCents:0,
      receivableTotalCents:0,receivableSettledCents:0,receivableOpenCents:0,
      overduePayableCents:0,overdueReceivableCents:0};
    for(const row of rows){
      const prefix=row.kind==='PAYABLE'?'payable':'receivable';
      summary[`${prefix}TotalCents`]=Number(row.total_cents||0);
      summary[`${prefix}SettledCents`]=Number(row.settled_cents||0);
      summary[`${prefix}OpenCents`]=Number(row.open_cents||0);
      summary[row.kind==='PAYABLE'?'overduePayableCents':'overdueReceivableCents']=Number(row.overdue_cents||0);
    }
    return summary;
  }

  return { createAccount, getAccount, listAccounts, createEntry, updateEntry, getEntry, listEntries, settleEntry, reverseSettlement, cancelEntry, getSummary };
}

module.exports = { createFinanceService };
