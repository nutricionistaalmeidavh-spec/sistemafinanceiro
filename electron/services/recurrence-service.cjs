'use strict';

const { randomUUID } = require('node:crypto');
const { writeAudit } = require('./audit.cjs');

function assertPositiveCents(value) { if (!Number.isSafeInteger(value) || value <= 0) throw new Error('amountCents must be a positive integer in cents'); return value; }
function validDate(value, label) { const text = String(value || '').slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(`${text}T00:00:00Z`))) throw new Error(`invalid ${label}`); return text; }
function daysInMonth(year, monthIndex) { return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate(); }
function dueInMonth(year, monthIndex, dueDay) { return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(Math.min(dueDay, daysInMonth(year, monthIndex))).padStart(2, '0')}`; }
function addMonths(dateText, months, dueDay) { const date = new Date(`${dateText}T00:00:00Z`); const absolute = date.getUTCFullYear() * 12 + date.getUTCMonth() + months; const year = Math.floor(absolute / 12); const month = absolute % 12; return dueInMonth(year, month, dueDay); }
function firstDue(startDate, dueDay, intervalMonths) { const start = new Date(`${startDate}T00:00:00Z`); let candidate = dueInMonth(start.getUTCFullYear(), start.getUTCMonth(), dueDay); if (candidate < startDate) candidate = addMonths(candidate, intervalMonths, dueDay); return candidate; }
function withTransaction(db, fn) { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; } }

function createRecurrenceService({ db, finance, now = () => new Date().toISOString(), idFactory = () => `rule-${randomUUID()}` } = {}) {
  if (!db || !finance) throw new TypeError('db and finance are required');
  const nowIso = () => String(now());
  function mapRule(row) { return row && { id: row.id, kind: row.kind, description: row.description, categoryId: row.category_id, accountId: row.account_id, customerId: row.customer_id, creditorId: row.creditor_id, amountCents: Number(row.amount_cents), startDate: row.start_date, endDate: row.end_date, dueDay: row.due_day, intervalMonths: row.interval_months, maxOccurrences: row.max_occurrences, generatedCount: row.generated_count, nextDueAt: row.next_due_at, notes: row.notes, active: Boolean(row.active), createdAt: row.created_at, updatedAt: row.updated_at };
  function requireRelation(table, id, label) { if (!id) return; const row = db.prepare(`SELECT id,active FROM ${table} WHERE id=?`).get(String(id)); if (!row || !Boolean(row.active)) throw new Error(`${label} not found or inactive`); }
  function validateCategory(kind, id) { if (!id) return; const row = db.prepare('SELECT * FROM financial_categories WHERE id=? AND active=1').get(String(id)); if (!row) throw new Error('category not found or inactive'); const expected = kind === 'PAYABLE' ? 'EXPENSE' : 'REVENUE'; if (row.nature !== expected) throw new Error(`category nature must be ${expected}`); }
  function createRule(input = {}, actor = null) {
    const kind = String(input.kind || '').toUpperCase(); if (!['PAYABLE', 'RECEIVABLE'].includes(kind)) throw new Error('invalid recurring kind');
    const description = String(input.description || '').trim(); if (!description) throw new Error('description is required');
    const amountCents = assertPositiveCents(input.amountCents);
    const startDate = validDate(input.startDate || nowIso().slice(0, 10), 'start date');
    const endDate = input.endDate ? validDate(input.endDate, 'end date') : null; if (endDate && endDate < startDate) throw new Error('end date cannot precede start date');
    const dueDay = Number(input.dueDay); if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) throw new Error('dueDay must be between 1 and 31');
    const intervalMonths = input.intervalMonths == null ? 1 : Number(input.intervalMonths); if (!Number.isInteger(intervalMonths) || intervalMonths < 1 || intervalMonths > 12) throw new Error('intervalMonths must be between 1 and 12');
    const maxOccurrences = input.maxOccurrences == null || input.maxOccurrences === '' ? null : Number(input.maxOccurrences); if (maxOccurrences != null && (!Number.isInteger(maxOccurrences) || maxOccurrences <= 0)) throw new Error('maxOccurrences must be a positive integer');
    if (kind === 'PAYABLE' && input.customerId) throw new Error('payable recurrence cannot reference customer'); if (kind === 'RECEIVABLE' && input.creditorId) throw new Error('receivable recurrence cannot reference creditor');
    requireRelation('financial_accounts', input.accountId, 'financial account'); requireRelation('customers', input.customerId, 'customer'); requireRelation('creditors', input.creditorId, 'creditor'); validateCategory(kind, input.categoryId);
    const id = String(input.id || idFactory()); const timestamp = nowIso(); const nextDueAt = firstDue(startDate, dueDay, intervalMonths);
    db.prepare(`INSERT INTO recurring_rules(id,kind,description,category_id,account_id,customer_id,creditor_id,amount_cents,start_date,end_date,due_day,interval_months,max_occurrences,generated_count,next_due_at,notes,active,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,1,?,?)`).run(id, kind, description, input.categoryId || null, input.accountId || null, input.customerId || null, input.creditorId || null, amountCents, startDate, endDate, dueDay, intervalMonths, maxOccurrences, nextDueAt, input.notes || null, timestamp, timestamp);
    writeAudit(db, { action: 'recurrence.create', entity: 'recurring-rule', entityId: id, actor, context: { kind, amountCents, dueDay, intervalMonths, maxOccurrences } }, nowIso);
    return mapRule(db.prepare('SELECT * FROM recurring_rules WHERE id=?').get(id));
  }
  function listRules({ includeInactive = true } = {}) { return db.prepare(`SELECT * FROM recurring_rules${includeInactive ? '' : ' WHERE active=1'} ORDER BY active DESC,next_due_at,description`).all().map(mapRule); }
  function setRuleActive(id, active, actor = null) { const timestamp = nowIso(); const result = db.prepare('UPDATE recurring_rules SET active=?,updated_at=? WHERE id=?').run(active ? 1 : 0, timestamp, String(id)); if (!result.changes) throw new Error('recurring rule not found'); writeAudit(db, { action: active ? 'recurrence.enable' : 'recurrence.pause', entity: 'recurring-rule', entityId: String(id), actor, context: {} }, nowIso); return mapRule(db.prepare('SELECT * FROM recurring_rules WHERE id=?').get(String(id))); }
  function generateDue({ asOf = nowIso().slice(0, 10), actor = null } = {}) {
    const limit = validDate(asOf, 'generation date');
    return withTransaction(db, () => {
      const rules = db.prepare('SELECT * FROM recurring_rules WHERE active=1 AND next_due_at<=? ORDER BY next_due_at,id').all(limit);
      const generated = [];
      for (const initial of rules) {
        let rule = initial;
        while (Boolean(rule.active) && rule.next_due_at <= limit) {
          if (rule.end_date && rule.next_due_at > rule.end_date) { db.prepare('UPDATE recurring_rules SET active=0,updated_at=? WHERE id=?').run(nowIso(), rule.id); break; }
          if (rule.max_occurrences != null && rule.generated_count >= rule.max_occurrences) { db.prepare('UPDATE recurring_rules SET active=0,updated_at=? WHERE id=?').run(nowIso(), rule.id); break; }
          const key = `${rule.id}:${rule.next_due_at}`;
          const existing = db.prepare('SELECT id FROM financial_entries WHERE recurrence_key=?').get(key);
          if (!existing) {
            generated.push(finance.createEntry({ kind: rule.kind, description: rule.description, categoryId: rule.category_id, accountId: rule.account_id, customerId: rule.customer_id, creditorId: rule.creditor_id, amountCents: Number(rule.amount_cents), issueAt: rule.next_due_at, dueAt: rule.next_due_at, notes: rule.notes, sourceType: 'recurring_rule', sourceId: rule.id, recurrenceRuleId: rule.id, recurrenceKey: key }, actor));
          }
          const count = Number(rule.generated_count) + 1;
          const next = addMonths(rule.next_due_at, Number(rule.interval_months), Number(rule.due_day));
          const shouldStop = (rule.max_occurrences != null && count >= rule.max_occurrences) || (rule.end_date && next > rule.end_date);
          db.prepare('UPDATE recurring_rules SET generated_count=?,next_due_at=?,active=?,updated_at=? WHERE id=?').run(count, next, shouldStop ? 0 : 1, nowIso(), rule.id);
          rule = db.prepare('SELECT * FROM recurring_rules WHERE id=?').get(rule.id);
        }
      }
      writeAudit(db, { action: 'recurrence.generate', entity: 'recurring-rule', entityId: null, actor, context: { asOf: limit, generated: generated.length } }, nowIso);
      return generated;
    });
  }
  return { createRule, listRules, setRuleActive, generateDue };
}

module.exports = { createRecurrenceService, addMonths, firstDue };
