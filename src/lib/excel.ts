"use client";

import * as XLSX from "xlsx";

import {
  buildAutoMapping,
  buildTemplateFingerprint,
  hasMeaningfulDraftValue,
  makeEmptyDraft,
} from "@/lib/orders";
import type { ColumnMapping, OrderDraft, ParseResult } from "@/types/order";

function readWorkbook(file: File) {
  return new Promise<XLSX.WorkBook>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const workbook = XLSX.read(reader.result, { type: "array" });
        resolve(workbook);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

function scoreHeaderRow(row: unknown[]) {
  return row.reduce<number>((score, cell) => {
    const value = String(cell ?? "").trim();
    if (!value) {
      return score;
    }
    const mapping = buildAutoMapping([value]);
    return score + (Object.keys(mapping).length > 0 ? 1 : 0);
  }, 0);
}

function findBestSheetAndHeader(workbook: XLSX.WorkBook) {
  let best:
    | {
        sheetName: string;
        headerRowIndex: number;
        score: number;
        rows: unknown[][];
      }
    | undefined;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as unknown[][];

    for (let index = 0; index < Math.min(rows.length, 12); index += 1) {
      const score = scoreHeaderRow(rows[index] ?? []);
      if (!best || score > best.score) {
        best = { sheetName, headerRowIndex: index, score, rows };
      }
    }
  }

  if (!best || best.score < 4) {
    throw new Error("未识别到有效表头，请检查 Sheet、表头行或文件格式。");
  }

  return best;
}

function buildRowsFromMapping(
  sourceRows: unknown[][],
  headers: string[],
  mapping: ColumnMapping,
  headerRowIndex: number,
) {
  const drafts: OrderDraft[] = [];
  const headerIndexMap = new Map<string, number>();

  headers.forEach((header, index) => {
    headerIndexMap.set(header, index);
  });

  for (let rowIndex = headerRowIndex + 1; rowIndex < sourceRows.length; rowIndex += 1) {
    const row = sourceRows[rowIndex] ?? [];
    const draft = makeEmptyDraft(rowIndex + 1);

    for (const [field, header] of Object.entries(mapping)) {
      if (!header) {
        continue;
      }
      const columnIndex = headerIndexMap.get(header);
      if (columnIndex === undefined) {
        continue;
      }
      draft[field as keyof OrderDraft] = String(row[columnIndex] ?? "").trim() as never;
    }

    if (!hasMeaningfulDraftValue(draft)) {
      continue;
    }

    drafts.push(draft);
  }

  return drafts;
}

export async function parseExcelFile(
  file: File,
  savedMapping?: ColumnMapping,
  onProgress?: (completed: number, total: number) => void,
): Promise<ParseResult> {
  if (!/\.(xlsx|xls)$/i.test(file.name)) {
    throw new Error("仅支持 .xlsx / .xls 文件");
  }

  const workbook = await readWorkbook(file);
  const { rows, sheetName, headerRowIndex } = findBestSheetAndHeader(workbook);
  const headers = (rows[headerRowIndex] ?? []).map((cell, index) =>
    String(cell ?? "").trim() || `未命名列${index + 1}`,
  );

  const autoMapping = buildAutoMapping(headers);
  const mapping = { ...autoMapping, ...savedMapping };
  const rawDrafts = buildRowsFromMapping(rows, headers, mapping, headerRowIndex);
  const total = rawDrafts.length;
  const parsedRows: OrderDraft[] = [];

  for (let index = 0; index < rawDrafts.length; index += 1) {
    parsedRows.push(rawDrafts[index]);
    onProgress?.(index + 1, total);
    if ((index + 1) % 100 === 0) {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
  }

  return {
    fileName: file.name,
    templateFingerprint: buildTemplateFingerprint(headers),
    detectedSheetName: sheetName,
    headerRowIndex,
    headers,
    sourceRows: rows,
    mapping,
    rows: parsedRows,
  };
}

export function remapDraftRows(
  headers: string[],
  rows: unknown[][],
  mapping: ColumnMapping,
  headerRowIndex: number,
) {
  return buildRowsFromMapping(rows, headers, mapping, headerRowIndex);
}

export async function exportDraftsToExcel(rows: OrderDraft[]) {
  const headerLabels = [
    "外部编码",
    "发件人姓名",
    "发件人电话",
    "发件人地址",
    "收件人姓名",
    "收件人电话",
    "收件人地址",
    "重量(kg)",
    "件数",
    "温层",
    "备注",
  ];

  const worksheet = XLSX.utils.aoa_to_sheet([
    headerLabels,
    ...rows.map((row) => [
      row.externalCode,
      row.senderName,
      row.senderPhone,
      row.senderAddress,
      row.receiverName,
      row.receiverPhone,
      row.receiverAddress,
      row.weight,
      row.quantity,
      row.tempZone,
      row.note,
    ]),
  ]);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "订单预览");
  XLSX.writeFile(workbook, `订单预览导出-${Date.now()}.xlsx`);
}
