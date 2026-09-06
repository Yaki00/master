import { scoreListing } from "./score";
import { htmlToPlainText, looksLikeHtml } from "./html-text";
import type { JobHuntProfile } from "./types";
import { findListingByUrl, importJobHuntListing } from "../db/job-hunt";
import {
  addSearchDecision,
  createSearchRun,
  finalizeSearchRun,
} from "../db/job-hunt-search-history";

export type SearchListingDraft = {
  title: string;
  company: string;
  url: string;
  applyUrl?: string;
  source: string;
  description: string;
  requirements?: string;
  benefits?: string;
  location: string;
  salary: string;
  employmentType?: string;
  remoteType: string;
  postedAt?: string | null;
  tags: string[];
  meta?: Record<string, unknown>;
};

function normalizeDescription(raw: string): string {
  const text = String(raw ?? "");
  return looksLikeHtml(text) ? htmlToPlainText(text) : text.trim();
}

function isMarketplaceSpam(draft: SearchListingDraft): boolean {
  const blob = `${draft.company} ${draft.title} ${draft.description}`;
  if (/\blemon\.io\b/i.test(blob)) return true;
  if (draft.tags.length >= 25 && /not your tech stack|multiple .+ openings/i.test(draft.description)) {
    return true;
  }
  return false;
}

const DEV_KEYWORDS =
  /developer|engineer|devops|frontend|backend|full.?stack|software|programmer|react|node|typescript|python|développeur/i;

function isDevJob(text: string): boolean {
  return DEV_KEYWORDS.test(text);
}

function matchesTargetRoles(text: string, profile: JobHuntProfile): boolean {
  const lower = text.toLowerCase();
  const roles = profile.targetRoles.map((r) => r.toLowerCase()).filter(Boolean);
  if (roles.length === 0) return true;
  return roles.some((role) => {
    const tokens = role.split(/\s+/).filter((t) => t.length > 3);
    return tokens.some((t) => lower.includes(t));
  });
}

function logDecision(
  runId: string,
  draft: SearchListingDraft,
  decision: "imported" | "skipped",
  reason: string,
  score: number | null,
  listingId?: string | null,
) {
  addSearchDecision({
    runId,
    title: draft.title,
    company: draft.company,
    url: draft.url,
    source: draft.source,
    score,
    decision,
    reason,
    listingId,
  });
}

type RemoteOkJob = {
  slug?: string;
  url?: string;
  apply_url?: string;
  position?: string;
  company?: string;
  description?: string;
  location?: string;
  salary_min?: number;
  salary_max?: number;
  tags?: string[];
  date?: string;
};

type RemotiveJob = {
  url?: string;
  title?: string;
  company_name?: string;
  description?: string;
  candidate_required_location?: string;
  salary?: string;
  job_type?: string;
  publication_date?: string;
  tags?: { name?: string }[] | string[];
};

