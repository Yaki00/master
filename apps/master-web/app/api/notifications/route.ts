import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { listNotifications, markNotificationRead } from "@/lib/db/sqlite";
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

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ip = await getClientIp();
  const limit = checkRateLimit(`notifications:${ip}`, METRICS_LIMIT);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many requests", retryAfter: limit.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  const { searchParams } = new URL(req.url);
  const unreadOnly = searchParams.get("unread") === "1";
  const items = listNotifications(100, unreadOnly);

  return withSecurity(NextResponse.json({ items }));
}

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as { id?: string };
  if (!body.id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const ok = markNotificationRead(body.id);
  return withSecurity(NextResponse.json({ ok }));
}
