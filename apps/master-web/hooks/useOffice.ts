import { useCallback, useEffect, useRef, useState } from "react";
import type { OfficeAgent, OfficeCommand, OfficeEvent, OfficeSources } from "@/lib/office/types";

export const OFFICE_POLL_MS = 2500;

export type OfficeSnapshot = {
  agents: OfficeAgent[];
  sources: OfficeSources;
};

export type OfficeDetail = {
  agent: OfficeAgent;
  events: OfficeEvent[];
  pendingCommands?: OfficeCommand[];
};

export function useOfficeAgents() {
  const [data, setData] = useState<OfficeSnapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const my = ++seq.current;
    try {
      const res = await fetch("/api/office/agents", { cache: "no-store" });
      if (res.status === 401) throw new Error("Session expirée");
      if (!res.ok) throw new Error("Impossible de charger les agents");
      const json = (await res.json()) as OfficeSnapshot;
      if (my !== seq.current) return;
      setData(json);
      setError("");
    } catch (e) {
      if (my !== seq.current) return;
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const poll = setInterval(() => void refresh(), OFFICE_POLL_MS);
    return () => clearInterval(poll);
  }, [refresh]);

  return { data, error, loading, refresh };
}

export function useOfficeDetail(agentId: string | null) {
  const [data, setData] = useState<OfficeDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const loadedFor = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!agentId) {
      seq.current += 1;
      setData(null);
      loadedFor.current = null;
      setLoading(false);
      return;
    }
    const my = ++seq.current;
    const firstLoad = loadedFor.current !== agentId;
    if (firstLoad) setLoading(true);
    try {
      const res = await fetch(`/api/office/agents/${encodeURIComponent(agentId)}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Agent introuvable");
      const json = (await res.json()) as OfficeDetail;
      if (my !== seq.current) return;
      setData(json);
      loadedFor.current = agentId;
      setError("");
    } catch (e) {
      if (my !== seq.current) return;
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void refresh();
    if (!agentId) return;
    const poll = setInterval(() => void refresh(), OFFICE_POLL_MS);
    return () => clearInterval(poll);
  }, [agentId, refresh]);

  return { data, error, loading, refresh, setData };
}
