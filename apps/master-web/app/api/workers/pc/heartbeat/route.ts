import { NextResponse } from "next/server";
import { upsertWorkerHeartbeat } from "@/lib/db/jobs";
import { assertWorkerAuth } from "@/lib/pipeline/auth";
import { SECURITY_HEADERS } from "@/lib/security";

export const dynamic = "force-dynamic";

function withSecurity(res: NextResponse) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    res.headers.set(k, v);
  }
  return res;
}

export async function POST(req: Request) {
  if (!assertWorkerAuth(req)) {
    return withSecurity(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return withSecurity(NextResponse.json({ error: "Invalid JSON" }, { status: 400 }));
  }

  const workerId = String(body.workerId ?? "pc-main");
  const hostname = body.hostname != null ? String(body.hostname) : null;
  const hb = upsertWorkerHeartbeat({
    workerId,
    hostname,
    meta: body.meta ?? null,
  });

  return withSecurity(NextResponse.json({ ok: true, heartbeat: hb }));
}
