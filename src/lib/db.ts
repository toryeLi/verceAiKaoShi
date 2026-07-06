import postgres from "postgres";

declare global {
  var __sql__: ReturnType<typeof postgres> | undefined;
  var __orders_schema_ready__: Promise<boolean> | undefined;
  var __import_rules_schema_ready__: Promise<boolean> | undefined;
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

async function runOrdersMigrations() {
  const sql = getDb();
  if (!sql) {
    return false;
  }

  await sql`
    create table if not exists import_orders (
      record_id text primary key,
      external_code text not null default '',
      sender_store text not null default '',
      sender_name text not null default '',
      sender_phone text not null default '',
      sender_address text not null default '',
      receiver_store text not null default '',
      receiver_name text not null default '',
      receiver_phone text not null default '',
      receiver_address text not null default '',
      amount numeric(12, 2) not null default 0,
      waybill_status text not null default 'imported',
      source_updated_at timestamptz not null default now(),
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
    alter table import_orders
    add column if not exists sender_store text not null default '',
    add column if not exists sender_name text not null default '',
    add column if not exists sender_phone text not null default '',
    add column if not exists sender_address text not null default '',
    add column if not exists amount numeric(12, 2) not null default 0,
    add column if not exists waybill_status text not null default 'imported',
    add column if not exists source_updated_at timestamptz not null default now()
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

export async function ensureOrdersTable() {
  if (!global.__orders_schema_ready__) {
    global.__orders_schema_ready__ = runOrdersMigrations().catch((error) => {
      global.__orders_schema_ready__ = undefined;
      throw error;
    });
  }

  return global.__orders_schema_ready__;
}

async function runImportRulesMigrations() {
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

export async function ensureImportRulesTable() {
  if (!global.__import_rules_schema_ready__) {
    global.__import_rules_schema_ready__ = runImportRulesMigrations().catch((error) => {
      global.__import_rules_schema_ready__ = undefined;
      throw error;
    });
  }

  return global.__import_rules_schema_ready__;
}
