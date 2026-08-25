"use client";

import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/StatusBadge";
import { useMetricsContext } from "@/components/MetricsProvider";

export default function N8nPage() {
  const { data, loading } = useMetricsContext();
  const n8n = data?.n8n;

  return (
    <>
      <PageHeader
        title="n8n"
        description="Workflows actifs et exécutions · n8n.pixelbrain.fr"
      />

      {loading && !data ? (
        <div className="h-48 animate-pulse rounded-2xl bg-surface-raised" />
      ) : !n8n ? (
        <Card padding="md" className="border-dashed border-surface-border">
          <p className="text-sm text-zinc-400">
            Données n8n indisponibles — configure <code className="text-zinc-300">N8N_API_KEY</code> dans Infisical
            pour activer le suivi live.
          </p>
        </Card>
      ) : (
        <>
          <div className="mb-8 grid gap-4 sm:grid-cols-3">
            <Card padding="sm">
              <p className="text-xs text-zinc-500">Workflows actifs</p>
              <p className="mt-1 text-2xl font-semibold text-white">{n8n.activeWorkflows}</p>
            </Card>
            <Card padding="sm">
              <p className="text-xs text-zinc-500">Exécutions running</p>
              <p className="mt-1 text-2xl font-semibold text-white">{n8n.runningExecutions}</p>
            </Card>
            <Card padding="sm">
              <p className="text-xs text-zinc-500">Failed (24h)</p>
              <p className="mt-1 text-2xl font-semibold text-white">{n8n.failed24h}</p>
            </Card>
          </div>

          {n8n.workflows.length > 0 ? (
            <div className="overflow-hidden rounded-2xl border border-surface-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-raised text-xs uppercase tracking-wider text-zinc-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">Workflow</th>
                    <th className="px-5 py-3 font-medium">PC IA</th>
                    <th className="px-5 py-3 font-medium">État</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border/60">
                  {n8n.workflows.map((w) => (
                    <tr key={w.id} className="bg-surface/30">
                      <td className="px-5 py-3.5 text-zinc-300">{w.name}</td>
                      <td className="px-5 py-3.5 text-xs text-zinc-500">{w.aiHost ?? "—"}</td>
                      <td className="px-5 py-3.5">
                        <StatusBadge status={w.active ? "up" : "down"} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Card>
              <p className="text-center text-sm text-zinc-500">Aucun workflow actif détecté</p>
            </Card>
          )}
        </>
      )}
    </>
  );
}
