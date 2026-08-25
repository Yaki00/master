"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { OfficeRail } from "@/components/office/OfficeRail";
import type {
  SecurityEvent,
  SecurityEventKind,
  SecurityEventSeverity,
} from "@/lib/db/security-events";

const SEVERITY_STYLES: Record<SecurityEventSeverity, string> = {
  critical: "border-red-500/30 bg-red-500/5",
  warning: "border-amber-500/30 bg-amber-500/5",
  info: "border-surface-border bg-surface-raised/40",
};

const SEVERITY_DOT: Record<SecurityEventSeverity, string> = {
  critical: "bg-red-500",
  warning: "bg-amber-500",
  info: "bg-blue-500",
};

const KIND_LABELS: Record<SecurityEventKind, string> = {
  login_success: "Connexion OK",
  login_failure: "Échec login",
  login_rate_limited: "Rate-limit",
  login_honeypot: "Honeypot",
  logout: "Déconnexion",
  worker_auth_fail: "Token worker",
  wa_sender_rejected: "WA (legacy)",
  docker_prune: "Docker prune",
  wa_alert_sent: "WA (legacy)",
  wa_alert_failed: "WA (legacy)",
  system_alert: "Alerte système",
  app_snooze: "Snooze app",
  office_message: "Message agent",
  office_stop: "Stop agent",
};

type FilterKind = SecurityEventKind | "all";
type FilterSeverity = SecurityEventSeverity | "all";

type Stats = {
  total: number;
  critical: number;
  warning: number;
  info: number;
};

type MaintStatus = {
  stripeConfigured: boolean;
  pixelbrainPlatformConfigured: boolean;
  messaging?: { channel: string; whatsapp: boolean };
};

