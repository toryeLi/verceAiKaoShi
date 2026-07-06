import { ensureOrdersTable, getDb } from "@/lib/db";
import type { ImportedOrder } from "@/types/order";

type HistoryQuery = {
  q?: string;
  date?: string;
  page?: number;
  pageSize?: number;
};

type WaybillSnapshotQuery = {
  q?: string;
  page?: number;
  pageSize?: number;
};

type DbOrderRow = {
  record_id: string;
  external_code: string;
  sender_store: string;
  sender_name: string;
  sender_phone: string;
  sender_address: string;
  receiver_store: string;
  receiver_name: string;
  receiver_phone: string;
  receiver_address: string;
  amount: string;
  waybill_status: string;
  source_updated_at: string;
  sku_code: string;
  sku_name: string;
  sku_quantity: string;
  sku_spec: string;
  note: string;
  submitted_at: string;
  created_at: string;
};

function mapOrderRow(row: DbOrderRow) {
  return {
    recordId: row.record_id,
    externalCode: row.external_code,
    senderStore: row.sender_store,
    senderName: row.sender_name,
    senderPhone: row.sender_phone,
    senderAddress: row.sender_address,
    receiverStore: row.receiver_store,
    receiverName: row.receiver_name,
    receiverPhone: row.receiver_phone,
    receiverAddress: row.receiver_address,
    amount: Number(row.amount ?? 0),
    waybillStatus: row.waybill_status,
    sourceUpdatedAt: row.source_updated_at,
    skuCode: row.sku_code,
    skuName: row.sku_name,
    skuQuantity: Number(row.sku_quantity ?? 0),
    skuSpec: row.sku_spec,
    note: row.note,
    submittedAt: row.submitted_at,
    createdAt: row.created_at,
  };
}

export async function getExistingCodes(codes: string[]) {
  const sql = getDb();
  if (codes.length === 0) {
    return [];
  }
  if (!sql) {
    throw new Error("未配置 DATABASE_URL，无法校验运单。");
  }

  try {
    await ensureOrdersTable();

    const result = await sql<{ external_code: string }[]>`
      select distinct external_code
      from import_orders
      where external_code = any(${codes})
    `;

    return result.map((item) => item.external_code);
  } catch (error) {
    console.error("getExistingCodes failed", error);
    throw error;
  }
}

export async function getWaybillSnapshotByExternalCode(externalCode: string) {
  const sql = getDb();
  if (!externalCode.trim()) {
    return null;
  }
  if (!sql) {
    throw new Error("未配置 DATABASE_URL，无法查询运单详情。");
  }

  try {
    await ensureOrdersTable();

    const rows = await sql<DbOrderRow[]>`
      select distinct on (external_code)
        record_id,
        external_code,
        sender_store,
        sender_name,
        sender_phone,
        sender_address,
        receiver_store,
        receiver_name,
        receiver_phone,
        receiver_address,
        amount::text,
        waybill_status,
        source_updated_at::text,
        sku_code,
        sku_name,
        sku_quantity::text,
        sku_spec,
        note,
        submitted_at::text,
        created_at::text
      from import_orders
      where external_code = ${externalCode.trim()}
      order by external_code, submitted_at desc, created_at desc
    `;

    return rows[0] ? mapOrderRow(rows[0]) : null;
  } catch (error) {
    console.error("getWaybillSnapshotByExternalCode failed", error);
    throw error;
  }
}

