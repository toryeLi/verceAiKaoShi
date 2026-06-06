import { ensureImportRulesTable, getDb } from "@/lib/db";
import type { ImportRule, RuleConfig, RuleMode, RuleSource, SupportedFileType } from "@/types/order";

export type RuleInput = Omit<ImportRule, "id" | "createdAt" | "updatedAt">;

const RULE_MODES = new Set<RuleMode>(["tabular", "matrix", "cards", "plainText"]);
const RULE_FILE_TYPES = new Set<SupportedFileType | "any">(["excel", "word", "pdf", "any"]);
const RULE_SOURCES = new Set<RuleSource>(["manual", "ai", "heuristic"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseRuleInput(value: unknown, options?: { allowEmptyName?: boolean }) {
  if (!isRecord(value)) {
    throw new Error("规则数据格式错误");
  }

  const allowEmptyName = options?.allowEmptyName ?? false;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const description = typeof value.description === "string" ? value.description.trim() : "";
  const fileType = value.fileType;
  const source = value.source;
  const config = value.config;

  if (!allowEmptyName && !name) {
    throw new Error("规则名称不能为空");
  }

  if (typeof fileType !== "string" || !RULE_FILE_TYPES.has(fileType as SupportedFileType | "any")) {
    throw new Error("规则适用文件类型无效");
  }

  if (typeof source !== "string" || !RULE_SOURCES.has(source as RuleSource)) {
    throw new Error("规则来源无效");
  }

  if (!isRecord(config)) {
    throw new Error("规则配置格式错误");
  }

  const mode = config.mode;
  if (typeof mode !== "string" || !RULE_MODES.has(mode as RuleMode)) {
    throw new Error("规则模式无效");
  }

  return {
    name,
    description,
    fileType: fileType as ImportRule["fileType"],
    source: source as RuleSource,
    config: config as RuleConfig,
  } satisfies RuleInput;
}

const memoryRules = new Map<string, ImportRule>();

const DEFAULT_RULES: ImportRule[] = [
  {
    id: "rule-tabular-basic",
    name: "标准行式表格",
    description: "适用于单 Sheet 或多 Sheet 的标准表格，支持表头识别、列映射和尾部信息过滤。",
    fileType: "excel",
    source: "manual",
    config: {
      mode: "tabular",
      sheetSelection: "best",
      scanHeaderRows: 8,
      ignoreKeywords: ["合计", "说明", "备注说明"],
      rowEndKeywords: ["合计"],
      manualMapping: {
        externalCode: "配送单号",
        receiverStore: "收货机构",
        receiverName: "收货人",
        receiverPhone: "收货电话",
        receiverAddress: "收货地址",
        skuCode: "物品编码",
        skuName: "物品名称",
        skuQuantity: "发货数量",
        skuSpec: "规格型号",
        note: "备注",
      },
    },
    createdAt: "2026-06-05T00:00:00.000Z",
    updatedAt: "2026-06-05T00:00:00.000Z",
  },
  {
    id: "rule-demo-hunan",
    name: "样例预设 - 湖南仓汇总单",
    description: "适配湖南仓.xlsx，按第 2 行表头解析，并使用配送单号聚合门店/收件信息。",
    fileType: "excel",
    source: "manual",
    config: {
      mode: "tabular",
      sheetSelection: "first",
      headerRow: 1,
      ignoreKeywords: ["合计", "说明"],
      manualMapping: {
        externalCode: "配送单号",
        receiverStore: "收货机构",
        receiverName: "收货人",
        receiverPhone: "收货电话",
        receiverAddress: "收货地址",
        skuCode: "物品编码*",
        skuName: "物品名称",
        skuQuantity: "发货数量*",
        skuSpec: "规格型号",
        note: "物品备注",
      },
    },
    createdAt: "2026-06-05T00:00:00.000Z",
    updatedAt: "2026-06-05T00:00:00.000Z",
  },
  {
    id: "rule-demo-liming",
    name: "样例预设 - 黎明屯配送发货单",
    description: "适配黎明屯配送单，明细表头在中部，门店信息在顶部区域，收件人信息在尾部区域。",
    fileType: "excel",
    source: "manual",
    config: {
      mode: "tabular",
      sheetSelection: "first",
      headerRow: 3,
      ignoreKeywords: ["合计"],
      rowEndKeywords: ["合计"],
      manualMapping: {
        skuCode: "物品编码",
        skuName: "物品名称",
        skuQuantity: "发货数量",
        skuSpec: "规格型号",
        note: "备注",
      },
      sheetTextPatterns: {
        externalCode: "单据号\\s*(?<value>PS\\d+)",
        receiverStore: "收货机构\\s*(?<value>[^\\n\\t]+)",
        receiverName: "收货人[:：]?\\s*(?<value>[^\\n]+)",
        receiverPhone: "收货电话[:：]?\\s*(?<value>1\\d{10})",
        receiverAddress: "收货地址[:：]?\\s*(?<value>[^\\n]+)",
      },
    },
    createdAt: "2026-06-05T00:00:00.000Z",
    updatedAt: "2026-06-05T00:00:00.000Z",
  },
  {
    id: "rule-tabular-multi-sheet",
    name: "多 Sheet 门店出库单",
    description: "遍历所有 Sheet，每个 Sheet 视作一个门店单据，门店名优先来自 Sheet 名称。",
    fileType: "excel",
    source: "manual",
    config: {
      mode: "tabular",
      sheetSelection: "all",
      scanHeaderRows: 8,
      ignoreKeywords: ["合计"],
      rowEndKeywords: ["合计"],
      manualMapping: {
        skuCode: "物品编码",
        skuName: "物品名称",
        skuQuantity: "出库数量",
        skuSpec: "规格型号",
        note: "备注",
      },
    },
    createdAt: "2026-06-05T00:00:00.000Z",
    updatedAt: "2026-06-05T00:00:00.000Z",
  },
  {
    id: "rule-matrix-store-columns",
    name: "门店矩阵模板",
    description: "SKU 在行，门店在列，按数量列展开为多条运单明细。",
    fileType: "excel",
    source: "manual",
    config: {
      mode: "matrix",
      sheetSelection: "first",
      headerRow: 0,
      matrix: {
        quantityHeaders: ["银泰", "金银潭", "金桥", "门店A", "门店B", "门店C", "门店D"],
      },
      manualMapping: {
        skuName: "SKU名称",
        skuCode: "外部商品编码",
        skuSpec: "规格",
      },
    },
    createdAt: "2026-06-05T00:00:00.000Z",
    updatedAt: "2026-06-05T00:00:00.000Z",
  },
  {
    id: "rule-demo-huanyuemuchang",
    name: "样例预设 - 欢乐牧场矩阵模板",
    description: "适配欢乐牧场模板0430.xlsx，按门店列展开 SKU 数量。",
    fileType: "excel",
    source: "manual",
    config: {
      mode: "matrix",
      sheetSelection: "first",
      headerRow: 0,
      matrix: {
        quantityHeaders: ["银泰", "金银潭", "金桥", "门店B", "门店D"],
      },
      manualMapping: {
        skuCode: "外部商品编码",
        skuName: "SKU名称",
        skuSpec: "规格",
      },
    },
    createdAt: "2026-06-05T00:00:00.000Z",
    updatedAt: "2026-06-05T00:00:00.000Z",
  },
  {
    id: "rule-cards-transfer",
    name: "卡片式调拨单",
    description: "按卡片边界拆分记录，再提取收件信息与物品小表。",
    fileType: "excel",
    source: "manual",
    config: {
      mode: "cards",
      card: {
        separatorKeyword: "调拨记录",
        itemsHeaderKeywords: ["物品编码", "物品名称", "规格", "数量"],
      },
    },
    createdAt: "2026-06-05T00:00:00.000Z",
    updatedAt: "2026-06-05T00:00:00.000Z",
  },
  {
    id: "rule-demo-pdf-delivery",
    name: "样例预设 - 黔寨寨 PDF 配送单",
    description: "适配 PDF 配送单，头部提取单号/门店，尾部提取收货人电话地址，中间按行提取物品明细。",
    fileType: "pdf",
    source: "manual",
    config: {
      mode: "plainText",
      itemLinePattern:
        "(?m)^\\s*\\d+\\s+[^\\n]*?\\s+(?<skuCode>ZBWP\\d+)\\s+(?<skuName>.+?)\\s{2,}(?<skuSpec>[^\\n\\t]+?)\\s+(?:件|包|瓶|桶)?\\s*(?<skuQuantity>\\d+(?:\\.\\d+)?)\\s*$",
      receiverPatterns: {
        externalCode: "单据编号[:：]\\s*(?<value>PS\\d+)",
        receiverStore: "收货机构[:：]\\s*(?<value>[^\\n\\t]+)",
        receiverName: "收货人[:：]\\s*(?<value>[^\\n]+)",
        receiverPhone: "收货电话[:：]\\s*(?<value>1\\d{10})",
        receiverAddress: "收货地址[:：]\\s*(?<value>[^\\n]+)",
      },
    },
    createdAt: "2026-06-05T00:00:00.000Z",
    updatedAt: "2026-06-05T00:00:00.000Z",
  },
  {
    id: "rule-plain-text-sign",
    name: "纯文本签收单",
    description: "适用于 Word/PDF 纯文本单据，按分隔线拆记录，并用正则提取商品明细。",
    fileType: "any",
    source: "manual",
    config: {
      mode: "plainText",
      recordSeparator: "────────────────",
      itemLinePattern:
        "(?<index>\\d+)[\\.、]\\s*(?<skuCode>[^|]+)\\|(?<skuName>[^|]+)\\|(?<skuSpec>[^|]+)\\|(?<skuQuantity>\\d+(?:\\.\\d+)?)",
      receiverPatterns: {
        externalCode: "(?:外部编码|配送单号|单号)[:：]\\s*(?<value>[^\\n]+)",
        receiverStore: "(?:收货门店|门店)[:：]\\s*(?<value>[^\\n]+)",
        receiverName: "(?:收件人|收货人)[:：]\\s*(?<value>[^\\n]+)",
        receiverPhone: "(?:电话|手机号)[:：]\\s*(?<value>1\\d{10})",
        receiverAddress: "(?:地址|收货地址)[:：]\\s*(?<value>[^\\n]+)",
      },
    },
    createdAt: "2026-06-05T00:00:00.000Z",
    updatedAt: "2026-06-05T00:00:00.000Z",
  },
];

function cloneRule(rule: ImportRule) {
  return JSON.parse(JSON.stringify(rule)) as ImportRule;
}

async function ensureSeeded() {
  const sql = getDb();
  if (!sql) {
    if (memoryRules.size === 0) {
      DEFAULT_RULES.forEach((rule) => {
        memoryRules.set(rule.id, cloneRule(rule));
      });
    }
    return;
  }

  await ensureImportRulesTable();

  for (const rule of DEFAULT_RULES) {
    await sql`
      insert into import_rules (
        id,
        name,
        description,
        file_type,
        source,
        config,
        created_at,
        updated_at
      ) values (
        ${rule.id},
        ${rule.name},
        ${rule.description},
        ${rule.fileType},
        ${rule.source},
        ${JSON.stringify(rule.config)},
        ${rule.createdAt},
        ${rule.updatedAt}
      )
      on conflict (id) do nothing
    `;
  }
}

export async function listRules() {
  await ensureSeeded();

  const sql = getDb();
  if (!sql) {
    return [...memoryRules.values()].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }

  const rows = await sql<
    Array<{
      id: string;
      name: string;
      description: string;
      file_type: ImportRule["fileType"];
      source: ImportRule["source"];
      config: ImportRule["config"] | string;
      created_at: string;
      updated_at: string;
    }>
  >`
    select id, name, description, file_type, source, config, created_at, updated_at
    from import_rules
    order by updated_at desc, name asc
  `;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    fileType: row.file_type,
    source: row.source,
    config: typeof row.config === "string" ? JSON.parse(row.config) : row.config,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function getRuleById(id: string) {
  await ensureSeeded();

  const sql = getDb();
  if (!sql) {
    return memoryRules.get(id) ?? null;
  }

  const rows = await sql<
    Array<{
      id: string;
      name: string;
      description: string;
      file_type: ImportRule["fileType"];
      source: ImportRule["source"];
      config: ImportRule["config"] | string;
      created_at: string;
      updated_at: string;
    }>
  >`
    select id, name, description, file_type, source, config, created_at, updated_at
    from import_rules
    where id = ${id}
    limit 1
  `;

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    fileType: row.file_type,
    source: row.source,
    config: typeof row.config === "string" ? JSON.parse(row.config) : row.config,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } satisfies ImportRule;
}

export async function createRule(input: RuleInput) {
  await ensureSeeded();

  const now = new Date().toISOString();
  const rule: ImportRule = {
    id: crypto.randomUUID(),
    ...input,
    createdAt: now,
    updatedAt: now,
  };

  const sql = getDb();
  if (!sql) {
    memoryRules.set(rule.id, rule);
    return rule;
  }

  await sql`
    insert into import_rules (
      id,
      name,
      description,
      file_type,
      source,
      config,
      created_at,
      updated_at
    ) values (
      ${rule.id},
      ${rule.name},
      ${rule.description},
      ${rule.fileType},
      ${rule.source},
      ${JSON.stringify(rule.config)},
      ${rule.createdAt},
      ${rule.updatedAt}
    )
  `;

  return rule;
}

export async function updateRule(id: string, input: RuleInput) {
  await ensureSeeded();

  const current = await getRuleById(id);
  if (!current) {
    throw new Error("规则不存在");
  }

  const updated: ImportRule = {
    ...current,
    ...input,
    updatedAt: new Date().toISOString(),
  };

  const sql = getDb();
  if (!sql) {
    memoryRules.set(id, updated);
    return updated;
  }

  await sql`
    update import_rules
    set
      name = ${updated.name},
      description = ${updated.description},
      file_type = ${updated.fileType},
      source = ${updated.source},
      config = ${JSON.stringify(updated.config)},
      updated_at = ${updated.updatedAt}
    where id = ${id}
  `;

  return updated;
}

export async function deleteRule(id: string) {
  await ensureSeeded();

  const sql = getDb();
  if (!sql) {
    return memoryRules.delete(id);
  }

  await sql`
    delete from import_rules
    where id = ${id}
  `;

  return true;
}
