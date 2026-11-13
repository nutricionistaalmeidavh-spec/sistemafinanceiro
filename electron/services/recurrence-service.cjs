'use strict';

const { randomUUID } = require('node:crypto');
const { writeAudit } = require('./audit.cjs');
const { assertDateOnly, localDay } = require('./date-utils.cjs');
const schedule=require('./recurrence-schedule.cjs');

function assertPositiveCents(value) { if (!Number.isSafeInteger(value) || value <= 0) throw new Error('amountCents must be a positive integer in cents'); return value; }
function validDate(value, label) { return assertDateOnly(value, label); }
// Compatibility exports for existing callers; recurrence dates have one canonical implementation.
function addMonths(dateText,months,dueDay){return schedule.addMonthsClamped(dateText,months,dueDay);}
function firstDue(startDate,dueDay,intervalMonths){return schedule.firstDue({startDate,dueDay,intervalMonths});}
function withTransaction(db, fn) { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; } }

function createRecurrenceService({ db, finance, now = () => new Date().toISOString(), idFactory = () => `rule-${randomUUID()}` } = {}) {
  if (!db || !finance) throw new TypeError('db and finance are required');
  const nowIso = () => String(now());
  function lifecycleStatus(row) {
    const ended = (row.max_occurrences != null && row.generated_count >= row.max_occurrences)
      || (row.end_date != null && row.next_due_at > row.end_date);
    return ended ? 'COMPLETED' : row.active ? 'ACTIVE' : 'PAUSED';
  }
  function mapRule(row) { return row && { id: row.id, kind: row.kind, description: row.description, categoryId: row.category_id, accountId: row.account_id, customerId: row.customer_id, creditorId: row.creditor_id, amountCents: Number(row.amount_cents), startDate: row.start_date, endDate: row.end_date, dueDay: row.due_day, intervalMonths: row.interval_months, intervalDays: row.interval_days ?? null, annualAdjustmentBps: Number(row.annual_adjustment_bps || 0), maxOccurrences: row.max_occurrences, generatedCount: row.generated_count, nextDueAt: row.next_due_at, notes: row.notes, active: Boolean(row.active), lifecycleStatus:lifecycleStatus(row), createdAt: row.created_at, updatedAt: row.updated_at }; }
  function requireRelation(table, id, label) { if (!id) return; const row = db.prepare(`SELECT id,active FROM ${table} WHERE id=?`).get(String(id)); if (!row || !Boolean(row.active)) throw new Error(`${label} not found or inactive`); }
  function validateCategory(kind, id) { if (!id) return; const row = db.prepare('SELECT * FROM financial_categories WHERE id=? AND active=1').get(String(id)); if (!row) throw new Error('category not found or inactive'); const expected = kind === 'PAYABLE' ? 'EXPENSE' : 'REVENUE'; if (row.nature !== expected) throw new Error(`category nature must be ${expected}`); }
  function createRule(input = {}, actor = null) {
    const kind = String(input.kind || '').toUpperCase(); if (!['PAYABLE', 'RECEIVABLE'].includes(kind)) throw new Error('invalid recurring kind');
    const description = String(input.description || '').trim(); if (!description) throw new Error('description is required');
    const amountCents = assertPositiveCents(input.amountCents);
    const startDate = validDate(input.startDate || localDay(nowIso()), 'start date');
    const endDate = input.endDate ? validDate(input.endDate, 'end date') : null; if (endDate && endDate < startDate) throw new Error('end date cannot precede start date');
    const dueDay = Number(input.dueDay); if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) throw new Error('dueDay must be between 1 and 31');
    const intervalMonths = input.intervalMonths == null ? 1 : Number(input.intervalMonths); if (!Number.isInteger(intervalMonths) || intervalMonths < 1 || intervalMonths > 12) throw new Error('intervalMonths must be between 1 and 12');
    const intervalDays = input.intervalDays == null || input.intervalDays === '' ? null : Number(input.intervalDays);
    if(intervalDays!==null&&![7,14].includes(intervalDays))throw new Error('intervalDays must be 7 or 14');
    const annualAdjustmentBps = input.annualAdjustmentBps == null ? 0 : Number(input.annualAdjustmentBps);
    if(!Number.isInteger(annualAdjustmentBps)||annualAdjustmentBps<0||annualAdjustmentBps>10000)throw new Error('annualAdjustmentBps must be between 0 and 10000');
    const maxOccurrences = input.maxOccurrences == null || input.maxOccurrences === '' ? null : Number(input.maxOccurrences); if (maxOccurrences != null && (!Number.isInteger(maxOccurrences) || maxOccurrences <= 0)) throw new Error('maxOccurrences must be a positive integer');
    if (kind === 'PAYABLE' && input.customerId) throw new Error('payable recurrence cannot reference customer'); if (kind === 'RECEIVABLE' && input.creditorId) throw new Error('receivable recurrence cannot reference creditor');
    requireRelation('financial_accounts', input.accountId, 'financial account'); requireRelation('customers', input.customerId, 'customer'); requireRelation('creditors', input.creditorId, 'creditor'); validateCategory(kind, input.categoryId);
    const id = String(input.id || idFactory()); const timestamp = nowIso(); const nextDueAt = schedule.firstDue({startDate,dueDay,intervalMonths,intervalDays});
    db.prepare(`INSERT INTO recurring_rules(id,kind,description,category_id,account_id,customer_id,creditor_id,amount_cents,start_date,end_date,due_day,interval_months,interval_days,annual_adjustment_bps,max_occurrences,generated_count,next_due_at,notes,active,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,1,?,?)`).run(id, kind, description, input.categoryId || null, input.accountId || null, input.customerId || null, input.creditorId || null, amountCents, startDate, endDate, dueDay, intervalMonths, intervalDays, annualAdjustmentBps, maxOccurrences, nextDueAt, input.notes || null, timestamp, timestamp);
    writeAudit(db, { action: 'recurrence.create', entity: 'recurring-rule', entityId: id, actor, context: { kind, amountCents, dueDay, intervalMonths, maxOccurrences } }, nowIso);
    return mapRule(db.prepare('SELECT * FROM recurring_rules WHERE id=?').get(id));
  }
  function updateRule(id, input = {}, actor = null) {
    return withTransaction(db, () => {
      const row = db.prepare('SELECT * FROM recurring_rules WHERE id=?').get(String(id));
      if (!row) throw new Error('recurring rule not found');
      const old = mapRule(row);
      if (input.kind != null && input.kind !== old.kind) throw new Error('recurring kind cannot change');
      const description = input.description == null ? old.description : String(input.description).trim();
      if (!description) throw new Error('description is required');
      const amountCents = input.amountCents == null ? old.amountCents : assertPositiveCents(input.amountCents);
      const startDate = validDate(input.startDate ?? old.startDate, 'start date');
      if (old.generatedCount && startDate !== old.startDate) throw new Error('start date cannot change after occurrences generated');
      const endDate = input.endDate === undefined ? old.endDate : input.endDate ? validDate(input.endDate,'end date') : null;
      if (endDate && endDate < startDate) throw new Error('end date cannot precede start date');
      const dueDay = Number(input.dueDay ?? old.dueDay);
      if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) throw new Error('invalid dueDay');
      const intervalMonths = Number(input.intervalMonths ?? old.intervalMonths);
      if (!Number.isInteger(intervalMonths) || intervalMonths < 1 || intervalMonths > 12) throw new Error('invalid intervalMonths');
      const intervalDays = input.intervalDays === undefined ? old.intervalDays : input.intervalDays === null || input.intervalDays === '' ? null : Number(input.intervalDays);
      if(intervalDays!==null&&![7,14].includes(intervalDays))throw new Error('intervalDays must be 7 or 14');
      const annualAdjustmentBps = input.annualAdjustmentBps === undefined ? old.annualAdjustmentBps : Number(input.annualAdjustmentBps);
      if(!Number.isInteger(annualAdjustmentBps)||annualAdjustmentBps<0||annualAdjustmentBps>10000)throw new Error('invalid annualAdjustmentBps');
      const maxOccurrences = input.maxOccurrences === undefined ? old.maxOccurrences : input.maxOccurrences == null || input.maxOccurrences === '' ? null : Number(input.maxOccurrences);
      if (maxOccurrences != null && (!Number.isInteger(maxOccurrences) || maxOccurrences < old.generatedCount || maxOccurrences <= 0))
        throw new Error('maxOccurrences cannot be less than occurrences generated');
      const accountId = input.accountId === undefined ? old.accountId : input.accountId || null;
      const categoryId = input.categoryId === undefined ? old.categoryId : input.categoryId || null;
      const customerId = input.customerId === undefined ? old.customerId : input.customerId || null;
      const creditorId = input.creditorId === undefined ? old.creditorId : input.creditorId || null;
      if (old.kind === 'PAYABLE' && customerId) throw new Error('payable recurrence cannot reference customer');
      if (old.kind === 'RECEIVABLE' && creditorId) throw new Error('receivable recurrence cannot reference creditor');
      requireRelation('financial_accounts',accountId,'financial account');
      requireRelation('customers',customerId,'customer');
      requireRelation('creditors',creditorId,'creditor');
      validateCategory(old.kind,categoryId);
      const ruleConfig={startDate,dueDay,intervalMonths,intervalDays,amountCents,annualAdjustmentBps};
      const last=old.generatedCount?db.prepare('SELECT MAX(due_at) due FROM financial_entries WHERE recurrence_rule_id=?').get(String(id))?.due:null;
      const nextDueAt=last?schedule.nextDue(ruleConfig,last):schedule.firstDue(ruleConfig);
      const active=old.active && !(maxOccurrences!=null && old.generatedCount>=maxOccurrences) && !(endDate && nextDueAt>endDate);
      db.prepare(`UPDATE recurring_rules SET description=?,amount_cents=?,start_date=?,end_date=?,due_day=?,interval_months=?,
        interval_days=?,annual_adjustment_bps=?,max_occurrences=?,account_id=?,category_id=?,customer_id=?,creditor_id=?,notes=?,next_due_at=?,active=?,updated_at=? WHERE id=?`)
        .run(description,amountCents,startDate,endDate,dueDay,intervalMonths,intervalDays,annualAdjustmentBps,maxOccurrences,accountId,categoryId,customerId,
          creditorId,input.notes===undefined?old.notes:input.notes||null,nextDueAt,active?1:0,nowIso(),String(id));
      writeAudit(db,{action:'recurrence.update',entity:'recurring-rule',entityId:String(id),actor,
        context:{before:{amountCents:old.amountCents,dueDay:old.dueDay,nextDueAt:old.nextDueAt},
          after:{amountCents,dueDay,nextDueAt}}},nowIso);
      return mapRule(db.prepare('SELECT * FROM recurring_rules WHERE id=?').get(String(id)));
    });
  }
  function listRules({ includeInactive = true } = {}) { return db.prepare(`SELECT * FROM recurring_rules${includeInactive ? '' : ' WHERE active=1'} ORDER BY active DESC,next_due_at,description`).all().map(mapRule); }
  function setRuleActive(id, active, actor = null) {
    const row=db.prepare('SELECT * FROM recurring_rules WHERE id=?').get(String(id));
    if(!row)throw new Error('recurring rule not found');
    if(active && lifecycleStatus(row)==='COMPLETED')throw new Error('recorrencia concluida: ajuste o limite ou a data final antes de reativar');
    if(Boolean(row.active)===Boolean(active))return mapRule(row);
    const timestamp=nowIso();
    db.prepare('UPDATE recurring_rules SET active=?,updated_at=? WHERE id=?').run(active?1:0,timestamp,String(id));
    writeAudit(db,{action:active?'recurrence.enable':'recurrence.pause',entity:'recurring-rule',entityId:String(id),actor,context:{}},nowIso);
    return mapRule(db.prepare('SELECT * FROM recurring_rules WHERE id=?').get(String(id)));
  }
  function generateDue({ asOf = localDay(nowIso()), actor = null } = {}) {
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
            generated.push(finance.createEntry({ kind: rule.kind, description: rule.description, categoryId: rule.category_id, accountId: rule.account_id, customerId: rule.customer_id, creditorId: rule.creditor_id, amountCents: schedule.amountAtDue({startDate:rule.start_date,dueDay:rule.due_day,intervalMonths:rule.interval_months,intervalDays:rule.interval_days,amountCents:Number(rule.amount_cents),annualAdjustmentBps:Number(rule.annual_adjustment_bps||0)}, rule.next_due_at), issueAt: rule.next_due_at, dueAt: rule.next_due_at, notes: rule.notes, sourceType: 'recurring_rule', sourceId: rule.id, recurrenceRuleId: rule.id, recurrenceKey: key }, actor));
          }
          const count = Number(rule.generated_count) + 1;
          const next = schedule.nextDue({startDate:rule.start_date,dueDay:rule.due_day,intervalMonths:rule.interval_months,intervalDays:rule.interval_days},rule.next_due_at);
          const shouldStop = (rule.max_occurrences != null && count >= rule.max_occurrences) || (rule.end_date && next > rule.end_date);
          db.prepare('UPDATE recurring_rules SET generated_count=?,next_due_at=?,active=?,updated_at=? WHERE id=?').run(count, next, shouldStop ? 0 : 1, nowIso(), rule.id);
          rule = db.prepare('SELECT * FROM recurring_rules WHERE id=?').get(rule.id);
        }
      }
      if (generated.length) writeAudit(db, { action: 'recurrence.generate', entity: 'recurring-rule', entityId: null, actor, context: { asOf: limit, generated: generated.length } }, nowIso);
      return generated;
    });
  }
  // Somente previsoes: nao grava entradas e nunca altera saldos realizados.
  function listUpcoming({from=localDay(nowIso()),to,limit=2000}={}){
    const start=validDate(from,'forecast start');
    const horizon=validDate(to||schedule.addMonthsClamped(start,12,Number(start.slice(-2))),'forecast end');
    if(horizon<start)throw new Error('forecast end before start');
    if(Number(horizon.slice(0,4))-Number(start.slice(0,4))>5)throw new Error('forecast horizon exceeds 5 years');
    const result=[];
    for(const rule of listRules({includeInactive:false})){
      for(const occurrence of schedule.forecastRule(rule,rule,{from:start,to:horizon,limit:Math.min(10000,Number(limit))})){
        result.push({ruleId:rule.id,kind:rule.kind,description:rule.description,dueAt:occurrence.dueAt,
          amountCents:occurrence.amountCents,status:'FORECAST',accountId:rule.accountId,categoryId:rule.categoryId});
      }
    }
    return result.sort((a,b)=>a.dueAt.localeCompare(b.dueAt)||a.ruleId.localeCompare(b.ruleId)).slice(0,Math.min(10000,Number(limit)));
  }
  function previewRule(input={}){
    const spec={startDate:validDate(input.startDate,'start date'),dueDay:Number(input.dueDay),
      intervalDays:input.intervalDays==null?null:Number(input.intervalDays),
      intervalMonths:Number(input.intervalMonths??1),amountCents:assertPositiveCents(Number(input.amountCents)),
      annualAdjustmentBps:Number(input.annualAdjustmentBps??0)};
    const due=schedule.firstDue(spec);
    return schedule.forecastRule(spec,{nextDueAt:due,generatedCount:0,maxOccurrences:input.maxOccurrences||null,
      endDate:input.endDate||null,active:true},{from:spec.startDate,to:schedule.addMonthsClamped(spec.startDate,36,Number(spec.startDate.slice(-2))),limit:3});
  }
  return { createRule, updateRule, listRules, setRuleActive, generateDue, listUpcoming, previewRule };
}

module.exports = { createRecurrenceService, addMonths, firstDue };
