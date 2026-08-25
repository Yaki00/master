import {
  countUnreadNotifications,
  getAlertLastFired,
  insertNotification,
  listNotifications,
  setAlertLastFired,
} from "../db/sqlite";
import { insertSecurityEvent } from "../db/security-events";
import type { DashboardMetrics, NotificationRecord } from "../types";
import { ALERT_COOLDOWN_MS, MAJOR_RULES } from "./rules";

export async function runAlertEngine(metrics: DashboardMetrics): Promise<void> {
  const now = Date.now();

  for (const rule of MAJOR_RULES) {
    if (!rule.when(metrics)) continue;

    const lastFired = getAlertLastFired(rule.id);
    if (lastFired && now - new Date(lastFired).getTime() < ALERT_COOLDOWN_MS) continue;

    const body = rule.body(metrics);

    insertNotification({
      type: rule.id,
      severity: rule.severity === "critical" ? "critical" : "warning",
      title: rule.title,
      body,
      sentWa: false,
      read: false,
    });

    insertSecurityEvent({
      kind: "system_alert",
      title: `Alerte ${rule.id}`,
      detail: `${rule.title} — ${body}`,
      severity: rule.severity === "critical" ? "critical" : "warning",
      meta: { ruleId: rule.id, channel: "in-app" },
    });

    setAlertLastFired(rule.id, new Date().toISOString());
  }
}

export function getNotificationsSummary(): {
  unreadCount: number;
  recent: NotificationRecord[];
} {
  return {
    unreadCount: countUnreadNotifications(),
    recent: listNotifications(5),
  };
}
