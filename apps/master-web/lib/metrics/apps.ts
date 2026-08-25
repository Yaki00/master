import { isAppSnoozed } from "../snooze";
import { APPS, type AppMetrics, type AppStats, type CheckResult, type HealthStatus } from "../types";
import { fetchStripeMrrByApp } from "../integrations/stripe";
import { pixelbrainSupportFetch } from "../pixelbrain-support-api";

const TIMEOUT_MS = 8000;
const CORE_APPS = new Set(["pixelbraincard", "echowork", "ratus"]);

async function probeUrl(url: string): Promise<CheckResult> {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "MasterPanel/1.0" },
    });
    clearTimeout(timer);
    const responseMs = Date.now() - start;
    const status: HealthStatus = res.ok ? "up" : res.status >= 500 ? "down" : "degraded";
    return { id: url, label: url, url, status, statusCode: res.status, responseMs };
  } catch (err) {
    clearTimeout(timer);
    return {
      id: url,
      label: url,
      url,
      status: "down",
      statusCode: null,
      responseMs: null,
      message: err instanceof Error ? err.message : "Erreur",
    };
  }
}

function aggregateAppStatus(checks: CheckResult[]): HealthStatus {
  if (checks.every((c) => c.status === "up")) return "up";
  if (checks.some((c) => c.status === "up")) return "degraded";
  return "down";
}

async function fetchAppStatsFromApi(appId: string, statsUrl?: string): Promise<AppStats | null> {
  const token = process.env.MASTER_STATS_TOKEN;
  if (!token || !statsUrl) return null;

  try {
    const res = await fetch(statsUrl, {
      headers: { "X-Master-Token": token },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Omit<AppStats, "source">;
    return { ...data, source: "api" };
  } catch {
    return null;
  }
}

async function fetchPixelbrainCardStats(): Promise<AppStats | null> {
  const result = await pixelbrainSupportFetch<{
    merchants: number;
    customers: number;
    activeSubscriptions: number;
  }>("/platform/stats");
  if (!result.ok) return null;
  return {
    usersTotal: result.data.merchants,
    usersOnline: null,
    revenueMrrCents: null,
    revenue30dCents: null,
    activeSubscriptions: result.data.activeSubscriptions,
    source: "api",
  };
}

const UNAVAILABLE_STATS: AppStats = {
  usersTotal: null,
  usersOnline: null,
  revenueMrrCents: null,
  revenue30dCents: null,
  activeSubscriptions: null,
  source: "unavailable",
};

async function resolveAppStats(appId: string): Promise<AppStats | null> {
  if (!CORE_APPS.has(appId)) return null;

  const appDef = APPS.find((a) => a.id === appId);
  const apiStats =
    (await fetchAppStatsFromApi(appId, (appDef as { statsUrl?: string })?.statsUrl)) ??
    (appId === "pixelbraincard" ? await fetchPixelbrainCardStats() : null);

  const stripe = await fetchStripeMrrByApp(appId);

  if (apiStats) {
    return {
      ...apiStats,
      revenueMrrCents: stripe.mrrCents ?? apiStats.revenueMrrCents,
      activeSubscriptions: stripe.activeSubscriptions ?? apiStats.activeSubscriptions,
      source: "api",
    };
  }

  if (stripe.mrrCents != null || stripe.activeSubscriptions != null) {
    return {
      ...UNAVAILABLE_STATS,
      revenueMrrCents: stripe.mrrCents,
      activeSubscriptions: stripe.activeSubscriptions,
      source: "api",
    };
  }

  return UNAVAILABLE_STATS;
}

export async function collectAppsMetrics(): Promise<AppMetrics[]> {
  return Promise.all(
    APPS.map(async (app) => {
      if (isAppSnoozed(app.id)) {
        return {
          id: app.id,
          name: app.name,
          status: "snoozed" as const,
          checks: app.checks.map((check) => ({
            id: check.id,
            label: check.label,
            url: check.url,
            status: "snoozed" as const,
            statusCode: null,
            responseMs: null,
            message: "Standby — snoozé",
          })),
          uptimeRatio: 0,
          stats: null,
        };
      }

      const checks = await Promise.all(
        app.checks.map(async (check) => {
          const result = await probeUrl(check.url);
          return { ...result, id: check.id, label: check.label };
        }),
      );
      const up = checks.filter((c) => c.status === "up").length;
      const stats = await resolveAppStats(app.id);
      return {
        id: app.id,
        name: app.name,
        status: aggregateAppStatus(checks),
        checks,
        uptimeRatio: checks.length ? up / checks.length : 0,
        stats,
      };
    }),
  );
}
