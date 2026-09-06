import { NextResponse } from "next/server";
import { getOfficeConversationDetail } from "@/lib/db/office-conversations";
import { requireOfficeSession, withOfficeSecurity } from "@/lib/office/http";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; conversationId: string }> };

/** Détail d’une discussion archivée (events snapshot). */
export async function GET(_req: Request, context: RouteContext) {
  const auth = await requireOfficeSession();
  if (!auth.ok) return auth.response;

  const { id: rawAgent, conversationId: rawCid } = await context.params;
  const agentId = decodeURIComponent(rawAgent);
  const conversationId = decodeURIComponent(rawCid);
  const detail = getOfficeConversationDetail(conversationId);
  if (!detail || detail.agentId !== agentId) {
    return withOfficeSecurity(NextResponse.json({ error: "not found" }, { status: 404 }));
  }

  return withOfficeSecurity(NextResponse.json({ conversation: detail }));
}
