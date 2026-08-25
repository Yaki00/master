import { NextResponse } from "next/server";
import { assertWorkerAuth } from "@/lib/pipeline/auth";
import { completeOfficeCommand, getOfficeCommand } from "@/lib/db/office";
import { processTaskAfterCommand } from "@/lib/office/handoff";
import { processMeetingAfterCommand } from "@/lib/office/meeting";
import { processPmAfterCommand } from "@/lib/office/project-orchestrator";
import { withOfficeSecurity } from "@/lib/office/http";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: Request, context: RouteContext) {
  if (!assertWorkerAuth(req)) {
    return withOfficeSecurity(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  }

  const { id } = await context.params;
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const rawStatus = String(body.status ?? "done");
  const status = rawStatus === "failed" ? "failed" : "done";
  const result = body.result != null ? String(body.result) : null;
  const summary = body.summary != null ? String(body.summary) : undefined;
  const before = getOfficeCommand(id);
  const command = completeOfficeCommand(id, status, result, summary ? { summary } : undefined);
  if (!command) {
    return withOfficeSecurity(NextResponse.json({ error: "not found" }, { status: 404 }));
  }

  if (
    before &&
    before.status !== "done" &&
    before.status !== "failed" &&
    (command.kind === "message" || command.kind === "resume") &&
    command.result
  ) {
    processMeetingAfterCommand(
      command.id,
      command.agentId,
      status,
      command.result,
    );
    const payloadTaskId =
      typeof before.payload.taskId === "string" ? before.payload.taskId : null;
    processTaskAfterCommand(
      command.id,
      command.agentId,
      status,
      command.result,
      payloadTaskId,
    );
    processPmAfterCommand(
      command.id,
      command.agentId,
      status,
      command.result,
      payloadTaskId,
    );
  }

  return withOfficeSecurity(NextResponse.json({ ok: true, command: getOfficeCommand(id) }));
}
