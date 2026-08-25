import { NextResponse } from "next/server";
import { assertWorkerAuth } from "@/lib/pipeline/auth";
import { listJobs, listWorkerHeartbeats } from "@/lib/db/jobs";
import { SECURITY_HEADERS } from "@/lib/security";
import type { JobStatus, JobTarget } from "@/lib/types";

export const dynamic = "force-dynamic";

function withSecurity(res: NextResponse) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    res.headers.set(k, v);
  }
  return res;
}

export async function GET(req: Request) {
  if (!assertWorkerAuth(req)) {
    return withSecurity(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  }

  const { searchParams } = new URL(req.url);
  const statusParam = searchParams.get("status");
  const targetParam = searchParams.get("target");
  const limit = Number(searchParams.get("limit") ?? "50");

  const status = statusParam
    ? (statusParam.split(",") as JobStatus[])
    : undefined;
  const target = targetParam ? (targetParam.split(",") as JobTarget[]) : undefined;

  const jobs = listJobs({ status, target, limit: Number.isFinite(limit) ? limit : 50 });
  const workers = listWorkerHeartbeats();

  return withSecurity(NextResponse.json({ jobs, workers }));
}
