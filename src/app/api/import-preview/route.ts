import { NextRequest, NextResponse } from "next/server";

import { previewByRule } from "@/lib/import-parser";
import { getRuleById, parseRuleInput } from "@/lib/import-rules";
import type { ImportRule } from "@/types/order";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const ruleId = String(formData.get("ruleId") ?? "").trim();
    const rawRule = String(formData.get("rule") ?? "").trim();

    if (!(file instanceof File)) {
      return NextResponse.json({ message: "缺少上传文件" }, { status: 400 });
    }

    let rule: ImportRule | null = null;

    if (ruleId) {
      rule = await getRuleById(ruleId);
      if (!rule) {
        return NextResponse.json({ message: "规则不存在" }, { status: 404 });
      }
    } else if (rawRule) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawRule);
      } catch {
        return NextResponse.json({ message: "规则 JSON 格式错误" }, { status: 400 });
      }

      const payload = parseRuleInput(parsed, { allowEmptyName: true });
      rule = {
        id: "__preview_rule__",
        ...payload,
        name: payload.name || "临时预览规则",
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      };
    } else {
      return NextResponse.json({ message: "缺少规则 ID 或临时规则" }, { status: 400 });
    }

    const result = await previewByRule(file.name, await file.arrayBuffer(), rule);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "试解析失败";
    return NextResponse.json({ message }, { status: 500 });
  }
}
