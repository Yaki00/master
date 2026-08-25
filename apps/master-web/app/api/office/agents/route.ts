import { NextResponse } from "next/server";
import { listAggregatedOfficeAgents, officeSources } from "@/lib/db/office";
import { requireOfficeSession, withOfficeSecurity } from "@/lib/office/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireOfficeSession();
  if (!auth.ok) return auth.response;

  return withOfficeSecurity(
    NextResponse.json({
      agents: listAggregatedOfficeAgents(),
      sources: officeSources(),
    }),
  );
}