export default function SecuritePage() {
  const [items, setItems] = useState<SecurityEvent[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, critical: 0, warning: 0, info: 0 });
  const [retentionDays, setRetentionDays] = useState(90);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [kind, setKind] = useState<FilterKind>("all");
  const [severity, setSeverity] = useState<FilterSeverity>("all");
  const [maint, setMaint] = useState<MaintStatus | null>(null);
  const [actionMsg, setActionMsg] = useState("");
  const [actionBusy, setActionBusy] = useState(false);

  const load = useCallback(async () => {
    setError("");
    const qs = new URLSearchParams();
    if (kind !== "all") qs.set("kind", kind);
    if (severity !== "all") qs.set("severity", severity);
    qs.set("limit", "300");

    const [res, maintRes] = await Promise.all([
      fetch(`/api/security?${qs}`, { cache: "no-store" }),
      fetch("/api/maintenance", { cache: "no-store" }),
    ]);
    if (!res.ok) {
      setError("Impossible de charger les logs.");
      setLoading(false);
      return;
    }
    const json = (await res.json()) as {
      items: SecurityEvent[];
      stats: Stats;
      retentionDays: number;
    };
    setItems(json.items);
    setStats(json.stats);
    setRetentionDays(json.retentionDays);
    if (maintRes.ok) setMaint((await maintRes.json()) as MaintStatus);
    setLoading(false);
  }, [kind, severity]);

  async function runAction(action: "prune") {
    setActionBusy(true);
    setActionMsg("");
    try {
      const res = await fetch("/api/maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = (await res.json()) as Record<string, unknown>;
      setActionMsg(
        json.ran
          ? `Prune OK · ${String(json.diskAfter ?? "")}`
          : `Prune: ${String(json.skipped ?? json.error ?? "noop")}`,
      );
      await load();
    } finally {
      setActionBusy(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  return (
    <>
      <PageHeader
        title="Sécurité"
        description={`Journal des connexions et événements suspects · ${retentionDays} jours max`}
      />

      <div className="mb-4">
        <OfficeRail />
      </div>

      <Card className="mb-6" padding="sm">
        <div className="flex flex-wrap items-center gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-zinc-400">Messagerie</p>
            <p className="text-sm text-white">Telegram (OpenClaw) + bureau /agents</p>
            <p className="mt-1 text-xs text-zinc-600">
              Stripe {maint?.stripeConfigured ? "OK" : "off"} · Platform stats{" "}
              {maint?.pixelbrainPlatformConfigured ? "OK" : "off"}
            </p>
          </div>
          <button
            type="button"
            disabled={actionBusy}
            onClick={() => void runAction("prune")}
            className="rounded-lg bg-surface px-3 py-2 text-xs font-medium text-zinc-300 ring-1 ring-surface-border disabled:opacity-40"
          >
            Docker prune
          </button>
        </div>
        {actionMsg && <p className="mt-3 text-xs text-zinc-400">{actionMsg}</p>}
      </Card>

      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        {(
          [
            { label: "Total", value: stats.total, tone: "text-white" },
            { label: "Critiques", value: stats.critical, tone: "text-red-400" },
            { label: "Alertes", value: stats.warning, tone: "text-amber-400" },
            { label: "Info", value: stats.info, tone: "text-blue-400" },
          ] as const
        ).map((kpi) => (
          <Card key={kpi.label} padding="sm">
            <p className="text-xs text-zinc-500">{kpi.label}</p>
            <p className={`mt-1 text-2xl font-semibold tabular-nums ${kpi.tone}`}>{kpi.value}</p>
          </Card>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(
          [
            ["all", "Tout"],
            ["login_failure", "Échecs"],
            ["login_rate_limited", "Rate-limit"],
            ["login_honeypot", "Honeypot"],
            ["worker_auth_fail", "Workers"],
            ["system_alert", "Alertes"],
            ["office_message", "Bureau"],
            ["login_success", "OK"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setKind(value)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
              kind === value
                ? "bg-blue-600/20 text-blue-300 ring-1 ring-blue-500/30"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {label}
          </button>
        ))}
        <span className="mx-1 hidden h-4 w-px bg-surface-border sm:block" />
        {(
          [
            ["all", "Sévérité"],
            ["critical", "Critique"],
            ["warning", "Warning"],
            ["info", "Info"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setSeverity(value)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
              severity === value
                ? "bg-zinc-500/20 text-zinc-200 ring-1 ring-zinc-500/30"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            void load();
          }}
          className="ml-auto rounded-lg px-3 py-1.5 text-xs text-blue-400 hover:text-blue-300"
        >
          Actualiser
        </button>
      </div>

      {error && (
        <Card className="mb-4">
          <p className="text-sm text-red-400">{error}</p>
        </Card>
      )}

      {loading && items.length === 0 ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-surface-raised" />
          ))}
        </div>
      ) : items.length > 0 ? (
        <div className="space-y-2">
          {items.map((ev) => (
            <article
              key={ev.id}
              className={`rounded-xl border px-5 py-4 ${SEVERITY_STYLES[ev.severity]}`}
            >
              <div className="flex flex-wrap items-start gap-3">
                <span
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[ev.severity]}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-white">{ev.title}</p>
                    <span className="rounded-md bg-surface px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                      {KIND_LABELS[ev.kind] ?? ev.kind}
                    </span>
                  </div>
                  {ev.detail && <p className="mt-1 text-sm text-zinc-400">{ev.detail}</p>}
                  <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-600">
                    <span>{new Date(ev.createdAt).toLocaleString("fr-FR")}</span>
                    {ev.ip && <span>IP · {ev.ip}</span>}
                    {ev.userAgent && (
                      <span className="max-w-md truncate" title={ev.userAgent}>
                        UA · {ev.userAgent}
                      </span>
                    )}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Card>
          <p className="text-center text-sm text-zinc-500">
            Aucun événement sur les {retentionDays} derniers jours. Les tentatives de connexion,
            rate-limits, honeypots, tokens worker invalides et actions bureau
            apparaîtront ici.
          </p>
        </Card>
      )}
    </>
  );
}
