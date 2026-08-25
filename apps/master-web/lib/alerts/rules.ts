import { isAppSnoozed } from "../snooze";
import type { DashboardMetrics } from "../types";

export const ALERT_COOLDOWN_MS = 30 * 60 * 1000;

const MONITORED_CORE_APPS = ["pixelbraincard", "echowork", "ratus"] as const;

export type AlertRule = {
  id: string;
  severity: "warning" | "critical";
  title: string;
  when: (m: DashboardMetrics) => boolean;
  body: (m: DashboardMetrics) => string;
};

export const MAJOR_RULES: AlertRule[] = [
  {
    id: "app_down",
    severity: "critical",
    title: "Application indisponible",
    when: (m) =>
      m.apps.some(
        (a) =>
          (MONITORED_CORE_APPS as readonly string[]).includes(a.id) &&
          !isAppSnoozed(a.id) &&
          a.status === "down",
      ),
    body: (m) => {
      const down = m.apps
        .filter(
          (a) =>
            (MONITORED_CORE_APPS as readonly string[]).includes(a.id) &&
            !isAppSnoozed(a.id) &&
            a.status === "down",
        )
        .map((a) => a.name);
      return `Apps down : ${down.join(", ")}`;
    },
  },
  {
    id: "vps_ram",
    severity: "critical",
    title: "RAM VPS critique",
    when: (m) => (m.vps.memoryPercent ?? 0) >= 90,
    body: (m) => `RAM à ${m.vps.memoryPercent}%`,
  },
  {
    id: "vps_disk",
    severity: "critical",
    title: "Disque VPS critique",
    when: (m) => (m.vps.diskPercent ?? 0) >= 90,
    body: (m) => `Disque à ${m.vps.diskPercent}%`,
  },
  {
    id: "vps_cpu",
    severity: "warning",
    title: "CPU VPS élevé",
    when: (m) => (m.vps.cpuPercent ?? 0) >= 95,
    body: (m) => `CPU à ${m.vps.cpuPercent}%`,
  },
  {
    id: "nginx_down",
    severity: "critical",
    title: "Nginx indisponible",
    when: (m) => {
      const nginx = m.vps.containers.find((c) => c.name === "pixelbrain-nginx");
      return nginx != null && nginx.health !== "up";
    },
    body: () => "Container pixelbrain-nginx unhealthy ou arrêté",
  },
];
