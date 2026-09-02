import { NextResponse } from "next/server";
import { upsertWorkerHeartbeat, getWorkerHeartbeat, PC_OFFLINE_MS } from "@/lib/db/jobs";
import { runJobHuntAutoPipeline } from "@/lib/job-hunt/engine";
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

  const prev = getWorkerHeartbeat(workerId);
  const wasOffline =
    !prev || Date.now() - new Date(prev.lastSeenAt).getTime() >= PC_OFFLINE_MS;

  const hb = upsertWorkerHeartbeat({
    workerId,
    hostname,
    meta: body.meta ?? null,
  });

  let jobHunt: Awaited<ReturnType<typeof runJobHuntAutoPipeline>> | null = null;
  const triggerJobHunt = body.jobHuntSync === true || wasOffline;
  if (triggerJobHunt && workerId === "pc-main") {
    try {
      jobHunt = await runJobHuntAutoPipeline({ pcJustConnected: wasOffline });
    } catch (err) {
      jobHunt = {
        ok: false,
        skipped: err instanceof Error ? err.message : "job-hunt error",
        tailorJobs: [],
        applyJobs: [],
      };
    }
  }

  return withSecurity(NextResponse.json({ ok: true, heartbeat: hb, pcJustConnected: wasOffline, jobHunt }));
}
