"use client";

import type { ColumnMapping, TemplateMemoryRecord } from "@/types/order";

const STORAGE_KEY = "template-memory-v1";

type TemplateMemoryState = Record<string, TemplateMemoryRecord>;

export function loadSavedMapping(fingerprint: string) {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return undefined;
    }
    const parsed = JSON.parse(raw) as TemplateMemoryState;
    return parsed[fingerprint]?.mapping;
  } catch {
    return undefined;
  }
}

export function saveMapping(fingerprint: string, mapping: ColumnMapping) {
  if (typeof window === "undefined" || !fingerprint) {
    return;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const current = raw ? (JSON.parse(raw) as TemplateMemoryState) : {};
    current[fingerprint] = {
      fingerprint,
      mapping,
      updatedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // 忽略本地存储异常，避免影响导入流程
  }
}
