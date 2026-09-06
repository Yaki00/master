import { NextResponse } from "next/server";
import { dispatchOfficeAction } from "@/lib/office/actions";
import { requireOfficeSession, withOfficeSecurity } from "@/lib/office/http";
import type { OfficeCommandKind } from "@/lib/office/types";

type RouteContext = { params: Promise<{ id: string }> };

async function readPayload(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    return body && typeof body === "object" ? body : {};
  } catch {
    return {};
  }
}

const KINDS: OfficeCommandKind[] = ["message", "pause", "resume", "stop"];

export async function handleOfficeAct(req: Request) {
  const auth = await requireOfficeSession();
  if (!auth.ok) return auth.response;

  const payload = await readPayload(req);
  const agentId = String(payload.agentId ?? "").trim();
  const kindRaw = String(payload.kind ?? "").trim();
  if (!agentId) {
    return withOfficeSecurity(NextResponse.json({ error: "id invalide" }, { status: 400 }));
  }

  if (kindRaw === "clear") {
    const { clearOfficeEvents, getAggregatedOfficeAgent } = await import("@/lib/db/office");
    const { listOfficeConversations } = await import("@/lib/db/office-conversations");
    const n = clearOfficeEvents(agentId);
    const archives = listOfficeConversations(agentId, { status: "archived", limit: 10 });
    return withOfficeSecurity(
      NextResponse.json({
        ok: true,
        cleared: n,
        archived: archives[0] ?? null,
        conversations: archives,
        agent: getAggregatedOfficeAgent(agentId),
      }),
    );
  }

  const kind = kindRaw as OfficeCommandKind;
  if (!KINDS.includes(kind)) {
    return withOfficeSecurity(NextResponse.json({ error: "action inconnue" }, { status: 400 }));
  }

  const result = await dispatchOfficeAction(agentId, kind, payload);
  if (!result.ok) {
    return withOfficeSecurity(
      NextResponse.json({ error: result.error ?? "échec" }, { status: result.agent ? 409 : 404 }),
    );
  }
  return withOfficeSecurity(NextResponse.json(result));
}

export async function handleOfficeCommandRoute(
  req: Request,
  context: RouteContext,
  kind: OfficeCommandKind,
) {
  const auth = await requireOfficeSession();
  if (!auth.ok) return auth.response;

  const { id: raw } = await context.params;
  const id = decodeURIComponent(raw);
  const payload = await readPayload(req);
  const result = await dispatchOfficeAction(id, kind, payload);

  if (!result.ok) {
    return withOfficeSecurity(
      NextResponse.json({ error: result.error ?? "échec" }, { status: result.agent ? 409 : 404 }),
    );
  }

  return withOfficeSecurity(NextResponse.json(result));
}
