import {
  appendJobHuntEvent,
  countApplicationsToday,
  getJobHuntListing,
  getJobHuntProfile,
  hasQueuedJobHuntWork,
  listListingsForAutoApply,
  updateJobHuntListing,
  updateJobHuntProfile,
} from "@/lib/db/job-hunt";
import { createJob, getJob, isPcOnline } from "@/lib/db/jobs";
import { buildApplyPrompt, buildTailorPrompt } from "@/lib/job-hunt/prompts";
import { runAllJobSearches } from "@/lib/job-hunt/search-sources";
import { JOB_HUNT_MARKER, jobHuntPromptHeader } from "@/lib/job-hunt/types";

export type AutoRunResult = {
  ok: boolean;
  skipped?: string;
  search?: { imported: number; skipped: number; sources: string[] };
  tailorJobs: string[];
  applyJobs: string[];
};

function shouldRunSearchNow(): boolean {
  const profile = getJobHuntProfile();
  if (!profile.autoSearchEnabled) return false;
  if (!profile.lastSearchAt) return true;
  const next = new Date(profile.lastSearchAt);
  next.setHours(next.getHours() + profile.searchIntervalHours);
  return Date.now() >= next.getTime();
}

export function parseJobHuntPrompt(prompt: string): { listingId: string; action: "tailor" | "apply" } | null {
  if (!prompt.includes(JOB_HUNT_MARKER)) return null;
  const idMatch = prompt.match(/listing_id:\s*([a-f0-9-]+)/i);
  const actionMatch = prompt.match(/action:\s*(tailor|apply)/i);
  if (!idMatch?.[1] || !actionMatch?.[1]) return null;
  return { listingId: idMatch[1], action: actionMatch[1] as "tailor" | "apply" };
}

function tryParseTailorJson(text: string): { tailoredCv?: string; coverLetter?: string } | null {
  const jsonMatch = text.match(/\{[\s\S]*"tailoredCv"[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]) as { tailoredCv?: string; coverLetter?: string };
  } catch {
    return null;
  }
}

export function handleJobHuntJobComplete(input: {
  jobId: string;
  status: string;
  resultText?: string | null;
  error?: string | null;
}): void {
  const job = getJob(input.jobId);
  if (!job || job.waChatId !== "job-hunt") return;

  const parsed = parseJobHuntPrompt(job.prompt);
  if (!parsed) return;

  const listing = getJobHuntListing(parsed.listingId);
  if (!listing) return;

  const resultText = input.resultText ?? "";
  const error = input.error ?? "";

  if (parsed.action === "tailor") {
    if (input.status === "completed") {
      const json = tryParseTailorJson(resultText);
      updateJobHuntListing(parsed.listingId, {
        status: "reviewed",
        tailoredCv: json?.tailoredCv ?? (listing.tailoredCv || resultText.slice(0, 12000)),
        coverLetter: json?.coverLetter ?? listing.coverLetter,
        agentResult: resultText.slice(0, 4000),
        agentError: "",
        pcJobId: null,
      });
      appendJobHuntEvent({
        listingId: parsed.listingId,
        kind: "tailor_done",
        message: "CV et lettre adaptés par l'agent",
      });
    } else if (input.status === "failed") {
      updateJobHuntListing(parsed.listingId, {
        status: "reviewed",
        agentError: error || resultText.slice(0, 500),
        pcJobId: null,
      });
      appendJobHuntEvent({
        listingId: parsed.listingId,
        kind: "apply_failed",
        message: "Échec adaptation CV",
        payload: { error: error.slice(0, 300) },
      });
    }
    return;
  }

  if (input.status === "paused") {
    updateJobHuntListing(parsed.listingId, {
      status: "queued",
      agentResult: resultText.slice(0, 4000),
      pcJobId: input.jobId,
    });
    appendJobHuntEvent({
      listingId: parsed.listingId,
      kind: "apply_paused",
      message: "Agent en pause — validation ou CAPTCHA requis",
      payload: { resultPreview: resultText.slice(0, 200) },
    });
    return;
  }

  if (input.status === "completed") {
    updateJobHuntListing(parsed.listingId, {
      status: "applied",
      appliedAt: new Date().toISOString(),
      agentResult: resultText.slice(0, 4000),
      agentError: "",
      pcJobId: null,
    });
    appendJobHuntEvent({
      listingId: parsed.listingId,
      kind: "apply_completed",
      message: "Formulaire rempli (soumission selon consignes agent)",
    });
    return;
  }

  updateJobHuntListing(parsed.listingId, {
    status: "reviewed",
    agentError: error || resultText.slice(0, 500),
    pcJobId: null,
  });
  appendJobHuntEvent({
    listingId: parsed.listingId,
    kind: "apply_failed",
    message: error || "Échec candidature",
  });
}

