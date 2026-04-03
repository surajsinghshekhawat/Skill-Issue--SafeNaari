import { getPool } from "./pool";

export async function insertLocationHistory(opts: {
  userId: string;
  latitude: number;
  longitude: number;
  accuracy?: number | null;
}): Promise<void> {
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.query(
      `insert into location_history (user_id, latitude, longitude, accuracy)
       values ($1, $2, $3, $4)`,
      [
        opts.userId,
        opts.latitude,
        opts.longitude,
        opts.accuracy != null && Number.isFinite(opts.accuracy) ? opts.accuracy : null,
      ]
    );
  } catch (e) {
    console.warn("location_history insert skipped:", (e as any)?.message || e);
  }
}
