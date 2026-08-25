import { headers } from "next/headers";
import {
  insertSecurityEvent,
  type SecurityEventKind,
  type SecurityEventSeverity,
} from "./db/security-events";
import { getClientIp, getClientIpFromRequest } from "./security";

async function requestContext() {
  try {
    const h = await headers();
    const ip = await getClientIp();
    const userAgent = h.get("user-agent");
    return { ip, userAgent };
  } catch {
    return { ip: "unknown", userAgent: null as string | null };
  }
}

/** Log un événement de sécurité (contexte request Next.js). */
export async function logSecurityEvent(input: {
  kind: SecurityEventKind;
  title: string;
  detail?: string;
  meta?: Record<string, unknown> | null;
  severity?: SecurityEventSeverity;
  ip?: string | null;
  userAgent?: string | null;
}) {
  try {
    const ctx = input.ip != null ? { ip: input.ip, userAgent: input.userAgent ?? null } : await requestContext();
    return insertSecurityEvent({
      kind: input.kind,
      title: input.title,
      detail: input.detail,
      meta: input.meta,
      severity: input.severity,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
  } catch (err) {
    console.error("[security-log] failed to persist event", err);
    return null;
  }
}

/** Log synchrone depuis une Route Handler avec Request. */
export function logSecurityEventFromRequest(
  req: Request,
  input: {
    kind: SecurityEventKind;
    title: string;
    detail?: string;
    meta?: Record<string, unknown> | null;
    severity?: SecurityEventSeverity;
  },
) {
  try {
    return insertSecurityEvent({
      kind: input.kind,
      title: input.title,
      detail: input.detail,
      meta: input.meta,
      severity: input.severity,
      ip: getClientIpFromRequest(req),
      userAgent: req.headers.get("user-agent"),
    });
  } catch (err) {
    console.error("[security-log] failed to persist event", err);
    return null;
  }
}
