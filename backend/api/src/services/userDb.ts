import { getPool } from "../db/pool";

export type DbUser = {
  id: string;
  email: string;
  passwordHash: string;
  name: string | null;
  phoneNumber: string | null;
  createdAt: string;
};

function mapRow(row: any): DbUser {
  return {
    id: String(row.id),
    email: String(row.email),
    passwordHash: String(row.password_hash),
    name: row.name ? String(row.name) : null,
    phoneNumber: row.phone_number ? String(row.phone_number) : null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function findUserByEmailDb(email: string): Promise<DbUser | null> {
  const pool = getPool();
  if (!pool) return null;
  const emailNorm = email.trim().toLowerCase();
  const { rows } = await pool.query(
    `select id, email, password_hash, name, phone_number, created_at
     from users
     where lower(email) = lower($1)
     limit 1`,
    [emailNorm]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function findUserByIdDb(id: string): Promise<Omit<DbUser, "passwordHash"> | null> {
  const pool = getPool();
  if (!pool) return null;
  const { rows } = await pool.query(
    `select id, email, name, phone_number, created_at
     from users
     where id = $1
     limit 1`,
    [id]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    email: String(row.email),
    name: row.name ? String(row.name) : null,
    phoneNumber: row.phone_number ? String(row.phone_number) : null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function createUserDb(user: {
  id: string;
  email: string;
  passwordHash: string;
  name?: string | null;
  phoneNumber?: string | null;
}): Promise<DbUser> {
  const pool = getPool();
  if (!pool) {
    throw new Error("DB not configured (set DATABASE_URL or PGHOST/PGDATABASE)");
  }
  const emailNorm = user.email.trim().toLowerCase();
  const { rows } = await pool.query(
    `insert into users (id, email, password_hash, name, phone_number)
     values ($1, $2, $3, $4, $5)
     returning id, email, password_hash, name, phone_number, created_at`,
    [user.id, emailNorm, user.passwordHash, user.name ?? null, user.phoneNumber ?? null]
  );
  return mapRow(rows[0]);
}

