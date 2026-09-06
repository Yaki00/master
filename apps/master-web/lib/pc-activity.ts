/**
 * Vue d’activité du PC fixe (pc-worker) — lecture agrégée jobs + heartbeat.
 */
import { getJobHuntListing, updateJobHuntListing } from "@/lib/db/job-hunt";
import {
  cancelJob,
  getWorkerHeartbeat,
  isPcOnline,
  listJobEvents,
  listJobs,
  listWorkerHeartbeats,
  PC_OFFLINE_MS,
} from "@/lib/db/jobs";
import { parseJobHuntPrompt } from "@/lib/job-hunt/engine";
import { JOB_HUNT_MARKER } from "@/lib/job-hunt/types";
import type { JobEvent, JobStatus, PipelineJob, WorkerHeartbeat } from "@/lib/types";

const ACTIVE: JobStatus[] = ["queued", "claimed", "running", "paused"];
const PC_WORKER_ID = "pc-main";

export type PcJobSummary = {
  id: string;
  status: JobStatus;
  target: string;
  kind: "job-hunt" | "agent" | "pc" | "screen" | "other";
  title: string;
  detail: string;
  claimedBy: string | null;
  claimedAt: string | null;
  createdAt: string;
  updatedAt: string;
  progress: string | null;
  listingId: string | null;
  listingTitle: string | null;
  listingCompany: string | null;
  error: string | null;
};

export type PcActivitySnapshot = {
  collectedAt: string;
  online: boolean;
  offlineAfterMs: number;
  worker: WorkerHeartbeat | null;
  ageSec: number | null;
  activeJobs: PcJobSummary[];
  recentJobs: PcJobSummary[];
  workers: WorkerHeartbeat[];
};

function summarizePrompt(prompt: string): {
  kind: PcJobSummary["kind"];
  title: string;
  detail: string;
  listingId: string | null;
} {
  const hunt = prompt.includes(JOB_HUNT_MARKER) ? parseJobHuntPrompt(prompt) : null;
  if (hunt) {
    const listing = getJobHuntListing(hunt.listingId);
    const action = hunt.action === "tailor" ? "Adaptation CV" : "Candidature";
    const label = listing
      ? `${action} · ${listing.title} (${listing.company})`
      : `${action} · listing ${hunt.listingId.slice(0, 8)}`;
    return {
      kind: "job-hunt",
      title: label,
      detail: listing?.url ?? prompt.slice(0, 180).replace(/\s+/g, " "),
      listingId: hunt.listingId,
    };
  }

  const first = prompt.trim().split(/\n/)[0]?.slice(0, 120) || "Job PC";
  if (/\bscreen\b/i.test(prompt)) {
    return { kind: "screen", title: first, detail: prompt.slice(0, 200), listingId: null };
  }
  return {
    kind: "agent",
    title: first,
    detail: prompt.slice(0, 200).replace(/\s+/g, " "),
    listingId: null,
  };
}

function latestProgress(events: JobEvent[]): string | null {
  for (const e of events) {
    if (e.kind !== "progress") continue;
    try {
      const p = JSON.parse(e.payload) as { message?: string };
      if (p.message) return String(p.message);
    } catch {
      if (e.payload) return e.payload.slice(0, 200);
    }
  }
  return null;
}

export function toPcJobSummary(job: PipelineJob): PcJobSummary {
  const meta = summarizePrompt(job.prompt);
  const listing = meta.listingId ? getJobHuntListing(meta.listingId) : null;
  const events = listJobEvents(job.id, 20);
  return {
    id: job.id,
    status: job.status,
    target: job.target,
    kind: meta.kind,
    title: meta.title,
    detail: meta.detail,
    claimedBy: job.claimedBy,
    claimedAt: job.claimedAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    progress: latestProgress(events),
    listingId: meta.listingId,
    listingTitle: listing?.title ?? null,
    listingCompany: listing?.company ?? null,
    error: job.error,
  };
}

function isPcRelated(job: PipelineJob): boolean {
  if (job.claimedBy === PC_WORKER_ID) return true;
  if (job.waChatId === "job-hunt") return true;
  if (job.target === "pc" || job.target === "screen" || job.target === "agent" || job.target === "continue") {
    return !job.claimedBy || job.claimedBy === PC_WORKER_ID;
  }
  return job.prompt.includes(JOB_HUNT_MARKER);
}

export function getPcActivitySnapshot(): PcActivitySnapshot {
  const collectedAt = new Date().toISOString();
  const worker = getWorkerHeartbeat(PC_WORKER_ID);
  const online = isPcOnline(PC_WORKER_ID);
  const ageSec = worker
    ? Math.round((Date.now() - new Date(worker.lastSeenAt).getTime()) / 1000)
    : null;

  const activeRaw = listJobs({ status: ACTIVE, limit: 80 }).filter(isPcRelated);
  const recentRaw = listJobs({ limit: 40 }).filter(isPcRelated).slice(0, 25);

  return {
    collectedAt,
    online,
    offlineAfterMs: PC_OFFLINE_MS,
    worker,
    ageSec,
    activeJobs: activeRaw.map(toPcJobSummary),
    recentJobs: recentRaw.map(toPcJobSummary),
    workers: listWorkerHeartbeats(),
  };
}

/** Annule tous les jobs PC / job-hunt encore actifs (+ skip listings liés). */
export function stopPcActivity(reason = "stop depuis Master /pc"): {
  cancelled: string[];
  skippedListings: string[];
  count: number;
} {
  const active = listJobs({ status: ["queued", "claimed", "running", "paused"], limit: 100 }).filter(
    isPcRelated,
  );
  const cancelled: string[] = [];
  const skippedListings: string[] = [];

  for (const job of active) {
    const next = cancelJob(job.id, reason);
    if (next) cancelled.push(job.id);

    const hunt = job.prompt.includes(JOB_HUNT_MARKER) ? parseJobHuntPrompt(job.prompt) : null;
    if (hunt?.listingId) {
      const listing = getJobHuntListing(hunt.listingId);
      if (listing && !["skipped", "applied", "rejected", "offer"].includes(listing.status)) {
        updateJobHuntListing(hunt.listingId, {
          status: "skipped",
          pcJobId: null,
          agentError: reason.slice(0, 300),
        });
        skippedListings.push(hunt.listingId);
      }
    }
  }

  return { cancelled, skippedListings, count: cancelled.length };
}
