import mammoth from "mammoth";
import * as XLSX from "xlsx";

import { makeBlankDraft } from "@/lib/orders";
import { loadPdfParse } from "@/lib/pdf-runtime";
import type {
  ColumnMapping,
  ImportRule,
  OrderDraft,
  OrderFieldKey,
  ParseDocumentSummary,
  ParseResult,
  RuleConfig,
  RuleMode,
  SupportedFileType,
} from "@/types/order";

type FilePayload = {
  fileName: string;
  fileType: SupportedFileType;
  buffer: Buffer;
};

type ExtractedDocument =
  | {
      kind: "excel";
      workbook: XLSX.WorkBook;
      sheets: Array<{ name: string; rows: string[][] }>;
      summary: ParseDocumentSummary;
    }
  | {
      kind: "text";
      text: string;
      summary: ParseDocumentSummary;
    };

const FIELD_ALIASES: Record<OrderFieldKey, string[]> = {
  externalCode: ["外部编码", "外部订单号", "配送单号", "单号", "客户单号", "配送汇总单号"],
  receiverStore: ["收货门店", "收货机构", "门店", "调入门店", "收货门店名称"],
  receiverName: ["收件人", "收货人", "联系人", "收货人姓名"],
  receiverPhone: ["收件人电话", "收货电话", "电话", "手机号", "联系电话"],
  receiverAddress: ["收件人地址", "收货地址", "地址"],
  skuCode: ["SKU物品编码", "物品编码", "SKU编码", "外部商品编码", "SKU条码"],
  skuName: ["SKU物品名称", "物品名称", "SKU名称", "商品名称"],
  skuQuantity: ["SKU发货数量", "发货数量", "出库数量", "数量", "应发数量"],
  skuSpec: ["SKU规格型号", "规格型号", "规格", "型号"],
  note: ["备注", "物品备注", "单据备注"],
};

function normalizeText(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/\r/g, "")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function normalizeCell(value: unknown) {
  return String(value ?? "").replace(/\r/g, "").trim();
}

function buildSheetText(rows: string[][]) {
  return rows
    .map((row) => row.map((cell) => normalizeCell(cell)).filter(Boolean).join("\t"))
    .filter(Boolean)
    .join("\n");
}

function buildHeaderMapping(headers: string[], manualMapping?: ColumnMapping, headerAliases?: RuleConfig["headerAliases"]) {
  const mapping: ColumnMapping = { ...(manualMapping ?? {}) };

  for (const field of Object.keys(FIELD_ALIASES) as OrderFieldKey[]) {
    if (mapping[field]) {
      continue;
    }

    const aliasSet = new Set(
      [...FIELD_ALIASES[field], ...(headerAliases?.[field] ?? [])].map((item) => normalizeText(item)),
    );

    const match = headers.find((header) => aliasSet.has(normalizeText(header)));
    if (match) {
      mapping[field] = match;
    }
  }

  return mapping;
}

function scoreHeaderRow(row: string[], config: RuleConfig) {
  let score = 0;
  for (const cell of row) {
    const normalized = normalizeText(cell);
    if (!normalized) {
      continue;
    }
    for (const aliases of Object.values(FIELD_ALIASES)) {
      if (aliases.some((alias) => normalizeText(alias) === normalized)) {
        score += 2;
        break;
      }
    }
    for (const manualTarget of Object.values(config.manualMapping ?? {})) {
      if (manualTarget && normalizeText(manualTarget) === normalized) {
        score += 3;
      }
    }
  }
  return score;
}

function getFileType(fileName: string): SupportedFileType {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    return "excel";
  }
  if (lower.endsWith(".docx")) {
    return "word";
  }
  return "pdf";
}

function guessMode(fileName: string, previewText: string, headerCandidates: string[]): RuleMode {
  const merged = `${fileName}\n${previewText}\n${headerCandidates.join("\n")}`;
  if (/调拨记录|卡片/.test(merged)) {
    return "cards";
  }
  if (/银泰|金银潭|金桥/.test(merged) && /SKU名称|外部商品编码/.test(merged)) {
    return "matrix";
  }
  if (/收件人|收货人|地址|电话/.test(merged) && /[|｜]/.test(merged)) {
    return "plainText";
  }
  return "tabular";
}

