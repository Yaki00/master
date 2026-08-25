import { NextResponse } from "next/server";
import { assertWorkerAuth } from "@/lib/pipeline/auth";
import { claimOfficeCommands } from "@/lib/db/office";
import { withOfficeSecurity } from "@/lib/office/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!assertWorkerAuth(req)) {
    return withOfficeSecurity(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  }

  const { searchParams } = new URL(req.url);
  const limit = Number(searchParams.get("limit") ?? "5");
  const claimedBy = searchParams.get("workerId")?.trim() || "openclaw-mac";
  const commands = claimOfficeCommands(claimedBy, Number.isFinite(limit) ? limit : 5);

  return withOfficeSecurity(NextResponse.json({ commands }));
}
