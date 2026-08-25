import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import {
  countSecurityEvents,
  listSecurityEvents,
  pruneSecurityEvents,
  SECURITY_RETENTION_DAYS,
  type SecurityEventKind,
  type SecurityEventSeverity,
} from "@/lib/db/security-events";
import { getClientIp, SECURITY_HEADERS } from "@/lib/security";
import { checkRateLimit, METRICS_LIMIT } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

function withSecurity(res: NextResponse) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    res.headers.set(k, v);
  }
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return res;
}

const KINDS = new Set<string>([
  "login_success",
  "login_failure",
  "login_rate_limited",
  "login_honeypot",
  "logout",
  "worker_auth_fail",
  "wa_sender_rejected",
  "docker_prune",
  "wa_alert_sent",
  "wa_alert_failed",
  "system_alert",
  "app_snooze",
  "office_message",
  "office_stop",
]);

const SEVERITIES = new Set<string>(["info", "warning", "critical"]);

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ip = await getClientIp();
  const limit = checkRateLimit(`security:${ip}`, METRICS_LIMIT);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many requests", retryAfter: limit.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  pruneSecurityEvents();

  const { searchParams } = new URL(req.url);
  const kindParam = searchParams.get("kind") ?? "all";
  const severityParam = searchParams.get("severity") ?? "all";
  const limitParam = Number(searchParams.get("limit") ?? "200");

  const kind =
    kindParam !== "all" && KINDS.has(kindParam) ? (kindParam as SecurityEventKind) : "all";
  const severity =
    severityParam !== "all" && SEVERITIES.has(severityParam)
      ? (severityParam as SecurityEventSeverity)
      : "all";

  const items = listSecurityEvents({
    limit: Number.isFinite(limitParam) ? limitParam : 200,
    kind,
    severity,
  });
  const stats = countSecurityEvents();

  return withSecurity(
    NextResponse.json({
      items,
      stats,
      retentionDays: SECURITY_RETENTION_DAYS,
    }),
  );
}
