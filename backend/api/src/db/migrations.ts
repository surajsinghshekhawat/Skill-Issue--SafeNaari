import { getPool } from "./pool";

export async function runMigrations() {
  const pool = getPool();
  if (!pool) {
    console.warn("⚠️ DATABASE_URL/PG* not set; skipping DB migrations");
    return;
  }

  await pool.query(`
    create table if not exists users (
      id text primary key,
      email text not null unique,
      password_hash text not null,
      name text,
      phone_number text,
      created_at timestamptz not null default now()
    );
  `);

  await pool.query(`
    create index if not exists users_email_lower_idx
    on users (lower(email));
  `);

  await pool.query(`
    create table if not exists audit_events (
      id bigserial primary key,
      actor_id text,
      actor_role text,
      action text not null,
      entity_type text,
      entity_id text,
      reason text,
      metadata jsonb,
      created_at timestamptz not null default now()
    );
  `);
  await pool.query(`
    create index if not exists audit_events_created_idx
    on audit_events (created_at desc);
  `);

  await pool.query(`
    create table if not exists location_history (
      id bigserial primary key,
      user_id text not null,
      latitude double precision not null,
      longitude double precision not null,
      accuracy double precision,
      recorded_at timestamptz not null default now()
    );
  `);
  await pool.query(`
    create index if not exists location_history_user_time_idx
    on location_history (user_id, recorded_at desc);
  `);

  await pool.query(`
    create table if not exists panic_alerts (
      id text primary key,
      user_id text not null,
      status text not null default 'active',
      latitude double precision,
      longitude double precision,
      started_at timestamptz not null default now(),
      ended_at timestamptz,
      meta jsonb
    );
  `);
  await pool.query(`
    create index if not exists panic_alerts_user_status_idx
    on panic_alerts (user_id, status);
  `);

  await pool.query(`
    create table if not exists user_emergency_contacts (
      id text primary key,
      user_id text not null,
      name text not null,
      phone text not null,
      sort_order int not null default 0,
      created_at timestamptz not null default now()
    );
  `);
  await pool.query(`
    create index if not exists user_emergency_contacts_user_idx
    on user_emergency_contacts (user_id);
  `);

  await pool.query(`
    create table if not exists user_submitted_reports (
      id text primary key,
      user_id text not null,
      type text not null,
      category text not null,
      description text not null,
      severity int not null,
      latitude double precision not null,
      longitude double precision not null,
      media_url text,
      created_at timestamptz not null default now()
    );
  `);
  await pool.query(`
    create index if not exists user_submitted_reports_user_idx
    on user_submitted_reports (user_id, created_at desc);
  `);
}

