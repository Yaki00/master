import type { DashboardMetrics } from "../types";
import { getNotificationsSummary, runAlertEngine } from "../alerts/engine";
import { loadClients } from "../clients";
import { fetchN8nSummary } from "../integrations/n8n";
import { maybeRunWeeklyDockerPrune } from "../maintenance/docker-prune";
import { collectAppsMetrics } from "./apps";
import { collectVpsMetrics } from "./vps";

export { collectVpsMetrics } from "./vps";
export { collectAppsMetrics } from "./apps";
export { V1_APP_IDS, formatEuros } from "./format";

export async function collectDashboardMetrics(): Promise<DashboardMetrics> {
  // Fire-and-forget: prune hebdo si dû (ne bloque pas les KPIs)
  void maybeRunWeeklyDockerPrune();

  const [vps, apps, n8n, clients] = await Promise.all([
    collectVpsMetrics(),
    collectAppsMetrics(),
    fetchN8nSummary(),
    loadClients(),
  ]);

  const metrics: DashboardMetrics = {
    vps,
    apps,
    notifications: getNotificationsSummary(),
    n8n,
    clients,
    collectedAt: new Date().toISOString(),
  };

  await runAlertEngine(metrics);

  metrics.notifications = getNotificationsSummary();

  return metrics;
}
