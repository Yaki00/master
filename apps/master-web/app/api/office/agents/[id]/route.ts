import { NextResponse } from "next/server";
import {
  getAggregatedOfficeAgent,
  listAgentEvents,
  listOfficeCommandsForAgent,
} from "@/lib/db/office";
import { requireOfficeSession, withOfficeSecurity } from "@/lib/office/http";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, context: RouteContext) {
  const auth = await requireOfficeSession();
  if (!auth.ok) return auth.response;

  const { id: raw } = await context.params;
  const id = decodeURIComponent(raw);
  const agent = getAggregatedOfficeAgent(id);
  if (!agent) {
    return withOfficeSecurity(NextResponse.json({ error: "not found" }, { status: 404 }));
  }

  const events = listAgentEvents(id, 80);
  const commands = listOfficeCommandsForAgent(id, 10);
  const pending = commands.filter((c) => c.status === "queued" || c.status === "claimed");

  return withOfficeSecurity(
    NextResponse.json({
      agent,
      events,
      pendingCommands: pending,
    }),
  );
}
