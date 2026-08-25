"use client";

import { useEffect, useState } from "react";

export type ViewMode = "cards" | "list";

const STORAGE_KEY = "master-panel-view-mode";

export function ViewToggle({
  value,
  onChange,
  storageKey = STORAGE_KEY,
}: {
  value?: ViewMode;
  onChange?: (mode: ViewMode) => void;
  storageKey?: string;
}) {
  const [internal, setInternal] = useState<ViewMode>("cards");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey) as ViewMode | null;
      if (saved === "cards" || saved === "list") setInternal(saved);
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  const mode = value ?? internal;

  const setMode = (next: ViewMode) => {
    if (!value) setInternal(next);
    onChange?.(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="inline-flex rounded-lg border border-surface-border bg-surface p-0.5">
      <button
        type="button"
        onClick={() => setMode("cards")}
        className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
          mode === "cards"
            ? "bg-blue-600/20 text-blue-300 ring-1 ring-blue-500/30"
            : "text-zinc-500 hover:text-zinc-300"
        }`}
      >
        Cartes
      </button>
      <button
        type="button"
        onClick={() => setMode("list")}
        className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
          mode === "list"
            ? "bg-blue-600/20 text-blue-300 ring-1 ring-blue-500/30"
            : "text-zinc-500 hover:text-zinc-300"
        }`}
      >
        Liste
      </button>
    </div>
  );
}

export function useViewMode(storageKey = STORAGE_KEY): [ViewMode, (m: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>("cards");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey) as ViewMode | null;
      if (saved === "cards" || saved === "list") setMode(saved);
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  const update = (next: ViewMode) => {
    setMode(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      /* ignore */
    }
  };

  return [mode, update];
}
