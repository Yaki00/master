"use client";

import { createContext, useContext } from "react";
import { useMetrics } from "@/hooks/useMetrics";
import type { DashboardMetrics } from "@/lib/types";

type MetricsContextValue = ReturnType<typeof useMetrics>;

const MetricsContext = createContext<MetricsContextValue | null>(null);

export function MetricsProvider({ children }: { children: React.ReactNode }) {
  const metrics = useMetrics();
  return <MetricsContext.Provider value={metrics}>{children}</MetricsContext.Provider>;
}

export function useMetricsContext() {
  const ctx = useContext(MetricsContext);
  if (!ctx) throw new Error("useMetricsContext must be used within MetricsProvider");
  return ctx;
}

export function useMetricsData(): DashboardMetrics | null {
  return useMetricsContext().data;
}
