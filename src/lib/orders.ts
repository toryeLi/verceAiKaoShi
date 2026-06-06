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
  { key: "externalCode", label: "外部编码", required: false, placeholder: "PS2605290033" },
  { key: "receiverStore", label: "收货门店", required: false, placeholder: "尹三顺自助烤肉（银泰店）" },
  { key: "receiverName", label: "收件人姓名", required: false, placeholder: "王店长" },
  { key: "receiverPhone", label: "收件人电话", required: false, placeholder: "13900001111" },
  { key: "receiverAddress", label: "收件人地址", required: false, placeholder: "汉口解放大道688号" },
  { key: "skuCode", label: "SKU物品编码", required: true, placeholder: "ZBWP0001" },
  { key: "skuName", label: "SKU物品名称", required: true, placeholder: "茶语柠听紫苏风味糖浆" },
  { key: "skuQuantity", label: "SKU发货数量", required: true, placeholder: "3" },
  { key: "skuSpec", label: "SKU规格型号", required: false, placeholder: "750ml*6瓶/件" },
  { key: "note", label: "备注", required: false, placeholder: "轻拿轻放" },
];

const orderSchema = z.object({
  externalCode: z.string().trim().default(""),
  receiverStore: z.string().trim().default(""),
  receiverName: z.string().trim().default(""),
  receiverPhone: z.string().trim().default(""),
  receiverAddress: z.string().trim().default(""),
  skuCode: z.string().trim().min(1, "SKU物品编码不能为空"),
  skuName: z.string().trim().min(1, "SKU物品名称不能为空"),
  skuQuantity: z.coerce.number().positive("SKU发货数量必须为正数"),
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
    receiverStore: "",
    receiverName: "",
    receiverPhone: "",
    receiverAddress: "",
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
      message: "收货门店 或 收件人姓名+电话+地址 至少填写一组",
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

    if (draft.skuQuantity.trim()) {
      const quantity = Number(draft.skuQuantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        errors.push({ field: "skuQuantity", message: "SKU发货数量必须为正数" });
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
    receiverStore: draft.receiverStore.trim(),
    receiverName: draft.receiverName.trim(),
    receiverPhone: draft.receiverPhone.trim(),
    receiverAddress: draft.receiverAddress.trim(),
    skuCode: draft.skuCode.trim(),
    skuName: draft.skuName.trim(),
    skuQuantity: Number(draft.skuQuantity),
    skuSpec: draft.skuSpec.trim(),
    note: draft.note.trim(),
  }));
}
