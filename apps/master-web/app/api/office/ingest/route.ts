import { NextResponse } from "next/server";
import { assertWorkerAuth } from "@/lib/pipeline/auth";
import { ingestOfficeSnapshot } from "@/lib/db/office";
import { upsertWorkerHeartbeat } from "@/lib/db/jobs";
import { withOfficeSecurity } from "@/lib/office/http";
import type { OfficeIngestAgent } from "@/lib/office/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!assertWorkerAuth(req)) {
    return withOfficeSecurity(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return withOfficeSecurity(NextResponse.json({ error: "Invalid JSON" }, { status: 400 }));
  }

  const agents = Array.isArray(body.agents) ? (body.agents as OfficeIngestAgent[]) : [];
  const events = Array.isArray(body.events)
    ? (body.events as { agentId: string; kind: string; payload?: Record<string, unknown> }[])
    : [];

  const result = ingestOfficeSnapshot({
    source: body.source != null ? String(body.source) : "openclaw-mac",
    hostname: body.hostname != null ? String(body.hostname) : null,
    agents,
    events,
  });

  upsertWorkerHeartbeat({
    workerId: "openclaw-mac",
    hostname: body.hostname != null ? String(body.hostname) : "openclaw-mac",
    meta: { role: "openclaw", source: "office-ingest", ingested: result.ingested },
  });

  return withOfficeSecurity(NextResponse.json({ ok: true, ingested: result.ingested, agents: result.agents }));
}