async function extractExcelDocument(file: FilePayload): Promise<ExtractedDocument> {
  const workbook = XLSX.read(file.buffer, { type: "buffer" });
  const sheets = workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as unknown[][];
    return {
      name: sheetName,
      rows: rows.map((row) => row.map((cell) => normalizeCell(cell))),
    };
  });

  const headerCandidates = sheets
    .flatMap((sheet) => sheet.rows.slice(0, 8))
    .map((row) => row.join(" | "))
    .filter(Boolean)
    .slice(0, 12);

  const previewText = sheets
    .slice(0, 2)
    .flatMap((sheet) => sheet.rows.slice(0, 8).map((row) => `[${sheet.name}] ${row.join(" | ")}`))
    .join("\n");

  const summary: ParseDocumentSummary = {
    fileName: file.fileName,
    fileType: "excel",
    sheetNames: workbook.SheetNames,
    previewText,
    detectedMode: guessMode(file.fileName, previewText, headerCandidates),
    headerCandidates,
    warnings: [],
  };

  return { kind: "excel", workbook, sheets, summary };
}

async function extractWordDocument(file: FilePayload): Promise<ExtractedDocument> {
  const result = await mammoth.extractRawText({ buffer: file.buffer });
  const text = result.value.replace(/\r/g, "").trim();
  const summary: ParseDocumentSummary = {
    fileName: file.fileName,
    fileType: "word",
    sheetNames: [],
    previewText: text.slice(0, 3000),
    detectedMode: guessMode(file.fileName, text.slice(0, 3000), []),
    headerCandidates: [],
    warnings: result.messages.map((item) => item.message),
  };

  return { kind: "text", text, summary };
}

async function extractPdfDocument(file: FilePayload): Promise<ExtractedDocument> {
  const { PDFParse } = await loadPdfParse();
  const parser = new PDFParse({ data: new Uint8Array(file.buffer) });
  try {
    const result = await parser.getText({});
    const text = result.text.replace(/\r/g, "").trim();
    const summary: ParseDocumentSummary = {
      fileName: file.fileName,
      fileType: "pdf",
      sheetNames: [],
      previewText: text.slice(0, 3000),
      detectedMode: guessMode(file.fileName, text.slice(0, 3000), []),
      headerCandidates: [],
      warnings: [],
    };

    return { kind: "text", text, summary };
  } finally {
    await parser.destroy();
  }
}

export async function extractDocument(fileName: string, arrayBuffer: ArrayBuffer): Promise<ExtractedDocument> {
  const fileType = getFileType(fileName);
  const payload: FilePayload = {
    fileName,
    fileType,
    buffer: Buffer.from(arrayBuffer),
  };

  if (fileType === "excel") {
    return extractExcelDocument(payload);
  }
  if (fileType === "word") {
    return extractWordDocument(payload);
  }
  return extractPdfDocument(payload);
}

function pickSheets(
  sheets: Array<{ name: string; rows: string[][] }>,
  config: RuleConfig,
) {
  if (config.sheetSelection === "all") {
    return sheets;
  }
  if (config.sheetSelection === "first") {
    return sheets.slice(0, 1);
  }

  const scanRows = config.scanHeaderRows ?? 8;
  let best = sheets[0];
  let bestScore = -1;

  for (const sheet of sheets) {
    for (let index = 0; index < Math.min(sheet.rows.length, scanRows); index += 1) {
      const score = scoreHeaderRow(sheet.rows[index] ?? [], config);
      if (score > bestScore) {
        best = sheet;
        bestScore = score;
      }
    }
  }

  return best ? [best] : [];
}

function findHeaderRowIndex(rows: string[][], config: RuleConfig) {
  if (typeof config.headerRow === "number") {
    return Math.max(0, config.headerRow);
  }

  const scanRows = config.scanHeaderRows ?? 8;
  let bestIndex = 0;
  let bestScore = -1;

  for (let index = 0; index < Math.min(rows.length, scanRows); index += 1) {
    const score = scoreHeaderRow(rows[index] ?? [], config);
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  }

  return bestIndex;
}

function shouldSkipRow(rowValues: string[], config: RuleConfig) {
  const joined = rowValues.join(" ").trim();
  if (!joined) {
    return true;
  }

  if ((config.ignoreKeywords ?? []).some((keyword) => joined.includes(keyword))) {
    return true;
  }

  return false;
}

function shouldStopRow(rowValues: string[], config: RuleConfig) {
  const joined = rowValues.join(" ").trim();
  if (!joined) {
    return false;
  }

  return (config.rowEndKeywords ?? []).some((keyword) => joined.includes(keyword));
}

