"use client";

import * as XLSX from "xlsx";

import type { OrderDraft } from "@/types/order";

export function exportDraftsToExcel(rows: OrderDraft[]) {
  const headerLabels = [
    "外部编码",
    "收货门店",
    "收件人姓名",
    "收件人电话",
    "收件人地址",
    "SKU物品编码",
    "SKU物品名称",
    "SKU发货数量",
    "SKU规格型号",
    "备注",
  ];

  const worksheet = XLSX.utils.aoa_to_sheet([
    headerLabels,
    ...rows.map((row) => [
      row.externalCode,
      row.receiverStore,
      row.receiverName,
      row.receiverPhone,
      row.receiverAddress,
      row.skuCode,
      row.skuName,
      row.skuQuantity,
      row.skuSpec,
      row.note,
    ]),
  ]);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "导入预览");
  XLSX.writeFile(workbook, `导入预览-${Date.now()}.xlsx`);
}
