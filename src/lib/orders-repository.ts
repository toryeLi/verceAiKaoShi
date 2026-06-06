import { ensureOrdersTable, getDb } from "@/lib/db";
import type { ImportedOrder } from "@/types/order";

type HistoryQuery = {
  q?: string;
  date?: string;
  page?: number;
  pageSize?: number;
};

export async function getExistingCodes(codes: string[]) {
  const sql = getDb();
  if (!sql || codes.length === 0) {
    return [];
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
    return [];
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
          receiver_store,
          receiver_name,
          receiver_phone,
          receiver_address,
          sku_code,
          sku_name,
          sku_quantity,
          sku_spec,
          note
        ) values (
          ${crypto.randomUUID()},
          ${order.externalCode},
          ${order.receiverStore},
          ${order.receiverName},
          ${order.receiverPhone},
          ${order.receiverAddress},
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

    type Row = {
      record_id: string;
      external_code: string;
      receiver_store: string;
      receiver_name: string;
      receiver_phone: string;
      receiver_address: string;
      sku_code: string;
      sku_name: string;
      sku_quantity: string;
      sku_spec: string;
      note: string;
      submitted_at: string;
      created_at: string;
    };

    let items: Row[] = [];
    let countRows: Array<{ count: string }> = [];

    if (keyword && dateValue) {
      items = await sql<Row[]>`
        select
          record_id,
          external_code,
          receiver_store,
          receiver_name,
          receiver_phone,
          receiver_address,
          sku_code,
          sku_name,
          sku_quantity::text,
          sku_spec,
          note,
          submitted_at,
          created_at
        from import_orders
        where (
          external_code ilike ${likeKeyword}
          or receiver_name ilike ${likeKeyword}
          or receiver_store ilike ${likeKeyword}
          or sku_name ilike ${likeKeyword}
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
          or receiver_name ilike ${likeKeyword}
          or receiver_store ilike ${likeKeyword}
          or sku_name ilike ${likeKeyword}
        )
        and date(submitted_at) = ${dateValue}
      `;
    } else if (keyword) {
      items = await sql<Row[]>`
        select
          record_id,
          external_code,
          receiver_store,
          receiver_name,
          receiver_phone,
          receiver_address,
          sku_code,
          sku_name,
          sku_quantity::text,
          sku_spec,
          note,
          submitted_at,
          created_at
        from import_orders
        where (
          external_code ilike ${likeKeyword}
          or receiver_name ilike ${likeKeyword}
          or receiver_store ilike ${likeKeyword}
          or sku_name ilike ${likeKeyword}
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
          or receiver_name ilike ${likeKeyword}
          or receiver_store ilike ${likeKeyword}
          or sku_name ilike ${likeKeyword}
        )
      `;
    } else if (dateValue) {
      items = await sql<Row[]>`
        select
          record_id,
          external_code,
          receiver_store,
          receiver_name,
          receiver_phone,
          receiver_address,
          sku_code,
          sku_name,
          sku_quantity::text,
          sku_spec,
          note,
          submitted_at,
          created_at
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
      items = await sql<Row[]>`
        select
          record_id,
          external_code,
          receiver_store,
          receiver_name,
          receiver_phone,
          receiver_address,
          sku_code,
          sku_name,
          sku_quantity::text,
          sku_spec,
          note,
          submitted_at,
          created_at
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
      items: items.map((item) => ({
        recordId: item.record_id,
        externalCode: item.external_code,
        receiverStore: item.receiver_store,
        receiverName: item.receiver_name,
        receiverPhone: item.receiver_phone,
        receiverAddress: item.receiver_address,
        skuCode: item.sku_code,
        skuName: item.sku_name,
        skuQuantity: Number(item.sku_quantity),
        skuSpec: item.sku_spec,
        note: item.note,
        submittedAt: item.submitted_at,
        createdAt: item.created_at,
      })),
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
