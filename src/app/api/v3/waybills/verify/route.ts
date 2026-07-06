import { NextRequest, NextResponse } from "next/server";

import { getExistingCodes } from "@/lib/orders-repository";
import { authorizeV3Api, getRequestId, withRequestId } from "@/lib/v3-api";

export async function POST(request: NextRequest) {
  const unauthorized = authorizeV3Api(request);
  if (unauthorized) {
    return unauthorized;
  }

  const requestId = getRequestId(request);

  try {
    const json = (await request.json()) as { codes?: string[] };
    const codes = Array.isArray(json.codes)
      ? json.codes.map((item) => String(item).trim()).filter(Boolean)
      : [];

    const existingCodes = await getExistingCodes(codes);
    const existingCodeSet = new Set(existingCodes);

    return withRequestId(
      NextResponse.json({
        requestId,
        items: codes.map((externalCode) => ({
          externalCode,
          exists: existingCodeSet.has(externalCode),
        })),
      }),
      requestId,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Waybill verify failed";
    return withRequestId(
      NextResponse.json({ requestId, message, items: [] }, { status: 500 }),
      requestId,
    );
  }
}
