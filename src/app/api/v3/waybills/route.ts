import { NextRequest, NextResponse } from "next/server";

import { queryWaybillSnapshots } from "@/lib/orders-repository";
import { authorizeV3Api, getRequestId, withRequestId } from "@/lib/v3-api";

export async function GET(request: NextRequest) {
  const unauthorized = authorizeV3Api(request);
  if (unauthorized) {
    return unauthorized;
  }

  const requestId = getRequestId(request);

  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") ?? "";
    const page = Number(searchParams.get("page") ?? "1");
    const pageSize = Number(searchParams.get("pageSize") ?? "20");

    const result = await queryWaybillSnapshots({ q, page, pageSize });
    const status = "message" in result && result.message ? 500 : 200;
    return withRequestId(
      NextResponse.json(
        {
          requestId,
          ...result,
        },
        { status },
      ),
      requestId,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Waybill query failed";
    return withRequestId(
      NextResponse.json(
        { requestId, message, items: [], total: 0, page: 1, pageSize: 20 },
        { status: 500 },
      ),
      requestId,
    );
  }
}
