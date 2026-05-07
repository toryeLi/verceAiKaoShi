import { z } from "zod";

import {
  type ColumnMapping,
  type ImportedOrder,
  type OrderDraft,
  type OrderFieldKey,
  type RowValidation,
  TEMP_ZONES,
  type TempZone,
} from "@/types/order";

export const ORDER_FIELDS: Array<{
  key: OrderFieldKey;
  label: string;
  required: boolean;
  placeholder: string;
}> = [
  { key: "externalCode", label: "外部编码", required: false, placeholder: "ORD-2024-001" },
  { key: "senderName", label: "发件人姓名", required: true, placeholder: "张三" },
  { key: "senderPhone", label: "发件人电话", required: true, placeholder: "13800138001" },
  { key: "senderAddress", label: "发件人地址", required: true, placeholder: "北京市朝阳区建国路88号" },
  { key: "receiverName", label: "收件人姓名", required: true, placeholder: "李四" },
  { key: "receiverPhone", label: "收件人电话", required: true, placeholder: "13900139001" },
  { key: "receiverAddress", label: "收件人地址", required: true, placeholder: "上海市浦东新区陆家嘴路100号" },
  { key: "weight", label: "重量(kg)", required: true, placeholder: "5.2" },
  { key: "quantity", label: "件数", required: true, placeholder: "2" },
  { key: "tempZone", label: "温层", required: true, placeholder: "常温 / 冷藏 / 冷冻" },
  { key: "note", label: "备注", required: false, placeholder: "易碎品" },
];

const headerAliasEntries: Array<[OrderFieldKey, string[]]> = [
  ["externalCode", ["外部编码", "外部订单号", "客户单号", "ref code", "客户编号", "订单号"]],
  ["senderName", ["发件人姓名", "发件人", "发货人", "sender"]],
  ["senderPhone", ["发件人电话", "发件电话", "发货电话", "sender tel", "sender phone"]],
  ["senderAddress", ["发件人地址", "发件地址", "发货地址", "sender address"]],
  ["receiverName", ["收件人姓名", "收件人", "收货人", "receiver"]],
  ["receiverPhone", ["收件人电话", "收件电话", "收货电话", "receiver tel", "receiver phone"]],
  ["receiverAddress", ["收件人地址", "收件地址", "收货地址", "receiver address"]],
  ["weight", ["重量(kg)", "重量", "weight(kg)", "weight", "重量kg", "重量(KG)"]],
  ["quantity", ["件数", "数量", "qty", "package qty"]],
  ["tempZone", ["温层", "温度要求", "temp zone", "temperature zone"]],
  ["note", ["备注", "附言", "note", "remark"]],
];

export const HEADER_ALIAS_MAP = new Map<string, OrderFieldKey>();

for (const [field, aliases] of headerAliasEntries) {
  for (const alias of aliases) {
    HEADER_ALIAS_MAP.set(normalizeHeader(alias), field);
  }
}

export const orderInsertSchema = z.object({
  externalCode: z.string().trim().default(""),
  senderName: z.string().trim().min(1, "发件人姓名不能为空"),
  senderPhone: z.string().trim().regex(/^1\d{10}$/, "发件人电话格式错误"),
  senderAddress: z.string().trim().min(1, "发件人地址不能为空"),
  receiverName: z.string().trim().min(1, "收件人姓名不能为空"),
  receiverPhone: z.string().trim().regex(/^1\d{10}$/, "收件人电话格式错误"),
  receiverAddress: z.string().trim().min(1, "收件人地址不能为空"),
  weight: z.coerce.number().positive("重量必须为正数"),
  quantity: z.coerce.number().int("件数必须为正整数").positive("件数必须为正整数"),
  tempZone: z.enum(TEMP_ZONES),
  note: z.string().trim().default(""),
});

export const orderBatchSchema = z.object({
  orders: z.array(orderInsertSchema),
});

export function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[（(]/g, "(")
    .replace(/[）)]/g, ")")
    .replace(/[_\-/:：]/g, "")
    .replace(/kg/g, "kg");
}

export function getFieldLabel(field: OrderFieldKey) {
  return ORDER_FIELDS.find((item) => item.key === field)?.label ?? field;
}

export function buildTemplateFingerprint(headers: string[]) {
  return headers
    .map((header) => normalizeHeader(header))
    .filter(Boolean)
    .sort()
    .join("|");
}