function rowsFromTabularSheet(sheetName: string, rows: string[][], config: RuleConfig) {
  const headerRowIndex = findHeaderRowIndex(rows, config);
  const headers = rows[headerRowIndex] ?? [];
  const mapping = buildHeaderMapping(headers, config.manualMapping, config.headerAliases);
  const headerIndexMap = new Map<string, number>();
  const sheetText = buildSheetText(rows);
  const sharedValues = {
    externalCode: firstCapture(sheetText, config.sheetTextPatterns?.externalCode),
    receiverStore: firstCapture(sheetText, config.sheetTextPatterns?.receiverStore),
    receiverName: firstCapture(sheetText, config.sheetTextPatterns?.receiverName),
    receiverPhone: firstCapture(sheetText, config.sheetTextPatterns?.receiverPhone),
    receiverAddress: firstCapture(sheetText, config.sheetTextPatterns?.receiverAddress),
    note: firstCapture(sheetText, config.sheetTextPatterns?.note),
  };

  headers.forEach((header, index) => {
    headerIndexMap.set(header, index);
  });

  const drafts: OrderDraft[] = [];

  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    if (shouldStopRow(row, config)) {
      break;
    }
    if (shouldSkipRow(row, config)) {
      continue;
    }

    const draft = makeBlankDraft(rowIndex + 1);

    for (const [field, header] of Object.entries(mapping)) {
      if (!header) {
        continue;
      }
      const columnIndex = headerIndexMap.get(header);
      if (columnIndex === undefined) {
        continue;
      }
      draft[field as OrderFieldKey] = normalizeCell(row[columnIndex]) as never;
    }

    for (const [field, value] of Object.entries(sharedValues)) {
      if (value && !draft[field as OrderFieldKey]) {
        draft[field as OrderFieldKey] = value as never;
      }
    }

    for (const [field, value] of Object.entries(config.staticValues ?? {})) {
      if (!draft[field as OrderFieldKey]) {
        draft[field as OrderFieldKey] = value as never;
      }
    }

    if (!draft.receiverStore.trim() && config.sheetSelection === "all") {
      draft.receiverStore = sheetName;
    }

    if (
      draft.skuCode.trim() ||
      draft.skuName.trim() ||
      draft.skuQuantity.trim() ||
      draft.externalCode.trim() ||
      draft.receiverStore.trim()
    ) {
      drafts.push(draft);
    }
  }

  return drafts;
}

function rowsFromMatrixSheet(rows: string[][], config: RuleConfig) {
  const headerRowIndex = typeof config.headerRow === "number" ? config.headerRow : 0;
  const headers = rows[headerRowIndex] ?? [];
  const mapping = buildHeaderMapping(headers, config.manualMapping, config.headerAliases);
  const quantityHeaders = config.matrix?.quantityHeaders ?? [];
  const storeColumns = headers
    .map((header, index) => ({ header, index }))
    .filter(({ header }) => quantityHeaders.includes(header) || /店/.test(header));

  const skuCodeIndex = mapping.skuCode ? headers.indexOf(mapping.skuCode) : -1;
  const skuNameIndex = mapping.skuName ? headers.indexOf(mapping.skuName) : -1;
  const skuSpecIndex = mapping.skuSpec ? headers.indexOf(mapping.skuSpec) : -1;

  const drafts: OrderDraft[] = [];

  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const skuCode = skuCodeIndex >= 0 ? normalizeCell(row[skuCodeIndex]) : "";
    const skuName = skuNameIndex >= 0 ? normalizeCell(row[skuNameIndex]) : "";
    const skuSpec = skuSpecIndex >= 0 ? normalizeCell(row[skuSpecIndex]) : "";

    if (!skuCode && !skuName) {
      continue;
    }

    for (const column of storeColumns) {
      const quantity = normalizeCell(row[column.index]);
      const numericQuantity = Number(quantity || "0");
      if (!Number.isFinite(numericQuantity) || numericQuantity <= 0) {
        continue;
      }

      const draft = makeBlankDraft(rowIndex + 1);
      draft.receiverStore = column.header;
      draft.skuCode = skuCode;
      draft.skuName = skuName;
      draft.skuSpec = skuSpec;
      draft.skuQuantity = String(numericQuantity);

      for (const [field, value] of Object.entries(config.staticValues ?? {})) {
        if (!draft[field as OrderFieldKey]) {
          draft[field as OrderFieldKey] = value as never;
        }
      }

      drafts.push(draft);
    }
  }

  return drafts;
}

function findCellValueInCard(cardRows: string[][], keyword: string) {
  for (const row of cardRows) {
    for (let index = 0; index < row.length; index += 1) {
      const cell = row[index] ?? "";
      if (normalizeText(cell) === normalizeText(keyword)) {
        return normalizeCell(row[index + 1] ?? "");
      }
    }
  }
  return "";
}

