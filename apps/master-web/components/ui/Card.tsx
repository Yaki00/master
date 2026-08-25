import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
  padding = "md",
}: {
  children: ReactNode;
  className?: string;
  padding?: "none" | "sm" | "md" | "lg";
}) {
  const pad =
    padding === "none"
      ? ""
      : padding === "sm"
        ? "p-4"
        : padding === "lg"
          ? "p-8"
          : "p-6";

  return (
    <div
      className={`rounded-2xl border border-surface-border bg-gradient-to-br from-surface-raised/80 to-surface ${pad} ${className}`}
    >
      {children}
    </div>
  );
}
