import { Pool } from "pg";

let _pool: Pool | null = null;

function makePool(): Pool | null {
  const connectionString = process.env.DATABASE_URL;
  const host = process.env.PGHOST;
  const user = process.env.PGUSER;
  const password = process.env.PGPASSWORD;
  const database = process.env.PGDATABASE;
  const portRaw = process.env.PGPORT;

  if (!connectionString && !host && !database) return null;

  const port = portRaw ? parseInt(portRaw, 10) : undefined;
  return new Pool(
    connectionString
      ? { connectionString }
      : { host, user, password, database, port }
  );
}

export function getPool(): Pool | null {
  if (_pool) return _pool;
  _pool = makePool();
  return _pool;
}

export async function dbReady(): Promise<boolean> {
  const pool = getPool();
  if (!pool) return false;
  try {
    await pool.query("select 1 as ok");
    return true;
  } catch {
    return false;
  }
}

