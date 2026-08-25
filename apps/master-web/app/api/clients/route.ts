import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getClientById, loadClients } from "@/lib/clients";
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
  const limit = checkRateLimit(`clients:${ip}`, METRICS_LIMIT);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many requests", retryAfter: limit.retryAfterSec },
      { status: 429 },
    );
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (id) {
    const client = await getClientById(id);
    if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return withSecurity(NextResponse.json(client));
  }

  const clients = await loadClients();
  return withSecurity(NextResponse.json({ clients }));
}