function rowsFromCardSheet(rows: string[][], config: RuleConfig) {
  const separatorKeyword = config.card?.separatorKeyword ?? "调拨记录";
  const itemHeaders = config.card?.itemsHeaderKeywords ?? ["物品编码", "物品名称", "规格", "数量"];
  const separators: number[] = [];

  rows.forEach((row, index) => {
    if (row.some((cell) => cell.includes(separatorKeyword))) {
      separators.push(index);
    }
  });

  const ranges = separators.map((start, index) => ({
    start,
    end: index === separators.length - 1 ? rows.length : separators[index + 1],
  }));

  const drafts: OrderDraft[] = [];

  for (const range of ranges) {
    const cardRows = rows.slice(range.start, range.end);
    const receiverStore = findCellValueInCard(cardRows, "调入门店");
    const receiverName = findCellValueInCard(cardRows, "收货人");
    const receiverPhone = findCellValueInCard(cardRows, "电话");
    const receiverAddress = findCellValueInCard(cardRows, "收货地址");
    const itemHeaderIndex = cardRows.findIndex((row) =>
      itemHeaders.every((keyword) => row.some((cell) => normalizeText(cell) === normalizeText(keyword))),
    );

    if (itemHeaderIndex < 0) {
      continue;
    }

    for (let index = itemHeaderIndex + 1; index < cardRows.length; index += 1) {
      const row = cardRows[index];
      if (!row.some(Boolean)) {
        continue;
      }

      const draft = makeBlankDraft(range.start + index + 1);
      draft.receiverStore = receiverStore;
      draft.receiverName = receiverName;
      draft.receiverPhone = receiverPhone;
      draft.receiverAddress = receiverAddress;
      draft.skuCode = normalizeCell(row[0]);
      draft.skuName = normalizeCell(row[1]);
      draft.skuSpec = normalizeCell(row[2]);
      draft.skuQuantity = normalizeCell(row[3]);

      if (draft.skuCode || draft.skuName) {
        drafts.push(draft);
      }
    }
  }

  return drafts;
}

function safeRegExp(pattern?: string) {
  if (!pattern) {
    return null;
  }

  try {
    return new RegExp(pattern, "gmi");
  } catch {
    return null;
  }
}

function firstCapture(text: string, pattern?: string) {
  if (!pattern) {
    return "";
  }

  try {
    const regexp = new RegExp(pattern, "im");
    const matched = regexp.exec(text);
    return normalizeCell(matched?.groups?.value ?? matched?.[1] ?? "");
  } catch {
    return "";
  }
}

function rowsFromPlainText(text: string, config: RuleConfig) {
  const separator = config.recordSeparator?.trim();
  const records = separator && text.includes(separator)
    ? text.split(separator)
    : text.split(/\n{2,}/);

  const itemPattern =
    safeRegExp(config.itemLinePattern) ??
    safeRegExp(
      "(?<skuCode>[A-Z0-9\\-]+)\\s+[|｜]\\s*(?<skuName>[^|｜\\n]+)\\s+[|｜]\\s*(?<skuSpec>[^|｜\\n]*)\\s+[|｜]\\s*(?<skuQuantity>\\d+(?:\\.\\d+)?)",
    ) ??
    safeRegExp(
      "(?m)^\\s*\\d+\\s+[^\\n]*?\\s+(?<skuCode>ZBWP\\d+)\\s+(?<skuName>.+?)\\s{2,}(?<skuSpec>[^\\n\\t]+?)\\s+(?:件|包|瓶|桶)?\\s*(?<skuQuantity>\\d+(?:\\.\\d+)?)\\s*$",
    );

  const drafts: OrderDraft[] = [];

  records.forEach((record, recordIndex) => {
    const trimmedRecord = record.trim();
    if (!trimmedRecord || !itemPattern) {
      return;
    }

    const baseDraft = makeBlankDraft(recordIndex + 1);
    baseDraft.externalCode = firstCapture(trimmedRecord, config.receiverPatterns?.externalCode);
    baseDraft.receiverStore = firstCapture(trimmedRecord, config.receiverPatterns?.receiverStore);
    baseDraft.receiverName = firstCapture(trimmedRecord, config.receiverPatterns?.receiverName);
    baseDraft.receiverPhone = firstCapture(trimmedRecord, config.receiverPatterns?.receiverPhone);
    baseDraft.receiverAddress = firstCapture(trimmedRecord, config.receiverPatterns?.receiverAddress);

    const matches = [...trimmedRecord.matchAll(itemPattern)];
    for (const match of matches) {
      const draft = {
        ...baseDraft,
        id: crypto.randomUUID(),
        skuCode: normalizeCell(match.groups?.skuCode ?? ""),
        skuName: normalizeCell(match.groups?.skuName ?? ""),
        skuSpec: normalizeCell(match.groups?.skuSpec ?? ""),
        skuQuantity: normalizeCell(match.groups?.skuQuantity ?? ""),
      };

      if (draft.skuCode || draft.skuName) {
        drafts.push(draft);
      }
    }
  });

  return drafts;
}