export function detectHeaderField(header: string) {
  return HEADER_ALIAS_MAP.get(normalizeHeader(header));
}

export function buildAutoMapping(headers: string[]) {
  const mapping: ColumnMapping = {};

  headers.forEach((header) => {
    const field = detectHeaderField(header);
    if (!field || mapping[field]) {
      return;
    }
    mapping[field] = header;
  });

  return mapping;
}

export function makeEmptyDraft(rowNumber = 0): OrderDraft {
  return {
    id: crypto.randomUUID(),
    originalRowNumber: rowNumber,
    externalCode: "",
    senderName: "",
    senderPhone: "",
    senderAddress: "",
    receiverName: "",
    receiverPhone: "",
    receiverAddress: "",
    weight: "",
    quantity: "",
    tempZone: "",
    note: "",
  };
}

export function hasMeaningfulDraftValue(draft: OrderDraft) {
  return ORDER_FIELDS.some((field) => draft[field.key].trim().length > 0);
}

export function validateDrafts(
  drafts: OrderDraft[],
  existingCodes: string[] = [],
): { validations: RowValidation[]; allErrors: string[] } {
  const existingCodeSet = new Set(existingCodes.filter(Boolean));
  const duplicateMap = new Map<string, number[]>();

  drafts.forEach((draft, index) => {
    const code = draft.externalCode.trim();
    if (!code) {
      return;
    }
    const rowNo = draft.originalRowNumber || index + 1;
    const list = duplicateMap.get(code) ?? [];
    list.push(rowNo);
    duplicateMap.set(code, list);
  });

  const validations = drafts.map((draft, index) => {
    const errors: RowValidation["errors"] = [];
    const rowNumber = draft.originalRowNumber || index + 1;

    for (const field of ORDER_FIELDS) {
      if (!field.required) {
        continue;
      }

      const value = draft[field.key].trim();
      if (!value) {
        errors.push({ field: field.key, message: `${field.label}不能为空` });
      }
    }

    if (draft.senderPhone.trim() && !/^1\d{10}$/.test(draft.senderPhone.trim())) {
      errors.push({ field: "senderPhone", message: "发件人电话格式错误" });
    }

    if (draft.receiverPhone.trim() && !/^1\d{10}$/.test(draft.receiverPhone.trim())) {
      errors.push({ field: "receiverPhone", message: "收件人电话格式错误" });
    }

    if (draft.weight.trim()) {
      const weight = Number(draft.weight);
      if (!Number.isFinite(weight) || weight <= 0) {
        errors.push({ field: "weight", message: "重量必须为正数" });
      }
    }

    if (draft.quantity.trim()) {
      const quantity = Number(draft.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0) {
        errors.push({ field: "quantity", message: "件数必须为正整数" });
      }
    }

    if (draft.tempZone.trim() && !TEMP_ZONES.includes(draft.tempZone.trim() as TempZone)) {
      errors.push({ field: "tempZone", message: "温层仅支持 常温 / 冷藏 / 冷冻" });
    }

    const code = draft.externalCode.trim();
    if (code) {
      const duplicates = duplicateMap.get(code) ?? [];
      if (duplicates.length > 1) {
        errors.push({
          field: "externalCode",
          message: `与当前批次第 ${duplicates.join("、")} 行重复`,
        });
      }

      if (existingCodeSet.has(code)) {
        errors.push({ field: "externalCode", message: "与数据库中已存在运单重复" });
      }
    }

    return {
      rowId: draft.id,
      rowNumber,
      errors,
    };
  });

  const allErrors = validations.flatMap((validation) =>
    validation.errors.map(
      (error) => `第 ${validation.rowNumber} 行，${getFieldLabel(error.field)}：${error.message}`,
    ),
  );

  return { validations, allErrors };
}

export function castDraftsToOrders(drafts: OrderDraft[]): ImportedOrder[] {
  return drafts.map((draft) => ({
    externalCode: draft.externalCode.trim(),
    senderName: draft.senderName.trim(),
    senderPhone: draft.senderPhone.trim(),
    senderAddress: draft.senderAddress.trim(),
    receiverName: draft.receiverName.trim(),
    receiverPhone: draft.receiverPhone.trim(),
    receiverAddress: draft.receiverAddress.trim(),
    weight: Number(draft.weight),
    quantity: Number(draft.quantity),
    tempZone: draft.tempZone.trim() as TempZone,
    note: draft.note.trim(),
  }));
}
