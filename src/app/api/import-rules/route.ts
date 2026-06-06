import { NextRequest, NextResponse } from "next/server";

import { createRule, listRules, parseRuleInput } from "@/lib/import-rules";
import type { ImportRule } from "@/types/order";

type RulePayload = Omit<ImportRule, "id" | "createdAt" | "updatedAt">;

export async function GET() {
  try {
    const items = await listRules();
    return NextResponse.json({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "规则列表加载失败";
    return NextResponse.json({ message, items: [] }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = parseRuleInput((await request.json()) as RulePayload);
    const rule = await createRule(payload);
    return NextResponse.json({ item: rule });
  } catch (error) {
    const message = error instanceof Error ? error.message : "规则创建失败";
    return NextResponse.json({ message }, { status: 500 });
  }
}
