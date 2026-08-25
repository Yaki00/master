"use client";

import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { Card } from "@/components/ui/Card";
import { MetricRingRow } from "@/components/ui/MetricRing";
import { StatusBadge } from "@/components/StatusBadge";
import { useMetricsContext } from "@/components/MetricsProvider";
import { formatEuros, V1_APP_IDS } from "@/lib/metrics/format";
import type { HealthStatus } from "@/lib/types";
import { OfficeRail } from "@/components/office/OfficeRail";

function globalStatus(appsDown: number, containersUnhealthy: number, vpsCritical: boolean): HealthStatus {
  if (appsDown > 0 || containersUnhealthy > 0 || vpsCritical) return "down";
  return "up";
}

function severityColor(severity: string) {
  if (severity === "critical") return "text-red-400";
  if (severity === "warning") return "text-amber-400";
  return "text-zinc-400";
}

export default function HomePage() {
  const { data, loading } = useMetricsContext();

  if (loading && !data) {
    return (
      <>
        <PageHeader title="Home" description="Synthèse de ton infrastructure Pixel Brain" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-surface-raised" />
          ))}
        </div>
      </>
    );
  }

  if (!data) return null;

  const coreApps = data.apps.filter((a) => (V1_APP_IDS as readonly string[]).includes(a.id));
  const activeApps = coreApps.filter((a) => a.status !== "snoozed");
  const appsUp = activeApps.filter((a) => a.status === "up").length;
  const appsDown = activeApps.filter((a) => a.status === "down").length;
  const snoozedCount = coreApps.length - activeApps.length;
  const vpsCritical =
    (data.vps.memoryPercent ?? 0) >= 90 ||
    (data.vps.diskPercent ?? 0) >= 90 ||
    (data.vps.cpuPercent ?? 0) >= 95;
  const status = globalStatus(appsDown, data.vps.containersUnhealthy, vpsCritical);
  const unread = data.notifications.unreadCount;

  const totalMrr = activeApps.reduce((sum, a) => sum + (a.stats?.revenueMrrCents ?? 0), 0);
  const totalUsers = activeApps.reduce((sum, a) => sum + (a.stats?.usersTotal ?? 0), 0);
  const hasMrr = activeApps.some((a) => a.stats?.revenueMrrCents != null);
  const hasUsers = activeApps.some((a) => a.stats?.usersTotal != null);

  return (
    <>
      <PageHeader
        title="Home"
        description="Synthèse temps réel · rafraîchissement toutes les 25 s"
      />

      <div
        className={`mb-8 flex flex-wrap items-center gap-4 rounded-2xl border p-5 ${
          status === "up"
            ? "border-emerald-500/20 bg-emerald-500/5"
            : "border-red-500/20 bg-red-500/5"
        }`}
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm text-zinc-500">État global</p>
          <p className="mt-1 text-lg font-medium text-white">
            {status === "up"
              ? "Infrastructure opérationnelle"
              : "Attention — incident détecté"}
          </p>
          {unread > 0 && (
            <Link href="/notifications" className="mt-1 inline-block text-sm text-amber-400 hover:text-amber-300">
              {unread} alerte{unread > 1 ? "s" : ""} non lue{unread > 1 ? "s" : ""}
            </Link>
          )}
          <OfficeRail />
        </div>
        <StatusBadge status={status} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="MRR"
          value={hasMrr ? formatEuros(totalMrr) : "—"}
          sub={hasMrr ? "Stripe" : "Non configuré"}
          accent="emerald"
        />
        <KpiCard
          label="Users total"
          value={hasUsers ? String(totalUsers) : "—"}
          sub={hasUsers ? "3 apps principales" : "API stats non configurée"}
          accent="blue"
        />
        <KpiCard
          label="Apps OK"
          value={`${appsUp}/${activeApps.length || coreApps.length}`}
          sub={
            snoozedCount > 0
              ? `EchoWork snoozé · ${snoozedCount} en standby`
              : "PixelbrainCard · EchoWork · Ratus"
          }
          accent="emerald"
          alert={appsDown > 0}
        />
        <KpiCard
          label="RAM VPS"
          value={data.vps.memoryPercent != null ? `${data.vps.memoryPercent}%` : "—"}
          sub={
            data.vps.memoryUsedMb != null
              ? `${data.vps.memoryUsedMb} / ${data.vps.memoryTotalMb} Mo`
              : undefined
          }
          accent="blue"
          alert={data.vps.memoryPercent != null && data.vps.memoryPercent >= 85}
        />
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-3">
        <section className="lg:col-span-1">
          <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-zinc-500">
            Applications
          </h3>
          <div className="space-y-2">
            {coreApps.map((app) => (
              <article
                key={app.id}
                className="flex items-center justify-between rounded-xl border border-surface-border bg-surface-raised/40 px-4 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <StatusBadge status={app.status} />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-white">{app.name}</p>
                <p className="text-xs text-zinc-600">
                  {app.stats?.usersTotal != null ? `${app.stats.usersTotal} users` : "— users"}
                  {app.stats?.revenueMrrCents != null ? ` · ${formatEuros(app.stats.revenueMrrCents)}/mois` : ""}
                </p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="lg:col-span-1">
          <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-zinc-500">
            VPS · {data.vps.ip}
          </h3>
          <Card padding="md">
            <MetricRingRow
              metrics={[
                {
                  value: data.vps.cpuPercent,
                  label: "CPU",
                  sub: data.vps.loadAverage?.[0] != null ? `load ${data.vps.loadAverage[0].toFixed(1)}` : undefined,
                },
                {
                  value: data.vps.memoryPercent,
                  label: "RAM",
                  sub:
                    data.vps.memoryUsedMb != null
                      ? `${data.vps.memoryUsedMb}/${data.vps.memoryTotalMb} Mo`
                      : undefined,
                },
                {
                  value: data.vps.diskPercent,
                  label: "Disque",
                  sub:
                    data.vps.diskUsedGb != null
                      ? `${data.vps.diskUsedGb}/${data.vps.diskTotalGb} Go`
                      : undefined,
                },
              ]}
            />
          </Card>
        </section>

        <section className="lg:col-span-1 space-y-6">
          {data.n8n && (
            <div>
              <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-zinc-500">n8n</h3>
              <Card padding="sm">
                <p className="text-sm text-zinc-300">
                  <span className="font-semibold text-white">{data.n8n.runningExecutions}</span> running ·{" "}
                  <span className="font-semibold text-white">{data.n8n.failed24h}</span> failed 24h
                </p>
                <p className="mt-1 text-xs text-zinc-600">{data.n8n.activeWorkflows} workflows actifs</p>
                <Link href="/n8n" className="mt-2 inline-block text-xs text-blue-400 hover:text-blue-300">
                  Voir détail →
                </Link>
              </Card>
            </div>
          )}

          <div>
            <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-zinc-500">
              Dernières alertes
            </h3>
            {data.notifications.recent.length === 0 ? (
              <Card padding="sm">
                <p className="text-sm text-zinc-500">Aucune alerte récente</p>
              </Card>
            ) : (
              <div className="space-y-2">
                {data.notifications.recent.map((n) => (
                  <Card key={n.id} padding="sm" className="!p-3">
                    <p className={`text-xs font-medium ${severityColor(n.severity)}`}>{n.title}</p>
                    <p className="mt-0.5 truncate text-xs text-zinc-500">{n.body}</p>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {data.clients.length > 0 && (
            <div>
              <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-zinc-500">
                Projets clients
              </h3>
              <div className="space-y-2">
                {data.clients.slice(0, 3).map((c) => (
                  <Link
                    key={c.id}
                    href={`/clients/${c.id}`}
                    className="block rounded-xl border border-surface-border bg-surface-raised/40 px-4 py-3 transition hover:bg-surface-raised/60"
                  >
                    <p className="font-medium text-white">{c.name}</p>
                    <p className="text-xs text-zinc-600">{c.projects.length} projet(s)</p>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      <section className="mt-10">
        <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-zinc-500">
          Liens rapides
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Infisical", href: "https://secrets.pixelbrain.fr", desc: "Secrets & env" },
            { label: "Stripe", href: "https://dashboard.stripe.com", desc: "Paiements & MRR" },
            { label: "n8n", href: "https://n8n.pixelbrain.fr", desc: "Workflows & automations" },
            { label: "OVH", href: "https://www.ovh.com/manager/", desc: "DNS & VPS" },
          ].map((link) => (
            <a
              key={link.label}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xl border border-surface-border bg-surface-raised/40 px-4 py-3 transition hover:border-zinc-600 hover:bg-surface-raised/70"
            >
              <p className="font-medium text-white">{link.label}</p>
              <p className="mt-0.5 text-xs text-zinc-500">{link.desc}</p>
            </a>
          ))}
        </div>
      </section>
    </>
  );
}
