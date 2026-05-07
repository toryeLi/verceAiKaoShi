"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { exportDraftsToExcel, parseExcelFile, remapDraftRows } from "@/lib/excel";
import { castDraftsToOrders, ORDER_FIELDS, validateDrafts } from "@/lib/orders";
import { loadSavedMapping, saveMapping } from "@/lib/template-memory";
import type { ColumnMapping, OrderDraft, OrderHistoryItem, ParseResult } from "@/types/order";

const PAGE_SIZE = 10;
const SUBMIT_BATCH_SIZE = 200;
const VIRTUAL_ROW_HEIGHT = 98;
const VIRTUAL_OVERSCAN = 8;

type Toast = {
  kind: "success" | "error" | "info";
  message: string;
};

function makeBlankRow(rowNumber: number): OrderDraft {
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

export function OrderWorkbench() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const duplicateCheckTimerRef = useRef<number | null>(null);
  const tableShellRef = useRef<HTMLDivElement | null>(null);

  const [selectedFileName, setSelectedFileName] = useState("");
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [draftRows, setDraftRows] = useState<OrderDraft[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [importProgress, setImportProgress] = useState({ completed: 0, total: 0 });
  const [submitProgress, setSubmitProgress] = useState({ completed: 0, total: 0 });
  const [existingCodes, setExistingCodes] = useState<string[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);
  const [history, setHistory] = useState<OrderHistoryItem[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyKeyword, setHistoryKeyword] = useState("");
  const [historyDate, setHistoryDate] = useState("");
  const [isDeletingAllOrders, setIsDeletingAllOrders] = useState(false);
  const [tableScrollTop, setTableScrollTop] = useState(0);
  const [tableViewportHeight, setTableViewportHeight] = useState(640);

  const [isParsing, startParsing] = useTransition();
  const [isSubmitting, startSubmitting] = useTransition();
  const [isHistoryLoading, startHistoryLoading] = useTransition();
  const [isTablePending, startTableTransition] = useTransition();

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
  const errorCount = validationState.allErrors.length;

  const virtualRange = useMemo(() => {
    if (draftRows.length <= 80) {
      return {
        start: 0,
        end: draftRows.length,
        topSpacerHeight: 0,
        bottomSpacerHeight: 0,
      };
    }

    const visibleCount = Math.ceil(tableViewportHeight / VIRTUAL_ROW_HEIGHT);
    const start = Math.max(0, Math.floor(tableScrollTop / VIRTUAL_ROW_HEIGHT) - VIRTUAL_OVERSCAN);
    const end = Math.min(
      draftRows.length,
      start + visibleCount + VIRTUAL_OVERSCAN * 2,
    );

    return {
      start,
      end,
      topSpacerHeight: start * VIRTUAL_ROW_HEIGHT,
      bottomSpacerHeight: (draftRows.length - end) * VIRTUAL_ROW_HEIGHT,
    };
  }, [draftRows.length, tableScrollTop, tableViewportHeight]);

  const visibleRows = useMemo(
    () => draftRows.slice(virtualRange.start, virtualRange.end),
    [draftRows, virtualRange.end, virtualRange.start],
  );

  useEffect(() => {
    if (!toast) {
      return undefined;
    }

    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    void refreshHistory(1, historyKeyword, historyDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const container = tableShellRef.current;
    if (!container) {
      return undefined;
    }

    const updateSize = () => {
      setTableViewportHeight(container.clientHeight || 640);
    };

    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

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
    }, 400);
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

  async function handleFile(file: File) {
    setSelectedFileName(file.name);
    setImportProgress({ completed: 0, total: 0 });

    startParsing(async () => {
      try {
        const parsed = await parseExcelFile(file, (completed, total) => {
          setImportProgress({ completed, total });
        });

        const savedMapping = loadSavedMapping(parsed.templateFingerprint);
        const finalMapping = savedMapping ? { ...parsed.mapping, ...savedMapping } : parsed.mapping;
        const finalRows = savedMapping
          ? remapDraftRows(parsed.headers, parsed.sourceRows, finalMapping, parsed.headerRowIndex)
          : parsed.rows;

        const finalResult: ParseResult = {
          ...parsed,
          mapping: finalMapping,
          rows: finalRows,
        };

        setParseResult(finalResult);
        setMapping(finalMapping);
        startTableTransition(() => {
          setDraftRows(finalRows);
        });
        setTableScrollTop(0);
        if (tableShellRef.current) {
          tableShellRef.current.scrollTop = 0;
        }
        scheduleDuplicateCheck(finalRows);

        setToast({
          kind: "success",
          message: `已导入 ${finalRows.length} 行，Sheet：${finalResult.detectedSheetName}`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "文件解析失败";
        setToast({ kind: "error", message });
        setParseResult(null);
        setDraftRows([]);
        setExistingCodes([]);
      }
    });
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
      const next = [...current, makeBlankRow(current.length + 1)];
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

  function handleMappingChange(field: keyof ColumnMapping, header: string) {
    if (!parseResult) {
      return;
    }

    const nextMapping = { ...mapping, [field]: header || undefined };
    const parsedRows = remapDraftRows(
      parseResult.headers,
      parseResult.sourceRows,
      nextMapping,
      parseResult.headerRowIndex,
    );

    setMapping(nextMapping);
    saveMapping(parseResult.templateFingerprint, nextMapping);

    startTableTransition(() => {
      setDraftRows(parsedRows);
    });
    scheduleDuplicateCheck(parsedRows);
    setToast({ kind: "info", message: "映射已更新，并写入模板记忆" });
  }

  async function handleSubmit() {
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

        for (const [index, batch] of batches.entries()) {
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
            throw new Error(data.message ?? `第 ${index + 1} 批提交失败`);
          }

          completed += batch.length;
          successTotal += data.success ?? 0;
          failedTotal += data.failed ?? 0;
          setSubmitProgress({ completed, total: orders.length });
        }

        setToast({
          kind: failedTotal ? "info" : "success",
          message: `提交完成：成功 ${successTotal} 条，失败 ${failedTotal} 条，分 ${batches.length} 批提交`,
        });

        await refreshHistory(1, historyKeyword, historyDate);
      } catch (error) {
        const message = error instanceof Error ? error.message : "提交失败";
        setToast({ kind: "error", message });
      }
    });
  }

  async function handleDeleteAllImportedOrders() {
    const confirmed = window.confirm("确定要删除所有已导入运单数据吗？此操作不可恢复。");
    if (!confirmed) {
      return;
    }

    setIsDeletingAllOrders(true);
    try {
      const response = await fetch("/api/orders", {
        method: "DELETE",
      });

      const data = (await response.json()) as {
        message?: string;
        deleted?: number;
      };

      if (!response.ok) {
        throw new Error(data.message ?? "清空失败");
      }

      setHistoryPage(1);
      await refreshHistory(1, historyKeyword, historyDate);
      setToast({ kind: "success", message: `已删除 ${data.deleted ?? 0} 条已导入运单` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "清空失败";
      setToast({ kind: "error", message });
    } finally {
      setIsDeletingAllOrders(false);
    }
  }

  const historyTotalPages = historyTotal > 0 ? Math.ceil(historyTotal / PAGE_SIZE) : 0;
  const historyDisplayPage = historyTotalPages === 0 ? 0 : historyPage;

  return (
    <div className="page-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">AI 万能导入</p>
          <h1>多模板 Excel 自动导入下单系统</h1>
          <p className="hero-copy">
            支持多 Sheet、说明行、英文表头、分组表头、列顺序漂移和手动映射记忆。
          </p>
        </div>
        <div className="hero-stats">
          <div className="stat-card">
            <span>当前文件</span>
            <strong>{selectedFileName || "未选择"}</strong>
          </div>
          <div className="stat-card">
            <span>预览行数</span>
            <strong>{draftRows.length}</strong>
          </div>
          <div className="stat-card">
            <span>错误行数</span>
            <strong>{invalidRowCount}</strong>
          </div>
        </div>
      </section>

      <section className="panel upload-panel">
        <div className="panel-header">
          <div>
            <h2>1. 导入模板</h2>
            <p>上传 Excel 文件，自动识别模板并加载历史映射。</p>
          </div>
          <div className="button-row">
            <button className="ghost-button" onClick={() => fileInputRef.current?.click()} type="button">
              选择文件
            </button>
            <input
              ref={fileInputRef}
              className="hidden-input"
              type="file"
              accept=".xlsx,.xls"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void handleFile(file);
                }
              }}
            />
          </div>
        </div>

        <label
          className="dropzone"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const file = event.dataTransfer.files?.[0];
            if (file) {
              void handleFile(file);
            }
          }}
        >
          <input
            className="hidden-input"
            type="file"
            accept=".xlsx,.xls"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void handleFile(file);
              }
            }}
          />
          <strong>拖拽 Excel 到此处</strong>
          <span>或点击上方按钮上传，支持 `.xlsx / .xls`</span>
        </label>

        <div className="progress-strip">
          <div className="progress-meta">
            <span>导入进度</span>
            <span>
              {importProgress.total > 0
                ? `${Math.round((importProgress.completed / importProgress.total) * 100)}% · ${importProgress.completed}/${importProgress.total}`
                : isParsing
                  ? "准备中"
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

        {parseResult ? (
          <div className="mapping-grid">
            <div className="mapping-head">
              <h3>模板映射</h3>
              <span>
                Sheet：{parseResult.detectedSheetName} · 表头第 {parseResult.headerRowIndex + 1} 行
              </span>
            </div>
            {ORDER_FIELDS.map((field) => (
              <label key={field.key} className="mapping-item">
                <span>
                  {field.label}
                  {field.required ? " *" : ""}
                </span>
                <select
                  value={mapping[field.key] ?? ""}
                  onChange={(event) => handleMappingChange(field.key, event.target.value)}
                >
                  <option value="">未映射</option>
                  {parseResult.headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>2. 预览与编辑</h2>
            <p>使用虚拟滚动，仅渲染可视区行，避免 1000+ 行导致页面冻结。</p>
          </div>
          <div className="button-row">
            <span className="muted-text">
              当前渲染 {visibleRows.length} / 总计 {draftRows.length} 行
              {isTablePending ? " · 更新中" : ""}
            </span>
            <button className="ghost-button" type="button" onClick={addBlankRow}>
              新增空行
            </button>
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

        <div
          ref={tableShellRef}
          className="table-shell virtual-shell"
          onScroll={(event) => setTableScrollTop(event.currentTarget.scrollTop)}
        >
          <table className="order-table">
            <thead>
              <tr>
                <th>行号</th>
                {ORDER_FIELDS.map((field) => (
                  <th key={field.key}>{field.label}</th>
                ))}
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {draftRows.length === 0 ? (
                <tr>
                  <td colSpan={ORDER_FIELDS.length + 2} className="empty-cell">
                    暂无数据，先上传 Excel 文件。
                  </td>
                </tr>
              ) : (
                <>
                  {virtualRange.topSpacerHeight > 0 ? (
                    <tr className="virtual-spacer">
                      <td
                        colSpan={ORDER_FIELDS.length + 2}
                        style={{ height: virtualRange.topSpacerHeight }}
                      />
                    </tr>
                  ) : null}

                  {visibleRows.map((row, index) => {
                    const actualIndex = virtualRange.start + index;
                    const rowErrors = validationMap.get(row.id) ?? new Map<string, string>();

                    return (
                      <tr key={row.id} className={rowErrors.size > 0 ? "row-error" : ""}>
                        <td>{row.originalRowNumber || actualIndex + 1}</td>
                        {ORDER_FIELDS.map((field) => {
                          const error = rowErrors.get(field.key);
                          const value = row[field.key];
                          const isTempZone = field.key === "tempZone";

                          return (
                            <td key={field.key}>
                              {isTempZone ? (
                                <select
                                  className={error ? "cell-input input-error" : "cell-input"}
                                  value={value}
                                  onChange={(event) =>
                                    updateDraft(row.id, field.key as keyof OrderDraft, event.target.value)
                                  }
                                  title={error}
                                >
                                  <option value="">请选择</option>
                                  <option value="常温">常温</option>
                                  <option value="冷藏">冷藏</option>
                                  <option value="冷冻">冷冻</option>
                                </select>
                              ) : (
                                <input
                                  className={error ? "cell-input input-error" : "cell-input"}
                                  value={value}
                                  title={error}
                                  placeholder={field.placeholder}
                                  onChange={(event) =>
                                    updateDraft(row.id, field.key as keyof OrderDraft, event.target.value)
                                  }
                                />
                              )}
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
                  })}

                  {virtualRange.bottomSpacerHeight > 0 ? (
                    <tr className="virtual-spacer">
                      <td
                        colSpan={ORDER_FIELDS.length + 2}
                        style={{ height: virtualRange.bottomSpacerHeight }}
                      />
                    </tr>
                  ) : null}
                </>
              )}
            </tbody>
          </table>
        </div>

        <div className="error-board">
          <div className="error-board-head">
            <h3>全量错误列表</h3>
            <span className="muted-text">校验计算已延后到低优先级，输入时不再明显卡顿</span>
          </div>
          {validationState.allErrors.length === 0 ? (
            <p className="muted-text">当前没有错误。</p>
          ) : (
            <div className="error-board-body">
              <div className="error-board-summary">
                共 {errorCount} 条错误，涉及 {invalidRowCount} 行
              </div>
              <ul>
                {validationState.allErrors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>3. 提交下单</h2>
            <p>有错误时禁止提交，提交完成后返回成功/失败汇总。</p>
          </div>
          <button className="primary-button" type="button" onClick={handleSubmit} disabled={isSubmitting}>
            提交下单
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

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>4. 已导入运单</h2>
            <p>从数据库读取历史记录，支持关键词筛选与分页。</p>
          </div>
          <div className="history-filters">
            <input
              value={historyKeyword}
              placeholder="搜外部编码 / 收件人 / 发件人"
              onChange={(event) => setHistoryKeyword(event.target.value)}
            />
            <input
              value={historyDate}
              type="date"
              onChange={(event) => setHistoryDate(event.target.value)}
            />
            <button
              className="ghost-button"
              type="button"
              onClick={() => void refreshHistory(1, historyKeyword, historyDate)}
              disabled={isDeletingAllOrders}
            >
              搜索
            </button>
            <button
              className="danger-link"
              type="button"
              onClick={() => void handleDeleteAllImportedOrders()}
              disabled={isDeletingAllOrders || historyTotal === 0}
            >
              {isDeletingAllOrders ? "清空中..." : "删除全部已导入运单"}
            </button>
          </div>
        </div>

        <div className="history-table-shell">
          <table className="history-table">
            <thead>
              <tr>
                <th>外部编码</th>
                <th>收件人</th>
                <th>温层</th>
                <th>重量</th>
                <th>件数</th>
                <th>提交时间</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-cell">
                    {isHistoryLoading ? "加载中..." : "暂无历史记录"}
                  </td>
                </tr>
              ) : (
                history.map((item) => (
                  <tr key={item.recordId}>
                    <td>{item.externalCode || "-"}</td>
                    <td>{item.receiverName}</td>
                    <td>{item.tempZone}</td>
                    <td>{item.weight}</td>
                    <td>{item.quantity}</td>
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
            <span>第 {historyDisplayPage} / {historyTotalPages} 页</span>
            <span>每页 {PAGE_SIZE} 条</span>
          </div>
          <button
            className="ghost-button"
            type="button"
            disabled={historyTotalPages === 0 || historyPage <= 1}
            onClick={() => void refreshHistory(historyPage - 1)}
          >
            上一页
          </button>
          <span>
            第 {historyPage} / {historyTotalPages} 页
          </span>
          <button
            className="ghost-button"
            type="button"
            disabled={historyTotalPages === 0 || historyPage >= historyTotalPages}
            onClick={() => void refreshHistory(historyPage + 1)}
          >
            下一页
          </button>
        </div>
      </section>

      {toast ? <div className={`toast toast-${toast.kind}`}>{toast.message}</div> : null}
    </div>
  );
}
