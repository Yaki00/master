import { NextResponse } from "next/server";
import { appendJobEvent, getJob, updateJob } from "@/lib/db/jobs";
import { handleJobHuntJobComplete } from "@/lib/job-hunt/engine";
import { assertWorkerAuth } from "@/lib/pipeline/auth";
import { SECURITY_HEADERS } from "@/lib/security";

export const dynamic = "force-dynamic";

function withSecurity(res: NextResponse) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    res.headers.set(k, v);
  }
  return res;
}

/** Fin de job PC — notifications canal = bureau / Telegram (OpenClaw), plus WhatsApp. */
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
  if (!jobId) {
    return withSecurity(NextResponse.json({ error: "jobId required" }, { status: 400 }));
  }

  const existing = getJob(jobId);
  if (!existing) {
    return withSecurity(NextResponse.json({ error: "not found" }, { status: 404 }));
  }

  // Ne pas écraser un stop manuel — le worker PC peut finir sa boucle locale après coup.
  if (existing.status === "cancelled") {
    appendJobEvent(jobId, "complete_ignored", {
      reason: "already cancelled",
      workerStatus: body.status ?? null,
    });
    return withSecurity(NextResponse.json({ ok: true, job: existing, ignored: true }));
  }

  const rawStatus = String(body.status ?? "completed");
  const status =
    rawStatus === "failed" ? "failed" : rawStatus === "paused" ? "paused" : "completed";
  const resultText = body.resultText != null ? String(body.resultText) : null;
  const error = body.error != null ? String(body.error) : null;
  const mediaUrl = body.mediaUrl != null ? String(body.mediaUrl) : null;
  const cursorAgentId = body.cursorAgentId != null ? String(body.cursorAgentId) : undefined;
  const cursorRunId = body.cursorRunId != null ? String(body.cursorRunId) : undefined;

  const job = updateJob(jobId, {
    status,
    resultText,
    error,
    mediaUrl,
    cursorAgentId: cursorAgentId ?? undefined,
    cursorRunId: cursorRunId ?? undefined,
  });

  appendJobEvent(jobId, status, {
    resultText: resultText?.slice(0, 500),
    error,
  });

  if (existing.waChatId === "job-hunt") {
    handleJobHuntJobComplete({ jobId, status, resultText, error });
  }

  // Canal WhatsApp retiré — les jobs bureau (channel office) restent visibles dans /agents.
  void body.notify;

  return withSecurity(NextResponse.json({ ok: true, job }));
}
