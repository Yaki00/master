"use client";

import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { Card } from "@/components/ui/Card";
import { MetricRing } from "@/components/ui/MetricRing";
import { StatusBadge } from "@/components/StatusBadge";
import { useMetricsContext } from "@/components/MetricsProvider";

export default function VpsPage() {
  const { data, loading } = useMetricsContext();
  const vps = data?.vps;

  return (
    <>
      <PageHeader
        title="VPS"
        description={`${vps?.ip ?? "51.210.11.46"} · métriques lecture seule`}
      />

      {loading && !vps ? (
        <div className="space-y-4">
          <div className="h-32 animate-pulse rounded-2xl bg-surface-raised" />
          <div className="h-64 animate-pulse rounded-2xl bg-surface-raised" />
        </div>
      ) : vps ? (
        <>
          <Card className="mb-8">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-white">{vps.name}</h3>
                <p className="text-sm text-zinc-500">{vps.ip}</p>
              </div>
              <div className="text-right text-sm text-zinc-500">
                {vps.uptimeFormatted && <p>Uptime · {vps.uptimeFormatted}</p>}
                <p className="mt-1">
                  {vps.containersRunning} containers · {vps.containersUnhealthy} en alerte
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-around gap-8 py-4">
              <MetricRing
                value={vps.cpuPercent}
                label="CPU"
                sub={vps.loadAverage?.map((n) => n.toFixed(2)).join(" · ")}
                size={100}
              />
              <MetricRing
                value={vps.memoryPercent}
                label="Mémoire"
                sub={
                  vps.memoryUsedMb != null
                    ? `${vps.memoryUsedMb} / ${vps.memoryTotalMb} Mo`
                    : undefined
                }
                size={100}
              />
              <MetricRing
                value={vps.diskPercent}
                label="Stockage"
                sub={
                  vps.diskUsedGb != null
                    ? `${vps.diskUsedGb} / ${vps.diskTotalGb} Go`
                    : undefined
                }
                size={100}
              />
            </div>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Load (1 / 5 / 15 min)"
              value={vps.loadAverage?.[0]?.toFixed(2) ?? "—"}
              sub={vps.loadAverage?.map((n) => n.toFixed(2)).join(" · ")}
              accent="amber"
            />
            <KpiCard label="Containers actifs" value={String(vps.containersRunning)} accent="emerald" />
            <KpiCard
              label="En alerte"
              value={String(vps.containersUnhealthy)}
              alert={vps.containersUnhealthy > 0}
              accent="red"
            />
            <KpiCard
              label="Uptime"
              value={vps.uptimeFormatted ?? "—"}
              accent="blue"
            />
          </div>

          <div className="mt-8 overflow-hidden rounded-2xl border border-surface-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-raised text-xs uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Container</th>
                  <th className="px-5 py-3 font-medium">État</th>
                  <th className="hidden px-5 py-3 font-medium sm:table-cell">Détail</th>
                  <th className="px-5 py-3 font-medium">Santé</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border/60">
                {vps.containers.map((c) => (
                  <tr key={c.name} className="bg-surface/30 hover:bg-surface-raised/30">
                    <td className="px-5 py-3.5 font-mono text-xs text-zinc-300">{c.name}</td>
                    <td className="px-5 py-3.5 capitalize text-zinc-400">{c.state}</td>
                    <td className="hidden max-w-xs truncate px-5 py-3.5 text-xs text-zinc-600 sm:table-cell">
                      {c.status}
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusBadge status={c.health} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </>
  );
}
