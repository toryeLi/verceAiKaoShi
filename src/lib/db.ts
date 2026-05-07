import postgres from "postgres";

declare global {
  var __sql__: ReturnType<typeof postgres> | undefined;
}

export function getDb() {
  const databaseUrl =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.PRISMA_DATABASE_URL;
  if (!databaseUrl) {
    return null;
  }

  if (!global.__sql__) {
    global.__sql__ = postgres(databaseUrl, {
      max: 1,
      idle_timeout: 5,
      prepare: false,
    });
  }

  return global.__sql__;
}

export async function ensureOrdersTable() {
  const sql = getDb();
  if (!sql) {
    return false;
  }

  await sql`
    create table if not exists orders (
      record_id text primary key,
      external_code text not null default '',
      sender_name text not null,
      sender_phone text not null,
      sender_address text not null,
      receiver_name text not null,
      receiver_phone text not null,
      receiver_address text not null,
      weight numeric(10, 2) not null,
      quantity integer not null,
      temp_zone text not null,
      note text not null default '',
      submitted_at timestamptz not null default now(),
      created_at timestamptz not null default now()
    );
  `;

  await sql`
    create unique index if not exists orders_external_code_unique
    on orders (external_code)
    where external_code <> '';
  `;

  await sql`
    create index if not exists orders_submitted_at_idx
    on orders (submitted_at desc);
  `;

  return true;
}
