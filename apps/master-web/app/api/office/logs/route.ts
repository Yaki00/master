import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { listAgentLogs } from "@/lib/db/agent-logs";
import { withOfficeSecurity } from "@/lib/office/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const agentId = url.searchParams.get("agentId");
  const limit = Number(url.searchParams.get("limit") ?? "40");
  const logs = listAgentLogs(agentId, limit);
  return withOfficeSecurity(NextResponse.json({ logs }));
}