function enqueueTailorJob(listingId: string): string | null {
  const profile = getJobHuntProfile();
  const listing = getJobHuntListing(listingId);
  if (!listing) return null;
  const prompt = buildTailorPrompt(profile, listing);
  const job = createJob({ target: "agent", prompt, waChatId: "job-hunt" });
  updateJobHuntListing(listingId, { status: "queued", pcJobId: job.id });
  appendJobHuntEvent({
    listingId,
    kind: "tailor_started",
    message: "Adaptation CV lancée sur le PC",
    payload: { jobId: job.id },
  });
  return job.id;
}

function enqueueApplyJob(listingId: string): string | null {
  const profile = getJobHuntProfile();
  const listing = getJobHuntListing(listingId);
  if (!listing || !profile.cvBase.trim()) return null;
  const prompt = buildApplyPrompt(profile, listing);
  const job = createJob({ target: "agent", prompt, waChatId: "job-hunt" });
  updateJobHuntListing(listingId, { status: "queued", pcJobId: job.id });
  appendJobHuntEvent({
    listingId,
    kind: "apply_started",
    message: "Remplissage formulaire lancé sur le PC",
    payload: { jobId: job.id },
  });
  return job.id;
}

export async function runJobHuntAutoPipeline(opts?: {
  forceSearch?: boolean;
  pcJustConnected?: boolean;
}): Promise<AutoRunResult> {
  const profile = getJobHuntProfile();
  const now = new Date().toISOString();

  if (!isPcOnline()) {
    return { ok: false, skipped: "PC hors ligne", tailorJobs: [], applyJobs: [] };
  }

  if (!profile.cvBase.trim() || profile.stack.length === 0) {
    return { ok: false, skipped: "Profil incomplet — importez votre CV", tailorJobs: [], applyJobs: [] };
  }

  if (hasQueuedJobHuntWork()) {
    return { ok: true, skipped: "Travail déjà en cours", tailorJobs: [], applyJobs: [] };
  }

  let searchResult: AutoRunResult["search"];
  const runSearch =
    profile.autoSearchEnabled && (opts?.forceSearch || shouldRunSearchNow() || opts?.pcJustConnected);

  if (runSearch) {
    searchResult = await runAllJobSearches(profile, 40);
    updateJobHuntProfile({ lastSearchAt: now });
    appendJobHuntEvent({
      kind: "search_run",
      message: `${searchResult.imported} offres importées (${searchResult.sources.join(", ")})`,
      payload: searchResult,
    });
  }

  const tailorJobs: string[] = [];
  const applyJobs: string[] = [];

  if (!profile.autoApplyEnabled) {
    updateJobHuntProfile({ lastAutoRunAt: now });
    return { ok: true, search: searchResult, tailorJobs, applyJobs };
  }

  const remaining = profile.maxApplicationsPerDay - countApplicationsToday();
  if (remaining <= 0) {
    updateJobHuntProfile({ lastAutoRunAt: now });
    return { ok: true, skipped: "Quota journalier atteint", search: searchResult, tailorJobs, applyJobs };
  }

  const candidates = listListingsForAutoApply(profile).slice(0, remaining);

  for (const listing of candidates) {
    if (tailorJobs.length + applyJobs.length >= remaining) break;

    if (!listing.tailoredCv.trim()) {
      const jobId = enqueueTailorJob(listing.id);
      if (jobId) tailorJobs.push(jobId);
      break;
    }

    const jobId = enqueueApplyJob(listing.id);
    if (jobId) applyJobs.push(jobId);
    break;
  }

  updateJobHuntProfile({ lastAutoRunAt: now });
  appendJobHuntEvent({
    kind: "auto_run",
    message: `Cycle auto: ${tailorJobs.length} adaptation(s), ${applyJobs.length} candidature(s)`,
    payload: { tailorJobs, applyJobs, search: searchResult },
  });

  return { ok: true, search: searchResult, tailorJobs, applyJobs };
}

export function enqueueJobHuntAction(
  listingId: string,
  action: "tailor" | "apply",
): { ok: boolean; jobId?: string; error?: string } {
  if (!isPcOnline()) return { ok: false, error: "PC hors ligne" };
  const jobId = action === "tailor" ? enqueueTailorJob(listingId) : enqueueApplyJob(listingId);
  if (!jobId) return { ok: false, error: "Listing introuvable" };
  return { ok: true, jobId };
}
