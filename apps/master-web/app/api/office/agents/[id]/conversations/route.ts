import { NextResponse } from "next/server";
import {
  getOfficeConversationDetail,
  listOfficeConversations,
} from "@/lib/db/office-conversations";
import { getAggregatedOfficeAgent } from "@/lib/db/office";
import { requireOfficeSession, withOfficeSecurity } from "@/lib/office/http";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** Liste les discussions archivées (+ active) d’un agent. */
export async function GET(req: Request, context: RouteContext) {
  const auth = await requireOfficeSession();
  if (!auth.ok) return auth.response;

  const { id: raw } = await context.params;
  const id = decodeURIComponent(raw);
  if (!getAggregatedOfficeAgent(id)) {
    return withOfficeSecurity(NextResponse.json({ error: "not found" }, { status: 404 }));
  }

  const url = new URL(req.url);
  const statusRaw = url.searchParams.get("status");
  const status =
    statusRaw === "archived" || statusRaw === "active" || statusRaw === "all"
      ? statusRaw
      : "archived";
  const limit = Number(url.searchParams.get("limit") ?? 40);
  const conversations = listOfficeConversations(id, { status, limit });

  return withOfficeSecurity(NextResponse.json({ conversations }));
}
