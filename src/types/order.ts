export const EXAM_ORDER_FIELDS = [
  "externalCode",
  "receiverStore",
  "receiverName",
  "receiverPhone",
  "receiverAddress",
  "skuCode",
  "skuName",
  "skuQuantity",
  "skuSpec",
  "note",
] as const;

export type OrderFieldKey = (typeof EXAM_ORDER_FIELDS)[number];

export type SupportedFileType = "excel" | "word" | "pdf";

export type RuleMode = "tabular" | "matrix" | "cards" | "plainText";

export type RuleSource = "manual" | "ai" | "heuristic";

export type OrderDraft = {
  id: string;
  originalRowNumber: number;
  externalCode: string;
  receiverStore: string;
  receiverName: string;
  receiverPhone: string;
  receiverAddress: string;
  skuCode: string;
  skuName: string;
  skuQuantity: string;
  skuSpec: string;
  note: string;
};

export type ImportedOrder = Omit<OrderDraft, "id" | "originalRowNumber" | "skuQuantity"> & {
  skuQuantity: number;
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

export type ColumnMapping = Partial<Record<OrderFieldKey, string>>;

export type RuleConfig = {
  mode: RuleMode;
  sheetSelection?: "best" | "first" | "all";
  headerRow?: number | null;
  scanHeaderRows?: number;
  headerAliases?: Partial<Record<OrderFieldKey, string[]>>;
  manualMapping?: ColumnMapping;
  ignoreKeywords?: string[];
  rowEndKeywords?: string[];
  recordSeparator?: string;
  itemLinePattern?: string;
  receiverPatterns?: {
    externalCode?: string;
    receiverStore?: string;
    receiverName?: string;
    receiverPhone?: string;
    receiverAddress?: string;
  };
  sheetTextPatterns?: {
    externalCode?: string;
    receiverStore?: string;
    receiverName?: string;
    receiverPhone?: string;
    receiverAddress?: string;
    note?: string;
  };
  staticValues?: Partial<Record<OrderFieldKey, string>>;
  matrix?: {
    storeColumnStartAfter?: string;
    quantityHeaders?: string[];
  };
  card?: {
    separatorKeyword?: string;
    itemsHeaderKeywords?: string[];
  };
};

export type ImportRule = {
  id: string;
  name: string;
  description: string;
  fileType: SupportedFileType | "any";
  source: RuleSource;
  config: RuleConfig;
  createdAt: string;
  updatedAt: string;
};

export type ParseDocumentSummary = {
  fileName: string;
  fileType: SupportedFileType;
  sheetNames: string[];
  previewText: string;
  detectedMode: RuleMode;
  headerCandidates: string[];
  warnings: string[];
};

export type ParseResult = {
  summary: ParseDocumentSummary;
  rows: OrderDraft[];
  warnings: string[];
};

export type RuleSuggestion = {
  rule: Omit<ImportRule, "id" | "createdAt" | "updatedAt">;
  summary: ParseDocumentSummary;
  reasoning: string[];
  usedModel: string | null;
  provider: string;
};

export type ModelStatus = {
  available: boolean;
  provider: string;
  model: string | null;
  baseUrl: string | null;
  mode: "llm" | "heuristic";
};

export type OrderHistoryItem = ImportedOrder & {
  recordId: string;
  submittedAt: string;
  createdAt: string;
};