export async function queryWaybillSnapshots({
  q,
  page = 1,
  pageSize = 20,
}: WaybillSnapshotQuery) {
  const sql = getDb();
  if (!sql) {
    return { items: [], total: 0, message: "database_not_configured" };
  }

  try {
    await ensureOrdersTable();

    const keyword = q?.trim() ?? "";
    const likeKeyword = `%${keyword}%`;
    const offset = (page - 1) * pageSize;

    let items: DbOrderRow[] = [];
    let countRows: Array<{ count: string }> = [];

    if (keyword) {
      items = await sql<DbOrderRow[]>`
        select *
        from (
          select distinct on (external_code)
            record_id,
            external_code,
            sender_store,
            sender_name,
            sender_phone,
            sender_address,
            receiver_store,
            receiver_name,
            receiver_phone,
            receiver_address,
            amount::text,
            waybill_status,
            source_updated_at::text,
            sku_code,
            sku_name,
            sku_quantity::text,
            sku_spec,
            note,
            submitted_at::text,
            created_at::text
          from import_orders
          where (
            external_code ilike ${likeKeyword}
            or sender_name ilike ${likeKeyword}
            or sender_store ilike ${likeKeyword}
            or receiver_name ilike ${likeKeyword}
            or receiver_store ilike ${likeKeyword}
            or sku_name ilike ${likeKeyword}
            or waybill_status ilike ${likeKeyword}
          )
          order by external_code, submitted_at desc, created_at desc
        ) snapshots
        order by submitted_at desc
        limit ${pageSize}
        offset ${offset}
      `;

      countRows = await sql<{ count: string }[]>`
        select count(distinct external_code)::text as count
        from import_orders
        where (
          external_code ilike ${likeKeyword}
          or sender_name ilike ${likeKeyword}
          or sender_store ilike ${likeKeyword}
          or receiver_name ilike ${likeKeyword}
          or receiver_store ilike ${likeKeyword}
          or sku_name ilike ${likeKeyword}
          or waybill_status ilike ${likeKeyword}
        )
      `;
    } else {
      items = await sql<DbOrderRow[]>`
        select *
        from (
          select distinct on (external_code)
            record_id,
            external_code,
            sender_store,
            sender_name,
            sender_phone,
            sender_address,
            receiver_store,
            receiver_name,
            receiver_phone,
            receiver_address,
            amount::text,
            waybill_status,
            source_updated_at::text,
            sku_code,
            sku_name,
            sku_quantity::text,
            sku_spec,
            note,
            submitted_at::text,
            created_at::text
          from import_orders
          order by external_code, submitted_at desc, created_at desc
        ) snapshots
        order by submitted_at desc
        limit ${pageSize}
        offset ${offset}
      `;

      countRows = await sql<{ count: string }[]>`
        select count(distinct external_code)::text as count
        from import_orders
      `;
    }

    return {
      items: items.map(mapOrderRow),
      total: Number(countRows[0]?.count ?? 0),
      page,
      pageSize,
    };
  } catch (error) {
    console.error("queryWaybillSnapshots failed", error);
    return {
      items: [],
      total: 0,
      page,
      pageSize,
      message: error instanceof Error ? error.message : "database_query_failed",
    };
  }
}

export async function insertOrders(orders: ImportedOrder[]) {
  const sql = getDb();
  if (!sql) {
    throw new Error("未配置 DATABASE_URL，无法提交到数据库。");
  }

  await ensureOrdersTable();

  let success = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const order of orders) {
    try {
      await sql`
        insert into import_orders (
          record_id,
          external_code,
          sender_store,
          sender_name,
          sender_phone,
          sender_address,
          receiver_store,
          receiver_name,
          receiver_phone,
          receiver_address,
          amount,
          waybill_status,
          source_updated_at,
          sku_code,
          sku_name,
          sku_quantity,
          sku_spec,
          note
        ) values (
          ${crypto.randomUUID()},
          ${order.externalCode},
          ${order.senderStore},
          ${order.senderName},
          ${order.senderPhone},
          ${order.senderAddress},
          ${order.receiverStore},
          ${order.receiverName},
          ${order.receiverPhone},
          ${order.receiverAddress},
          ${order.amount},
          ${order.waybillStatus},
          ${order.sourceUpdatedAt},
          ${order.skuCode},
          ${order.skuName},
          ${order.skuQuantity},
          ${order.skuSpec},
          ${order.note}
        )
      `;
      success += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : "未知错误";
      failures.push(`${order.externalCode || order.skuName}：${message}`);
    }
  }

  return { success, failed, failures };
}

export async function deleteAllOrders() {
  const sql = getDb();
  if (!sql) {
    throw new Error("未配置 DATABASE_URL，无法删除数据。");
  }

  await ensureOrdersTable();

  const result = await sql<{ record_id: string }[]>`
    delete from import_orders
    returning record_id
  `;

  return { deleted: result.length };
}

