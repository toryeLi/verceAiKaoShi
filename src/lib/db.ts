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
    create table if not exists import_orders (
      record_id text primary key,
      external_code text not null default '',
      receiver_store text not null default '',
      receiver_name text not null default '',
      receiver_phone text not null default '',
      receiver_address text not null default '',
      sku_code text not null,
      sku_name text not null,
      sku_quantity numeric(12, 2) not null,
      sku_spec text not null default '',
      note text not null default '',
      submitted_at timestamptz not null default now(),
      created_at timestamptz not null default now()
    );
  `;

  await sql`
    create unique index if not exists import_orders_external_code_sku_code_unique
    on import_orders (external_code, sku_code, sku_name)
    where external_code <> ''
  `;

  await sql`
    create index if not exists import_orders_submitted_at_idx
    on import_orders (submitted_at desc);
  `;

  return true;
}

export async function ensureImportRulesTable() {
  const sql = getDb();
  if (!sql) {
    return false;
  }

  await sql`
    create table if not exists import_rules (
      id text primary key,
      name text not null,
      description text not null default '',
      file_type text not null,
      source text not null,
      config jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `;

  await sql`
    create index if not exists import_rules_updated_at_idx
    on import_rules (updated_at desc);
  `;

  return true;
}
