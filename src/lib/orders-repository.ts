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

  await ensureOrdersTable();

  const result = await sql<{ external_code: string }[]>`
    select external_code
    from orders
    where external_code = any(${codes})
  `;

  return result.map((item) => item.external_code);
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
        insert into orders (
          record_id,
          external_code,
          sender_name,
          sender_phone,
          sender_address,
          receiver_name,
          receiver_phone,
          receiver_address,
          weight,
          quantity,
          temp_zone,
          note
        ) values (
          ${crypto.randomUUID()},
          ${order.externalCode},
          ${order.senderName},
          ${order.senderPhone},
          ${order.senderAddress},
          ${order.receiverName},
          ${order.receiverPhone},
          ${order.receiverAddress},
          ${order.weight},
          ${order.quantity},
          ${order.tempZone},
          ${order.note}
        )
      `;
      success += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : "未知错误";
      failures.push(`${order.externalCode || order.receiverName}：${message}`);
    }
  }

  return { success, failed, failures };
}

export async function queryOrders({ q, date, page = 1, pageSize = 10 }: HistoryQuery) {
  const sql = getDb();
  if (!sql) {
    return { items: [], total: 0 };
  }

  await ensureOrdersTable();

  const keyword = q?.trim() ?? "";
  const offset = (page - 1) * pageSize;
  const likeKeyword = `%${keyword}%`;
  const dateValue = date?.trim();

  type Row = {
    record_id: string;
    external_code: string;
    sender_name: string;
    sender_phone: string;
    sender_address: string;
    receiver_name: string;
    receiver_phone: string;
    receiver_address: string;
    weight: string;
    quantity: number;
    temp_zone: string;
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
        sender_name,
        sender_phone,
        sender_address,
        receiver_name,
        receiver_phone,
        receiver_address,
        weight::text,
        quantity,
        temp_zone,
        note,
        submitted_at,
        created_at
      from orders
      where (
        external_code ilike ${likeKeyword}
        or receiver_name ilike ${likeKeyword}
        or sender_name ilike ${likeKeyword}
      )
      and date(submitted_at) = ${dateValue}
      order by submitted_at desc
      limit ${pageSize}
      offset ${offset}
    `;

    countRows = await sql<{ count: string }[]>`
      select count(*)::text as count
      from orders
      where (
        external_code ilike ${likeKeyword}
        or receiver_name ilike ${likeKeyword}
        or sender_name ilike ${likeKeyword}
      )
      and date(submitted_at) = ${dateValue}
    `;
  } else if (keyword) {
    items = await sql<Row[]>`
      select
        record_id,
        external_code,
        sender_name,
        sender_phone,
        sender_address,
        receiver_name,
        receiver_phone,
        receiver_address,
        weight::text,
        quantity,
        temp_zone,
        note,
        submitted_at,
        created_at
      from orders
      where (
        external_code ilike ${likeKeyword}
        or receiver_name ilike ${likeKeyword}
        or sender_name ilike ${likeKeyword}
      )
      order by submitted_at desc
      limit ${pageSize}
      offset ${offset}
    `;

    countRows = await sql<{ count: string }[]>`
      select count(*)::text as count
      from orders
      where (
        external_code ilike ${likeKeyword}
        or receiver_name ilike ${likeKeyword}
        or sender_name ilike ${likeKeyword}
      )
    `;
  } else if (dateValue) {
    items = await sql<Row[]>`
      select
        record_id,
        external_code,
        sender_name,
        sender_phone,
        sender_address,
        receiver_name,
        receiver_phone,
        receiver_address,
        weight::text,
        quantity,
        temp_zone,
        note,
        submitted_at,
        created_at
      from orders
      where date(submitted_at) = ${dateValue}
      order by submitted_at desc
      limit ${pageSize}
      offset ${offset}
    `;

    countRows = await sql<{ count: string }[]>`
      select count(*)::text as count
      from orders
      where date(submitted_at) = ${dateValue}
    `;
  } else {
    items = await sql<Row[]>`
      select
        record_id,
        external_code,
        sender_name,
        sender_phone,
        sender_address,
        receiver_name,
        receiver_phone,
        receiver_address,
        weight::text,
        quantity,
        temp_zone,
        note,
        submitted_at,
        created_at
      from orders
      order by submitted_at desc
      limit ${pageSize}
      offset ${offset}
    `;

    countRows = await sql<{ count: string }[]>`
      select count(*)::text as count
      from orders
    `;
  }

  return {
    items: items.map((item) => ({
      recordId: item.record_id,
      externalCode: item.external_code,
      senderName: item.sender_name,
      senderPhone: item.sender_phone,
      senderAddress: item.sender_address,
      receiverName: item.receiver_name,
      receiverPhone: item.receiver_phone,
      receiverAddress: item.receiver_address,
      weight: Number(item.weight),
      quantity: item.quantity,
      tempZone: item.temp_zone,
      note: item.note,
      submittedAt: item.submitted_at,
      createdAt: item.created_at,
    })),
    total: Number(countRows[0]?.count ?? 0),
  };
}