export async function fetchRemoteOkJobs(): Promise<SearchListingDraft[]> {
  const res = await fetch("https://remoteok.com/api", {
    headers: { "User-Agent": "Master-JobHunt/1.0" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`RemoteOK ${res.status}`);
  const data = (await res.json()) as RemoteOkJob[];
  const jobs = Array.isArray(data) ? data.slice(1) : [];
  const out: SearchListingDraft[] = [];

  for (const job of jobs) {
    const title = String(job.position ?? "").trim();
    if (!title) continue;
    const url =
      String(job.apply_url ?? job.url ?? "").trim() ||
      (job.slug ? `https://remoteok.com/remote-jobs/${job.slug}` : "");
    if (!url) continue;
    const salary =
      job.salary_min || job.salary_max
        ? `$${job.salary_min ?? "?"} – $${job.salary_max ?? "?"}`
        : "";
    out.push({
      title,
      company: String(job.company ?? ""),
      url,
      applyUrl: url,
      source: "remoteok",
      description: normalizeDescription(String(job.description ?? "")).slice(0, 12000),
      location: String(job.location ?? "Remote"),
      salary,
      employmentType: "full-time",
      remoteType: "remote",
      postedAt: job.date ?? null,
      tags: (job.tags ?? []).map(String),
      meta: { remoteok_slug: job.slug ?? null },
    });
  }
  return out;
}

export async function fetchRemotiveJobs(): Promise<SearchListingDraft[]> {
  const res = await fetch("https://remotive.com/api/remote-jobs", {
    headers: { "User-Agent": "Master-JobHunt/1.0" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Remotive ${res.status}`);
  const data = (await res.json()) as { jobs?: RemotiveJob[] };
  const jobs = data.jobs ?? [];
  const out: SearchListingDraft[] = [];

  for (const job of jobs) {
    const title = String(job.title ?? "").trim();
    const url = String(job.url ?? "").trim();
    if (!title || !url) continue;
    const tags = Array.isArray(job.tags)
      ? job.tags.map((t) => (typeof t === "string" ? t : String(t.name ?? ""))).filter(Boolean)
      : [];
    out.push({
      title,
      company: String(job.company_name ?? ""),
      url,
      applyUrl: url,
      source: "remotive",
      description: normalizeDescription(String(job.description ?? "")).slice(0, 12000),
      location: String(job.candidate_required_location ?? "Worldwide"),
      salary: String(job.salary ?? ""),
      employmentType: String(job.job_type ?? "full_time"),
      remoteType: "remote",
      postedAt: job.publication_date ?? null,
      tags,
      meta: { remotive_url: url },
    });
  }
  return out;
}

function evaluateDraft(
  runId: string,
  draft: SearchListingDraft,
  profile: JobHuntProfile,
  minScore: number,
): { imported: boolean; title?: string } {
  const text = [draft.title, draft.description, ...draft.tags].join(" ");

  if (isMarketplaceSpam(draft)) {
    logDecision(runId, draft, "skipped", "Écartée — marketplace / annonce fourre-tout (Lemon.io…)", null);
    return { imported: false };
  }

  if (!isDevJob(text)) {
    logDecision(runId, draft, "skipped", "Écartée — pas une offre développement", null);
    return { imported: false };
  }

  if (!matchesTargetRoles(text, profile)) {
    const roles = profile.targetRoles.join(", ") || "profil";
    logDecision(
      runId,
      draft,
      "skipped",
      `Écartée — ne correspond pas aux postes recherchés (${roles})`,
      null,
    );
    return { imported: false };
  }

  const score = scoreListing(draft, profile);
  if (score < minScore) {
    logDecision(
      runId,
      draft,
      "skipped",
      `Écartée — score ${score}/100 insuffisant (minimum ${minScore})`,
      score,
    );
    return { imported: false };
  }

  const existing = findListingByUrl(draft.url);
  if (existing) {
    logDecision(
      runId,
      draft,
      "skipped",
      `Écartée — déjà importée le ${new Date(existing.createdAt).toLocaleDateString("fr-FR")}`,
      score,
      existing.id,
    );
    return { imported: false };
  }

  const listing = importJobHuntListing(draft);
  if (listing) {
    logDecision(
      runId,
      draft,
      "imported",
      `Retenue — score ${score}/100, correspond au profil`,
      score,
      listing.id,
    );
    return { imported: true, title: listing.title };
  }

  return { imported: false };
}

export async function runAllJobSearches(
  profile: JobHuntProfile,
  minScore = 40,
): Promise<{
  runId: string;
  imported: number;
  skipped: number;
  sources: string[];
  titles: string[];
}> {
  const runId = createSearchRun(minScore);
  const sources: string[] = [];
  const titles: string[] = [];
  let imported = 0;
  let skipped = 0;

  const batches: SearchListingDraft[][] = [];
  try {
    batches.push(await fetchRemoteOkJobs());
    sources.push("remoteok");
  } catch {
    /* optional source */
  }
  try {
    batches.push(await fetchRemotiveJobs());
    sources.push("remotive");
  } catch {
    /* optional source */
  }

  if (batches.length === 0) {
    finalizeSearchRun(runId, { sources: [], imported: 0, skipped: 0 });
    throw new Error("Aucune source de jobs disponible");
  }

  for (const batch of batches) {
    for (const draft of batch) {
      const result = evaluateDraft(runId, draft, profile, minScore);
      if (result.imported) {
        imported += 1;
        if (result.title) titles.push(result.title);
      } else {
        skipped += 1;
      }
    }
  }

  finalizeSearchRun(runId, { sources, imported, skipped });

  return { runId, imported, skipped, sources, titles: titles.slice(0, 30) };
}
