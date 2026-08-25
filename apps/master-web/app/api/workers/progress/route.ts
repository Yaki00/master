import { NextResponse } from "next/server";
import { appendJobEvent, getJob, updateJob } from "@/lib/db/jobs";
import { assertWorkerAuth } from "@/lib/pipeline/auth";
import { SECURITY_HEADERS } from "@/lib/security";

export const dynamic = "force-dynamic";

function withSecurity(res: NextResponse) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    res.headers.set(k, v);
  }
  return res;
}

/** Progress PC — log SQLite uniquement (plus de push WhatsApp). */
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

  const jobId = String(body.jobId ?? "");
  const message = String(body.message ?? "").slice(0, 1500);
  if (!jobId || !message) {
    return withSecurity(NextResponse.json({ error: "jobId and message required" }, { status: 400 }));
  }

  const job = getJob(jobId);
  if (!job) {
    return withSecurity(NextResponse.json({ error: "not found" }, { status: 404 }));
  }

  if (body.cursorAgentId) {
    updateJob(jobId, { cursorAgentId: String(body.cursorAgentId) });
  }
  if (body.cursorRunId) {
    updateJob(jobId, { cursorRunId: String(body.cursorRunId) });
  }

  appendJobEvent(jobId, "progress", { message: message.slice(0, 500) });

  return withSecurity(NextResponse.json({ ok: true }));
}
