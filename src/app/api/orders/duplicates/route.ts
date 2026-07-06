import { NextRequest, NextResponse } from "next/server";

import { getExistingCodes } from "@/lib/orders-repository";

export async function POST(request: NextRequest) {
  try {
    const json = (await request.json()) as { codes?: string[] };
    const codes = Array.isArray(json.codes)
      ? json.codes.map((item) => String(item).trim()).filter(Boolean)
      : [];

    const duplicates = await getExistingCodes(codes);
    return NextResponse.json({ duplicates });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Waybill verify failed";
    return NextResponse.json({ message, duplicates: [] }, { status: 500 });
  }
}
