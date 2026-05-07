import { NextRequest, NextResponse } from "next/server";

import { queryOrders } from "@/lib/orders-repository";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") ?? "";
    const date = searchParams.get("date") ?? "";
    const page = Number(searchParams.get("page") ?? "1");
    const pageSize = Number(searchParams.get("pageSize") ?? "10");

    const result = await queryOrders({ q, date, page, pageSize });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "查询失败";
    return NextResponse.json({ message, items: [], total: 0 }, { status: 500 });
  }
}
