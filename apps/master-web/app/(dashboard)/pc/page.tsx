"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import type { PcActivitySnapshot, PcJobSummary } from "@/lib/pc-activity";

const POLL_MS = 4000;

function statusTone(status: string): string {
  if (status === "running" || status === "claimed") return "text-amber-300";
  if (status === "queued") return "text-blue-300";
  if (status === "paused") return "text-violet-300";
  if (status === "completed") return "text-emerald-300";
  if (status === "failed" || status === "cancelled") return "text-zinc-400";
  return "text-zinc-300";
}

function kindLabel(kind: PcJobSummary["kind"]): string {
  if (kind === "job-hunt") return "Carrière";
  if (kind === "screen") return "Écran";
  if (kind === "agent") return "Agent";
  if (kind === "pc") return "PC";
  return "Autre";
}

function formatAge(sec: number | null): string {
  if (sec == null) return "jamais";
  if (sec < 5) return "à l’instant";
  if (sec < 60) return `il y a ${sec}s`;
  if (sec < 3600) return `il y a ${Math.round(sec / 60)} min`;
  return `il y a ${Math.round(sec / 3600)} h`;
}

function JobRow({ job }: { job: PcJobSummary }) {
  return (
    <div className="border-b border-surface-border px-5 py-4 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500">
              {kindLabel(job.kind)}
            </span>
            <span className={`text-xs font-medium uppercase ${statusTone(job.status)}`}>{job.status}</span>
          </div>
          <p className="mt-1 text-sm font-medium text-white">{job.title}</p>
          {job.progress && <p className="mt-1 text-xs text-amber-200/90">{job.progress}</p>}
          {job.error && <p className="mt-1 text-xs text-red-400">{job.error}</p>}
          <p className="mt-1 truncate text-xs text-zinc-600">{job.detail}</p>
        </div>
        <div className="shrink-0 text-right text-[11px] text-zinc-600">
          <p>{new Date(job.updatedAt).toLocaleString("fr-FR")}</p>
          <p className="mt-0.5 font-mono text-zinc-700">{job.id.slice(0, 8)}</p>
        </div>
      </div>
    </div>
  );
}

export default function PcPage() {
  const [data, setData] = useState<PcActivitySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [stopping, setStopping] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/workers/pc/status", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as PcActivitySnapshot;
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  async function stopAll() {
    if (!confirm("Arrêter tous les jobs actifs du PC (et skip les offres Carrière liées) ?")) return;
    setStopping(true);
    try {
      const res = await fetch("/api/workers/pc/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });
      const json = (await res.json()) as { ok?: boolean; count?: number; snapshot?: PcActivitySnapshot; error?: string };
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      if (json.snapshot) setData(json.snapshot);
      else await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Stop échoué");
    } finally {
      setStopping(false);
    }
  }

  const active = data?.activeJobs ?? [];
  const busy = active.some((j) => j.status === "running" || j.status === "claimed");

  return (
    <>
      <PageHeader
        title="PC fixe"
        description="Activité live du worker pc-main (Ollama, Carrière, agent bureau)"
      />

      <Card className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3">
              {data?.online ? (
                <>
                  <span
                    className={`absolute inline-flex h-full w-full rounded-full opacity-40 ${
                      busy ? "animate-ping bg-amber-400" : "animate-ping bg-emerald-400"
                    }`}
                  />
                  <span
                    className={`relative inline-flex h-3 w-3 rounded-full ${
                      busy ? "bg-amber-400" : "bg-emerald-500"
                    }`}
                  />
                </>
              ) : (
                <span className="relative inline-flex h-3 w-3 rounded-full bg-zinc-500" />
              )}
            </span>
            <div>
              <p className="text-sm font-semibold text-white">
                {!data
                  ? "…"
                  : !data.online
                    ? "Hors ligne"
                    : busy
                      ? "En activité"
                      : "En ligne · idle"}
              </p>
              <p className="text-xs text-zinc-500">
                {data?.worker?.hostname ?? "Yaki-pc"} · heartbeat {formatAge(data?.ageSec ?? null)}
                {data?.worker?.meta ? ` · ${safeMeta(data.worker.meta)}` : ""}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-xs text-zinc-300 hover:border-blue-500/40 hover:text-white"
            >
              Rafraîchir
            </button>
            <button
              type="button"
              onClick={() => void stopAll()}
              disabled={stopping || active.length === 0}
              className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-300 hover:bg-red-500/20 disabled:opacity-40"
            >
              {stopping ? "Arrêt…" : "Tout arrêter"}
            </button>
          </div>
        </div>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
        {loading && !data && <p className="mt-4 text-sm text-zinc-500">Chargement…</p>}
      </Card>

      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <Card padding="sm">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500">Jobs actifs</p>
          <p className="mt-1 text-2xl font-semibold text-white">{active.length}</p>
        </Card>
        <Card padding="sm">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500">En cours</p>
          <p className="mt-1 text-2xl font-semibold text-amber-300">
            {active.filter((j) => j.status === "running" || j.status === "claimed").length}
          </p>
        </Card>
        <Card padding="sm">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500">Dernière sync</p>
          <p className="mt-1 text-sm font-medium text-zinc-300">
            {data ? new Date(data.collectedAt).toLocaleTimeString("fr-FR") : "—"}
          </p>
        </Card>
      </div>

      <h3 className="mb-3 text-sm font-semibold text-white">En cours</h3>
      <div className="mb-8 overflow-hidden rounded-2xl border border-surface-border bg-surface-raised/40">
        {active.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-zinc-500">Aucun job actif</p>
        ) : (
          active.map((job) => <JobRow key={job.id} job={job} />)
        )}
      </div>

      <h3 className="mb-3 text-sm font-semibold text-white">Historique récent</h3>
      <div className="overflow-hidden rounded-2xl border border-surface-border bg-surface-raised/40">
        {(data?.recentJobs ?? []).length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-zinc-500">Pas encore d’historique</p>
        ) : (
          (data?.recentJobs ?? []).map((job) => <JobRow key={job.id} job={job} />)
        )}
      </div>

      <p className="mt-6 text-xs text-zinc-600">
        Note : « Tout arrêter » annule les jobs côté Master et skip les offres liées. La boucle Ollama
        déjà lancée sur le PC peut encore tourner quelques minutes jusqu’à la fin de l’étape en cours.
      </p>
    </>
  );
}

function safeMeta(raw: string): string {
  try {
    const m = JSON.parse(raw) as { runner?: string; role?: string };
    return [m.role, m.runner].filter(Boolean).join(" · ") || "worker";
  } catch {
    return "worker";
  }
}
