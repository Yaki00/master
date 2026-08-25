import { NextResponse } from "next/server";
import { assertWorkerAuth } from "@/lib/pipeline/auth";
import { appendOfficeEvent, normalizeOfficeAgentId, parseOfficeAgentId } from "@/lib/db/office";
import { appendAgentLog } from "@/lib/db/agent-logs";
import { applyRuntimeStatusFromEvent } from "@/lib/office/handoff";
import { withOfficeSecurity } from "@/lib/office/http";

export const dynamic = "force-dynamic";

/** Worker → événement chat immédiat (interim / progress / réflexion). */
export async function POST(req: Request) {
  if (!assertWorkerAuth(req)) {
    return withOfficeSecurity(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return withOfficeSecurity(NextResponse.json({ error: "Invalid JSON" }, { status: 400 }));
  }

  const rawId = String(body.agentId ?? "").trim();
  const kind = String(body.kind ?? "agent_message").trim() || "agent_message";
  if (!rawId) {
    return withOfficeSecurity(NextResponse.json({ error: "agentId requis" }, { status: 400 }));
  }

  const parsed = parseOfficeAgentId(rawId);
  const agentId = parsed
    ? normalizeOfficeAgentId(rawId, parsed.kind)
    : normalizeOfficeAgentId(rawId, "openclaw");

  const payload =
    body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
      ? (body.payload as Record<string, unknown>)
      : {};
  const text = body.text != null ? String(body.text) : typeof payload.text === "string" ? payload.text : "";

  const commandId =
    payload.commandId != null
      ? String(payload.commandId)
      : body.commandId != null
        ? String(body.commandId)
        : null;

  const isReflectionOnly = kind === "reflection" || payload.reflection === true;

  if (isReflectionOnly && text) {
    const log = appendAgentLog(agentId, "reflection", text.slice(0, 4000), {
      eventKind: kind,
      commandId,
    });
    applyRuntimeStatusFromEvent(commandId, kind, { ...payload, text });
    return withOfficeSecurity(NextResponse.json({ ok: true, log }));
  }

  const event = appendOfficeEvent(agentId, kind, {
    ...payload,
    ...(text ? { text } : {}),
    role: payload.role ?? (kind === "command_failed" ? "system" : "agent"),
  });

  if ((payload.interim === true || kind === "spawn_tree" || kind === "progress") && text) {
    appendAgentLog(
      agentId,
      kind === "spawn_tree" ? "system" : "reflection",
      text.slice(0, 4000),
      { eventKind: kind, commandId },
    );
  }

  applyRuntimeStatusFromEvent(commandId, kind, { ...payload, text });

  return withOfficeSecurity(NextResponse.json({ ok: true, event }));
}
