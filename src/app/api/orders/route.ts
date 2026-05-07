import { NextRequest, NextResponse } from "next/server";

import { deleteAllOrders, insertOrders } from "@/lib/orders-repository";
import { orderBatchSchema } from "@/lib/orders";

export async function POST(request: NextRequest) {
  try {
    const json = await request.json();
    const parsed = orderBatchSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { message: "提交数据格式错误", errors: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const result = await insertOrders(parsed.data.orders);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "服务端异常";
    return NextResponse.json({ message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const result = await deleteAllOrders();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "服务端异常";
    return NextResponse.json({ message }, { status: 500 });
  }
}
