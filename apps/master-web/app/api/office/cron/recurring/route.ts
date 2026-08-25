import { NextResponse } from "next/server";
import { assertWorkerAuth } from "@/lib/pipeline/auth";
import { tickDueRecurringProjects } from "@/lib/office/recurring-tick";
import { withOfficeSecurity } from "@/lib/office/http";

export const dynamic = "force-dynamic";

/** Tick sentinelles récurrentes + timeouts réunion (appelé par le bridge). */
export async function POST(req: Request) {
  if (!assertWorkerAuth(req)) {
    return withOfficeSecurity(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  }

  const result = tickDueRecurringProjects();
  return withOfficeSecurity(NextResponse.json({ ok: true, ...result }));
}
