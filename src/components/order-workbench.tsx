"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { exportDraftsToExcel } from "@/lib/excel";
import { castDraftsToOrders, makeBlankDraft, ORDER_FIELDS, validateDrafts } from "@/lib/orders";
import type {
  ImportRule,
  ModelStatus,
  OrderDraft,
  OrderHistoryItem,
  ParseResult,
  RuleSuggestion,
  SupportedFileType,
} from "@/types/order";

const PAGE_SIZE = 10;
const SUBMIT_BATCH_SIZE = 200;
const SUGGESTED_RULE_OPTION_ID = "__suggested_rule__";

type Toast = {
  kind: "success" | "error" | "info";
  message: string;
};

type PreviewFailure = {
  fileName: string;
  fileType: SupportedFileType;
  message: string;
  ruleName: string;
  ruleSource: ImportRule["source"];
  previewText: string;
};

type RuleFormState = {
  id?: string;
  name: string;
  description: string;
  fileType: ImportRule["fileType"];
  source: ImportRule["source"];
  configText: string;
};

type WorkspaceSection = "rules" | "batch" | "manual" | "history";

type OrderWorkbenchProps = {
  initialSection?: WorkspaceSection;
};

function buildFormState(rule?: ImportRule): RuleFormState {
  if (!rule) {
    return {
      name: "",
      description: "",
      fileType: "any",
      source: "manual",
      configText: JSON.stringify(
        {
          mode: "tabular",
          sheetSelection: "best",
          scanHeaderRows: 8,
          ignoreKeywords: ["合计"],
          rowEndKeywords: ["合计"],
        },
        null,
        2,
      ),
    };
  }

  return {
    id: rule.id,
    name: rule.name,
    description: rule.description,
    fileType: rule.fileType,
    source: rule.source,
    configText: JSON.stringify(rule.config, null, 2),
  };
}

function buildValidationMap(rows: ReturnType<typeof validateDrafts>["validations"]) {
  const map = new Map<string, Map<string, string>>();

  rows.forEach((row) => {
    const fieldMap = new Map<string, string>();
    row.errors.forEach((error) => {
      fieldMap.set(error.field, error.message);
    });
    map.set(row.rowId, fieldMap);
  });

  return map;
}

function splitIntoBatches<T>(items: T[], batchSize: number) {
  const batches: T[][] = [];

  for (let index = 0; index < items.length; index += batchSize) {
    batches.push(items.slice(index, index + batchSize));
  }

  return batches;
}

function getSuggestedRuleFileType(fileName: string): SupportedFileType {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    return "excel";
  }
  if (lower.endsWith(".docx")) {
    return "word";
  }
  return "pdf";
}

function isSameRuleForm(left: RuleFormState, right: RuleFormState) {
  return (
    (left.id ?? "") === (right.id ?? "") &&
    left.name === right.name &&
    left.description === right.description &&
    left.fileType === right.fileType &&
    left.source === right.source &&
    left.configText === right.configText
  );
}

