import { NextRequest, NextResponse } from "next/server";

import { deleteRule, getRuleById, parseRuleInput, updateRule } from "@/lib/import-rules";
import type { ImportRule } from "@/types/order";

type RulePayload = Omit<ImportRule, "id" | "createdAt" | "updatedAt">;

type Context = {
  params: Promise<{ id: string }>;
};

export async function GET(_: NextRequest, context: Context) {
  try {
    const { id } = await context.params;
    const item = await getRuleById(id);
    if (!item) {
      return NextResponse.json({ message: "规则不存在" }, { status: 404 });
    }
    return NextResponse.json({ item });
  } catch (error) {
    const message = error instanceof Error ? error.message : "规则加载失败";
    return NextResponse.json({ message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params;
    const payload = parseRuleInput((await request.json()) as RulePayload);
    const item = await updateRule(id, payload);
    return NextResponse.json({ item });
  } catch (error) {
    const message = error instanceof Error ? error.message : "规则更新失败";
    return NextResponse.json({ message }, { status: 500 });
  }
}

export async function DELETE(_: NextRequest, context: Context) {
  try {
    const { id } = await context.params;
    await deleteRule(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "规则删除失败";
    return NextResponse.json({ message }, { status: 500 });
  }
}
