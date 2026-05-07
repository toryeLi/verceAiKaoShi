"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { exportDraftsToExcel, parseExcelFile } from "@/lib/excel";
import { castDraftsToOrders, hasMeaningfulDraftValue, ORDER_FIELDS, validateDrafts } from "@/lib/orders";
import { loadSavedMapping, saveMapping } from "@/lib/template-memory";
import type { ColumnMapping, OrderDraft, OrderHistoryItem, ParseResult } from "@/types/order";

const PAGE_SIZE = 10;

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

export function OrderWorkbench() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFileName, setSelectedFileName] = useState("");
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [draftRows, setDraftRows] = useState<OrderDraft[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [importProgress, setImportProgress] = useState({ completed: 0, total: 0 });
  const [submitProgress, setSubmitProgress] = useState({ completed: 0, total: 0 });
  const [existingCodes, setExistingCodes] = useState<string[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);
  const [isParsing, startParsing] = useTransition();
  const [isSubmitting, startSubmitting] = useTransition();
  const [history, setHistory] = useState<OrderHistoryItem[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyKeyword, setHistoryKeyword] = useState("");
  const [historyDate, setHistoryDate] = useState("");
  const [isHistoryLoading, startHistoryLoading] = useTransition();

  const validationState = useMemo(
    () => validateDrafts(draftRows, existingCodes),
    [draftRows, existingCodes],
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
    void refreshHistory(1, historyKeyword, historyDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const codes = draftRows.map((row) => row.externalCode.trim()).filter(Boolean);
      if (codes.length === 0) {
        setExistingCodes([]);
        return;
      }
      void queryExistingCodes(codes);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [draftRows]);

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
    if (codes.length === 0) {
      setExistingCodes([]);
      return;
    }

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
        const memoryProbe = await parseExcelFile(file);
        const savedMapping = loadSavedMapping(memoryProbe.templateFingerprint);
        const result = await parseExcelFile(file, savedMapping, (completed, total) => {
          setImportProgress({ completed, total });
        });

        setParseResult(result);
        setMapping(result.mapping);
        setDraftRows(result.rows);
        setToast({
          kind: "success",
          message: `已导入 ${result.rows.length} 行，Sheet：${result.detectedSheetName}`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "文件解析失败";
        setToast({ kind: "error", message });
        setParseResult(null);
        setDraftRows([]);
      }
    });
  }

  function updateDraft(rowId: string, field: keyof OrderDraft, value: string) {
    setDraftRows((current) =>
      current.map((row) => (row.id === rowId ? { ...row, [field]: value } : row)),
    );
  }

  function addBlankRow() {
    setDraftRows((current) => [...current, makeBlankRow(current.length + 1)]);
  }

  function removeRow(rowId: string) {
    setDraftRows((current) => current.filter((row) => row.id !== rowId));
  }

  function rebuildRowsFromParse(result: ParseResult, nextMapping: ColumnMapping) {
    const headerIndexMap = new Map<string, number>();
    result.headers.forEach((header, index) => headerIndexMap.set(header, index));

    const rows: OrderDraft[] = [];

    for (let rowIndex = result.headerRowIndex + 1; rowIndex < result.sourceRows.length; rowIndex += 1) {
      const source = result.sourceRows[rowIndex] ?? [];
      const draft = makeBlankRow(rowIndex + 1);

      for (const [field, header] of Object.entries(nextMapping)) {
        if (!header) {
          continue;
        }
        const index = headerIndexMap.get(header);
        if (index === undefined) {
          continue;
        }
        draft[field as keyof OrderDraft] = String(source[index] ?? "").trim() as never;
      }

      if (hasMeaningfulDraftValue(draft)) {
        rows.push(draft);
      }
    }

    return rows;
  }

  function handleMappingChange(field: keyof ColumnMapping, header: string) {
    if (!parseResult) {
      return;
    }

    const nextMapping = { ...mapping, [field]: header || undefined };
    setMapping(nextMapping);
    saveMapping(parseResult.templateFingerprint, nextMapping);

    const parsedRows = rebuildRowsFromParse(parseResult, nextMapping);
    setDraftRows(parsedRows);
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
        setSubmitProgress({ completed: 0, total: orders.length });

        const response = await fetch("/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orders }),
        });

        const data = (await response.json()) as {
          message?: string;
          success?: number;
          failed?: number;
          failures?: string[];
        };

        setSubmitProgress({ completed: orders.length, total: orders.length });

        if (!response.ok) {
          throw new Error(data.message ?? "提交失败");
        }

        setToast({
          kind: data.failed ? "info" : "success",
          message: `提交完成：成功 ${data.success ?? 0} 条，失败 ${data.failed ?? 0} 条`,
        });

        await refreshHistory(1, historyKeyword, historyDate);
      } catch (error) {
        const message = error instanceof Error ? error.message : "提交失败";
        setToast({ kind: "error", message });
      }
    });
  }

  const historyTotalPages = Math.max(1, Math.ceil(historyTotal / PAGE_SIZE));

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
            <p>固定表头、横向滚动、单元格即点即改，并实时校验。</p>
          </div>
          <div className="button-row">
            <button className="ghost-button" type="button" onClick={addBlankRow}>
              新增空行
            </button>
            <button
              className="ghost-button"
              type="button"
              disabled={draftRows.length === 0}
              onClick={() => void exportDraftsToExcel(draftRows)}
            >
              导出 Excel
            </button>
          </div>
        </div>

        <div className="table-shell">
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
                draftRows.map((row, index) => {
                  const rowErrors = validationMap.get(row.id) ?? new Map<string, string>();

                  return (
                    <tr key={row.id} className={rowErrors.size > 0 ? "row-error" : ""}>
                      <td>{row.originalRowNumber || index + 1}</td>
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
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="error-board">
          <div className="error-board-head">
            <h3>全量错误列表</h3>
            <span className="muted-text">实时同步当前所有错误，无需手动刷新</span>
          </div>
          {validationState.allErrors.length === 0 ? (
            <p className="muted-text">当前没有错误。</p>
          ) : (
            <ul>
              {validationState.allErrors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
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
            >
              搜索
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
          <button
            className="ghost-button"
            type="button"
            disabled={historyPage <= 1}
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
            disabled={historyPage >= historyTotalPages}
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
