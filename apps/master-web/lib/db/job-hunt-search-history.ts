import type {
  JobHuntSearchDecision,
  JobHuntSearchDecisionKind,
  JobHuntSearchRun,
} from "../job-hunt/types";
import { SEARCH_HISTORY_MAX } from "../job-hunt/types";
import { getDb } from "./sqlite";

function parseJsonArray(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function rowToDecision(row: Record<string, unknown>): JobHuntSearchDecision {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    title: String(row.title),
    company: String(row.company ?? ""),
    url: String(row.url ?? ""),
    source: String(row.source ?? ""),
    score: row.score != null ? Number(row.score) : null,
    decision: String(row.decision) as JobHuntSearchDecisionKind,
    reason: String(row.reason ?? ""),
    listingId: row.listing_id != null ? String(row.listing_id) : null,
    createdAt: String(row.created_at),
  };
}

function rowToRun(row: Record<string, unknown>, decisions: JobHuntSearchDecision[]): JobHuntSearchRun {
  return {
    id: String(row.id),
    sources: parseJsonArray(row.sources),
    minScore: Number(row.min_score ?? 40),
    importedCount: Number(row.imported_count ?? 0),
    skippedCount: Number(row.skipped_count ?? 0),
    createdAt: String(row.created_at),
    decisions,
  };
}

export function createSearchRun(minScore: number): string {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO job_hunt_search_runs (id, sources, min_score, imported_count, skipped_count, created_at)
       VALUES (?, '[]', ?, 0, 0, ?)`,
    )
    .run(id, minScore, now);
  return id;
}

export function addSearchDecision(input: {
  runId: string;
  title: string;
  company?: string;
  url?: string;
  source?: string;
  score?: number | null;
  decision: JobHuntSearchDecisionKind;
  reason: string;
  listingId?: string | null;
}): void {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO job_hunt_search_decisions (
        id, run_id, title, company, url, source, score, decision, reason, listing_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.runId,
      input.title,
      input.company ?? "",
      input.url ?? "",
      input.source ?? "",
      input.score ?? null,
      input.decision,
      input.reason,
      input.listingId ?? null,
      now,
    );
}

export function finalizeSearchRun(
  runId: string,
  input: { sources: string[]; imported: number; skipped: number },
): void {
  getDb()
    .prepare(
      `UPDATE job_hunt_search_runs SET
        sources = ?, imported_count = ?, skipped_count = ?
       WHERE id = ?`,
    )
    .run(JSON.stringify(input.sources), input.imported, input.skipped, runId);

  pruneSearchHistory();
}

/** Garde uniquement les SEARCH_HISTORY_MAX dernières recherches. */
export function pruneSearchHistory(): void {
  const database = getDb();
  const oldRuns = database
    .prepare(
      `SELECT id FROM job_hunt_search_runs
       ORDER BY created_at DESC
       LIMIT -1 OFFSET ?`,
    )
    .all(SEARCH_HISTORY_MAX) as { id: string }[];

  for (const row of oldRuns) {
    database.prepare(`DELETE FROM job_hunt_search_decisions WHERE run_id = ?`).run(row.id);
    database.prepare(`DELETE FROM job_hunt_search_runs WHERE id = ?`).run(row.id);
  }
}

export function listSearchHistory(limit = SEARCH_HISTORY_MAX): JobHuntSearchRun[] {
  const database = getDb();
  const runs = database
    .prepare(`SELECT * FROM job_hunt_search_runs ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as Record<string, unknown>[];

  return runs.map((run) => {
    const decisions = database
      .prepare(
        `SELECT * FROM job_hunt_search_decisions WHERE run_id = ? ORDER BY created_at ASC`,
      )
      .all(String(run.id))
      .map((r) => rowToDecision(r as Record<string, unknown>));
    return rowToRun(run, decisions);
  });
}
