import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { listAppSnoozes, setAppSnooze } from "@/lib/db/snooze";
import { isAppSnoozed } from "@/lib/snooze";
import { APPS } from "@/lib/types";
import { getClientIp, SECURITY_HEADERS } from "@/lib/security";
import { checkRateLimit, METRICS_LIMIT } from "@/lib/rate-limit";
import { logSecurityEvent } from "@/lib/security-log";

export const dynamic = "force-dynamic";

const ALLOWED = new Set(APPS.map((a) => a.id));

function withSecurity(res: NextResponse) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    res.headers.set(k, v);
  }
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const overrides = listAppSnoozes();
  const items = APPS.filter((a) => ["pixelbraincard", "echowork", "ratus", "n8n", "infisical"].includes(a.id)).map(
    (a) => ({
      id: a.id,
      name: a.name,
      snoozed: isAppSnoozed(a.id),
      codeDefault: Boolean(a.snoozed),
    }),
  );

  return withSecurity(NextResponse.json({ items, overrides }));
}

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ip = await getClientIp();
  const limit = checkRateLimit(`snooze:${ip}`, METRICS_LIMIT);
  if (!limit.ok) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const body = (await req.json()) as { appId?: string; snoozed?: boolean; reason?: string };
  if (!body.appId || !ALLOWED.has(body.appId) || typeof body.snoozed !== "boolean") {
    return NextResponse.json({ error: "appId + snoozed requis" }, { status: 400 });
  }

  const result = setAppSnooze(body.appId, body.snoozed, body.reason);
  await logSecurityEvent({
    kind: "app_snooze",
    title: body.snoozed ? `App snoozée: ${body.appId}` : `App réactivée: ${body.appId}`,
    detail: body.reason ?? (body.snoozed ? "Standby monitoring" : "Monitoring repris"),
    meta: { appId: body.appId, snoozed: body.snoozed },
    severity: "info",
  });

  return withSecurity(NextResponse.json({ ok: true, ...result }));
}
