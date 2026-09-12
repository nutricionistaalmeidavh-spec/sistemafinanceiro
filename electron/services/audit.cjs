'use strict';

function writeAudit(db, { action, entity, entityId = null, actor = null, context = {} }, now = () => new Date().toISOString()) {
  if (!db) throw new TypeError('Database is required.');
  const createdAt = typeof now === 'function' ? now() : new Date().toISOString();
  db.prepare(`INSERT INTO audit_log(action,entity,entity_id,actor_id,actor_role,context_json,created_at)
    VALUES (?,?,?,?,?,?,?)`).run(
      String(action),
      String(entity),
      entityId == null ? null : String(entityId),
      actor?.id == null ? null : String(actor.id),
      actor?.role == null ? null : String(actor.role),
      JSON.stringify(context || {}),
      String(createdAt),
    );
}

module.exports = { writeAudit };
