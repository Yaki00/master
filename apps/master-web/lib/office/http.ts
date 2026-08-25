import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getClientIp, SECURITY_HEADERS } from "@/lib/security";
import { checkRateLimit, OFFICE_LIMIT } from "@/lib/rate-limit";

export function withOfficeSecurity(res: NextResponse) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    res.headers.set(k, v);
  }
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return res;
}

export async function requireOfficeSession(): Promise<
  { ok: true } | { ok: false; response: NextResponse }
> {
  const session = await getServerSession(authOptions);
  if (!session) {
    return { ok: false, response: withOfficeSecurity(NextResponse.json({ error: "Unauthorized" }, { status: 401 })) };
  }

  const ip = await getClientIp();
  const limit = checkRateLimit(`office:${ip}`, OFFICE_LIMIT);
  if (!limit.ok) {
    return {
      ok: false,
      response: withOfficeSecurity(
        NextResponse.json(
          { error: "Too many requests", retryAfter: limit.retryAfterSec },
          { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
        ),
      ),
    };
  }

  return { ok: true };
}
