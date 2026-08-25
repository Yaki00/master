import { getDb } from "./sqlite";

export type AiProjectKind = "punctual" | "recurring";
export type AiProjectStatus = "draft" | "active" | "paused" | "done";

export type AiProject = {
  id: string;
  title: string;
  kind: AiProjectKind;
  schedule: string | null;
  status: AiProjectStatus;
  notes: string;
  agentId: string | null;
  brief: string;
  goals: string;
  priority: number;
  nextRunAt: string | null;
  teamId: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

function parseMeta(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function rowToProject(row: Record<string, unknown>): AiProject {
  return {
    id: String(row.id),
    title: String(row.title),
    kind: (String(row.kind) === "recurring" ? "recurring" : "punctual") as AiProjectKind,
    schedule: row.schedule != null ? String(row.schedule) : null,
    status: String(row.status) as AiProjectStatus,
    notes: String(row.notes ?? ""),
    agentId: row.agent_id != null ? String(row.agent_id) : null,
    brief: String(row.brief ?? ""),
    goals: String(row.goals ?? ""),
    priority: Number(row.priority ?? 0),
    nextRunAt: row.next_run_at != null ? String(row.next_run_at) : null,
    teamId: row.team_id != null ? String(row.team_id) : null,
    meta: parseMeta(row.meta),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

const STATUSES = new Set(["draft", "active", "paused", "done"]);

export function listAiProjects(status?: AiProjectStatus | "all"): AiProject[] {
  const database = getDb();
  if (status && status !== "all" && STATUSES.has(status)) {
    return database
      .prepare(`SELECT * FROM ai_projects WHERE status = ? ORDER BY updated_at DESC`)
      .all(status)
      .map((r) => rowToProject(r as Record<string, unknown>));
  }
  return database
    .prepare(`SELECT * FROM ai_projects ORDER BY updated_at DESC`)
    .all()
    .map((r) => rowToProject(r as Record<string, unknown>));
}

export function getAiProject(id: string): AiProject | null {
  const row = getDb().prepare(`SELECT * FROM ai_projects WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToProject(row) : null;
}

export function createAiProject(input: {
  title: string;
  kind?: AiProjectKind;
  schedule?: string | null;
  status?: AiProjectStatus;
  notes?: string;
  agentId?: string | null;
  brief?: string;
  goals?: string;
  priority?: number;
  nextRunAt?: string | null;
  teamId?: string | null;
  meta?: Record<string, unknown>;
}): AiProject {
  const database = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const title = input.title.trim().slice(0, 160) || "Sans titre";
  const kind = input.kind === "recurring" ? "recurring" : "punctual";
  const status = input.status && STATUSES.has(input.status) ? input.status : "active";
  database
    .prepare(
      `INSERT INTO ai_projects (
        id, title, kind, schedule, status, notes, agent_id,
        brief, goals, priority, next_run_at, team_id, meta, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      title,
      kind,
      input.schedule?.trim() || null,
      status,
      (input.notes ?? "").trim().slice(0, 4000),
      input.agentId ?? null,
      (input.brief ?? "").trim().slice(0, 4000),
      (input.goals ?? "").trim().slice(0, 4000),
      Number(input.priority ?? 0),
      input.nextRunAt ?? null,
      input.teamId ?? null,
      JSON.stringify(input.meta ?? {}),
      now,
      now,
    );
  return getAiProject(id)!;
}

export function updateAiProject(
  id: string,
  patch: Partial<{
    title: string;
    kind: AiProjectKind;
    schedule: string | null;
    status: AiProjectStatus;
    notes: string;
    agentId: string | null;
    brief: string;
    goals: string;
    priority: number;
    nextRunAt: string | null;
    teamId: string | null;
    meta: Record<string, unknown>;
  }>,
): AiProject | null {
  const current = getAiProject(id);
  if (!current) return null;
  const now = new Date().toISOString();
  const title = patch.title != null ? patch.title.trim().slice(0, 160) : current.title;
  const kind = patch.kind === "recurring" || patch.kind === "punctual" ? patch.kind : current.kind;
  const status =
    patch.status && STATUSES.has(patch.status) ? patch.status : current.status;
  const schedule =
    patch.schedule !== undefined ? patch.schedule?.trim() || null : current.schedule;
  const notes = patch.notes != null ? patch.notes.trim().slice(0, 4000) : current.notes;
  const agentId = patch.agentId !== undefined ? patch.agentId : current.agentId;
  const brief = patch.brief != null ? patch.brief.trim().slice(0, 4000) : current.brief;
  const goals = patch.goals != null ? patch.goals.trim().slice(0, 4000) : current.goals;
  const priority = patch.priority != null ? Number(patch.priority) : current.priority;
  const nextRunAt = patch.nextRunAt !== undefined ? patch.nextRunAt : current.nextRunAt;
  const teamId = patch.teamId !== undefined ? patch.teamId : current.teamId;
  const meta = patch.meta ? { ...current.meta, ...patch.meta } : current.meta;
  getDb()
    .prepare(
      `UPDATE ai_projects SET
        title = ?, kind = ?, schedule = ?, status = ?, notes = ?, agent_id = ?,
        brief = ?, goals = ?, priority = ?, next_run_at = ?, team_id = ?, meta = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      title,
      kind,
      schedule,
      status,
      notes,
      agentId,
      brief,
      goals,
      priority,
      nextRunAt,
      teamId,
      JSON.stringify(meta),
      now,
      id,
    );
  return getAiProject(id);
}

export function deleteAiProject(id: string): boolean {
  const r = getDb().prepare(`DELETE FROM ai_projects WHERE id = ?`).run(id);
  return r.changes > 0;
}

export function listDueRecurringProjects(nowIso = new Date().toISOString()): AiProject[] {
  return getDb()
    .prepare(
      `SELECT * FROM ai_projects
       WHERE status = 'active' AND kind = 'recurring' AND next_run_at IS NOT NULL AND next_run_at <= ?
       ORDER BY next_run_at ASC`,
    )
    .all(nowIso)
    .map((r) => rowToProject(r as Record<string, unknown>));
}
