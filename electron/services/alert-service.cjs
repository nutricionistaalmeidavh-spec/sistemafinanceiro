'use strict';

const { randomUUID } = require('node:crypto');
const { writeAudit } = require('./audit.cjs');

const SEVERITY_ORDER = Object.freeze({ CRITICAL: 0, WARNING: 1, INFO: 2 });
function dateOnly(value) {
  const text = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(`${text}T00:00:00Z`))) throw new Error('invalid alert date');
  return text;
}
function assertThreshold(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('thresholdCents must be a non-negative integer in cents');
  return value;
}

function createAlertService({ db, finance, cashflow, now = () => new Date().toISOString(), idFactory = () => `alert-${randomUUID()}` } = {}) {
  if (!db || !finance || !cashflow) throw new TypeError('db, finance and cashflow are required');
  const nowIso = () => String(now());

  function stateFor(userId) {
    if (!userId) return new Map();
    return new Map(db.prepare('SELECT alert_key,state FROM alert_states WHERE user_id=?').all(String(userId)).map((row) => [row.alert_key, row.state]));
  }

  function listAlerts({ userId = '', asOf = nowIso().slice(0, 10), includeDismissed = false } = {}) {
    const day = dateOnly(asOf);
    const items = [];
    for (const entry of finance.listEntries({ asOf: day })) {
      if (!['OPEN', 'PARTIAL'].includes(entry.status)) continue;
      if (entry.dueAt === day) {
        items.push({ key: `entry:${entry.id}:due-today`, type: 'DUE_TODAY', severity: 'WARNING', title: entry.kind === 'PAYABLE' ? 'Conta vence hoje' : 'Recebimento vence hoje', body: entry.description, entityType: 'financial-entry', entityId: entry.id, amountCents: entry.openCents, dueAt: entry.dueAt });
      } else if (entry.dueAt < day) {
        items.push({ key: `entry:${entry.id}:overdue`, type: 'OVERDUE', severity: 'CRITICAL', title: entry.kind === 'PAYABLE' ? 'Conta atrasada' : 'Recebimento atrasado', body: entry.description, entityType: 'financial-entry', entityId: entry.id, amountCents: entry.openCents, dueAt: entry.dueAt });
      }
    }

    const balances = new Map(cashflow.getAccountBalances({ asOf: day }).map((item) => [item.id, item]));
    const thresholds = db.prepare(`SELECT s.*,a.name account_name FROM account_alert_settings s JOIN financial_accounts a ON a.id=s.account_id WHERE s.enabled=1 AND a.active=1`).all();
    for (const threshold of thresholds) {
      const account = balances.get(threshold.account_id);
      if (!account) continue;
      const limit = Number(threshold.low_balance_cents || 0);
      if (account.balanceCents < limit) {
        items.push({ key: `account:${account.id}:low-balance:${day.slice(0, 7)}`, type: 'LOW_BALANCE', severity: 'WARNING', title: 'Saldo baixo', body: account.name, entityType: 'financial-account', entityId: account.id, amountCents: account.balanceCents, thresholdCents: limit });
      }
    }

    const internal = db.prepare(`SELECT * FROM internal_alerts WHERE active=1 AND starts_at<=? AND (ends_at IS NULL OR ends_at>=?) ORDER BY created_at,id`).all(day, day);
    for (const alert of internal) {
      items.push({ key: `internal:${alert.id}`, type: 'INTERNAL', severity: alert.severity, title: alert.title, body: alert.body, entityType: 'internal-alert', entityId: alert.id, startsAt: alert.starts_at, endsAt: alert.ends_at });
    }

    const states = stateFor(userId);
    return items.map((item) => {
      const state = states.get(item.key) || null;
      return { ...item, state, read: state === 'READ' || state === 'DISMISSED', dismissed: state === 'DISMISSED' };
    }).filter((item) => includeDismissed || !item.dismissed).sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) || a.key.localeCompare(b.key));
  }

  function acknowledge(alertKey, userId, state = 'READ') {
    const key = String(alertKey || '').trim();
    const user = String(userId || '').trim();
    const normalized = String(state || '').toUpperCase();
    if (!key || !user) throw new Error('alertKey and userId are required');
    if (!['READ', 'DISMISSED'].includes(normalized)) throw new Error('alert state must be READ or DISMISSED');
    db.prepare(`INSERT INTO alert_states(user_id,alert_key,state,updated_at) VALUES (?,?,?,?)
      ON CONFLICT(user_id,alert_key) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at`).run(user, key, normalized, nowIso());
    return { alertKey: key, userId: user, state: normalized };
  }

  function saveInternalAlert(input = {}, actor = null) {
    const id = String(input.id || idFactory());
    const title = String(input.title || '').trim();
    if (!title) throw new Error('alert title is required');
    const body = String(input.body || '').trim();
    const severity = String(input.severity || 'INFO').toUpperCase();
    if (!['INFO', 'WARNING', 'CRITICAL'].includes(severity)) throw new Error('invalid alert severity');
    const startsAt = dateOnly(input.startsAt || nowIso().slice(0, 10));
    const endsAt = input.endsAt ? dateOnly(input.endsAt) : null;
    if (endsAt && endsAt < startsAt) throw new Error('alert end date cannot precede start date');
    const timestamp = nowIso();
    db.prepare(`INSERT INTO internal_alerts(id,title,body,severity,starts_at,ends_at,active,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,severity=excluded.severity,starts_at=excluded.starts_at,ends_at=excluded.ends_at,active=excluded.active,updated_at=excluded.updated_at`)
      .run(id, title, body, severity, startsAt, endsAt, input.active === false ? 0 : 1, actor?.id || null, timestamp, timestamp);
    writeAudit(db, { action: 'alert.internal.save', entity: 'internal-alert', entityId: id, actor, context: { severity, startsAt, endsAt } }, nowIso);
    return { id, title, body, severity, startsAt, endsAt, active: input.active !== false };
  }

  function setAccountThreshold(accountId, thresholdCents, actor = null, enabled = true) {
    const id = String(accountId || '').trim();
    const account = db.prepare('SELECT id,name FROM financial_accounts WHERE id=? AND active=1').get(id);
    if (!account) throw new Error('financial account not found or inactive');
    const limit = assertThreshold(thresholdCents);
    const timestamp = nowIso();
    db.prepare(`INSERT INTO account_alert_settings(account_id,low_balance_cents,enabled,updated_at) VALUES (?,?,?,?)
      ON CONFLICT(account_id) DO UPDATE SET low_balance_cents=excluded.low_balance_cents,enabled=excluded.enabled,updated_at=excluded.updated_at`)
      .run(id, limit, enabled ? 1 : 0, timestamp);
    writeAudit(db, { action: 'alert.threshold.save', entity: 'financial-account', entityId: id, actor, context: { thresholdCents: limit, enabled: Boolean(enabled) } }, nowIso);
    return { accountId: id, accountName: account.name, thresholdCents: limit, enabled: Boolean(enabled) };
  }

  function listAccountThresholds() {
    return db.prepare(`SELECT s.account_id accountId,a.name accountName,s.low_balance_cents thresholdCents,s.enabled enabled,s.updated_at updatedAt
      FROM account_alert_settings s JOIN financial_accounts a ON a.id=s.account_id ORDER BY a.name COLLATE NOCASE`).all().map((row) => ({ ...row, enabled: Boolean(row.enabled) }));
  }

  return { listAlerts, acknowledge, saveInternalAlert, setAccountThreshold, listAccountThresholds };
}

module.exports = { createAlertService };
