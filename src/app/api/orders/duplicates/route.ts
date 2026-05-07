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
  } catch {
    return NextResponse.json({ duplicates: [] }, { status: 200 });
  }
}
