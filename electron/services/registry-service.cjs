'use strict';

const { randomUUID } = require('node:crypto');
const { writeAudit } = require('./audit.cjs');

function text(value) { const normalized = String(value ?? '').trim(); return normalized || null; }
function requireName(value) { const name = String(value ?? '').trim(); if (!name) throw new Error('name is required'); return name; }
function activeFlag(value) { return value === false || value === 0 ? 0 : 1; }

function createRegistryService({ db, now = () => new Date().toISOString(), idFactory = (prefix) => `${prefix}-${randomUUID()}` } = {}) {
  if (!db) throw new TypeError('Database is required.');
  const nowIso = () => String(now());

  function mapParty(row) {
    if (!row) return null;
    return { id: row.id, name: row.name, document: row.document, phone: row.phone, email: row.email, notes: row.notes, active: Boolean(row.active), createdAt: row.created_at, updatedAt: row.updated_at };
  }
  function mapCategory(row) {
    if (!row) return null;
    return { id: row.id, name: row.name, nature: row.nature, dreGroup: row.dre_group, active: Boolean(row.active), createdAt: row.created_at, updatedAt: row.updated_at };
  }
  function listParties(table, { includeInactive = false, query = '' } = {}) {
    const clauses = [];
    const params = [];
    if (!includeInactive) clauses.push('active=1');
    if (String(query).trim()) { clauses.push('(LOWER(name) LIKE ? OR LOWER(COALESCE(document,\'\')) LIKE ?)'); const q = `%${String(query).trim().toLowerCase()}%`; params.push(q, q); }
    return db.prepare(`SELECT * FROM ${table}${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''} ORDER BY name COLLATE NOCASE,id`).all(...params).map(mapParty);
  }
  function saveParty(table, prefix, entity, input, actor) {
    const name = requireName(input.name);
    const timestamp = nowIso();
    const values = [name, text(input.document), text(input.phone), text(input.email), text(input.notes), activeFlag(input.active), timestamp];
    let id = input.id ? String(input.id) : null;
    if (id) {
      const result = db.prepare(`UPDATE ${table} SET name=?,document=?,phone=?,email=?,notes=?,active=?,updated_at=? WHERE id=?`).run(...values, id);
      if (!result.changes) throw new Error(`${entity} not found`);
      writeAudit(db, { action: `${entity}.update`, entity, entityId: id, actor, context: { name } }, nowIso);
    } else {
      id = String(idFactory(prefix));
      db.prepare(`INSERT INTO ${table}(id,name,document,phone,email,notes,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(id, name, text(input.document), text(input.phone), text(input.email), text(input.notes), activeFlag(input.active), timestamp, timestamp);
      writeAudit(db, { action: `${entity}.create`, entity, entityId: id, actor, context: { name } }, nowIso);
    }
    return mapParty(db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id));
  }
  function setPartyActive(table, entity, id, active, actor) {
    const timestamp = nowIso();
    const result = db.prepare(`UPDATE ${table} SET active=?,updated_at=? WHERE id=?`).run(active ? 1 : 0, timestamp, String(id));
    if (!result.changes) throw new Error(`${entity} not found`);
    writeAudit(db, { action: active ? `${entity}.enable` : `${entity}.disable`, entity, entityId: id, actor, context: {} }, nowIso);
    return mapParty(db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(String(id)));
  }

  return {
    listCustomers(filters) { return listParties('customers', filters); },
    saveCustomer(input, actor) { return saveParty('customers', 'cust', 'customer', input || {}, actor); },
    setCustomerActive(id, active, actor) { return setPartyActive('customers', 'customer', id, active, actor); },
    listCreditors(filters) { return listParties('creditors', filters); },
    saveCreditor(input, actor) { return saveParty('creditors', 'cred', 'creditor', input || {}, actor); },
    setCreditorActive(id, active, actor) { return setPartyActive('creditors', 'creditor', id, active, actor); },
    listCategories({ nature = null, includeInactive = false } = {}) {
      const clauses = [];
      const params = [];
      if (!includeInactive) clauses.push('active=1');
      if (nature) { clauses.push('nature=?'); params.push(String(nature).toUpperCase()); }
      return db.prepare(`SELECT * FROM financial_categories${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''} ORDER BY nature,name COLLATE NOCASE,id`).all(...params).map(mapCategory);
    },
    saveCategory(input = {}, actor) {
      const name = requireName(input.name);
      const nature = String(input.nature || '').toUpperCase();
      if (!['REVENUE', 'EXPENSE'].includes(nature)) throw new Error('invalid category nature');
      const dreGroup = String(input.dreGroup || 'OPERATING').trim().toUpperCase();
      const timestamp = nowIso();
      let id = input.id ? String(input.id) : null;
      if (id) {
        const result = db.prepare('UPDATE financial_categories SET name=?,nature=?,dre_group=?,active=?,updated_at=? WHERE id=?')
          .run(name, nature, dreGroup, activeFlag(input.active), timestamp, id);
        if (!result.changes) throw new Error('category not found');
        writeAudit(db, { action: 'financial-category.update', entity: 'financial-category', entityId: id, actor, context: { name, nature } }, nowIso);
      } else {
        id = String(idFactory('cat'));
        db.prepare('INSERT INTO financial_categories(id,name,nature,dre_group,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
          .run(id, name, nature, dreGroup, activeFlag(input.active), timestamp, timestamp);
        writeAudit(db, { action: 'financial-category.create', entity: 'financial-category', entityId: id, actor, context: { name, nature } }, nowIso);
      }
      return mapCategory(db.prepare('SELECT * FROM financial_categories WHERE id=?').get(id));
    },
    setCategoryActive(id, active, actor) {
      const timestamp = nowIso();
      const result = db.prepare('UPDATE financial_categories SET active=?,updated_at=? WHERE id=?').run(active ? 1 : 0, timestamp, String(id));
      if (!result.changes) throw new Error('category not found');
      writeAudit(db, { action: active ? 'financial-category.enable' : 'financial-category.disable', entity: 'financial-category', entityId: id, actor, context: {} }, nowIso);
      return mapCategory(db.prepare('SELECT * FROM financial_categories WHERE id=?').get(String(id)));
    },
  };
}

module.exports = { createRegistryService };
