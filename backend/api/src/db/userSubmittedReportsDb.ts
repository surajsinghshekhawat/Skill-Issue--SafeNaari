import { getPool } from "./pool";

export type UserReportRow = {
  id: string;
  type: string;
  category: string;
  description: string;
  severity: number;
  location: { latitude: number; longitude: number };
  timestamp: string;
  verified: boolean;
  media_url: string | null;
};

export async function insertUserSubmittedReport(row: {
  id: string;
  userId: string;
  type: string;
  category: string;
  description: string;
  severity: number;
  latitude: number;
  longitude: number;
  mediaUrl: string | null;
  createdAtIso: string;
}): Promise<void> {
  const pool = getPool();
  if (!pool) return;
  await pool.query(
    `insert into user_submitted_reports
     (id, user_id, type, category, description, severity, latitude, longitude, media_url, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz)
     on conflict (id) do nothing`,
    [
      row.id,
      row.userId,
      row.type,
      row.category,
      row.description,
      row.severity,
      row.latitude,
      row.longitude,
      row.mediaUrl,
      row.createdAtIso,
    ]
  );
}

export async function listUserSubmittedReportsDb(userId: string): Promise<UserReportRow[]> {
  const pool = getPool();
  if (!pool) return [];
  const { rows } = await pool.query(
    `select id, type, category, description, severity, latitude, longitude, created_at, media_url
     from user_submitted_reports
     where user_id = $1
     order by created_at desc
     limit 500`,
    [userId]
  );
  return rows.map((r: any) => ({
    id: String(r.id),
    type: String(r.type),
    category: String(r.category),
    description: String(r.description),
    severity: Number(r.severity) || 3,
    location: { latitude: Number(r.latitude), longitude: Number(r.longitude) },
    timestamp: new Date(r.created_at).toISOString(),
    verified: false,
    media_url: r.media_url ? String(r.media_url) : null,
  }));
}
