import { NextResponse } from "next/server";
import { claimJob, updateJob } from "@/lib/db/jobs";
import { assertWorkerAuth } from "@/lib/pipeline/auth";
import { SECURITY_HEADERS } from "@/lib/security";
import type { JobTarget } from "@/lib/types";

export const dynamic = "force-dynamic";

function withSecurity(res: NextResponse) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    res.headers.set(k, v);
  }
  return res;
}

const DEFAULT_PC_TARGETS: JobTarget[] = ["agent", "pc", "screen", "continue"];
const DEFAULT_CLOUD_TARGETS: JobTarget[] = ["cloud"];

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
  const role = String(body.role ?? "pc");
  const targets = Array.isArray(body.targets)
    ? (body.targets as JobTarget[])
    : role === "orchestrator"
      ? DEFAULT_CLOUD_TARGETS
      : DEFAULT_PC_TARGETS;

  const job = claimJob(workerId, targets);
  if (!job) {
    return withSecurity(NextResponse.json({ job: null }));
  }

  updateJob(job.id, { status: "running" });
  return withSecurity(NextResponse.json({ job: { ...job, status: "running" } }));
}
