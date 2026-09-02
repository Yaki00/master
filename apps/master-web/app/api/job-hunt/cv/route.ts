import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getJobHuntProfile, rescoreAllListings, updateJobHuntProfile } from "@/lib/db/job-hunt";
import { analyzeCvText } from "@/lib/job-hunt/cv-analyze";
import { cvTextToMarkdown, extractCvText } from "@/lib/job-hunt/cv-parse";
import { SECURITY_HEADERS } from "@/lib/security";

export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;

function withSecurity(res: NextResponse) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    res.headers.set(k, v);
  }
  return res;
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return withSecurity(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const form = await req.formData().catch(() => null);
  if (!form) {
    return withSecurity(NextResponse.json({ error: "multipart/form-data requis" }, { status: 400 }));
  }

  const file = form.get("file");
  const applyToProfile = form.get("apply") !== "false";

  if (!(file instanceof File)) {
    return withSecurity(NextResponse.json({ error: "fichier CV requis" }, { status: 400 }));
  }

  if (file.size > MAX_BYTES) {
    return withSecurity(NextResponse.json({ error: "Fichier trop volumineux (max 5 Mo)" }, { status: 400 }));
  }

  const fileName = file.name || "cv.txt";
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (!["pdf", "txt", "md", "text", "markdown"].includes(ext)) {
    return withSecurity(
      NextResponse.json({ error: "Formats acceptés: .pdf, .txt, .md" }, { status: 400 }),
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let rawText: string;
  try {
    rawText = extractCvText(buffer, fileName);
  } catch (err) {
    return withSecurity(
      NextResponse.json(
        { error: err instanceof Error ? err.message : "Extraction impossible" },
        { status: 422 },
      ),
    );
  }

  const analysis = analyzeCvText(rawText, fileName);
  const cvMarkdown = cvTextToMarkdown(analysis.cvMarkdown, fileName);
  const now = new Date().toISOString();

  let profile = getJobHuntProfile();
  if (applyToProfile) {
    profile = updateJobHuntProfile({
      cvBase: cvMarkdown,
      cvFileName: fileName,
      cvAnalyzedAt: now,
      fullName: analysis.fullName || profile.fullName,
      email: analysis.email || profile.email,
      phone: analysis.phone || profile.phone,
      location: analysis.location || profile.location,
      stack: analysis.stack,
      targetRoles: analysis.targetRoles,
      languages: analysis.languages,
    });
    rescoreAllListings();
  }

  return withSecurity(
    NextResponse.json({
      ok: true,
      analysis: { ...analysis, cvMarkdown },
      profile: applyToProfile ? profile : undefined,
    }),
  );
}
