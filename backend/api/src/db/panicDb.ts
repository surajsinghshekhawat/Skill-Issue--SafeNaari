import { getPool } from "./pool";

export async function supersedeActivePanicsForUser(userId: string): Promise<void> {
  const pool = getPool();
  if (!pool) return;
  await pool.query(
    `update panic_alerts
     set status = 'superseded', ended_at = coalesce(ended_at, now())
     where user_id = $1 and status = 'active'`,
    [userId]
  );
}

export async function createPanicRecord(opts: {
  id: string;
  userId: string;
  latitude: number | null;
  longitude: number | null;
  meta?: Record<string, unknown> | null;
}): Promise<void> {
  const pool = getPool();
  if (!pool) return;
  await supersedeActivePanicsForUser(opts.userId);
  await pool.query(
    `insert into panic_alerts (id, user_id, status, latitude, longitude, meta)
     values ($1, $2, 'active', $3, $4, $5::jsonb)`,
    [
      opts.id,
      opts.userId,
      opts.latitude,
      opts.longitude,
      opts.meta ? JSON.stringify(opts.meta) : null,
    ]
  );
}

export async function cancelPanicRecord(panicId: string, userId: string): Promise<boolean> {
  const pool = getPool();
  if (!pool) return false;
  const { rowCount } = await pool.query(
    `update panic_alerts
     set status = 'cancelled', ended_at = now()
     where id = $1 and user_id = $2 and status = 'active'`,
    [panicId, userId]
  );
  return (rowCount ?? 0) > 0;
}

export async function getActivePanicForUser(userId: string): Promise<{
  panicId: string;
  startedAt: string;
  latitude: number | null;
  longitude: number | null;
} | null> {
  const pool = getPool();
  if (!pool) return null;
  const { rows } = await pool.query(
    `select id, started_at, latitude, longitude
     from panic_alerts
     where user_id = $1 and status = 'active'
     order by started_at desc
     limit 1`,
    [userId]
  );
  const r = rows[0];
  if (!r) return null;
  return {
    panicId: String(r.id),
    startedAt: new Date(r.started_at).toISOString(),
    latitude: r.latitude != null ? Number(r.latitude) : null,
    longitude: r.longitude != null ? Number(r.longitude) : null,
  };
}
