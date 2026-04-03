import { getPool } from "./pool";

export type ContactRow = { id: string; name: string; phone: string; sortOrder: number };

export async function listEmergencyContacts(userId: string): Promise<ContactRow[]> {
  const pool = getPool();
  if (!pool) return [];
  const { rows } = await pool.query(
    `select id, name, phone, sort_order
     from user_emergency_contacts
     where user_id = $1
     order by sort_order asc, created_at asc`,
    [userId]
  );
  return rows.map((r: any) => ({
    id: String(r.id),
    name: String(r.name),
    phone: String(r.phone),
    sortOrder: Number(r.sort_order) || 0,
  }));
}

export async function replaceEmergencyContacts(
  userId: string,
  contacts: Array<{ name: string; phone: string }>
): Promise<void> {
  const pool = getPool();
  if (!pool) throw new Error("Database not configured");
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`delete from user_emergency_contacts where user_id = $1`, [userId]);
    let order = 0;
    for (const c of contacts) {
      const id = `ec_${userId}_${order}_${Date.now()}`;
      await client.query(
        `insert into user_emergency_contacts (id, user_id, name, phone, sort_order)
         values ($1, $2, $3, $4, $5)`,
        [id, userId, String(c.name).trim(), String(c.phone).trim(), order++]
      );
    }
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}
