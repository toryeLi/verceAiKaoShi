import { z } from "zod";

import type {
  ImportedOrder,
  OrderDraft,
  OrderFieldKey,
  RowValidation,
} from "@/types/order";

export const ORDER_FIELDS: Array<{
  key: OrderFieldKey;
  label: string;
  required: boolean;
  placeholder: string;
}> = [
  { key: "externalCode", label: "运单号", required: false, placeholder: "PS2605290033" },
  { key: "senderStore", label: "发件门店", required: false, placeholder: "武汉仓或发件门店" },
  { key: "senderName", label: "发件人姓名", required: false, placeholder: "张三" },
  { key: "senderPhone", label: "发件人电话", required: false, placeholder: "13900002222" },
  { key: "senderAddress", label: "发件地址", required: false, placeholder: "武汉市汉阳区某某路 1 号" },
  { key: "receiverStore", label: "收货门店", required: false, placeholder: "尹三顺自助烤肉（银泰店）" },
  { key: "receiverName", label: "收件人姓名", required: false, placeholder: "王店长" },
  { key: "receiverPhone", label: "收件人电话", required: false, placeholder: "13900001111" },
  { key: "receiverAddress", label: "收件人地址", required: false, placeholder: "汉口解放大道 688 号" },
  { key: "amount", label: "运单金额", required: false, placeholder: "88.50" },
  { key: "waybillStatus", label: "运单状态", required: false, placeholder: "imported / in_transit / delivered" },
  { key: "sourceUpdatedAt", label: "来源更新时间", required: false, placeholder: "2026-07-06T10:30:00.000Z" },
  { key: "skuCode", label: "SKU 物品编码", required: true, placeholder: "ZBWP0001" },
  { key: "skuName", label: "SKU 物品名称", required: true, placeholder: "茶语柠檬听紫苏风味糖浆" },
  { key: "skuQuantity", label: "SKU 发货数量", required: true, placeholder: "3" },
  { key: "skuSpec", label: "SKU 规格型号", required: false, placeholder: "750ml*6 瓶/件" },
  { key: "note", label: "备注", required: false, placeholder: "轻拿轻放" },
];

const orderSchema = z.object({
  externalCode: z.string().trim().default(""),
  senderStore: z.string().trim().default(""),
  senderName: z.string().trim().default(""),
  senderPhone: z.string().trim().default(""),
  senderAddress: z.string().trim().default(""),
  receiverStore: z.string().trim().default(""),
  receiverName: z.string().trim().default(""),
  receiverPhone: z.string().trim().default(""),
  receiverAddress: z.string().trim().default(""),
  amount: z.coerce.number().min(0, "运单金额不能小于 0").default(0),
  waybillStatus: z.string().trim().default("imported"),
  sourceUpdatedAt: z.string().trim().default(""),
  skuCode: z.string().trim().min(1, "SKU 物品编码不能为空"),
  skuName: z.string().trim().min(1, "SKU 物品名称不能为空"),
  skuQuantity: z.coerce.number().positive("SKU 发货数量必须为正数"),
  skuSpec: z.string().trim().default(""),
  note: z.string().trim().default(""),
});

export const orderBatchSchema = z.object({
  orders: z.array(orderSchema),
});

export function makeBlankDraft(rowNumber: number): OrderDraft {
  return {
    id: crypto.randomUUID(),
    originalRowNumber: rowNumber,
    externalCode: "",
    senderStore: "",
    senderName: "",
    senderPhone: "",
    senderAddress: "",
    receiverStore: "",
    receiverName: "",
    receiverPhone: "",
    receiverAddress: "",
    amount: "0",
    waybillStatus: "imported",
    sourceUpdatedAt: new Date().toISOString(),
    skuCode: "",
    skuName: "",
    skuQuantity: "",
    skuSpec: "",
    note: "",
  };
}

export function hasMeaningfulDraftValue(draft: OrderDraft) {
  return ORDER_FIELDS.some((field) => draft[field.key].trim().length > 0);
}

export function getFieldLabel(field: OrderFieldKey) {
  return ORDER_FIELDS.find((item) => item.key === field)?.label ?? field;
}

function validateReceiverBundle(draft: OrderDraft, errors: RowValidation["errors"]) {
  const hasStore = draft.receiverStore.trim().length > 0;
  const hasReceiverBundle =
    draft.receiverName.trim().length > 0 ||
    draft.receiverPhone.trim().length > 0 ||
    draft.receiverAddress.trim().length > 0;

  if (!hasStore && !hasReceiverBundle) {
    errors.push({
      field: "receiverStore",
      message: "收货门店，或收件人姓名+电话+地址，至少填写一组",
    });
    return;
  }

  if (!hasStore) {
    if (!draft.receiverName.trim()) {
      errors.push({ field: "receiverName", message: "收件人姓名不能为空" });
    }
    if (!draft.receiverPhone.trim()) {
      errors.push({ field: "receiverPhone", message: "收件人电话不能为空" });
    }
    if (!draft.receiverAddress.trim()) {
      errors.push({ field: "receiverAddress", message: "收件人地址不能为空" });
    }
  }
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

    validateReceiverBundle(draft, errors);

    for (const field of ORDER_FIELDS) {
      if (!field.required) {
        continue;
      }

      if (!draft[field.key].trim()) {
        errors.push({ field: field.key, message: `${field.label}不能为空` });
      }
    }

    if (draft.receiverPhone.trim() && !/^1\d{10}$/.test(draft.receiverPhone.trim())) {
      errors.push({ field: "receiverPhone", message: "收件人电话格式错误" });
    }

    if (draft.senderPhone.trim() && !/^1\d{10}$/.test(draft.senderPhone.trim())) {
      errors.push({ field: "senderPhone", message: "发件人电话格式错误" });
    }

    if (draft.skuQuantity.trim()) {
      const quantity = Number(draft.skuQuantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        errors.push({ field: "skuQuantity", message: "SKU 发货数量必须为正数" });
      }
    }

    if (draft.amount.trim()) {
      const amount = Number(draft.amount);
      if (!Number.isFinite(amount) || amount < 0) {
        errors.push({ field: "amount", message: "运单金额必须是 0 或正数" });
      }
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
        errors.push({ field: "externalCode", message: "与数据库中已存在数据重复" });
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
    senderStore: draft.senderStore.trim(),
    senderName: draft.senderName.trim(),
    senderPhone: draft.senderPhone.trim(),
    senderAddress: draft.senderAddress.trim(),
    receiverStore: draft.receiverStore.trim(),
    receiverName: draft.receiverName.trim(),
    receiverPhone: draft.receiverPhone.trim(),
    receiverAddress: draft.receiverAddress.trim(),
    amount: Number(draft.amount || 0),
    waybillStatus: draft.waybillStatus.trim() || "imported",
    sourceUpdatedAt: draft.sourceUpdatedAt.trim() || new Date().toISOString(),
    skuCode: draft.skuCode.trim(),
    skuName: draft.skuName.trim(),
    skuQuantity: Number(draft.skuQuantity),
    skuSpec: draft.skuSpec.trim(),
    note: draft.note.trim(),
  }));
}
