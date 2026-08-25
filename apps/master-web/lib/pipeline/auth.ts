import { timingSafeEqual } from "crypto";
import { logSecurityEventFromRequest } from "../security-log";

export function getWorkerToken(): string | null {
  return process.env.WORKER_TOKEN?.trim() || null;
}

export function assertWorkerAuth(req: Request): boolean {
  const expected = getWorkerToken();
  const header =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ||
    req.headers.get("x-worker-token")?.trim() ||
    "";

  let ok = false;
  if (expected && header && header.length === expected.length) {
    try {
      ok = timingSafeEqual(Buffer.from(header), Buffer.from(expected));
    } catch {
      ok = false;
    }
  }

  if (!ok) {
    const path = (() => {
      try {
        return new URL(req.url).pathname;
      } catch {
        return "unknown";
      }
    })();
    logSecurityEventFromRequest(req, {
      kind: "worker_auth_fail",
      title: "Token worker invalide",
      detail: `Requête rejetée sur ${path} (token manquant ou incorrect).`,
      meta: { path, hasToken: Boolean(header), tokenConfigured: Boolean(expected) },
    });
  }

  return ok;
}
