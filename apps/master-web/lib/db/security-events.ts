import { getDb } from "./sqlite";

/** Rétention max des logs de sécurité (3 mois). */
export const SECURITY_RETENTION_DAYS = 90;

export type SecurityEventKind =
  | "login_success"
  | "login_failure"
  | "login_rate_limited"
  | "login_honeypot"
  | "logout"
  | "worker_auth_fail"
  | "wa_sender_rejected" // historique WhatsApp (legacy)
  | "docker_prune"
  | "wa_alert_sent" // historique
  | "wa_alert_failed" // historique
  | "system_alert"
  | "app_snooze"
  | "office_message"
  | "office_stop";

export type SecurityEventSeverity = "info" | "warning" | "critical";

export type SecurityEvent = {
  id: string;
  kind: SecurityEventKind;
  severity: SecurityEventSeverity;
  title: string;
  detail: string;
  ip: string | null;
  userAgent: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
};

const KIND_SEVERITY: Record<SecurityEventKind, SecurityEventSeverity> = {
  login_success: "info",
  login_failure: "warning",
  login_rate_limited: "critical",
  login_honeypot: "critical",
  logout: "info",
  worker_auth_fail: "critical",
  wa_sender_rejected: "warning",
  docker_prune: "info",
  wa_alert_sent: "info",
  wa_alert_failed: "warning",
  system_alert: "warning",
  app_snooze: "info",
  office_message: "info",
  office_stop: "warning",
};

function retentionCutoffIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - SECURITY_RETENTION_DAYS);
  return d.toISOString();
}

export function pruneSecurityEvents(): number {
  const database = getDb();
  const result = database
    .prepare(`DELETE FROM security_events WHERE created_at < ?`)
    .run(retentionCutoffIso());
  return result.changes;
}

function rowToEvent(row: Record<string, unknown>): SecurityEvent {
  let meta: Record<string, unknown> | null = null;
  if (row.meta != null && String(row.meta)) {
    try {
      meta = JSON.parse(String(row.meta)) as Record<string, unknown>;
    } catch {
      meta = null;
    }
  }
  return {
    id: String(row.id),
    kind: String(row.kind) as SecurityEventKind,
    severity: row.severity as SecurityEventSeverity,
    title: String(row.title),
    detail: String(row.detail),
    ip: row.ip != null ? String(row.ip) : null,
    userAgent: row.user_agent != null ? String(row.user_agent) : null,
    meta,
    createdAt: String(row.created_at),
  };
}

export function insertSecurityEvent(input: {
  kind: SecurityEventKind;
  title: string;
  detail?: string;
  ip?: string | null;
  userAgent?: string | null;
  meta?: Record<string, unknown> | null;
  severity?: SecurityEventSeverity;
}): SecurityEvent {
  const database = getDb();
  // Purge occasionnelle (1 écriture sur ~20) pour limiter le coût
  if (Math.random() < 0.05) pruneSecurityEvents();

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const severity = input.severity ?? KIND_SEVERITY[input.kind];
  const detail = input.detail ?? "";
  const metaJson = input.meta ? JSON.stringify(input.meta) : null;

  database
    .prepare(
      `INSERT INTO security_events (id, kind, severity, title, detail, ip, user_agent, meta, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.kind,
      severity,
      input.title,
      detail,
      input.ip ?? null,
      input.userAgent ?? null,
      metaJson,
      createdAt,
    );

  return {
    id,
    kind: input.kind,
    severity,
    title: input.title,
    detail,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    meta: input.meta ?? null,
    createdAt,
  };
}

export function listSecurityEvents(opts?: {
  limit?: number;
  kind?: SecurityEventKind | "all";
  severity?: SecurityEventSeverity | "all";
}): SecurityEvent[] {
  const database = getDb();
  const limit = Math.min(Math.max(opts?.limit ?? 200, 1), 500);
  const cutoff = retentionCutoffIso();
  const kind = opts?.kind && opts.kind !== "all" ? opts.kind : null;
  const severity = opts?.severity && opts.severity !== "all" ? opts.severity : null;

  let sql = `SELECT * FROM security_events WHERE created_at >= ?`;
  const params: unknown[] = [cutoff];

  if (kind) {
    sql += ` AND kind = ?`;
    params.push(kind);
  }
  if (severity) {
    sql += ` AND severity = ?`;
    params.push(severity);
  }

  sql += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(limit);

  return database
    .prepare(sql)
    .all(...params)
    .map((r) => rowToEvent(r as Record<string, unknown>));
}

export function countSecurityEvents(sinceIso?: string): {
  total: number;
  critical: number;
  warning: number;
  info: number;
} {
  const database = getDb();
  const cutoff = sinceIso ?? retentionCutoffIso();
  const row = database
    .prepare(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) as critical,
         SUM(CASE WHEN severity = 'warning' THEN 1 ELSE 0 END) as warning,
         SUM(CASE WHEN severity = 'info' THEN 1 ELSE 0 END) as info
       FROM security_events WHERE created_at >= ?`,
    )
    .get(cutoff) as {
    total: number;
    critical: number;
    warning: number;
    info: number;
  };

  return {
    total: row.total ?? 0,
    critical: row.critical ?? 0,
    warning: row.warning ?? 0,
    info: row.info ?? 0,
  };
}
