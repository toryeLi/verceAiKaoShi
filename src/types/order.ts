export const TEMP_ZONES = ["常温", "冷藏", "冷冻"] as const;

export type TempZone = (typeof TEMP_ZONES)[number];

export type OrderFieldKey =
  | "externalCode"
  | "senderName"
  | "senderPhone"
  | "senderAddress"
  | "receiverName"
  | "receiverPhone"
  | "receiverAddress"
  | "weight"
  | "quantity"
  | "tempZone"
  | "note";

export type OrderDraft = {
  id: string;
  originalRowNumber: number;
  externalCode: string;
  senderName: string;
  senderPhone: string;
  senderAddress: string;
  receiverName: string;
  receiverPhone: string;
  receiverAddress: string;
  weight: string;
  quantity: string;
  tempZone: string;
  note: string;
};

export type FieldError = {
  field: OrderFieldKey;
  message: string;
};

export type RowValidation = {
  rowId: string;
  rowNumber: number;
  errors: FieldError[];
};

export type ImportedOrder = Omit<
  OrderDraft,
  "id" | "originalRowNumber" | "weight" | "quantity" | "tempZone"
> & {
  weight: number;
  quantity: number;
  tempZone: TempZone;
};

export type ColumnMapping = Partial<Record<OrderFieldKey, string>>;

export type ParseResult = {
  fileName: string;
  templateFingerprint: string;
  detectedSheetName: string;
  headerRowIndex: number;
  headers: string[];
  sourceRows: unknown[][];
  mapping: ColumnMapping;
  rows: OrderDraft[];
};

export type TemplateMemoryRecord = {
  fingerprint: string;
  mapping: ColumnMapping;
  updatedAt: string;
};

export type OrderHistoryItem = ImportedOrder & {
  recordId: string;
  submittedAt: string;
  createdAt: string;
};