export async function queryOrders({ q, date, page = 1, pageSize = 10 }: HistoryQuery) {
  const sql = getDb();
  if (!sql) {
    return { items: [], total: 0, message: "database_not_configured" };
  }

  try {
    await ensureOrdersTable();

    const keyword = q?.trim() ?? "";
    const offset = (page - 1) * pageSize;
    const likeKeyword = `%${keyword}%`;
    const dateValue = date?.trim();

    let items: DbOrderRow[] = [];
    let countRows: Array<{ count: string }> = [];

    if (keyword && dateValue) {
      items = await sql<DbOrderRow[]>`
        select
          record_id,
          external_code,
          sender_store,
          sender_name,
          sender_phone,
          sender_address,
          receiver_store,
          receiver_name,
          receiver_phone,
          receiver_address,
          amount::text,
          waybill_status,
          source_updated_at::text,
          sku_code,
          sku_name,
          sku_quantity::text,
          sku_spec,
          note,
          submitted_at::text,
          created_at::text
        from import_orders
        where (
          external_code ilike ${likeKeyword}
          or sender_name ilike ${likeKeyword}
          or sender_store ilike ${likeKeyword}
          or receiver_name ilike ${likeKeyword}
          or receiver_store ilike ${likeKeyword}
          or sku_name ilike ${likeKeyword}
          or waybill_status ilike ${likeKeyword}
        )
        and date(submitted_at) = ${dateValue}
        order by submitted_at desc
        limit ${pageSize}
        offset ${offset}
      `;

      countRows = await sql<{ count: string }[]>`
        select count(*)::text as count
        from import_orders
        where (
          external_code ilike ${likeKeyword}
          or sender_name ilike ${likeKeyword}
          or sender_store ilike ${likeKeyword}
          or receiver_name ilike ${likeKeyword}
          or receiver_store ilike ${likeKeyword}
          or sku_name ilike ${likeKeyword}
          or waybill_status ilike ${likeKeyword}
        )
        and date(submitted_at) = ${dateValue}
      `;
    } else if (keyword) {
      items = await sql<DbOrderRow[]>`
        select
          record_id,
          external_code,
          sender_store,
          sender_name,
          sender_phone,
          sender_address,
          receiver_store,
          receiver_name,
          receiver_phone,
          receiver_address,
          amount::text,
          waybill_status,
          source_updated_at::text,
          sku_code,
          sku_name,
          sku_quantity::text,
          sku_spec,
          note,
          submitted_at::text,
          created_at::text
        from import_orders
        where (
          external_code ilike ${likeKeyword}
          or sender_name ilike ${likeKeyword}
          or sender_store ilike ${likeKeyword}
          or receiver_name ilike ${likeKeyword}
          or receiver_store ilike ${likeKeyword}
          or sku_name ilike ${likeKeyword}
          or waybill_status ilike ${likeKeyword}
        )
        order by submitted_at desc
        limit ${pageSize}
        offset ${offset}
      `;

      countRows = await sql<{ count: string }[]>`
        select count(*)::text as count
        from import_orders
        where (
          external_code ilike ${likeKeyword}
          or sender_name ilike ${likeKeyword}
          or sender_store ilike ${likeKeyword}
          or receiver_name ilike ${likeKeyword}
          or receiver_store ilike ${likeKeyword}
          or sku_name ilike ${likeKeyword}
          or waybill_status ilike ${likeKeyword}
        )
      `;
    } else if (dateValue) {
      items = await sql<DbOrderRow[]>`
        select
          record_id,
          external_code,
          sender_store,
          sender_name,
          sender_phone,
          sender_address,
          receiver_store,
          receiver_name,
          receiver_phone,
          receiver_address,
          amount::text,
          waybill_status,
          source_updated_at::text,
          sku_code,
          sku_name,
          sku_quantity::text,
          sku_spec,
          note,
          submitted_at::text,
          created_at::text
        from import_orders
        where date(submitted_at) = ${dateValue}
        order by submitted_at desc
        limit ${pageSize}
        offset ${offset}
      `;

      countRows = await sql<{ count: string }[]>`
        select count(*)::text as count
        from import_orders
        where date(submitted_at) = ${dateValue}
      `;
    } else {
      items = await sql<DbOrderRow[]>`
        select
          record_id,
          external_code,
          sender_store,
          sender_name,
          sender_phone,
          sender_address,
          receiver_store,
          receiver_name,
          receiver_phone,
          receiver_address,
          amount::text,
          waybill_status,
          source_updated_at::text,
          sku_code,
          sku_name,
          sku_quantity::text,
          sku_spec,
          note,
          submitted_at::text,
          created_at::text
        from import_orders
        order by submitted_at desc
        limit ${pageSize}
        offset ${offset}
      `;

      countRows = await sql<{ count: string }[]>`
        select count(*)::text as count
        from import_orders
      `;
    }

    return {
      items: items.map(mapOrderRow),
      total: Number(countRows[0]?.count ?? 0),
    };
  } catch (error) {
    console.error("queryOrders failed", error);
    return {
      items: [],
      total: 0,
      message: error instanceof Error ? error.message : "database_query_failed",
    };
  }
}
