import { getPool } from "./pool";

export type AuditEventInput = {
  actorId?: string | null;
  actorRole?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
};

export async function insertAuditEvent(input: AuditEventInput): Promise<void> {
  const pool = getPool();
  if (!pool) return;
  await pool.query(
    `insert into audit_events (actor_id, actor_role, action, entity_type, entity_id, reason, metadata)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      input.actorId ?? null,
      input.actorRole ?? null,
      input.action,
      input.entityType ?? null,
      input.entityId ?? null,
      input.reason ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
    ]
  );
}

export type AuditRow = {
  entityId: string | null;
  action: string;
  reason: string | null;
  timestamp: string;
  actorId: string | null;
  actorRole: string | null;
  entityType: string | null;
};

export async function listAuditEvents(limit: number): Promise<AuditRow[]> {
  const pool = getPool();
  if (!pool) return [];
  const lim = Math.min(Math.max(1, limit), 500);
  const { rows } = await pool.query(
    `select entity_id, action, reason, created_at, actor_id, actor_role, entity_type
     from audit_events
     order by created_at desc
     limit $1`,
    [lim]
  );
  return rows.map((r: any) => ({
    entityId: r.entity_id ? String(r.entity_id) : null,
    action: String(r.action),
    reason: r.reason ? String(r.reason) : null,
    timestamp: new Date(r.created_at).toISOString(),
    actorId: r.actor_id ? String(r.actor_id) : null,
    actorRole: r.actor_role ? String(r.actor_role) : null,
    entityType: r.entity_type ? String(r.entity_type) : null,
  }));
}