export async function previewByRule(fileName: string, arrayBuffer: ArrayBuffer, rule: ImportRule): Promise<ParseResult> {
  const extracted = await extractDocument(fileName, arrayBuffer);
  const warnings = [...extracted.summary.warnings];
  let rows: OrderDraft[] = [];

  if (extracted.kind === "excel") {
    const targetSheets = pickSheets(extracted.sheets, rule.config);
    if (rule.config.mode === "matrix") {
      rows = targetSheets.flatMap((sheet) => rowsFromMatrixSheet(sheet.rows, rule.config));
    } else if (rule.config.mode === "cards") {
      rows = targetSheets.flatMap((sheet) => rowsFromCardSheet(sheet.rows, rule.config));
    } else {
      rows = targetSheets.flatMap((sheet) => rowsFromTabularSheet(sheet.name, sheet.rows, rule.config));
    }
  } else {
    rows = rowsFromPlainText(extracted.text, rule.config);
    if (rule.config.mode !== "plainText") {
      warnings.push("当前文件为非表格文本，已按纯文本规则进行试解析。");
    }
  }

  if (rows.length === 0) {
    warnings.push("未解析出任何明细，请检查规则配置或尝试 AI 推荐规则。");
  }

  return {
    summary: extracted.summary,
    rows,
    warnings,
  };
}

export async function buildHeuristicSuggestion(fileName: string, arrayBuffer: ArrayBuffer) {
  const extracted = await extractDocument(fileName, arrayBuffer);
  const fileType = extracted.summary.fileType;
  const mode = extracted.summary.detectedMode;

  let config: RuleConfig;
  if (mode === "matrix") {
    config = {
      mode,
      sheetSelection: "first",
      headerRow: 0,
      matrix: {
        quantityHeaders: ["银泰", "金银潭", "金桥", "门店A", "门店B", "门店C", "门店D"],
      },
      manualMapping: {
        skuCode: "外部商品编码",
        skuName: "SKU名称",
        skuSpec: "规格",
      },
    };
  } else if (mode === "cards") {
    config = {
      mode,
      sheetSelection: "first",
      card: {
        separatorKeyword: "调拨记录",
        itemsHeaderKeywords: ["物品编码", "物品名称", "规格", "数量"],
      },
    };
  } else if (mode === "plainText") {
    config = {
      mode,
      recordSeparator: "────────────────",
      itemLinePattern:
        "(?<index>\\d+)[\\.、]\\s*(?<skuCode>[^|｜]+)[|｜](?<skuName>[^|｜]+)[|｜](?<skuSpec>[^|｜]*)[|｜](?<skuQuantity>\\d+(?:\\.\\d+)?)",
      receiverPatterns: {
        externalCode: "(?:外部编码|配送单号|单号)[:：]\\s*(?<value>[^\\n]+)",
        receiverStore: "(?:收货门店|门店)[:：]\\s*(?<value>[^\\n]+)",
        receiverName: "(?:收件人|收货人)[:：]\\s*(?<value>[^\\n]+)",
        receiverPhone: "(?:电话|手机号)[:：]\\s*(?<value>1\\d{10})",
        receiverAddress: "(?:地址|收货地址)[:：]\\s*(?<value>[^\\n]+)",
      },
    };
  } else {
    config = {
      mode: "tabular",
      sheetSelection: extracted.summary.sheetNames.length > 1 ? "all" : "best",
      scanHeaderRows: 8,
      ignoreKeywords: ["合计", "说明"],
      rowEndKeywords: ["合计"],
    };
  }

  return {
    rule: {
      name: `AI 推荐规则 - ${fileName.replace(/\.[^.]+$/, "")}`,
      description: "基于文件结构自动生成的初始规则，请先试解析并人工确认后保存。",
      fileType,
      source: "heuristic" as const,
      config,
    },
    summary: extracted.summary,
    reasoning: [
      `识别文件类型为 ${fileType}`,
      `推断结构模式为 ${mode}`,
      "已生成可编辑的初始规则，请先试解析并确认字段映射。",
    ],
    usedModel: null,
    provider: "heuristic",
  };
}
