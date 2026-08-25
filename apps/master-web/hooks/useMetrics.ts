"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DashboardMetrics } from "@/lib/types";

export const METRICS_POLL_MS = 25_000;

export function useMetrics() {
  const [data, setData] = useState<DashboardMetrics | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [lastFetchAt, setLastFetchAt] = useState<number | null>(null);
  const [secondsUntilRefresh, setSecondsUntilRefresh] = useState(METRICS_POLL_MS / 1000);
  const fetching = useRef(false);

  const refresh = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    try {
      const res = await fetch("/api/metrics", { cache: "no-store" });
      if (res.status === 429) throw new Error("Trop de requêtes — ralentissez");
      if (!res.ok) throw new Error("Impossible de charger les KPI");
      setData(await res.json());
      setError("");
      setLastFetchAt(Date.now());
      setSecondsUntilRefresh(METRICS_POLL_MS / 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setLoading(false);
      fetching.current = false;
    }
  }, []);

  useEffect(() => {
    refresh();
    const poll = setInterval(refresh, METRICS_POLL_MS);
    return () => clearInterval(poll);
  }, [refresh]);

  useEffect(() => {
    const tick = setInterval(() => {
      setSecondsUntilRefresh((s) => (s <= 1 ? METRICS_POLL_MS / 1000 : s - 1));
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  return { data, error, loading, refresh, lastFetchAt, secondsUntilRefresh };
}
