"use client";

import { useEffect, type ReactNode } from "react";

export function DetailDrawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  className = "",
  mode = "overlay",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  mode?: "overlay" | "dock";
}) {
  useEffect(() => {
    if (!open || mode === "dock") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose, mode]);

  useEffect(() => {
    if (!open || mode !== "dock") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, mode]);

  if (!open) return null;

  const panel = (
    <aside
      className={`relative flex h-full w-full flex-col ${
        mode === "dock" ? "max-w-none" : "max-w-lg max-sm:max-w-none"
      } border-l border-surface-border bg-surface shadow-2xl ${className}`}
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-surface-border px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-semibold text-white">{title}</h3>
          {subtitle && <p className="mt-0.5 truncate text-sm text-zinc-500">{subtitle}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-2 text-zinc-500 transition hover:bg-surface-raised hover:text-zinc-300"
        >
          ✕
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
      {footer ? <div className="shrink-0 border-t border-surface-border px-4 py-3">{footer}</div> : null}
    </aside>
  );

  if (mode === "dock") return panel;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Fermer"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      {panel}
    </div>
  );
}
