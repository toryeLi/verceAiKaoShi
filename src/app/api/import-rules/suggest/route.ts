import { NextRequest, NextResponse } from "next/server";

import { getModelStatus, suggestRuleWithModel } from "@/lib/ai-rule-suggester";
import { buildHeuristicSuggestion, extractDocument } from "@/lib/import-parser";

export async function GET() {
  return NextResponse.json(getModelStatus());
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ message: "缺少上传文件" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const extracted = await extractDocument(file.name, arrayBuffer);

    let suggestion = null;
    const modelStatus = getModelStatus();

    if (modelStatus.available) {
      try {
        suggestion = await suggestRuleWithModel({
          fileName: file.name,
          fileType: extracted.summary.fileType,
          previewText: extracted.summary.previewText,
          headerCandidates: extracted.summary.headerCandidates,
        });
      } catch {
        suggestion = null;
      }
    }

    if (!suggestion) {
      suggestion = await buildHeuristicSuggestion(file.name, arrayBuffer);
    }

    return NextResponse.json(suggestion);
  } catch (error) {
    const message = error instanceof Error ? error.message : "规则推荐失败";
    return NextResponse.json({ message }, { status: 500 });
  }
}
