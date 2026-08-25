import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { collectDashboardMetrics } from "@/lib/metrics";
import { getClientIp } from "@/lib/security";
import { checkRateLimit, METRICS_LIMIT } from "@/lib/rate-limit";
import { SECURITY_HEADERS } from "@/lib/security";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ip = await getClientIp();
  const limit = checkRateLimit(`metrics:${ip}`, METRICS_LIMIT);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many requests", retryAfter: limit.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  const metrics = await collectDashboardMetrics();
  const res = NextResponse.json(metrics);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    res.headers.set(k, v);
  }
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return res;
}