export function OrderWorkbench({ initialSection = "batch" }: OrderWorkbenchProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const duplicateCheckTimerRef = useRef<number | null>(null);
  const ruleSelectTimerRef = useRef<number | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewResult, setPreviewResult] = useState<ParseResult | null>(null);
  const [previewFailure, setPreviewFailure] = useState<PreviewFailure | null>(null);
  const [draftRows, setDraftRows] = useState<OrderDraft[]>([]);
  const [existingCodes, setExistingCodes] = useState<string[]>([]);
  const [importProgress, setImportProgress] = useState({ completed: 0, total: 0 });
  const [submitProgress, setSubmitProgress] = useState({ completed: 0, total: 0 });
  const [toast, setToast] = useState<Toast | null>(null);

  const [rules, setRules] = useState<ImportRule[]>([]);
  const [selectedRuleId, setSelectedRuleId] = useState("");
  const [ruleForm, setRuleForm] = useState<RuleFormState>(buildFormState());
  const [suggestion, setSuggestion] = useState<RuleSuggestion | null>(null);
  const [suggestionPreviewRows, setSuggestionPreviewRows] = useState(0);
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const [activeSection, setActiveSection] = useState<WorkspaceSection>(initialSection);

  const [history, setHistory] = useState<OrderHistoryItem[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyKeyword, setHistoryKeyword] = useState("");
  const [historyDate, setHistoryDate] = useState("");

  const [isParsing, startParsing] = useTransition();
  const [isSubmitting, startSubmitting] = useTransition();
  const [isRulesLoading, startRulesLoading] = useTransition();
  const [isHistoryLoading, startHistoryLoading] = useTransition();
  const [isSuggesting, startSuggesting] = useTransition();
  const [isSavingRule, startSavingRule] = useTransition();
  const [isDeletingRule, setIsDeletingRule] = useState(false);
  const [isApplyingSuggestion, setIsApplyingSuggestion] = useState(false);
  const [isDeletingAllOrders, setIsDeletingAllOrders] = useState(false);
  const [isRuleSwitching, setIsRuleSwitching] = useState(false);

  const deferredDraftRows = useDeferredValue(draftRows);
  const deferredExistingCodes = useDeferredValue(existingCodes);

  const validationState = useMemo(
    () => validateDrafts(deferredDraftRows, deferredExistingCodes),
    [deferredDraftRows, deferredExistingCodes],
  );

  const validationMap = useMemo(
    () => buildValidationMap(validationState.validations),
    [validationState.validations],
  );

  const invalidRowCount = validationState.validations.filter((item) => item.errors.length > 0).length;

  useEffect(() => {
    if (!toast) {
      return undefined;
    }

    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    void refreshRules();
    void refreshHistory(1, "", "");
    void refreshModelStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (ruleSelectTimerRef.current) {
        window.clearTimeout(ruleSelectTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (activeSection !== "manual" || draftRows.length > 0) {
      return;
    }

    fillSingleManualDraft();
  }, [activeSection, draftRows.length]);

  function notifyRequestPending() {
    setToast({ kind: "info", message: "正在请求中，请稍后再试" });
  }

  function resetPreviewState() {
    setPreviewResult(null);
    setPreviewFailure(null);
    setDraftRows([]);
    setExistingCodes([]);
    setImportProgress({ completed: 0, total: 0 });
    setSubmitProgress({ completed: 0, total: 0 });
  }

  function scheduleDuplicateCheck(rows: OrderDraft[]) {
    if (duplicateCheckTimerRef.current) {
      window.clearTimeout(duplicateCheckTimerRef.current);
    }

    duplicateCheckTimerRef.current = window.setTimeout(() => {
      const codes = rows.map((row) => row.externalCode.trim()).filter(Boolean);
      if (codes.length === 0) {
        setExistingCodes([]);
        return;
      }
      void queryExistingCodes(codes);
    }, 300);
  }

  async function queryExistingCodes(codes: string[]) {
    try {
      const response = await fetch("/api/orders/duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codes }),
      });
      const data = (await response.json()) as { duplicates: string[] };
      setExistingCodes(data.duplicates ?? []);
    } catch {
      setExistingCodes([]);
    }
  }

  async function refreshRules() {
    startRulesLoading(async () => {
      try {
        const response = await fetch("/api/import-rules");
        const data = (await response.json()) as { items: ImportRule[]; message?: string };
        const items = data.items ?? [];
        setRules(items);

        if (!selectedRuleId && items[0]) {
          setSelectedRuleId(items[0].id);
          setRuleForm(buildFormState(items[0]));
        } else if (selectedRuleId) {
          const matched = items.find((item) => item.id === selectedRuleId);
          if (matched) {
            setRuleForm((current) => (current.id === matched.id ? current : buildFormState(matched)));
          }
        }
      } catch {
        setToast({ kind: "error", message: "规则列表加载失败" });
      }
    });
  }

  async function refreshModelStatus() {
    try {
      const response = await fetch("/api/import-rules/suggest");
      const data = (await response.json()) as ModelStatus;
      setModelStatus(data);
    } catch {
      setModelStatus({
        available: false,
        provider: "heuristic",
        model: null,
        baseUrl: null,
        mode: "heuristic",
      });
    }
  }

  async function refreshHistory(page = historyPage, keyword = historyKeyword, date = historyDate) {
    startHistoryLoading(async () => {
      try {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: String(PAGE_SIZE),
          q: keyword,
          date,
        });
        const response = await fetch(`/api/history?${params.toString()}`);
        const data = (await response.json()) as { items: OrderHistoryItem[]; total: number };
        setHistory(data.items ?? []);
        setHistoryTotal(data.total ?? 0);
        setHistoryPage(page);
      } catch {
        setToast({ kind: "error", message: "历史列表加载失败" });
      }
    });
  }

  function selectRule(rule: ImportRule) {
    if (isRulesLoading || isSavingRule || isDeletingRule || isApplyingSuggestion || isParsing) {
      notifyRequestPending();
      return;
    }

    if (isRuleSwitching) {
      setToast({ kind: "info", message: "正在切换规则，请稍后再试" });
      return;
    }

    if (rule.id === selectedRuleId) {
      return;
    }

    setIsRuleSwitching(true);
    if (ruleSelectTimerRef.current) {
      window.clearTimeout(ruleSelectTimerRef.current);
    }

    ruleSelectTimerRef.current = window.setTimeout(() => {
      setSelectedRuleId(rule.id);
      setRuleForm(buildFormState(rule));
      setSuggestion(null);
      setSuggestionPreviewRows(0);
      setIsRuleSwitching(false);
      ruleSelectTimerRef.current = null;
    }, 120);
  }

  function handleFileSelection(file: File) {
    setSelectedFile(file);
    resetPreviewState();
    setSuggestion(null);
    setSuggestionPreviewRows(0);
    if (selectedRuleId === SUGGESTED_RULE_OPTION_ID) {
      setSelectedRuleId("");
      setRuleForm(buildFormState());
    }
    setToast({ kind: "info", message: `已选择文件：${file.name}` });
  }

  function hasManualContent(row: OrderDraft) {
    return (
      [
        row.externalCode,
        row.senderStore,
        row.senderName,
        row.senderPhone,
        row.senderAddress,
        row.receiverStore,
        row.receiverName,
        row.receiverPhone,
        row.receiverAddress,
        row.skuCode,
        row.skuName,
        row.skuQuantity,
        row.skuSpec,
        row.note,
      ].some((value) => value.trim().length > 0) ||
      row.amount.trim() !== "0" ||
      row.waybillStatus.trim() !== "imported"
    );
  }

  function fillSingleManualDraft() {
    const next = [makeBlankDraft(1)];
    setDraftRows(next);
    scheduleDuplicateCheck(next);
  }

  function ensureManualDraftRows() {
    if (draftRows.length > 0) {
      return;
    }

    fillSingleManualDraft();
  }

  function resetToManualDraft() {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    setSelectedFile(null);
    resetPreviewState();
    setSuggestion(null);
    setSuggestionPreviewRows(0);

    if (selectedRuleId === SUGGESTED_RULE_OPTION_ID) {
      setSelectedRuleId("");
      setRuleForm(buildFormState());
    }

    fillSingleManualDraft();
  }

  function switchSection(nextSection: WorkspaceSection) {
    if (nextSection !== "manual") {
      setActiveSection(nextSection);
      return;
    }

    if (activeSection === "manual") {
      ensureManualDraftRows();
      return;
    }

    const hasBatchContext = Boolean(
      selectedFile ||
        previewResult ||
        previewFailure ||
        suggestion ||
        selectedRuleId === SUGGESTED_RULE_OPTION_ID,
    );

    if (hasBatchContext) {
      const confirmed = window.confirm("切换到人工录单将清空当前批量导入草稿，是否继续？");
      if (!confirmed) {
        return;
      }
      resetToManualDraft();
      setActiveSection("manual");
      return;
    }

    setActiveSection("manual");
    ensureManualDraftRows();
  }

  function handleResetManualDraft() {
    if (draftRows.some(hasManualContent)) {
      const confirmed = window.confirm("确定清空当前录单草稿并重新开始吗？");
      if (!confirmed) {
        return;
      }
    }

    resetToManualDraft();
    setActiveSection("manual");
  }

  async function handleSuggestRule() {
    if (isSuggesting) {
      notifyRequestPending();
      return;
    }

    if (!selectedFile) {
      setToast({ kind: "info", message: "请先选择文件" });
      return;
    }

    setSuggestion(null);
    setSuggestionPreviewRows(0);

    startSuggesting(async () => {
      try {
        const formData = new FormData();
        formData.append("file", selectedFile);

        const response = await fetch("/api/import-rules/suggest", {
          method: "POST",
          body: formData,
        });

        const data = (await response.json()) as RuleSuggestion & { message?: string };
        if (!response.ok) {
          throw new Error(data.message ?? "规则推荐失败");
        }

        setSuggestion(data);
        setRuleForm({
          name: data.rule.name,
          description: data.rule.description,
          fileType: data.rule.fileType,
          source: data.rule.source,
          configText: JSON.stringify(data.rule.config, null, 2),
        });
        setSelectedRuleId(SUGGESTED_RULE_OPTION_ID);
        setToast({
          kind: "success",
          message: data.usedModel ? `已生成 AI 推荐规则（${data.usedModel}）` : "已生成推荐规则",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "规则推荐失败";
        setToast({ kind: "error", message });
      }
    });
  }

  function buildPreviewRulePayload() {
    return {
      name: ruleForm.name.trim(),
      description: ruleForm.description.trim(),
      fileType: ruleForm.fileType,
      source: ruleForm.source,
      config: JSON.parse(ruleForm.configText),
    };
  }

  async function handleCopyRule(rule: ImportRule) {
    if (isRuleSelectionLocked) {
      notifyRequestPending();
      return;
    }

    if (!confirmDiscardDirtyRuleForm()) {
      return;
    }

    setSelectedRuleId("");
    setSuggestion(null);
    setSuggestionPreviewRows(0);
    setRuleForm({
      name: `${rule.name} - 副本`,
      description: rule.description,
      fileType: rule.fileType,
      source: "manual",
      configText: JSON.stringify(rule.config, null, 2),
    });
    setToast({ kind: "info", message: "已创建规则副本，请确认后保存" });
  }

  async function handleSaveRule() {
    if (isSavingRule) {
      notifyRequestPending();
      return;
    }

    let config: unknown;
    try {
      config = JSON.parse(ruleForm.configText);
    } catch {
      setToast({ kind: "error", message: "规则 JSON 格式错误" });
      return;
    }

    const payload = {
      name: ruleForm.name.trim(),
      description: ruleForm.description.trim(),
      fileType: ruleForm.fileType,
      source: ruleForm.source,
      config,
    };

    if (!payload.name) {
      setToast({ kind: "error", message: "规则名称不能为空" });
      return;
    }

    startSavingRule(async () => {
      try {
        const isUpdate = Boolean(ruleForm.id);
        const response = await fetch(isUpdate ? `/api/import-rules/${ruleForm.id}` : "/api/import-rules", {
          method: isUpdate ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = (await response.json()) as { item?: ImportRule; message?: string };

        if (!response.ok || !data.item) {
          throw new Error(data.message ?? "规则保存失败");
        }

        await refreshRules();
        setSelectedRuleId(data.item.id);
        setRuleForm(buildFormState(data.item));
        setToast({ kind: "success", message: isUpdate ? "规则已更新" : "规则已创建" });
      } catch (error) {
        const message = error instanceof Error ? error.message : "规则保存失败";
        setToast({ kind: "error", message });
      }
    });
  }

  async function handleDeleteRule() {
    if (isDeletingRule) {
      notifyRequestPending();
      return;
    }

    if (!ruleForm.id) {
      setRuleForm(buildFormState());
      return;
    }

    const confirmed = window.confirm("确定删除当前规则吗？");
    if (!confirmed) {
      return;
    }

    setIsDeletingRule(true);
    try {
      const response = await fetch(`/api/import-rules/${ruleForm.id}`, { method: "DELETE" });
      const data = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(data.message ?? "规则删除失败");
      }

      setRuleForm(buildFormState());
      setSelectedRuleId("");
      await refreshRules();
      setToast({ kind: "success", message: "规则已删除" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "规则删除失败";
      setToast({ kind: "error", message });
    } finally {
      setIsDeletingRule(false);
    }
  }

  async function handlePreviewWithRule(ruleId: string) {
    if (isParsing) {
      notifyRequestPending();
      return null;
    }

    if (!selectedFile) {
      setToast({ kind: "info", message: "请先选择文件" });
      return null;
    }

    let previewRulePayload: ReturnType<typeof buildPreviewRulePayload> | null = null;
    try {
      previewRulePayload = buildPreviewRulePayload();
    } catch {
      setToast({ kind: "error", message: "规则 JSON 格式错误" });
      return null;
    }

    if (ruleId === SUGGESTED_RULE_OPTION_ID) {
      return await handlePreviewSuggestion();
    }

    return new Promise<ParseResult | null>((resolve) => {
      startParsing(async () => {
        try {
          setImportProgress({ completed: 20, total: 100 });
          setPreviewFailure(null);
          const formData = new FormData();
          formData.append("file", selectedFile);
          if (ruleId) {
            formData.append("ruleId", ruleId);
          } else if (previewRulePayload) {
            formData.append("rule", JSON.stringify(previewRulePayload));
          }

          const response = await fetch("/api/import-preview", {
            method: "POST",
            body: formData,
          });

          const data = (await response.json()) as ParseResult & { message?: string };
          if (!response.ok) {
            throw new Error(data.message ?? "试解析失败");
          }

          setImportProgress({ completed: 100, total: 100 });
          setPreviewResult(data);
          setPreviewFailure(null);
          setDraftRows(data.rows ?? []);
          scheduleDuplicateCheck(data.rows ?? []);
          setToast({
            kind: "success",
            message: `试解析完成，得到 ${(data.rows ?? []).length} 行明细`,
          });
          resolve(data);
        } catch (error) {
          const message = error instanceof Error ? error.message : "试解析失败";
          setImportProgress({ completed: 0, total: 0 });
          resetPreviewState();
          setPreviewFailure({
            fileName: selectedFile.name,
            fileType: getSuggestedRuleFileType(selectedFile.name),
            message,
            ruleName: previewRulePayload?.name || ruleForm.name.trim() || "临时规则",
            ruleSource: previewRulePayload?.source ?? ruleForm.source,
            previewText: previewRulePayload ? JSON.stringify(previewRulePayload.config, null, 2).slice(0, 800) : "",
          });
          setToast({ kind: "error", message });
          resolve(null);
        }
      });
    });
  }

  async function handlePreviewSuggestion(): Promise<ParseResult | null> {
    if (isApplyingSuggestion) {
      notifyRequestPending();
      return null;
    }

    if (!suggestion || !selectedFile) {
      return null;
    }

    setIsApplyingSuggestion(true);
    try {
      const response = await fetch("/api/import-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(suggestion.rule),
      });
      const data = (await response.json()) as { item?: ImportRule; message?: string };

      if (!response.ok || !data.item) {
        throw new Error(data.message ?? "推荐规则创建失败");
      }

      await refreshRules();
      setSelectedRuleId(data.item.id);
      setRuleForm(buildFormState(data.item));
      const preview = await handlePreviewWithRule(data.item.id);
      setSuggestionPreviewRows(preview?.rows.length ?? 0);
      return preview;
    } catch (error) {
      const message = error instanceof Error ? error.message : "推荐规则试解析失败";
      setToast({ kind: "error", message });
      return null;
    } finally {
      setIsApplyingSuggestion(false);
    }
  }

  function updateDraft(rowId: string, field: keyof OrderDraft, value: string) {
    setDraftRows((current) => {
      const next = current.map((row) => (row.id === rowId ? { ...row, [field]: value } : row));
      if (field === "externalCode") {
        scheduleDuplicateCheck(next);
      }
      return next;
    });
  }

  function addBlankRow() {
    setDraftRows((current) => {
      const next = [...current, makeBlankDraft(current.length + 1)];
      scheduleDuplicateCheck(next);
      return next;
    });
  }

  function removeRow(rowId: string) {
    setDraftRows((current) => {
      const next = current.filter((row) => row.id !== rowId);
      scheduleDuplicateCheck(next);
      return next;
    });
  }

  async function handleSubmit() {
    if (isSubmitting) {
      notifyRequestPending();
      return;
    }

    if (draftRows.length === 0) {
      setToast({ kind: "info", message: "当前没有可提交的数据" });
      return;
    }

    if (validationState.allErrors.length > 0) {
      setToast({ kind: "error", message: "存在校验错误，无法提交" });
      return;
    }

    startSubmitting(async () => {
      try {
        const orders = castDraftsToOrders(draftRows);
        const batches = splitIntoBatches(orders, SUBMIT_BATCH_SIZE);
        let completed = 0;
        let successTotal = 0;
        let failedTotal = 0;

        setSubmitProgress({ completed: 0, total: orders.length });

        for (const batch of batches) {
          const response = await fetch("/api/orders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orders: batch }),
          });

          const data = (await response.json()) as {
            message?: string;
            success?: number;
            failed?: number;
          };

          if (!response.ok) {
            throw new Error(data.message ?? "提交失败");
          }

          completed += batch.length;
          successTotal += data.success ?? 0;
          failedTotal += data.failed ?? 0;
          setSubmitProgress({ completed, total: orders.length });
        }

        setToast({
          kind: failedTotal ? "info" : "success",
          message: `提交完成：成功 ${successTotal} 条，失败 ${failedTotal} 条`,
        });

        if (failedTotal === 0) {
          if (fileInputRef.current) {
            fileInputRef.current.value = "";
          }
          setSelectedFile(null);
          resetPreviewState();
          if (activeSection === "manual") {
            fillSingleManualDraft();
          }
        }

        await refreshHistory(1, historyKeyword, historyDate);
      } catch (error) {
        const message = error instanceof Error ? error.message : "提交失败";
        setToast({ kind: "error", message });
      }
    });
  }

  async function handleDeleteAllImportedOrders() {
    if (isDeletingAllOrders) {
      notifyRequestPending();
      return;
    }

    const confirmed = window.confirm("确定要删除所有已导入运单数据吗？此操作不可恢复。");
    if (!confirmed) {
      return;
    }

    setIsDeletingAllOrders(true);
    try {
      const response = await fetch("/api/orders", { method: "DELETE" });
      const data = (await response.json()) as { deleted?: number; message?: string };

      if (!response.ok) {
        throw new Error(data.message ?? "清空失败");
      }

      await refreshHistory(1, historyKeyword, historyDate);
      setToast({ kind: "success", message: `已删除 ${data.deleted ?? 0} 条记录` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "清空失败";
      setToast({ kind: "error", message });
    } finally {
      setIsDeletingAllOrders(false);
    }
  }

  const historyTotalPages = historyTotal > 0 ? Math.ceil(historyTotal / PAGE_SIZE) : 0;
  const validationSummary = `${validationState.allErrors.length} 条错误 / ${invalidRowCount} 行`;
  const selectedRule = rules.find((item) => item.id === selectedRuleId) ?? null;
  const isRuleSelectionLocked =
    isRulesLoading || isSavingRule || isDeletingRule || isApplyingSuggestion || isParsing || isRuleSwitching;
  const baselineRuleForm = buildFormState(selectedRule ?? undefined);
  const isRuleFormDirty = !isSameRuleForm(ruleForm, baselineRuleForm);
  const topNavItems = ["网络货运", "冷链智运", "智冷仓链", "更多租户"];
  const sectionItems: Array<{
    key: WorkspaceSection;
    label: string;
    eyebrow: string;
    title: string;
    description: string;
    chips: string[];
  }> = [
    {
      key: "rules",
      label: "规则管理",
      eyebrow: "Rule Center",
      title: "导入规则管理",
      description: "维护不同文件模板的解析规则，支持手工编辑、刷新和 AI 推荐规则落库。",
      chips: ["规则配置", "AI建议", "模板适配"],
    },
    {
      key: "batch",
      label: "批量录单",
      eyebrow: "Batch Entry",
      title: "批量录单工作台",
      description: "完成文件上传、试解析、在线修正、校验与批量提交，是当前项目的核心录单入口。",
      chips: ["文件导入", "在线校验", "批量提交"],
    },
    {
      key: "manual",
      label: "人工录单",
      eyebrow: "Manual Entry",
      title: "人工录单工作台",
      description: "直接按运单字段人工补录数据，无需上传文件，提交链路与批量导入完全一致。",
      chips: ["人工录入", "实时校验", "直接提交"],
    },
    {
      key: "history",
      label: "已导入运单",
      eyebrow: "Imported Orders",
      title: "已导入运单查询",
      description: "按关键字和日期检索已入库记录，查看导入后的运单结果并支持批量清理。",
      chips: ["历史检索", "分页浏览", "数据清理"],
    },
  ];
  const currentSection = sectionItems.find((item) => item.key === activeSection) ?? sectionItems[1];
  const statusCards = [
    { label: "当前文件", value: selectedFile?.name ?? "未选择" },
    { label: "当前规则", value: selectedRule?.name ?? suggestion?.rule.name ?? "未选择" },
    { label: "校验状态", value: draftRows.length ? validationSummary : activeSection === "manual" ? "等待录单" : "等待试解析" },
    { label: "规则建议引擎", value: modelStatus?.mode === "llm" ? modelStatus.provider : "启发式回退" },
  ];

  function confirmDiscardDirtyRuleForm() {
    if (!isRuleFormDirty) {
      return true;
    }

    return window.confirm("当前规则编辑内容尚未保存，继续操作将丢失修改。是否继续？");
  }

  function renderDraftEditorPanel(options: {
    title: string;
    description: string;
    emptyMessage: string;
    showPreviewSummary?: boolean;
    showResetAction?: boolean;
  }) {
    return (
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>{options.title}</h2>
            <p>{options.description}</p>
          </div>
          <div className="button-row">
            <button className="ghost-button" type="button" onClick={addBlankRow}>
              新增空行
            </button>
            {options.showResetAction ? (
              <button className="ghost-button" type="button" onClick={handleResetManualDraft}>
                清空重录
              </button>
            ) : null}
            <button
              className="ghost-button"
              type="button"
              disabled={draftRows.length === 0}
              onClick={() => exportDraftsToExcel(draftRows)}
            >
              导出 Excel
            </button>
          </div>
        </div>

        {options.showPreviewSummary && previewResult ? (
          <div className="summary-grid">
            <div className="summary-card">
              <span>文件类型</span>
              <strong>{previewResult.summary.fileType}</strong>
            </div>
            <div className="summary-card">
              <span>识别模式</span>
              <strong>{previewResult.summary.detectedMode}</strong>
            </div>
            <div className="summary-card">
              <span>试解析行数</span>
              <strong>{previewResult.rows.length}</strong>
            </div>
          </div>
        ) : null}

        {options.showPreviewSummary && previewResult?.warnings.length ? (
          <div className="warning-box">
            <strong>试解析提示</strong>
            <ul className="reason-list">
              {previewResult.warnings.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {options.showPreviewSummary && previewFailure ? (
          <div className="warning-box preview-failure-box">
            <strong>试解析失败</strong>
            <div className="failure-meta">
              <span>文件：{previewFailure.fileName}</span>
              <span>类型：{previewFailure.fileType}</span>
              <span>规则：{previewFailure.ruleName}</span>
              <span>来源：{previewFailure.ruleSource}</span>
            </div>
            <p className="failure-message">{previewFailure.message}</p>
            {previewFailure.previewText ? (
              <textarea className="failure-preview" readOnly rows={10} value={previewFailure.previewText} />
            ) : null}
            <div className="button-row">
              <button className="ghost-button" type="button" onClick={() => switchSection("rules")}>
                去规则管理
              </button>
            </div>
          </div>
        ) : null}

        <div className="table-shell">
          <table className="order-table">
            <thead>
              <tr>
                <th>行号</th>
                {ORDER_FIELDS.map((field) => (
                  <th key={field.key}>{field.required ? `${field.label} *` : field.label}</th>
                ))}
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {draftRows.length === 0 ? (
                <tr>
                  <td colSpan={ORDER_FIELDS.length + 2} className="empty-cell">
                    {options.emptyMessage}
                  </td>
                </tr>
              ) : (
                draftRows.map((row, index) => {
                  const rowErrors = validationMap.get(row.id) ?? new Map<string, string>();
                  return (
                    <tr key={row.id} className={rowErrors.size > 0 ? "row-error" : ""}>
                      <td>{row.originalRowNumber || index + 1}</td>
                      {ORDER_FIELDS.map((field) => {
                        const error = rowErrors.get(field.key);
                        return (
                          <td key={field.key}>
                            <input
                              className={error ? "cell-input input-error" : "cell-input"}
                              value={row[field.key]}
                              placeholder={field.placeholder}
                              title={error}
                              onChange={(event) =>
                                updateDraft(row.id, field.key as keyof OrderDraft, event.target.value)
                              }
                            />
                            {error ? <span className="inline-error">{error}</span> : null}
                          </td>
                        );
                      })}
                      <td>
                        <button className="danger-link" type="button" onClick={() => removeRow(row.id)}>
                          删除
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="error-board">
          <div className="error-board-head">
            <h3>全量错误列表</h3>
            <span className="muted-text">{validationSummary}</span>
          </div>
          {validationState.allErrors.length === 0 ? (
            <p className="muted-text">当前没有错误。</p>
          ) : (
            <div className="error-board-body">
              <ul>
                {validationState.allErrors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>
    );
  }

  function renderSubmitPanel(options: {
    title: string;
    description: string;
    submitLabel: string;
  }) {
    return (
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>{options.title}</h2>
            <p>{options.description}</p>
          </div>
          <button className="primary-button" type="button" disabled={isSubmitting} onClick={() => void handleSubmit()}>
            {isSubmitting ? "提交中..." : options.submitLabel}
          </button>
        </div>

        <div className="submit-bar">
          <div className="progress-meta">
            <span>提交进度</span>
            <span>
              {submitProgress.total > 0
                ? `${submitProgress.completed}/${submitProgress.total}`
                : "未开始"}
            </span>
          </div>
          <div className="progress-bar">
            <div
              className="progress-value warm"
              style={{
                width:
                  submitProgress.total > 0
                    ? `${(submitProgress.completed / submitProgress.total) * 100}%`
                    : "0%",
              }}
            />
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="app-frame">
      <header className="app-topbar">
        <div className="brand-block">
          <div className="brand-logo">ZT</div>
          <div className="brand-meta">
            <strong>中通冷链</strong>
            <span>ZTO COLD CHAIN</span>
          </div>
        </div>
        <nav className="top-nav">
          {topNavItems.map((item) => (
            <span key={item} className="top-nav-item">
              {item}
            </span>
          ))}
        </nav>
        <div className="topbar-actions">
          <Link href="/">工作台首页</Link>
          <Link href="/manual-entry">人工录单页</Link>
          <span>返回旧版</span>
          <span>快捷脱离</span>
          <span>消息</span>
          <span>导出</span>
          <span>下载</span>
        </div>
      </header>

      <div className="app-body">
        <aside className="app-sidebar">
          <div className="sidebar-head">
            <span>功能导航</span>
            <button type="button">⌄</button>
          </div>
          <div className="sidebar-search">按功能切换工作区</div>
          <div className="sidebar-menu">
            {sectionItems.map((item) => (
              <button
                key={item.key}
                type="button"
                className={activeSection === item.key ? "sidebar-item active" : "sidebar-item"}
                onClick={() => switchSection(item.key)}
              >
                {item.label}
                <small>{item.eyebrow}</small>
              </button>
            ))}
          </div>
        </aside>

        <main className="app-main">
          <div className="workspace-tabs">
            {sectionItems.map((item) => (
              <button
                key={item.key}
                type="button"
                className={activeSection === item.key ? "workspace-tab current" : "workspace-tab"}
                onClick={() => switchSection(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="page-shell">
            <section className="workspace-toolbar">
              <div className="toolbar-title">
                <p className="eyebrow">{currentSection.eyebrow}</p>
                <h1>{currentSection.title}</h1>
                <p className="hero-copy">{currentSection.description}</p>
              </div>
              <div className="toolbar-actions">
                {currentSection.chips.map((chip) => (
                  <span key={chip} className="toolbar-chip">
                    {chip}
                  </span>
                ))}
              </div>
            </section>

            <div className="workspace-content">
              <div className="workspace-main">
                {activeSection === "rules" ? (
                  <section className="panel panel-grid">
        <div className="panel-header">
          <div>
            <h2>规则管理</h2>
            <p>规则持久化保存在服务端。可手工配置，也可让 AI 先生成初始规则再人工微调。</p>
          </div>
          <div className="button-row">
            <button
              className="ghost-button"
              type="button"
              onClick={() => {
                if (!confirmDiscardDirtyRuleForm()) {
                  return;
                }
                setSelectedRuleId("");
                setRuleForm(buildFormState());
                setSuggestion(null);
              }}
            >
              新建规则
            </button>
            <button
              className="ghost-button"
              type="button"
              disabled={isRulesLoading}
              onClick={() => {
                if (isRulesLoading) {
                  notifyRequestPending();
                  return;
                }
                void refreshRules();
              }}
            >
              {isRulesLoading ? "刷新中..." : "刷新列表"}
            </button>
            <span className="muted-text">
              {isRuleSwitching ? "规则切换中..." : isRuleFormDirty ? "有未保存修改" : ""}
            </span>
          </div>
        </div>

        <div className="rule-layout">
          <div className="rule-list">
            {rules.map((rule) => (
              <button
                key={rule.id}
                type="button"
                disabled={isRuleSelectionLocked}
                className={selectedRuleId === rule.id ? "rule-card active" : "rule-card"}
                onClick={() => {
                  if (!confirmDiscardDirtyRuleForm()) {
                    return;
                  }
                  selectRule(rule);
                }}
              >
                <strong>{rule.name}</strong>
                <span>{rule.description || "未填写描述"}</span>
                <small>
                  {rule.fileType} · {rule.source}
                </small>
                <span className="rule-card-action">复制规则</span>
              </button>
            ))}
          </div>

          <div className="rule-editor">
            <div className="form-grid">
              <label className="field">
                <span>规则名称</span>
                <input
                  value={ruleForm.name}
                  onChange={(event) => setRuleForm((current) => ({ ...current, name: event.target.value }))}
                />
              </label>

              <label className="field">
                <span>适用文件类型</span>
                <select
                  value={ruleForm.fileType}
                  onChange={(event) =>
                    setRuleForm((current) => ({
                      ...current,
                      fileType: event.target.value as ImportRule["fileType"],
                    }))
                  }
                >
                  <option value="any">任意</option>
                  <option value="excel">Excel</option>
                  <option value="word">Word</option>
                  <option value="pdf">PDF</option>
                </select>
              </label>

              <label className="field field-full">
                <span>规则描述</span>
                <input
                  value={ruleForm.description}
                  onChange={(event) =>
                    setRuleForm((current) => ({ ...current, description: event.target.value }))
                  }
                />
              </label>

              <label className="field field-full">
                <span>规则 JSON</span>
                <textarea
                  rows={18}
                  value={ruleForm.configText}
                  onChange={(event) =>
                    setRuleForm((current) => ({ ...current, configText: event.target.value }))
                  }
                />
              </label>
            </div>

            <div className="button-row">
              <button className="primary-button" type="button" onClick={() => void handleSaveRule()}>
                {isSavingRule ? "保存中..." : ruleForm.id ? "更新规则" : "创建规则"}
              </button>
              <button
                className="ghost-button"
                type="button"
                disabled={!ruleForm.id || isRuleSelectionLocked}
                onClick={() => {
                  const currentRule = rules.find((item) => item.id === ruleForm.id);
                  if (currentRule) {
                    void handleCopyRule(currentRule);
                  }
                }}
              >
                复制当前规则
              </button>
              <button className="ghost-button" type="button" disabled={isDeletingRule} onClick={() => void handleDeleteRule()}>
                {isDeletingRule ? "删除中..." : "删除当前规则"}
              </button>
            </div>
          </div>
        </div>
                  </section>
                ) : null}

                {activeSection === "batch" ? (
                  <>
                    <section className="panel">
        <div className="panel-header">
          <div>
            <h2>上传文件与 AI 规则建议</h2>
            <p>先上传文件，再选择已有规则试解析，或让 AI/启发式先生成一版推荐规则。</p>
          </div>
          <div className="button-row">
            <button className="ghost-button" type="button" onClick={() => fileInputRef.current?.click()}>
              选择文件
            </button>
            <button
              className="ghost-button"
              type="button"
              disabled={isSuggesting}
              onClick={() => {
                if (!confirmDiscardDirtyRuleForm()) {
                  return;
                }
                void handleSuggestRule();
              }}
            >
              {isSuggesting ? "分析中..." : "AI 建议规则"}
            </button>
          </div>
        </div>

        <div className="status-strip">
          <span className={modelStatus?.mode === "llm" ? "status-badge status-live" : "status-badge"}>
            {modelStatus?.mode === "llm" ? "LLM 已接入" : "当前使用启发式"}
          </span>
          <span className="muted-text">
            Provider：{modelStatus?.provider ?? "未知"}
          </span>
          <span className="muted-text">
            Model：{modelStatus?.model ?? "未配置"}
          </span>
          <span className="muted-text text-ellipsis">
            Base URL：{modelStatus?.baseUrl ?? "未配置"}
          </span>
          {modelStatus?.reason ? <span className="muted-text">Reason：{modelStatus.reason}</span> : null}
          {modelStatus?.envKey ? <span className="muted-text">Key Env：{modelStatus.envKey}</span> : null}
        </div>

        <input
          ref={fileInputRef}
          className="hidden-input"
          type="file"
          accept=".xlsx,.xls,.docx,.pdf"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              handleFileSelection(file);
            }
          }}
        />

        <label
          className="dropzone"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const file = event.dataTransfer.files?.[0];
            if (file) {
              handleFileSelection(file);
            }
          }}
        >
          <strong>拖拽文件到此处</strong>
          <span>支持 .xlsx / .xls / .docx / .pdf</span>
        </label>

        <div className="inline-actions">
          <select
            value={selectedRuleId}
            onChange={(event) => {
              if (!confirmDiscardDirtyRuleForm()) {
                return;
              }
              const nextRuleId = event.target.value;
              setSelectedRuleId(nextRuleId);
              if (nextRuleId === SUGGESTED_RULE_OPTION_ID && suggestion) {
                setRuleForm({
                  name: suggestion.rule.name,
                  description: suggestion.rule.description,
                  fileType: suggestion.rule.fileType,
                  source: suggestion.rule.source,
                  configText: JSON.stringify(suggestion.rule.config, null, 2),
                });
                return;
              }
              const matched = rules.find((item) => item.id === nextRuleId);
              if (matched) {
                setRuleForm(buildFormState(matched));
              }
            }}
          >
            <option value="">选择已有规则</option>
            {suggestion ? <option value={SUGGESTED_RULE_OPTION_ID}>AI 推荐规则</option> : null}
            {rules.map((rule) => (
              <option key={rule.id} value={rule.id}>
                {rule.name} ({rule.fileType})
              </option>
            ))}
          </select>
          <button className="primary-button" type="button" disabled={isParsing} onClick={() => void handlePreviewWithRule(selectedRuleId)}>
            {isParsing ? "试解析中..." : "按当前规则试解析"}
          </button>
        </div>

        <div className="progress-strip">
          <div className="progress-meta">
            <span>试解析进度</span>
            <span>
              {importProgress.total > 0
                ? `${Math.round((importProgress.completed / importProgress.total) * 100)}%`
                : "未开始"}
            </span>
          </div>
          <div className="progress-bar">
            <div
              className="progress-value"
              style={{
                width:
                  importProgress.total > 0
                    ? `${(importProgress.completed / importProgress.total) * 100}%`
                    : "0%",
              }}
            />
          </div>
        </div>

        {suggestion ? (
          <div className="suggestion-box">
            <div className="panel-header panel-header-compact">
              <div>
                <h3>{suggestion.rule.name}</h3>
                <p>{suggestion.rule.description}</p>
              </div>
              <button className="primary-button" type="button" disabled={isApplyingSuggestion} onClick={() => void handlePreviewSuggestion()}>
                {isApplyingSuggestion ? "保存并试解析中..." : "保存并试解析"}
              </button>
            </div>
            <div className="tag-row">
              <span className="tag-chip">文件类型：{suggestion.rule.fileType}</span>
              <span className="tag-chip">来源：{suggestion.rule.source}</span>
              <span className="tag-chip">Provider：{suggestion.provider}</span>
              <span className="tag-chip">
                引擎：{suggestion.usedModel ?? `${getSuggestedRuleFileType(selectedFile?.name ?? "")} 启发式`}
              </span>
              <span className="tag-chip">最近试解析：{suggestionPreviewRows} 行</span>
            </div>
            <ul className="reason-list">
              {suggestion.reasoning.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}
                    </section>

                    {renderDraftEditorPanel({
                      title: "试解析结果与在线编辑",
                      description: "所有错误一次性展示。可新增空行、删除行、在线修正后导出或提交。",
                      emptyMessage: "暂无试解析结果。",
                      showPreviewSummary: true,
                    })}

                    {renderSubmitPanel({
                      title: "提交下单",
                      description: "有错误时禁止提交。提交成功后写入数据库，并可在历史列表中继续检索。",
                      submitLabel: "提交下单",
                    })}
                  </>
                ) : null}

                {activeSection === "manual" ? (
                  <>
                    <section className="panel">
                      <div className="panel-header">
                        <div>
                          <h2>人工录单</h2>
                          <p>无需上传文件，直接按运单字段录入数据，校验通过后即可写入已导入运单列表。</p>
                        </div>
                      </div>

                      <div className="warning-box">
                        <strong>录单约束</strong>
                        <ul className="reason-list">
                          <li>必填字段：SKU 物品编码、SKU 物品名称、SKU 发货数量。</li>
                          <li>收货信息至少填写一组：收货门店，或收件人姓名 + 电话 + 地址。</li>
                          <li>运单号如填写，将参与重复校验，并作为“已导入运单”列表的主搜索字段。</li>
                        </ul>
                      </div>
                    </section>

                    {renderDraftEditorPanel({
                      title: "录单明细编辑",
                      description: "支持逐行人工补录、在线修正、导出备份与实时校验。",
                      emptyMessage: "暂无录单数据，请先新增一行。",
                      showResetAction: true,
                    })}

                    {renderSubmitPanel({
                      title: "提交录单",
                      description: "人工录单与批量导入复用同一提交接口，校验通过后即可入库。",
                      submitLabel: "提交录单",
                    })}
                  </>
                ) : null}

                {activeSection === "history" ? (
                  <section className="panel">
        <div className="panel-header">
          <div>
            <h2>已导入运单</h2>
            <p>从数据库读取历史记录，支持按运单号、门店、收件人、商品名和日期筛选。</p>
          </div>
          <div className="history-filters">
            <input
              value={historyKeyword}
              placeholder="搜运单号 / 门店 / 收件人 / SKU"
              onChange={(event) => setHistoryKeyword(event.target.value)}
            />
            <input value={historyDate} type="date" onChange={(event) => setHistoryDate(event.target.value)} />
            <button
              className="ghost-button"
              type="button"
              disabled={isHistoryLoading}
              onClick={() => {
                if (isHistoryLoading) {
                  notifyRequestPending();
                  return;
                }
                void refreshHistory(1, historyKeyword, historyDate);
              }}
            >
              {isHistoryLoading ? "搜索中..." : "搜索"}
            </button>
            <button className="danger-link" type="button" disabled={isDeletingAllOrders} onClick={() => void handleDeleteAllImportedOrders()}>
              {isDeletingAllOrders ? "删除中..." : "删除全部已导入运单"}
            </button>
          </div>
        </div>

        <div className="history-table-shell">
          <table className="history-table">
            <thead>
              <tr>
                <th>运单号</th>
                <th>发件摘要</th>
                <th>收件摘要</th>
                <th>SKU编码</th>
                <th>SKU名称</th>
                <th>数量</th>
                <th>金额</th>
                <th>运单状态</th>
                <th>来源更新时间</th>
                <th>提交时间</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr>
                  <td colSpan={10} className="empty-cell">
                    {isHistoryLoading ? "加载中..." : "暂无历史记录"}
                  </td>
                </tr>
              ) : (
                history.map((item) => (
                  <tr key={item.recordId}>
                    <td>{item.externalCode || "-"}</td>
                    <td>{item.senderStore || item.senderName || "-"}</td>
                    <td>{item.receiverStore || item.receiverName || "-"}</td>
                    <td>{item.skuCode}</td>
                    <td>{item.skuName}</td>
                    <td>{item.skuQuantity}</td>
                    <td>{item.amount.toFixed(2)}</td>
                    <td>{item.waybillStatus || "-"}</td>
                    <td>{item.sourceUpdatedAt ? new Date(item.sourceUpdatedAt).toLocaleString("zh-CN") : "-"}</td>
                    <td>{new Date(item.submittedAt).toLocaleString("zh-CN")}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="pagination">
          <div className="pagination-meta">
            <span>共 {historyTotal} 条数据</span>
            <span>第 {historyPage} / {historyTotalPages || 1} 页</span>
            <span>每页 {PAGE_SIZE} 条</span>
          </div>
          <button
            className="ghost-button"
            type="button"
            disabled={historyPage <= 1}
            onClick={() => {
              if (isHistoryLoading) {
                notifyRequestPending();
                return;
              }
              void refreshHistory(historyPage - 1);
            }}
          >
            {isHistoryLoading ? "加载中..." : "上一页"}
          </button>
          <button
            className="ghost-button"
            type="button"
            disabled={historyTotalPages === 0 || historyPage >= historyTotalPages}
            onClick={() => {
              if (isHistoryLoading) {
                notifyRequestPending();
                return;
              }
              void refreshHistory(historyPage + 1);
            }}
          >
            {isHistoryLoading ? "加载中..." : "下一页"}
          </button>
        </div>
                  </section>
                ) : null}
              </div>

              <aside className="status-dock status-dock-inline" aria-label="导入动态面板">
                <div className="status-dock-head">
                  <span>导入动态</span>
                  <strong>实时状态</strong>
                </div>
                <div className="status-dock-grid">
                  {statusCards.map((card) => (
                    <div key={card.label} className="stat-card status-card-compact">
                      <span>{card.label}</span>
                      <strong title={card.value}>{card.value}</strong>
                    </div>
                  ))}
                </div>
              </aside>
            </div>
          </div>
        </main>
      </div>

      {toast ? <div className={`toast toast-${toast.kind}`}>{toast.message}</div> : null}
    </div>
  );
}
