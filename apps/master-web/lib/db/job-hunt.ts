import { scoreListing } from "../job-hunt/score";
import type {
  JobHuntAutomationStatus,
  JobHuntEvent,
  JobHuntListing,
  JobHuntListingStatus,
  JobHuntProfile,
  JobHuntStats,
} from "../job-hunt/types";
import type { SearchListingDraft } from "../job-hunt/search-sources";
import { getDb } from "./sqlite";
import { isPcOnline } from "./jobs";

function parseJsonArray(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function parseMeta(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function rowToProfile(row: Record<string, unknown>): JobHuntProfile {
  return {
    id: String(row.id),
    fullName: String(row.full_name ?? ""),
    email: String(row.email ?? ""),
    phone: String(row.phone ?? ""),
    location: String(row.location ?? ""),
    timezone: String(row.timezone ?? "Europe/Paris"),
    cvBase: String(row.cv_base ?? ""),
    cvFileName: String(row.cv_file_name ?? ""),
    cvAnalyzedAt: row.cv_analyzed_at != null ? String(row.cv_analyzed_at) : null,
    stack: parseJsonArray(row.stack),
    targetRoles: parseJsonArray(row.target_roles),
    languages: parseJsonArray(row.languages),
    minSalaryEur: row.min_salary_eur != null ? Number(row.min_salary_eur) : null,
    remoteOnly: Boolean(row.remote_only ?? 1),
    preferredRegions: parseJsonArray(row.preferred_regions),
    coverLetterTemplate: String(row.cover_letter_template ?? ""),
    platforms: parseJsonArray(row.platforms),
    autoSearchEnabled: Boolean(row.auto_search_enabled ?? 1),
    autoApplyEnabled: Boolean(row.auto_apply_enabled ?? 1),
    minScoreAutoApply: Number(row.min_score_auto_apply ?? 55),
    maxApplicationsPerDay: Number(row.max_applications_per_day ?? 8),
    searchIntervalHours: Number(row.search_interval_hours ?? 4),
    lastSearchAt: row.last_search_at != null ? String(row.last_search_at) : null,
    lastAutoRunAt: row.last_auto_run_at != null ? String(row.last_auto_run_at) : null,
    updatedAt: String(row.updated_at),
  };
}

function rowToListing(row: Record<string, unknown>): JobHuntListing {
  return {
    id: String(row.id),
    title: String(row.title),
    company: String(row.company ?? ""),
    url: String(row.url),
    applyUrl: String(row.apply_url ?? row.url ?? ""),
    source: String(row.source ?? "manual"),
    description: String(row.description ?? ""),
    requirements: String(row.requirements ?? ""),
    benefits: String(row.benefits ?? ""),
    location: String(row.location ?? ""),
    salary: String(row.salary ?? ""),
    employmentType: String(row.employment_type ?? ""),
    remoteType: String(row.remote_type ?? "remote"),
    postedAt: row.posted_at != null ? String(row.posted_at) : null,
    tags: parseJsonArray(row.tags),
    score: Number(row.score ?? 0),
    status: String(row.status) as JobHuntListingStatus,
    tailoredCv: String(row.tailored_cv ?? ""),
    coverLetter: String(row.cover_letter ?? ""),
    notes: String(row.notes ?? ""),
    agentResult: String(row.agent_result ?? ""),
    agentError: String(row.agent_error ?? ""),
    pcJobId: row.pc_job_id != null ? String(row.pc_job_id) : null,
    appliedAt: row.applied_at != null ? String(row.applied_at) : null,
    meta: parseMeta(row.meta),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToEvent(row: Record<string, unknown>): JobHuntEvent {
  return {
    id: String(row.id),
    listingId: row.listing_id != null ? String(row.listing_id) : null,
    kind: String(row.kind),
    message: String(row.message ?? ""),
    payload: parseMeta(row.payload),
    createdAt: String(row.created_at),
  };
}

const STATUSES = new Set<string>([
  "new",
  "reviewed",
  "queued",
  "applied",
  "interview",
  "offer",
  "rejected",
  "skipped",
]);

export function appendJobHuntEvent(input: {
  listingId?: string | null;
  kind: string;
  message?: string;
  payload?: Record<string, unknown>;
}): JobHuntEvent {
  const database = getDb();
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO job_hunt_events (id, listing_id, kind, message, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.listingId ?? null,
      input.kind,
      input.message ?? "",
      JSON.stringify(input.payload ?? {}),
      createdAt,
    );
  return rowToEvent(
    database.prepare(`SELECT * FROM job_hunt_events WHERE id = ?`).get(id) as Record<string, unknown>,
  );
}

export function listJobHuntEvents(listingId: string, limit = 50): JobHuntEvent[] {
  return getDb()
    .prepare(`SELECT * FROM job_hunt_events WHERE listing_id = ? ORDER BY created_at DESC LIMIT ?`)
    .all(listingId, limit)
    .map((r) => rowToEvent(r as Record<string, unknown>));
}

export function getJobHuntListingByPcJobId(pcJobId: string): JobHuntListing | null {
  const row = getDb()
    .prepare(`SELECT * FROM job_hunt_listings WHERE pc_job_id = ? LIMIT 1`)
    .get(pcJobId) as Record<string, unknown> | undefined;
  return row ? rowToListing(row) : null;
}

export function getJobHuntProfile(): JobHuntProfile {
  const database = getDb();
  const row = database.prepare(`SELECT * FROM job_hunt_profile WHERE id = 'default'`).get() as
    | Record<string, unknown>
    | undefined;
  if (row) return rowToProfile(row);

  const now = new Date().toISOString();
  database.prepare(`INSERT INTO job_hunt_profile (id, updated_at) VALUES ('default', ?)`).run(now);
  return rowToProfile(
    database.prepare(`SELECT * FROM job_hunt_profile WHERE id = 'default'`).get() as Record<string, unknown>,
  );
}

export function updateJobHuntProfile(
  patch: Partial<Omit<JobHuntProfile, "id" | "updatedAt">>,
): JobHuntProfile {
  getJobHuntProfile();
  const current = getJobHuntProfile();
  const next = {
    fullName: patch.fullName ?? current.fullName,
    email: patch.email ?? current.email,
    phone: patch.phone ?? current.phone,
    location: patch.location ?? current.location,
    timezone: patch.timezone ?? current.timezone,
    cvBase: patch.cvBase ?? current.cvBase,
    cvFileName: patch.cvFileName ?? current.cvFileName,
    cvAnalyzedAt: patch.cvAnalyzedAt !== undefined ? patch.cvAnalyzedAt : current.cvAnalyzedAt,
    stack: patch.stack ?? current.stack,
    targetRoles: patch.targetRoles ?? current.targetRoles,
    languages: patch.languages ?? current.languages,
    minSalaryEur: patch.minSalaryEur !== undefined ? patch.minSalaryEur : current.minSalaryEur,
    remoteOnly: patch.remoteOnly ?? current.remoteOnly,
    preferredRegions: patch.preferredRegions ?? current.preferredRegions,
    coverLetterTemplate: patch.coverLetterTemplate ?? current.coverLetterTemplate,
    platforms: patch.platforms ?? current.platforms,
    autoSearchEnabled: patch.autoSearchEnabled ?? current.autoSearchEnabled,
    autoApplyEnabled: patch.autoApplyEnabled ?? current.autoApplyEnabled,
    minScoreAutoApply: patch.minScoreAutoApply ?? current.minScoreAutoApply,
    maxApplicationsPerDay: patch.maxApplicationsPerDay ?? current.maxApplicationsPerDay,
    searchIntervalHours: patch.searchIntervalHours ?? current.searchIntervalHours,
    lastSearchAt: patch.lastSearchAt !== undefined ? patch.lastSearchAt : current.lastSearchAt,
    lastAutoRunAt: patch.lastAutoRunAt !== undefined ? patch.lastAutoRunAt : current.lastAutoRunAt,
  };
  const updatedAt = new Date().toISOString();

  getDb()
    .prepare(
      `UPDATE job_hunt_profile SET
        full_name = ?, email = ?, phone = ?, location = ?, timezone = ?,
        cv_base = ?, cv_file_name = ?, cv_analyzed_at = ?, stack = ?, target_roles = ?,
        languages = ?, min_salary_eur = ?, remote_only = ?, preferred_regions = ?,
        cover_letter_template = ?, platforms = ?,
        auto_search_enabled = ?, auto_apply_enabled = ?, min_score_auto_apply = ?,
        max_applications_per_day = ?, search_interval_hours = ?,
        last_search_at = ?, last_auto_run_at = ?, updated_at = ?
       WHERE id = 'default'`,
    )
    .run(
      next.fullName,
      next.email,
      next.phone,
      next.location,
      next.timezone,
      next.cvBase,
      next.cvFileName,
      next.cvAnalyzedAt,
      JSON.stringify(next.stack),
      JSON.stringify(next.targetRoles),
      JSON.stringify(next.languages),
      next.minSalaryEur,
      next.remoteOnly ? 1 : 0,
      JSON.stringify(next.preferredRegions),
      next.coverLetterTemplate,
      JSON.stringify(next.platforms),
      next.autoSearchEnabled ? 1 : 0,
      next.autoApplyEnabled ? 1 : 0,
      next.minScoreAutoApply,
      next.maxApplicationsPerDay,
      next.searchIntervalHours,
      next.lastSearchAt,
      next.lastAutoRunAt,
      updatedAt,
    );

  return getJobHuntProfile();
}

export function listJobHuntListings(opts?: {
  status?: JobHuntListingStatus | JobHuntListingStatus[];
  limit?: number;
  minScore?: number;
}): JobHuntListing[] {
  const database = getDb();
  const limit = opts?.limit ?? 100;
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (opts?.status) {
    const statuses = Array.isArray(opts.status) ? opts.status : [opts.status];
    clauses.push(`status IN (${statuses.map(() => "?").join(",")})`);
    params.push(...statuses);
  }
  if (opts?.minScore != null) {
    clauses.push(`score >= ?`);
    params.push(opts.minScore);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  params.push(limit);

  return database
    .prepare(`SELECT * FROM job_hunt_listings ${where} ORDER BY score DESC, updated_at DESC LIMIT ?`)
    .all(...params)
    .map((r) => rowToListing(r as Record<string, unknown>));
}

export function getJobHuntListing(id: string): JobHuntListing | null {
  const row = getDb().prepare(`SELECT * FROM job_hunt_listings WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToListing(row) : null;
}

type ListingInput = SearchListingDraft & { rescore?: boolean };

export function createJobHuntListing(input: ListingInput): JobHuntListing {
  const profile = getJobHuntProfile();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const listingData = {
    title: input.title.trim(),
    company: (input.company ?? "").trim(),
    url: input.url.trim(),
    applyUrl: (input.applyUrl ?? input.url).trim(),
    source: input.source ?? "manual",
    description: input.description ?? "",
    requirements: input.requirements ?? "",
    benefits: input.benefits ?? "",
    location: input.location ?? "",
    salary: input.salary ?? "",
    employmentType: input.employmentType ?? "",
    remoteType: input.remoteType ?? "remote",
    postedAt: input.postedAt ?? null,
    tags: input.tags ?? [],
    meta: input.meta ?? {},
  };
  const score = scoreListing(listingData, profile);

  getDb()
    .prepare(
      `INSERT INTO job_hunt_listings (
        id, title, company, url, apply_url, source, description, requirements, benefits,
        location, salary, employment_type, remote_type, posted_at, tags, score, status,
        tailored_cv, cover_letter, notes, agent_result, agent_error, meta,
        pc_job_id, applied_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', '', '', '', '', '', ?, NULL, NULL, ?, ?)`,
    )
    .run(
      id,
      listingData.title,
      listingData.company,
      listingData.url,
      listingData.applyUrl,
      listingData.source,
      listingData.description,
      listingData.requirements,
      listingData.benefits,
      listingData.location,
      listingData.salary,
      listingData.employmentType,
      listingData.remoteType,
      listingData.postedAt,
      JSON.stringify(listingData.tags),
      score,
      JSON.stringify(listingData.meta),
      now,
      now,
    );

  appendJobHuntEvent({
    listingId: id,
    kind: "imported",
    message: `Importée depuis ${listingData.source} (score ${score})`,
    payload: { score, source: listingData.source },
  });

  return getJobHuntListing(id)!;
}

export function updateJobHuntListing(
  id: string,
  patch: Partial<
    Pick<
      JobHuntListing,
      | "title"
      | "company"
      | "url"
      | "applyUrl"
      | "description"
      | "requirements"
      | "benefits"
      | "location"
      | "salary"
      | "employmentType"
      | "remoteType"
      | "postedAt"
      | "tags"
      | "status"
      | "tailoredCv"
      | "coverLetter"
      | "notes"
      | "agentResult"
      | "agentError"
      | "pcJobId"
      | "appliedAt"
      | "score"
      | "meta"
    >
  > & { rescore?: boolean },
): JobHuntListing | null {
  const current = getJobHuntListing(id);
  if (!current) return null;

  const next = { ...current, ...patch };
  if (patch.rescore) next.score = scoreListing(next, getJobHuntProfile());
  if (patch.status && !STATUSES.has(patch.status)) return null;

  const updatedAt = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE job_hunt_listings SET
        title = ?, company = ?, url = ?, apply_url = ?, description = ?, requirements = ?,
        benefits = ?, location = ?, salary = ?, employment_type = ?, remote_type = ?,
        posted_at = ?, tags = ?, score = ?, status = ?, tailored_cv = ?, cover_letter = ?,
        notes = ?, agent_result = ?, agent_error = ?, meta = ?, pc_job_id = ?,
        applied_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      next.title,
      next.company,
      next.url,
      next.applyUrl,
      next.description,
      next.requirements,
      next.benefits,
      next.location,
      next.salary,
      next.employmentType,
      next.remoteType,
      next.postedAt,
      JSON.stringify(next.tags),
      next.score,
      next.status,
      next.tailoredCv,
      next.coverLetter,
      next.notes,
      next.agentResult,
      next.agentError,
      JSON.stringify(next.meta),
      next.pcJobId,
      next.appliedAt,
      updatedAt,
      id,
    );

  return getJobHuntListing(id);
}

export function deleteJobHuntListing(id: string): boolean {
  return getDb().prepare(`DELETE FROM job_hunt_listings WHERE id = ?`).run(id).changes > 0;
}

function todayStartIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function countApplicationsToday(): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) as c FROM job_hunt_listings
       WHERE applied_at >= ? OR (status = 'queued' AND updated_at >= ?)`,
    )
    .get(todayStartIso(), todayStartIso()) as { c: number };
  return row.c;
}

export function getJobHuntStats(): JobHuntStats {
  const database = getDb();
  const rows = database
    .prepare(`SELECT status, COUNT(*) as c FROM job_hunt_listings GROUP BY status`)
    .all() as { status: string; c: number }[];

  const stats: JobHuntStats = {
    total: 0,
    new: 0,
    queued: 0,
    applied: 0,
    interview: 0,
    offer: 0,
    rejected: 0,
    appliedToday: countApplicationsToday(),
  };

  for (const row of rows) {
    stats.total += row.c;
    if (row.status === "new") stats.new = row.c;
    if (row.status === "queued") stats.queued = row.c;
    if (row.status === "applied") stats.applied = row.c;
    if (row.status === "interview") stats.interview = row.c;
    if (row.status === "offer") stats.offer = row.c;
    if (row.status === "rejected") stats.rejected = row.c;
  }

  return stats;
}

export function getJobHuntAutomationStatus(): JobHuntAutomationStatus {
  const profile = getJobHuntProfile();
  const appliedToday = countApplicationsToday();
  const remaining = Math.max(0, profile.maxApplicationsPerDay - appliedToday);

  let nextSearchEligibleAt: string | null = null;
  if (profile.lastSearchAt) {
    const next = new Date(profile.lastSearchAt);
    next.setHours(next.getHours() + profile.searchIntervalHours);
    nextSearchEligibleAt = next.toISOString();
  }

  return {
    pcOnline: isPcOnline(),
    profileReady: profile.cvBase.trim().length > 80 && profile.stack.length > 0,
    autoSearchEnabled: profile.autoSearchEnabled,
    autoApplyEnabled: profile.autoApplyEnabled,
    lastSearchAt: profile.lastSearchAt,
    lastAutoRunAt: profile.lastAutoRunAt,
    applicationsRemainingToday: remaining,
    nextSearchEligibleAt,
  };
}

export function rescoreAllListings(): number {
  const profile = getJobHuntProfile();
  let count = 0;
  for (const listing of listJobHuntListings({ limit: 500 })) {
    const score = scoreListing(listing, profile);
    if (score !== listing.score) {
      updateJobHuntListing(listing.id, { score });
      count += 1;
    }
  }
  return count;
}

export function importJobHuntListing(input: ListingInput): JobHuntListing | null {
  const url = input.url.trim();
  const existing = getDb()
    .prepare(`SELECT id FROM job_hunt_listings WHERE url = ? LIMIT 1`)
    .get(url) as { id: string } | undefined;
  if (existing) return getJobHuntListing(existing.id);
  return createJobHuntListing(input);
}

export function findListingByUrl(url: string): JobHuntListing | null {
  const row = getDb()
    .prepare(`SELECT id FROM job_hunt_listings WHERE url = ? LIMIT 1`)
    .get(url.trim()) as { id: string } | undefined;
  return row ? getJobHuntListing(row.id) : null;
}

export function listListingsForAutoApply(profile: JobHuntProfile): JobHuntListing[] {
  return listJobHuntListings({ minScore: profile.minScoreAutoApply, limit: 50 }).filter((l) =>
    ["new", "reviewed"].includes(l.status),
  );
}

export function hasQueuedJobHuntWork(): boolean {
  const row = getDb()
    .prepare(`SELECT COUNT(*) as c FROM job_hunt_listings WHERE status = 'queued'`)
    .get() as { c: number };
  return row.c > 0;
}
