"use client";

import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Card } from "@/components/ui/Card";
import { DetailDrawer } from "@/components/ui/DetailDrawer";
import { SparklinePlaceholder } from "@/components/ui/Sparkline";
import { ViewToggle, useViewMode } from "@/components/ui/ViewToggle";
import { useMetricsContext } from "@/components/MetricsProvider";
import { formatEuros, V1_APP_IDS } from "@/lib/metrics/format";
import type { AppMetrics } from "@/lib/types";

function AppCard({ app, onSelect }: { app: AppMetrics; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full overflow-hidden rounded-2xl border border-surface-border bg-gradient-to-br from-surface-raised/80 to-surface text-left transition hover:ring-1 hover:ring-blue-500/30"
    >
      <div className="flex items-center justify-between border-b border-surface-border/60 px-5 py-4">
        <div>
          <h3 className="font-semibold text-white">{app.name}</h3>
          <p className="text-xs text-zinc-500">
            {app.stats?.usersTotal != null ? `${app.stats.usersTotal} users` : "— users"}
            {app.stats?.revenueMrrCents != null ? ` · ${formatEuros(app.stats.revenueMrrCents)}/mois` : ""}
          </p>
        </div>
        <StatusBadge status={app.status} />
      </div>
      <div className="px-5 py-4">
        <div className="flex justify-between text-xs text-zinc-500">
          <span>Disponibilité</span>
          <span className="font-medium text-zinc-300">{Math.round(app.uptimeRatio * 100)}%</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-700"
            style={{ width: `${app.uptimeRatio * 100}%` }}
          />
        </div>
      </div>
    </button>
  );
}

function AppListRow({ app, onSelect }: { app: AppMetrics; onSelect: () => void }) {
  const avgLatency =
    app.checks.filter((c) => c.responseMs != null).reduce((s, c) => s + (c.responseMs ?? 0), 0) /
      (app.checks.filter((c) => c.responseMs != null).length || 1);

  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-4 rounded-xl border border-surface-border bg-surface-raised/40 px-4 py-3 text-left transition hover:bg-surface-raised/60"
    >
      <StatusBadge status={app.status} />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-white">{app.name}</p>
        <p className="text-xs text-zinc-600">{app.id}</p>
      </div>
      <div className="hidden text-right text-xs text-zinc-500 sm:block">
        <p>{app.stats?.usersOnline ?? "—"} online</p>
        <p>{formatEuros(app.stats?.revenueMrrCents)}/mois</p>
      </div>
      <span className="font-mono text-xs tabular-nums text-zinc-400">
        {avgLatency > 0 ? `${Math.round(avgLatency)} ms` : "—"}
      </span>
    </button>
  );
}

export default function AppsPage() {
  const { data, loading, refresh } = useMetricsContext();
  const [viewMode, setViewMode] = useViewMode("master-apps-view");
  const [selected, setSelected] = useState<AppMetrics | null>(null);
  const [snoozeBusy, setSnoozeBusy] = useState(false);

  const apps = data?.apps.filter((a) => (V1_APP_IDS as readonly string[]).includes(a.id)) ?? [];

  async function toggleSnooze(app: AppMetrics) {
    setSnoozeBusy(true);
    try {
      const snoozed = app.status !== "snoozed";
      const res = await fetch("/api/apps/snooze", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appId: app.id,
          snoozed,
          reason: snoozed ? "Snooze manuel panel" : "Reprise manuelle panel",
        }),
      });
      if (res.ok) {
        await refresh();
        setSelected(null);
      }
    } finally {
      setSnoozeBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Applications"
        description="Health checks HTTPS · users et revenus si API configurée"
      />

      <div className="mb-6 flex justify-end">
        <ViewToggle value={viewMode} onChange={setViewMode} storageKey="master-apps-view" />
      </div>

      {loading && !data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-48 animate-pulse rounded-2xl bg-surface-raised" />
          ))}
        </div>
      ) : viewMode === "cards" ? (
        <div className="grid gap-5 lg:grid-cols-2">
          {apps.map((app) => (
            <AppCard key={app.id} app={app} onSelect={() => setSelected(app)} />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {apps.map((app) => (
            <AppListRow key={app.id} app={app} onSelect={() => setSelected(app)} />
          ))}
        </div>
      )}

      <DetailDrawer
        open={selected != null}
        onClose={() => setSelected(null)}
        title={selected?.name ?? ""}
        subtitle={selected?.id}
      >
        {selected && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge status={selected.status} />
              <span className="text-sm text-zinc-500">
                {selected.status === "snoozed"
                  ? "Monitoring en pause"
                  : `${Math.round(selected.uptimeRatio * 100)}% checks OK`}
              </span>
              <button
                type="button"
                disabled={snoozeBusy}
                onClick={(e) => {
                  e.stopPropagation();
                  void toggleSnooze(selected);
                }}
                className="ml-auto rounded-lg bg-surface px-3 py-1.5 text-xs font-medium text-zinc-300 ring-1 ring-surface-border hover:text-white disabled:opacity-50"
              >
                {snoozeBusy
                  ? "…"
                  : selected.status === "snoozed"
                    ? "Réactiver monitoring"
                    : "Snooze"}
              </button>
            </div>

            <Card padding="sm">
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-zinc-500">Users total</dt>
                  <dd className="font-semibold text-white">{selected.stats?.usersTotal ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Users online</dt>
                  <dd className="font-semibold text-white">{selected.stats?.usersOnline ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">MRR</dt>
                  <dd className="font-semibold text-white">{formatEuros(selected.stats?.revenueMrrCents)}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Abonnements</dt>
                  <dd className="font-semibold text-white">{selected.stats?.activeSubscriptions ?? "—"}</dd>
                </div>
              </dl>
            </Card>

            <SparklinePlaceholder label="Users online (24h)" />

            <div>
              <h4 className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500">Checks</h4>
              <ul className="divide-y divide-surface-border rounded-xl border border-surface-border">
                {selected.checks.map((check) => (
                  <li key={check.id} className="flex items-center justify-between gap-4 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm text-zinc-300">{check.label}</p>
                      <p className="truncate text-xs text-zinc-600">{check.url}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {check.responseMs != null && (
                        <span className="font-mono text-xs text-zinc-400">{check.responseMs} ms</span>
                      )}
                      <StatusBadge status={check.status} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </DetailDrawer>
    </>
  );
}
