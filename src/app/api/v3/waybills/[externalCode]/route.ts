import { NextRequest, NextResponse } from "next/server";

import { getWaybillSnapshotByExternalCode } from "@/lib/orders-repository";
import { authorizeV3Api, getRequestId, withRequestId } from "@/lib/v3-api";

type Context = {
  params: Promise<{ externalCode: string }>;
};

export async function GET(request: NextRequest, context: Context) {
  const unauthorized = authorizeV3Api(request);
  if (unauthorized) {
    return unauthorized;
  }

  const requestId = getRequestId(request);

  try {
    const { externalCode } = await context.params;
    const item = await getWaybillSnapshotByExternalCode(decodeURIComponent(externalCode));

    if (!item) {
      return withRequestId(
        NextResponse.json({ requestId, message: "Waybill not found" }, { status: 404 }),
        requestId,
      );
    }

    return withRequestId(
      NextResponse.json({
        requestId,
        item,
      }),
      requestId,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Waybill detail failed";
    return withRequestId(
      NextResponse.json({ requestId, message }, { status: 500 }),
      requestId,
    );
  }
}
