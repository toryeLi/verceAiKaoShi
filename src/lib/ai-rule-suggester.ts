import type { ModelStatus, RuleConfig, RuleSuggestion, SupportedFileType } from "@/types/order";

type SuggestionInput = {
  fileName: string;
  fileType: SupportedFileType;
  previewText: string;
  headerCandidates: string[];
};

function inferProvider(baseUrl: string) {
  if (/deepseek/i.test(baseUrl)) {
    return "deepseek";
  }
  if (/openai/i.test(baseUrl)) {
    return "openai-compatible";
  }
  return "custom-compatible";
}

function firstDefinedEnv(names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) {
      return {
        name,
        value: value.trim(),
      };
    }
  }

  return null;
}

function normalizeBaseUrl(baseUrl: string) {
  const trimmed = baseUrl.replace(/\/$/, "");
  if (/\/chat\/completions$/i.test(trimmed)) {
    return trimmed.replace(/\/chat\/completions$/i, "");
  }
  return trimmed;
}

export function getModelConfigFromEnv() {
  const keyEnv = firstDefinedEnv([
    "LLM_API_KEY",
    "OPENAI_API_KEY",
    "DEEPSEEK_API_KEY",
    "OPENROUTER_API_KEY",
  ]);
  const baseUrlEnv = firstDefinedEnv([
    "LLM_API_URL",
    "OPENAI_BASE_URL",
    "OPENAI_API_BASE",
    "DEEPSEEK_BASE_URL",
    "OPENROUTER_BASE_URL",
  ]);
  const modelEnv = firstDefinedEnv([
    "LLM_MODEL",
    "OPENAI_MODEL",
    "DEEPSEEK_MODEL",
    "OPENROUTER_MODEL",
  ]);

  if (!keyEnv) {
    return null;
  }

  const baseUrl = normalizeBaseUrl(baseUrlEnv?.value || "https://api.openai.com/v1");
  const model = modelEnv?.value || "gpt-4.1-mini";

  return {
    apiKey: keyEnv.value,
    baseUrl,
    model,
    provider: inferProvider(baseUrl),
    envKey: keyEnv.name,
    envBaseUrl: baseUrlEnv?.name ?? null,
    envModel: modelEnv?.name ?? null,
  };
}

export function getModelStatus(): ModelStatus {
  const config = getModelConfigFromEnv();
  if (!config) {
    return {
      available: false,
      provider: "heuristic",
      model: null,
      baseUrl: null,
      mode: "heuristic",
      reason: "missing_api_key",
      envKey: null,
      envBaseUrl: null,
      envModel: null,
    };
  }

  return {
    available: true,
    provider: config.provider,
    model: config.model,
    baseUrl: config.baseUrl,
    mode: "llm",
    reason: null,
    envKey: config.envKey,
    envBaseUrl: config.envBaseUrl,
    envModel: config.envModel,
  };
}

function buildPrompt(input: SuggestionInput) {
  return [
    "你是一个物流出库单规则引擎设计助手。",
    "你的目标不是直接提取订单数据，而是根据文件结构生成一个可编辑的解析规则 JSON。",
    "只返回 JSON，不要输出 markdown。",
    "JSON 必须包含字段：name, description, fileType, source, config, reasoning。",
    "config 的结构必须兼容以下 TypeScript 概念：",
    JSON.stringify(
      {
        mode: "tabular | matrix | cards | plainText",
        sheetSelection: "best | first | all",
        headerRow: "number | null",
        scanHeaderRows: "number",
        manualMapping: {
          externalCode: "string",
          receiverStore: "string",
          receiverName: "string",
          receiverPhone: "string",
          receiverAddress: "string",
          skuCode: "string",
          skuName: "string",
          skuQuantity: "string",
          skuSpec: "string",
          note: "string",
        },
        ignoreKeywords: ["string"],
        rowEndKeywords: ["string"],
        recordSeparator: "string",
        itemLinePattern: "string",
        receiverPatterns: {
          externalCode: "regex",
          receiverStore: "regex",
          receiverName: "regex",
          receiverPhone: "regex",
          receiverAddress: "regex",
        },
        matrix: {
          quantityHeaders: ["string"],
        },
        card: {
          separatorKeyword: "string",
          itemsHeaderKeywords: ["string"],
        },
      },
      null,
      2,
    ),
    `文件名: ${input.fileName}`,
    `文件类型: ${input.fileType}`,
    "头部候选:",
    input.headerCandidates.join("\n") || "无",
    "预览文本:",
    input.previewText.slice(0, 4000),
  ].join("\n");
}

function safeParseResponse(content: string) {
  const firstBrace = content.indexOf("{");
  const lastBrace = content.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace < 0 || lastBrace <= firstBrace) {
    throw new Error("模型返回内容不是有效 JSON");
  }
  return JSON.parse(content.slice(firstBrace, lastBrace + 1)) as {
    name: string;
    description: string;
    fileType: SupportedFileType | "any";
    source?: "ai";
    config: RuleConfig;
    reasoning?: string[];
  };
}

export async function suggestRuleWithModel(input: SuggestionInput): Promise<RuleSuggestion | null> {
  const config = getModelConfigFromEnv();
  if (!config) {
    return null;
  }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "你是一个严格输出 JSON 的规则生成器。",
        },
        {
          role: "user",
          content: buildPrompt(input),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`模型调用失败: ${response.status}`);
  }

  const json = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };

  const content = json.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("模型未返回规则内容");
  }

  const parsed = safeParseResponse(content);

  return {
    rule: {
      name: parsed.name,
      description: parsed.description,
      fileType: parsed.fileType,
      source: "ai",
      config: parsed.config,
    },
    summary: {
      fileName: input.fileName,
      fileType: input.fileType,
      sheetNames: [],
      previewText: input.previewText,
      detectedMode: parsed.config.mode,
      headerCandidates: input.headerCandidates,
      warnings: [],
    },
    reasoning: parsed.reasoning ?? ["已通过大模型分析文件结构并生成初始规则。"],
    usedModel: config.model,
    provider: config.provider,
  };
}
