import type { JobEvent, JobStatus, JobTarget, PipelineJob, WorkerHeartbeat } from "../types";
import { getDb } from "./sqlite";

function rowToJob(row: Record<string, unknown>): PipelineJob {
  return {
    id: String(row.id),
    target: row.target as JobTarget,
    status: row.status as JobStatus,
    prompt: String(row.prompt),
    waChatId: String(row.wa_chat_id),
    cursorAgentId: row.cursor_agent_id ? String(row.cursor_agent_id) : null,
    cursorRunId: row.cursor_run_id ? String(row.cursor_run_id) : null,
    parentJobId: row.parent_job_id ? String(row.parent_job_id) : null,
    resultText: row.result_text ? String(row.result_text) : null,
    error: row.error ? String(row.error) : null,
    mediaUrl: row.media_url ? String(row.media_url) : null,
    claimedBy: row.claimed_by ? String(row.claimed_by) : null,
    claimedAt: row.claimed_at ? String(row.claimed_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function createJob(input: {
  target: JobTarget;
  prompt: string;
  waChatId: string;
  parentJobId?: string | null;
  cursorAgentId?: string | null;
}): PipelineJob {
  const database = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO jobs (
        id, target, status, prompt, wa_chat_id, cursor_agent_id, cursor_run_id,
        parent_job_id, result_text, error, media_url, claimed_by, claimed_at, created_at, updated_at
      ) VALUES (?, ?, 'queued', ?, ?, ?, NULL, ?, NULL, NULL, NULL, NULL, NULL, ?, ?)`,
    )
    .run(
      id,
      input.target,
      input.prompt,
      input.waChatId,
      input.cursorAgentId ?? null,
      input.parentJobId ?? null,
      now,
      now,
    );
  appendJobEvent(id, "created", { target: input.target });
  return getJob(id)!;
}

export function getJob(id: string): PipelineJob | null {
  const database = getDb();
  const row = database.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  return row ? rowToJob(row) : null;
}

export function listJobs(opts?: {
  status?: JobStatus | JobStatus[];
  target?: JobTarget | JobTarget[];
  limit?: number;
}): PipelineJob[] {
  const database = getDb();
  const limit = opts?.limit ?? 50;
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (opts?.status) {
    const statuses = Array.isArray(opts.status) ? opts.status : [opts.status];
    clauses.push(`status IN (${statuses.map(() => "?").join(",")})`);
    params.push(...statuses);
  }
  if (opts?.target) {
    const targets = Array.isArray(opts.target) ? opts.target : [opts.target];
    clauses.push(`target IN (${targets.map(() => "?").join(",")})`);
    params.push(...targets);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  params.push(limit);
  return database
    .prepare(`SELECT * FROM jobs ${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...params)
    .map((r) => rowToJob(r as Record<string, unknown>));
}

export function updateJob(
  id: string,
  patch: Partial<{
    status: JobStatus;
    resultText: string | null;
    error: string | null;
    mediaUrl: string | null;
    cursorAgentId: string | null;
    cursorRunId: string | null;
    claimedBy: string | null;
    claimedAt: string | null;
  }>,
): PipelineJob | null {
  const database = getDb();
  const current = getJob(id);
  if (!current) return null;

  const next = {
    status: patch.status ?? current.status,
    resultText: patch.resultText !== undefined ? patch.resultText : current.resultText,
    error: patch.error !== undefined ? patch.error : current.error,
    mediaUrl: patch.mediaUrl !== undefined ? patch.mediaUrl : current.mediaUrl,
    cursorAgentId: patch.cursorAgentId !== undefined ? patch.cursorAgentId : current.cursorAgentId,
    cursorRunId: patch.cursorRunId !== undefined ? patch.cursorRunId : current.cursorRunId,
    claimedBy: patch.claimedBy !== undefined ? patch.claimedBy : current.claimedBy,
    claimedAt: patch.claimedAt !== undefined ? patch.claimedAt : current.claimedAt,
  };
  const updatedAt = new Date().toISOString();

  database
    .prepare(
      `UPDATE jobs SET
        status = ?, result_text = ?, error = ?, media_url = ?,
        cursor_agent_id = ?, cursor_run_id = ?, claimed_by = ?, claimed_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      next.status,
      next.resultText,
      next.error,
      next.mediaUrl,
      next.cursorAgentId,
      next.cursorRunId,
      next.claimedBy,
      next.claimedAt,
      updatedAt,
      id,
    );

  return getJob(id);
}

/** Atomically claim the oldest queued job matching targets. */
export function claimJob(workerId: string, targets: JobTarget[]): PipelineJob | null {
  const database = getDb();
  const now = new Date().toISOString();

  const claim = database.transaction(() => {
    const placeholders = targets.map(() => "?").join(",");
    const row = database
      .prepare(
        `SELECT * FROM jobs
         WHERE status = 'queued' AND target IN (${placeholders})
         ORDER BY created_at ASC LIMIT 1`,
      )
      .get(...targets) as Record<string, unknown> | undefined;
    if (!row) return null;

    database
      .prepare(
        `UPDATE jobs SET status = 'claimed', claimed_by = ?, claimed_at = ?, updated_at = ?
         WHERE id = ? AND status = 'queued'`,
      )
      .run(workerId, now, now, String(row.id));

    const updated = database.prepare(`SELECT * FROM jobs WHERE id = ?`).get(String(row.id)) as
      | Record<string, unknown>
      | undefined;
    if (!updated || String(updated.claimed_by) !== workerId) return null;
    return rowToJob(updated);
  });

  const job = claim();
  if (job) appendJobEvent(job.id, "claimed", { workerId });
  return job;
}

export function appendJobEvent(jobId: string, kind: string, payload: unknown = {}): JobEvent {
  const database = getDb();
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const payloadStr = JSON.stringify(payload);
  database
    .prepare(`INSERT INTO job_events (id, job_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(id, jobId, kind, payloadStr, createdAt);
  return { id, jobId, kind, payload: payloadStr, createdAt };
}

export function listJobEvents(jobId: string, limit = 50): JobEvent[] {
  const database = getDb();
  return database
    .prepare(`SELECT * FROM job_events WHERE job_id = ? ORDER BY created_at DESC LIMIT ?`)
    .all(jobId, limit)
    .map((r) => {
      const row = r as Record<string, unknown>;
      return {
        id: String(row.id),
        jobId: String(row.job_id),
        kind: String(row.kind),
        payload: String(row.payload),
        createdAt: String(row.created_at),
      };
    });
}



export function upsertWorkerHeartbeat(input: {
  workerId: string;
  hostname?: string | null;
  meta?: unknown;
}): WorkerHeartbeat {
  const database = getDb();
  const now = new Date().toISOString();
  const meta = input.meta != null ? JSON.stringify(input.meta) : null;
  database
    .prepare(
      `INSERT INTO worker_heartbeats (worker_id, hostname, last_seen_at, meta)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(worker_id) DO UPDATE SET
         hostname = excluded.hostname,
         last_seen_at = excluded.last_seen_at,
         meta = excluded.meta`,
    )
    .run(input.workerId, input.hostname ?? null, now, meta);

  return {
    workerId: input.workerId,
    hostname: input.hostname ?? null,
    lastSeenAt: now,
    meta,
  };
}

export function getWorkerHeartbeat(workerId: string): WorkerHeartbeat | null {
  const database = getDb();
  const row = database.prepare(`SELECT * FROM worker_heartbeats WHERE worker_id = ?`).get(workerId) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  return {
    workerId: String(row.worker_id),
    hostname: row.hostname ? String(row.hostname) : null,
    lastSeenAt: String(row.last_seen_at),
    meta: row.meta ? String(row.meta) : null,
  };
}

export function listWorkerHeartbeats(): WorkerHeartbeat[] {
  const database = getDb();
  return database
    .prepare(`SELECT * FROM worker_heartbeats ORDER BY last_seen_at DESC`)
    .all()
    .map((r) => {
      const row = r as Record<string, unknown>;
      return {
        workerId: String(row.worker_id),
        hostname: row.hostname ? String(row.hostname) : null,
        lastSeenAt: String(row.last_seen_at),
        meta: row.meta ? String(row.meta) : null,
      };
    });
}



/** Resume a paused job with the user's answer appended to the prompt. */
export function resumePausedJob(jobId: string, userReply: string): PipelineJob | null {
  const database = getDb();
  const current = getJob(jobId);
  if (!current || current.status !== "paused") return null;

  const question = current.resultText?.trim() || "(question)";
  const nextPrompt = `${current.prompt}\n\n[Agent a demandé]\n${question}\n\n[Réponse utilisateur]\n${userReply.trim()}`;
  const now = new Date().toISOString();

  database
    .prepare(
      `UPDATE jobs SET
        status = 'queued', prompt = ?, result_text = NULL, error = NULL,
        claimed_by = NULL, claimed_at = NULL, updated_at = ?
       WHERE id = ? AND status = 'paused'`,
    )
    .run(nextPrompt, now, jobId);

  appendJobEvent(jobId, "resumed", { userReply: userReply.slice(0, 500) });
  return getJob(jobId);
}

export function cancelJob(jobId: string, reason = "cancelled from office"): PipelineJob | null {
  const current = getJob(jobId);
  if (!current) return null;
  if (current.status === "completed" || current.status === "cancelled") return current;
  const job = updateJob(jobId, { status: "cancelled", error: reason });
  appendJobEvent(jobId, "cancelled", { reason });
  return job;
}

export function pauseJob(jobId: string, note = "paused from office"): PipelineJob | null {
  const current = getJob(jobId);
  if (!current) return null;
  if (!["queued", "claimed", "running"].includes(current.status)) return current;
  const job = updateJob(jobId, { status: "paused", resultText: note });
  appendJobEvent(jobId, "paused", { note });
  return job;
}

export const PC_OFFLINE_MS = 90_000;

export function isPcOnline(workerId = "pc-main"): boolean {
  const hb = getWorkerHeartbeat(workerId);
  if (!hb) return false;
  return Date.now() - new Date(hb.lastSeenAt).getTime() < PC_OFFLINE_MS;
}
