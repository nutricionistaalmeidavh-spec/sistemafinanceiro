'use strict';

const { randomUUID } = require('node:crypto');
const { writeAudit } = require('./audit.cjs');

function integer(value, label, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new TypeError(`${label} must be an integer`);
  return number;
}
function required(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new TypeError(`${label} is required`);
  return text;
}
function optional(value) { const text = String(value ?? '').trim(); return text || null; }
function isoDate(value, label = 'date') {
  const text = required(value, label);
  if (!Number.isFinite(Date.parse(text))) throw new TypeError(`invalid ${label}`);
  return text;
}
function withTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
}
function normalizeAllocations(totalCents, allocations = []) {
  const total = integer(totalCents, 'totalCents', { min: 1 });
  if (!Array.isArray(allocations) || allocations.length === 0) throw new TypeError('at least one allocation is required');
  const ids = new Set();
  for (const row of allocations) {
    const id = required(row?.costCenterId, 'costCenterId');
    if (ids.has(id)) throw new Error('duplicate cost center allocation');
    ids.add(id);
  }
  const explicit = allocations.every((row) => row.amountCents != null);
  const percent = allocations.every((row) => row.percentage != null || row.percentageBasisPoints != null);
  if (!explicit && !percent) throw new TypeError('allocations must use either amountCents or percentage');
  if (explicit) {
    const amounts = allocations.map((row) => integer(row.amountCents, 'amountCents', { min: 1 }));
    if (amounts.reduce((sum, value) => sum + value, 0) !== total) throw new Error('allocation values must equal entry amount');
    let bpUsed = 0;
    return allocations.map((row, index) => {
      const amountCents = amounts[index];
      const percentageBasisPoints = index === allocations.length - 1 ? 10000 - bpUsed : Math.round((amountCents / total) * 10000);
      bpUsed += percentageBasisPoints;
      return Object.freeze({ costCenterId: required(row.costCenterId, 'costCenterId'), amountCents, percentageBasisPoints });
    });
  }
  const basis = allocations.map((row) => row.percentageBasisPoints != null
    ? integer(row.percentageBasisPoints, 'percentageBasisPoints', { min: 1, max: 10000 })
    : Math.round(Number(row.percentage) * 100));
  if (basis.some((value) => !Number.isSafeInteger(value) || value <= 0) || basis.reduce((sum, value) => sum + value, 0) !== 10000) {
    throw new Error('allocation percentages must equal 100%');
  }
  const raw = basis.map((bp) => (total * bp) / 10000);
  const amounts = raw.map(Math.floor);
  let remaining = total - amounts.reduce((sum, value) => sum + value, 0);
  const order = raw.map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0; i < remaining; i += 1) amounts[order[i % order.length].index] += 1;
  return allocations.map((row, index) => Object.freeze({ costCenterId: required(row.costCenterId, 'costCenterId'), amountCents: amounts[index], percentageBasisPoints: basis[index] }));
}
function projectSeries({ openingBalanceCents = 0, monthly = [], adjustments = [] } = {}) {
  let balance = integer(openingBalanceCents, 'openingBalanceCents');
  const adjustmentMap = new Map();
  for (const item of adjustments || []) {
    const month = required(item.month, 'adjustment month');
    adjustmentMap.set(month, (adjustmentMap.get(month) || 0) + integer(item.amountCents, 'adjustment amountCents'));
  }
  return [...monthly].sort((a, b) => String(a.month).localeCompare(String(b.month))).map((row) => {
    const month = required(row.month, 'month');
    const baseNetCents = integer(row.netCents || 0, 'netCents');
    const adjustmentCents = adjustmentMap.get(month) || 0;
    const opening = balance;
    balance += baseNetCents + adjustmentCents;
    return Object.freeze({ month, openingBalanceCents: opening, baseNetCents, adjustmentCents, netCents: baseNetCents + adjustmentCents, closingBalanceCents: balance });
  });
}
function validateBulkSelection(entryIds = []) {
  if (!Array.isArray(entryIds) || entryIds.length === 0) throw new TypeError('entryIds are required');
  const normalized = [];
  const seen = new Set();
  for (const value of entryIds) {
    if (typeof value !== 'string' || !value.trim()) throw new TypeError('invalid entry id');
    const id = value.trim();
    if (!seen.has(id)) { seen.add(id); normalized.push(id); }
  }
  return normalized;
}
function monthKey(value) { return String(value).slice(0, 7); }
function addMonths(dateText, months) {
  const date = new Date(`${String(dateText).slice(0, 10)}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

function createPlanningService({ db, cashflow = null, now = () => new Date().toISOString(), idFactory = (prefix) => `${prefix}-${randomUUID()}` } = {}) {
  if (!db) throw new TypeError('Database is required.');
  const nowIso = () => String(now());
  const requireEntry = (id) => { const row = db.prepare('SELECT * FROM financial_entries WHERE id=?').get(required(id, 'entryId')); if (!row) throw new Error('financial entry not found'); return row; };
  const requireCenter = (id) => { const row = db.prepare('SELECT * FROM cost_centers WHERE id=? AND active=1').get(required(id, 'costCenterId')); if (!row) throw new Error('cost center not found or inactive'); return row; };
  const requireTag = (id) => { const row = db.prepare('SELECT * FROM tags WHERE id=? AND active=1').get(required(id, 'tagId')); if (!row) throw new Error('tag not found or inactive'); return row; };

  function listCostCenters({ includeInactive = false } = {}) {
    return db.prepare(`SELECT * FROM cost_centers${includeInactive ? '' : ' WHERE active=1'} ORDER BY code COLLATE NOCASE,name COLLATE NOCASE`).all();
  }
  function saveCostCenter(input = {}, actor = null) {
    const timestamp = nowIso(); const id = optional(input.id) || idFactory('cc'); const code = required(input.code, 'code'); const name = required(input.name, 'name');
    const parentId = optional(input.parentId); if (parentId) { requireCenter(parentId); if (parentId === id) throw new Error('cost center cannot be its own parent'); }
    const existing = db.prepare('SELECT id FROM cost_centers WHERE id=?').get(id);
    if (existing) db.prepare('UPDATE cost_centers SET code=?,name=?,parent_id=?,active=?,updated_at=? WHERE id=?').run(code, name, parentId, input.active === false ? 0 : 1, timestamp, id);
    else db.prepare('INSERT INTO cost_centers(id,code,name,parent_id,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(id, code, name, parentId, input.active === false ? 0 : 1, timestamp, timestamp);
    writeAudit(db, { action: existing ? 'planning.cost-center.update' : 'planning.cost-center.create', entity: 'cost-center', entityId: id, actor, context: { code, parentId } }, nowIso);
    return db.prepare('SELECT * FROM cost_centers WHERE id=?').get(id);
  }
  function listTags({ includeInactive = false } = {}) { return db.prepare(`SELECT * FROM tags${includeInactive ? '' : ' WHERE active=1'} ORDER BY name COLLATE NOCASE`).all(); }
  function saveTag(input = {}, actor = null) {
    const timestamp = nowIso(); const id = optional(input.id) || idFactory('tag'); const name = required(input.name, 'name'); const existing = db.prepare('SELECT id FROM tags WHERE id=?').get(id);
    if (existing) db.prepare('UPDATE tags SET name=?,active=?,updated_at=? WHERE id=?').run(name, input.active === false ? 0 : 1, timestamp, id);
    else db.prepare('INSERT INTO tags(id,name,active,created_at,updated_at) VALUES (?,?,?,?,?)').run(id, name, input.active === false ? 0 : 1, timestamp, timestamp);
    writeAudit(db, { action: existing ? 'planning.tag.update' : 'planning.tag.create', entity: 'tag', entityId: id, actor }, nowIso);
    return db.prepare('SELECT * FROM tags WHERE id=?').get(id);
  }
  function getEntryAllocations(entryId) {
    requireEntry(entryId);
    return db.prepare(`SELECT ea.entry_id entryId,ea.cost_center_id costCenterId,cc.code,cc.name,ea.amount_cents amountCents,ea.percentage_basis_points percentageBasisPoints
      FROM entry_allocations ea JOIN cost_centers cc ON cc.id=ea.cost_center_id WHERE ea.entry_id=? ORDER BY cc.code`).all(String(entryId));
  }
  function setEntryAllocations(entryId, allocations, actor = null) {
    const entry = requireEntry(entryId); const normalized = normalizeAllocations(Number(entry.amount_cents), allocations); const timestamp = nowIso(); normalized.forEach((row) => requireCenter(row.costCenterId));
    return withTransaction(db, () => {
      db.prepare('DELETE FROM entry_allocations WHERE entry_id=?').run(entry.id);
      const insert = db.prepare('INSERT INTO entry_allocations(entry_id,cost_center_id,amount_cents,percentage_basis_points,created_at,updated_at) VALUES (?,?,?,?,?,?)');
      normalized.forEach((row) => insert.run(entry.id, row.costCenterId, row.amountCents, row.percentageBasisPoints, timestamp, timestamp));
      writeAudit(db, { action: 'planning.allocations.set', entity: 'financial-entry', entityId: entry.id, actor, context: { allocations: normalized } }, nowIso);
      return getEntryAllocations(entry.id);
    });
  }
  function getEntryTags(entryId) { requireEntry(entryId); return db.prepare(`SELECT t.id,t.name FROM entry_tags et JOIN tags t ON t.id=et.tag_id WHERE et.entry_id=? ORDER BY t.name COLLATE NOCASE`).all(String(entryId)); }
  function setEntryTags(entryId, tagIds = [], actor = null) {
    const entry = requireEntry(entryId); const ids = [...new Set((tagIds || []).map((id) => required(id, 'tagId')))]; ids.forEach(requireTag); const timestamp = nowIso();
    return withTransaction(db, () => {
      db.prepare('DELETE FROM entry_tags WHERE entry_id=?').run(entry.id);
      const insert = db.prepare('INSERT INTO entry_tags(entry_id,tag_id,created_at) VALUES (?,?,?)'); ids.forEach((id) => insert.run(entry.id, id, timestamp));
      writeAudit(db, { action: 'planning.tags.set', entity: 'financial-entry', entityId: entry.id, actor, context: { tagIds: ids } }, nowIso);
      return getEntryTags(entry.id);
    });
  }
  function listScenarios({ includeInactive = false } = {}) { return db.prepare(`SELECT * FROM budget_scenarios${includeInactive ? '' : ' WHERE active=1'} ORDER BY CASE kind WHEN 'BASE' THEN 0 WHEN 'OPTIMISTIC' THEN 1 WHEN 'PESSIMISTIC' THEN 2 ELSE 3 END,name`).all(); }
  function saveScenario(input = {}, actor = null) {
    const timestamp = nowIso(); const id = optional(input.id) || idFactory('scenario'); const name = required(input.name, 'name'); const kind = String(input.kind || 'CUSTOM').toUpperCase(); if (!['BASE','OPTIMISTIC','PESSIMISTIC','CUSTOM'].includes(kind)) throw new Error('invalid scenario kind');
    const existing = db.prepare('SELECT id FROM budget_scenarios WHERE id=?').get(id);
    if (existing) db.prepare('UPDATE budget_scenarios SET name=?,kind=?,active=?,updated_at=? WHERE id=?').run(name, kind, input.active === false ? 0 : 1, timestamp, id);
    else db.prepare('INSERT INTO budget_scenarios(id,name,kind,active,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(id, name, kind, input.active === false ? 0 : 1, timestamp, timestamp);
    writeAudit(db, { action: existing ? 'planning.scenario.update' : 'planning.scenario.create', entity: 'budget-scenario', entityId: id, actor }, nowIso);
    return db.prepare('SELECT * FROM budget_scenarios WHERE id=?').get(id);
  }
  function listBudgets(filters = {}) {
    const where = []; const params = [];
    if (filters.scenarioId) { where.push('b.scenario_id=?'); params.push(String(filters.scenarioId)); }
    if (filters.year) { where.push('b.year=?'); params.push(integer(filters.year, 'year')); }
    if (filters.month) { where.push('b.month=?'); params.push(integer(filters.month, 'month', { min: 1, max: 12 })); }
    return db.prepare(`SELECT b.*,bs.name scenario_name,fc.name category_name,cc.name cost_center_name FROM budgets b JOIN budget_scenarios bs ON bs.id=b.scenario_id LEFT JOIN financial_categories fc ON fc.id=b.category_id LEFT JOIN cost_centers cc ON cc.id=b.cost_center_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY b.year,b.month,b.nature,fc.name,cc.name`).all(...params);
  }
  function saveBudget(input = {}, actor = null) {
    const scenarioId = required(input.scenarioId || 'base', 'scenarioId'); if (!db.prepare('SELECT id FROM budget_scenarios WHERE id=? AND active=1').get(scenarioId)) throw new Error('scenario not found or inactive');
    const year = integer(input.year, 'year', { min: 2000, max: 2200 }); const month = integer(input.month, 'month', { min: 1, max: 12 }); const nature = String(input.nature || '').toUpperCase(); if (!['REVENUE','EXPENSE'].includes(nature)) throw new Error('invalid budget nature');
    const amountCents = integer(input.amountCents, 'amountCents', { min: 0 }); const categoryId = optional(input.categoryId); const costCenterId = optional(input.costCenterId); if (costCenterId) requireCenter(costCenterId);
    if (categoryId && !db.prepare('SELECT id FROM financial_categories WHERE id=? AND active=1').get(categoryId)) throw new Error('category not found or inactive');
    const timestamp = nowIso(); const existing = db.prepare('SELECT id FROM budgets WHERE scenario_id=? AND year=? AND month=? AND nature=? AND category_id IS ? AND cost_center_id IS ?').get(scenarioId, year, month, nature, categoryId, costCenterId); const id = existing?.id || idFactory('budget');
    if (existing) db.prepare('UPDATE budgets SET amount_cents=?,notes=?,updated_at=? WHERE id=?').run(amountCents, optional(input.notes), timestamp, id);
    else db.prepare('INSERT INTO budgets(id,scenario_id,year,month,nature,amount_cents,category_id,cost_center_id,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id, scenarioId, year, month, nature, amountCents, categoryId, costCenterId, optional(input.notes), timestamp, timestamp);
    writeAudit(db, { action: existing ? 'planning.budget.update' : 'planning.budget.create', entity: 'budget', entityId: id, actor, context: { scenarioId, year, month, nature, amountCents, categoryId, costCenterId } }, nowIso);
    return db.prepare('SELECT * FROM budgets WHERE id=?').get(id);
  }
  function listGoals({ activeOnly = true } = {}) { return db.prepare(`SELECT * FROM financial_goals${activeOnly ? ' WHERE active=1' : ''} ORDER BY period_start,name`).all(); }
  function saveGoal(input = {}, actor = null) {
    const id = optional(input.id) || idFactory('goal'); const name = required(input.name, 'name'); const metric = String(input.metric || '').toUpperCase(); if (!['REVENUE','EXPENSE','BALANCE','RESULT'].includes(metric)) throw new Error('invalid goal metric'); const targetCents = integer(input.targetCents, 'targetCents'); const start = isoDate(input.periodStart, 'periodStart'); const end = isoDate(input.periodEnd, 'periodEnd'); if (end < start) throw new Error('goal periodEnd must not precede periodStart'); const categoryId = optional(input.categoryId); const costCenterId = optional(input.costCenterId); if (costCenterId) requireCenter(costCenterId); const timestamp = nowIso(); const existing = db.prepare('SELECT id FROM financial_goals WHERE id=?').get(id);
    if (existing) db.prepare('UPDATE financial_goals SET name=?,metric=?,target_cents=?,period_start=?,period_end=?,category_id=?,cost_center_id=?,active=?,updated_at=? WHERE id=?').run(name, metric, targetCents, start, end, categoryId, costCenterId, input.active === false ? 0 : 1, timestamp, id);
    else db.prepare('INSERT INTO financial_goals(id,name,metric,target_cents,period_start,period_end,category_id,cost_center_id,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id, name, metric, targetCents, start, end, categoryId, costCenterId, input.active === false ? 0 : 1, timestamp, timestamp);
    writeAudit(db, { action: existing ? 'planning.goal.update' : 'planning.goal.create', entity: 'financial-goal', entityId: id, actor }, nowIso);
    return db.prepare('SELECT * FROM financial_goals WHERE id=?').get(id);
  }
  function compareBudget(filters = {}) {
    const budgets = listBudgets(filters); const entries = db.prepare(`SELECT fe.*,fc.nature category_nature FROM financial_entries fe LEFT JOIN financial_categories fc ON fc.id=fe.category_id WHERE fe.status<>'CANCELLED'`).all();
    const settlements = db.prepare(`SELECT fs.* FROM financial_settlements fs WHERE fs.reversed_at IS NULL`).all(); const byEntry = new Map(); settlements.forEach((row) => { const list = byEntry.get(row.entry_id) || []; list.push(row); byEntry.set(row.entry_id, list); });
    const allocations = db.prepare('SELECT * FROM entry_allocations').all(); const allocByEntry = new Map(); allocations.forEach((row) => { const list = allocByEntry.get(row.entry_id) || []; list.push(row); allocByEntry.set(row.entry_id, list); });
    return budgets.map((budget) => {
      const period = `${budget.year}-${String(budget.month).padStart(2,'0')}`; let actualCents = 0; let committedCents = 0;
      for (const entry of entries) {
        const nature = entry.kind === 'RECEIVABLE' ? 'REVENUE' : 'EXPENSE'; if (nature !== budget.nature) continue; if (budget.category_id && entry.category_id !== budget.category_id) continue;
        let share = 1; if (budget.cost_center_id) { const allocation = (allocByEntry.get(entry.id) || []).find((row) => row.cost_center_id === budget.cost_center_id); if (!allocation) continue; share = Number(allocation.amount_cents) / Number(entry.amount_cents); }
        for (const settlement of byEntry.get(entry.id) || []) if (monthKey(settlement.occurred_at) === period) actualCents += Math.round(Number(settlement.amount_cents) * share);
        if (monthKey(entry.due_at) === period && ['OPEN','PARTIAL'].includes(entry.status)) {
          const paid = (byEntry.get(entry.id) || []).reduce((sum, row) => sum + Number(row.amount_cents), 0); committedCents += Math.max(0, Math.round((Number(entry.amount_cents) - paid) * share));
        }
      }
      const plannedCents = Number(budget.amount_cents); return { budgetId: budget.id, scenarioId: budget.scenario_id, year: budget.year, month: budget.month, nature: budget.nature, categoryId: budget.category_id, costCenterId: budget.cost_center_id, plannedCents, actualCents, committedCents, varianceCents: plannedCents - actualCents, projectedCents: actualCents + committedCents };
    });
  }
  function addAttachment(entryId, input = {}, actor = null) {
    const entry = requireEntry(entryId); const id = optional(input.id) || idFactory('attachment'); const workspacePath = required(input.workspacePath, 'workspacePath'); if (workspacePath.includes('..') || workspacePath.startsWith('/') || /^[A-Za-z]:/.test(workspacePath)) throw new Error('attachment must reference a relative workspace path'); const filename = required(input.filename || workspacePath.split('/').pop(), 'filename'); const timestamp = nowIso();
    db.prepare('INSERT INTO entry_attachments(id,entry_id,workspace_path,filename,mime_type,extracted_text,review_status,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, entry.id, workspacePath, filename, optional(input.mimeType), optional(input.extractedText), 'PENDING', actor?.id || null, timestamp, timestamp);
    writeAudit(db, { action: 'planning.attachment.add', entity: 'financial-entry', entityId: entry.id, actor, context: { attachmentId: id, workspacePath, hasExtractedText: Boolean(optional(input.extractedText)) } }, nowIso);
    return db.prepare('SELECT * FROM entry_attachments WHERE id=?').get(id);
  }
  function listAttachments(entryId) { requireEntry(entryId); return db.prepare('SELECT * FROM entry_attachments WHERE entry_id=? ORDER BY created_at DESC').all(String(entryId)); }
  function reviewAttachment(id, actor = null) { const timestamp = nowIso(); const result = db.prepare("UPDATE entry_attachments SET review_status='REVIEWED',updated_at=? WHERE id=?").run(timestamp, required(id, 'attachmentId')); if (!result.changes) throw new Error('attachment not found'); writeAudit(db, { action: 'planning.attachment.review', entity: 'entry-attachment', entityId: id, actor }, nowIso); return db.prepare('SELECT * FROM entry_attachments WHERE id=?').get(id); }
  function listApprovalPolicies({ includeInactive = false } = {}) { return db.prepare(`SELECT * FROM approval_policies${includeInactive ? '' : ' WHERE active=1'} ORDER BY min_amount_cents DESC,name`).all(); }
  function saveApprovalPolicy(input = {}, actor = null) {
    const id = optional(input.id) || idFactory('policy'); const name = required(input.name, 'name'); const minAmountCents = integer(input.minAmountCents || 0, 'minAmountCents', { min: 0 }); const requiredApprovals = integer(input.requiredApprovals || 1, 'requiredApprovals', { min: 1, max: 20 }); const roles = [...new Set((input.approverRoles || []).map((role) => String(role).toUpperCase()))]; const timestamp = nowIso(); const existing = db.prepare('SELECT id FROM approval_policies WHERE id=?').get(id);
    if (existing) db.prepare('UPDATE approval_policies SET name=?,min_amount_cents=?,required_approvals=?,approver_roles_json=?,active=?,updated_at=? WHERE id=?').run(name, minAmountCents, requiredApprovals, JSON.stringify(roles), input.active === false ? 0 : 1, timestamp, id);
    else db.prepare('INSERT INTO approval_policies(id,name,min_amount_cents,required_approvals,approver_roles_json,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id, name, minAmountCents, requiredApprovals, JSON.stringify(roles), input.active === false ? 0 : 1, timestamp, timestamp);
    writeAudit(db, { action: existing ? 'planning.approval-policy.update' : 'planning.approval-policy.create', entity: 'approval-policy', entityId: id, actor }, nowIso); return db.prepare('SELECT * FROM approval_policies WHERE id=?').get(id);
  }
  function resolvePolicy(entry, policyId = null) { if (policyId) { const row = db.prepare('SELECT * FROM approval_policies WHERE id=? AND active=1').get(String(policyId)); if (!row) throw new Error('approval policy not found or inactive'); return row; } return db.prepare('SELECT * FROM approval_policies WHERE active=1 AND min_amount_cents<=? ORDER BY min_amount_cents DESC LIMIT 1').get(Number(entry.amount_cents)) || null; }
  function requestApproval(input = {}, actor = null) {
    const entry = input.entryId ? requireEntry(input.entryId) : null; const batchKey = optional(input.batchKey); if (!entry && !batchKey) throw new Error('entryId or batchKey is required'); const policy = entry ? resolvePolicy(entry, input.policyId) : (input.policyId ? resolvePolicy({ amount_cents: 0 }, input.policyId) : null); const id = optional(input.id) || idFactory('approval'); const timestamp = nowIso(); const requiredApprovals = policy ? Number(policy.required_approvals) : integer(input.requiredApprovals || 1, 'requiredApprovals', { min: 1, max: 20 });
    db.prepare('INSERT INTO approval_requests(id,entry_id,batch_key,policy_id,requested_by,status,required_approvals,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id, entry?.id || null, batchKey, policy?.id || null, actor?.id || null, 'PENDING', requiredApprovals, timestamp, timestamp); writeAudit(db, { action: 'planning.approval.request', entity: 'approval-request', entityId: id, actor, context: { entryId: entry?.id || null, batchKey, policyId: policy?.id || null } }, nowIso); return db.prepare('SELECT * FROM approval_requests WHERE id=?').get(id);
  }
  function decideApproval(requestId, input = {}, actor = null) {
    if (!actor?.id) throw new Error('actor is required'); const request = db.prepare('SELECT * FROM approval_requests WHERE id=?').get(required(requestId, 'requestId')); if (!request) throw new Error('approval request not found'); if (request.status !== 'PENDING') throw new Error('approval request is already closed'); const decision = String(input.decision || '').toUpperCase(); if (!['APPROVED','REJECTED'].includes(decision)) throw new Error('invalid approval decision'); const policy = request.policy_id ? db.prepare('SELECT * FROM approval_policies WHERE id=?').get(request.policy_id) : null; const roles = policy ? JSON.parse(policy.approver_roles_json || '[]') : []; if (roles.length && !roles.includes(String(actor.role || '').toUpperCase())) throw new Error('actor role cannot approve this request'); const timestamp = nowIso();
    return withTransaction(db, () => { db.prepare('INSERT INTO approval_decisions(id,request_id,actor_id,decision,comment,created_at) VALUES (?,?,?,?,?,?)').run(idFactory('decision'), request.id, String(actor.id), decision, optional(input.comment), timestamp); const approvals = db.prepare("SELECT COUNT(*) count FROM approval_decisions WHERE request_id=? AND decision='APPROVED'").get(request.id).count; const rejected = db.prepare("SELECT COUNT(*) count FROM approval_decisions WHERE request_id=? AND decision='REJECTED'").get(request.id).count; const status = rejected > 0 ? 'REJECTED' : approvals >= Number(request.required_approvals) ? 'APPROVED' : 'PENDING'; db.prepare('UPDATE approval_requests SET status=?,updated_at=? WHERE id=?').run(status, timestamp, request.id); writeAudit(db, { action: 'planning.approval.decide', entity: 'approval-request', entityId: request.id, actor, context: { decision, status } }, nowIso); return db.prepare('SELECT * FROM approval_requests WHERE id=?').get(request.id); });
  }
  function listApprovalRequests({ status = null } = {}) { return db.prepare(`SELECT ar.*,fe.description entry_description,fe.amount_cents FROM approval_requests ar LEFT JOIN financial_entries fe ON fe.id=ar.entry_id${status ? ' WHERE ar.status=?' : ''} ORDER BY ar.created_at DESC`).all(...(status ? [String(status).toUpperCase()] : [])); }
  function runBulkOperation(input = {}, actor = null) {
    const ids = validateBulkSelection(input.entryIds); const placeholders = ids.map(() => '?').join(','); const rows = db.prepare(`SELECT * FROM financial_entries WHERE id IN (${placeholders})`).all(...ids); if (rows.length !== ids.length) throw new Error('one or more financial entries were not found'); const action = String(input.action || '').toUpperCase(); const payload = input.payload || {}; const timestamp = nowIso();
    if (!['CATEGORY','TAG','COST_CENTER','APPROVAL'].includes(action)) throw new Error('unsupported bulk action');
    if (action === 'CATEGORY' && !db.prepare('SELECT id FROM financial_categories WHERE id=? AND active=1').get(required(payload.categoryId, 'categoryId'))) throw new Error('category not found or inactive');
    if (action === 'TAG') requireTag(payload.tagId); if (action === 'COST_CENTER') requireCenter(payload.costCenterId); if (action === 'APPROVAL' && payload.policyId && !db.prepare('SELECT id FROM approval_policies WHERE id=? AND active=1').get(String(payload.policyId))) throw new Error('approval policy not found or inactive');
    return withTransaction(db, () => {
      for (const entry of rows) {
        if (action === 'CATEGORY') db.prepare('UPDATE financial_entries SET category_id=?,updated_at=? WHERE id=?').run(String(payload.categoryId), timestamp, entry.id);
        if (action === 'TAG') db.prepare('INSERT OR IGNORE INTO entry_tags(entry_id,tag_id,created_at) VALUES (?,?,?)').run(entry.id, String(payload.tagId), timestamp);
        if (action === 'COST_CENTER') { db.prepare('DELETE FROM entry_allocations WHERE entry_id=?').run(entry.id); db.prepare('INSERT INTO entry_allocations(entry_id,cost_center_id,amount_cents,percentage_basis_points,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(entry.id, String(payload.costCenterId), Number(entry.amount_cents), 10000, timestamp, timestamp); }
        if (action === 'APPROVAL') { const policy = resolvePolicy(entry, payload.policyId); const approvalId = idFactory('approval'); db.prepare('INSERT INTO approval_requests(id,entry_id,batch_key,policy_id,requested_by,status,required_approvals,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(approvalId, entry.id, optional(payload.batchKey), policy?.id || null, actor?.id || null, 'PENDING', policy ? Number(policy.required_approvals) : 1, timestamp, timestamp); }
      }
      writeAudit(db, { action: `planning.bulk.${action.toLowerCase()}`, entity: 'financial-entry-batch', entityId: optional(input.batchKey), actor, context: { entryIds: ids, payload } }, nowIso); return { action, count: rows.length, entryIds: ids };
    });
  }
  function getProjection({ months = 12, adjustments = [] } = {}) {
    const count = integer(months, 'months', { min: 1, max: 60 }); const today = nowIso().slice(0, 10); const monthly = new Map();
    for (let i = 0; i < count; i += 1) monthly.set(monthKey(addMonths(today, i)), 0);
    const settlements = db.prepare('SELECT entry_id,SUM(amount_cents) paid FROM financial_settlements WHERE reversed_at IS NULL GROUP BY entry_id').all(); const paid = new Map(settlements.map((row) => [row.entry_id, Number(row.paid)]));
    const open = db.prepare("SELECT * FROM financial_entries WHERE status IN ('OPEN','PARTIAL') AND due_at>=? ORDER BY due_at").all(today);
    for (const entry of open) { const month = monthKey(entry.due_at); if (!monthly.has(month)) continue; const outstanding = Math.max(0, Number(entry.amount_cents) - (paid.get(entry.id) || 0)); monthly.set(month, monthly.get(month) + (entry.kind === 'RECEIVABLE' ? outstanding : -outstanding)); }
    const rules = db.prepare('SELECT * FROM recurring_rules WHERE active=1').all();
    for (const rule of rules) { let due = String(rule.next_due_at).slice(0,10); let generated = Number(rule.generated_count || 0); while (monthKey(due) <= [...monthly.keys()].at(-1)) { const month = monthKey(due); if (monthly.has(month)) monthly.set(month, monthly.get(month) + (rule.kind === 'RECEIVABLE' ? Number(rule.amount_cents) : -Number(rule.amount_cents))); generated += 1; if (rule.max_occurrences && generated >= Number(rule.max_occurrences)) break; due = addMonths(due, Number(rule.interval_months || 1)); if (rule.end_date && due > String(rule.end_date).slice(0,10)) break; } }
    const openingBalanceCents = cashflow ? cashflow.getAccountBalances({ asOf: today }).reduce((sum, row) => sum + Number(row.balanceCents), 0) : 0;
    return projectSeries({ openingBalanceCents, monthly: [...monthly].map(([month, netCents]) => ({ month, netCents })), adjustments });
  }

  return { listCostCenters, saveCostCenter, listTags, saveTag, getEntryAllocations, setEntryAllocations, getEntryTags, setEntryTags, listScenarios, saveScenario, listBudgets, saveBudget, listGoals, saveGoal, compareBudget, addAttachment, listAttachments, reviewAttachment, listApprovalPolicies, saveApprovalPolicy, requestApproval, decideApproval, listApprovalRequests, runBulkOperation, getProjection };
}

module.exports = { createPlanningService, normalizeAllocations, projectSeries, validateBulkSelection };
