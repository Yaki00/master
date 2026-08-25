import { getDb } from "./sqlite";

export type OfficeTaskStatus =
  | "queued"
  | "thinking"
  | "working"
  | "blocked"
  | "handoff"
  | "done"
  | "failed"
  | "cancelled";

export type OfficeTaskPhase =
  | "meeting"
  | "plan"
  | "decision"
  | "execution"
  | "done"
  | "failed";

export type OfficeTask = {
  id: string;
  projectId: string | null;
  teamId: string | null;
  title: string;
  brief: string;
  status: OfficeTaskStatus;
  phase: OfficeTaskPhase;
  assigneeAgentId: string | null;
  reporterAgentId: string | null;
  deliverTo: string | null;
  parentTaskId: string | null;
  commandId: string | null;
  resultSummary: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type OfficeTaskEvent = {
  id: string;
  taskId: string;
  kind: string;
  fromAgent: string | null;
  toAgent: string | null;
  text: string;
  createdAt: string;
};

const STATUSES = new Set<OfficeTaskStatus>([
  "queued",
  "thinking",
  "working",
  "blocked",
  "handoff",
  "done",
  "failed",
  "cancelled",
]);

const PHASES = new Set<OfficeTaskPhase>([
  "meeting",
  "plan",
  "decision",
  "execution",
  "done",
  "failed",
]);

function parseMeta(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function rowToTask(row: Record<string, unknown>): OfficeTask {
  return {
    id: String(row.id),
    projectId: row.project_id != null ? String(row.project_id) : null,
    teamId: row.team_id != null ? String(row.team_id) : null,
    title: String(row.title),
    brief: String(row.brief ?? ""),
    status: String(row.status) as OfficeTaskStatus,
    phase: String(row.phase) as OfficeTaskPhase,
    assigneeAgentId: row.assignee_agent_id != null ? String(row.assignee_agent_id) : null,
    reporterAgentId: row.reporter_agent_id != null ? String(row.reporter_agent_id) : null,
    deliverTo: row.deliver_to != null ? String(row.deliver_to) : null,
    parentTaskId: row.parent_task_id != null ? String(row.parent_task_id) : null,
    commandId: row.command_id != null ? String(row.command_id) : null,
    resultSummary: row.result_summary != null ? String(row.result_summary) : null,
    meta: parseMeta(row.meta),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    completedAt: row.completed_at != null ? String(row.completed_at) : null,
  };
}

function rowToEvent(row: Record<string, unknown>): OfficeTaskEvent {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    kind: String(row.kind),
    fromAgent: row.from_agent != null ? String(row.from_agent) : null,
    toAgent: row.to_agent != null ? String(row.to_agent) : null,
    text: String(row.text ?? ""),
    createdAt: String(row.created_at),
  };
}

export function appendTaskEvent(input: {
  taskId: string;
  kind: string;
  fromAgent?: string | null;
  toAgent?: string | null;
  text?: string;
}): OfficeTaskEvent {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO office_task_events (id, task_id, kind, from_agent, to_agent, text, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.taskId,
      input.kind.slice(0, 40),
      input.fromAgent ?? null,
      input.toAgent ?? null,
      (input.text ?? "").slice(0, 4000),
      now,
    );
  return {
    id,
    taskId: input.taskId,
    kind: input.kind,
    fromAgent: input.fromAgent ?? null,
    toAgent: input.toAgent ?? null,
    text: (input.text ?? "").slice(0, 4000),
    createdAt: now,
  };
}

export function listTaskEvents(taskId: string, limit = 80): OfficeTaskEvent[] {
  return getDb()
    .prepare(
      `SELECT * FROM office_task_events WHERE task_id = ? ORDER BY created_at ASC LIMIT ?`,
    )
    .all(taskId, Math.max(1, Math.min(limit, 200)))
    .map((r) => rowToEvent(r as Record<string, unknown>));
}

export function getOfficeTask(id: string): OfficeTask | null {
  const row = getDb().prepare(`SELECT * FROM office_tasks WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToTask(row) : null;
}

export function getOfficeTaskByCommandId(commandId: string): OfficeTask | null {
  const row = getDb()
    .prepare(`SELECT * FROM office_tasks WHERE command_id = ? ORDER BY created_at DESC LIMIT 1`)
    .get(commandId) as Record<string, unknown> | undefined;
  return row ? rowToTask(row) : null;
}

/** Sous-tâches d’un parent (arbre PM / parentTaskId). */
export function listOfficeTasksByParent(parentTaskId: string, limit = 80): OfficeTask[] {
  return getDb()
    .prepare(
      `SELECT * FROM office_tasks WHERE parent_task_id = ? ORDER BY created_at ASC LIMIT ?`,
    )
    .all(parentTaskId, Math.max(1, Math.min(limit, 200)))
    .map((r) => rowToTask(r as Record<string, unknown>));
}

export function listOfficeTasks(opts?: {
  status?: OfficeTaskStatus | "active" | "all";
  phase?: OfficeTaskPhase;
  projectId?: string;
  limit?: number;
}): OfficeTask[] {
  const limit = Math.max(1, Math.min(opts?.limit ?? 80, 200));
  const database = getDb();
  if (opts?.projectId) {
    return database
      .prepare(
        `SELECT * FROM office_tasks WHERE project_id = ? ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(opts.projectId, limit)
      .map((r) => rowToTask(r as Record<string, unknown>));
  }
  if (opts?.phase && PHASES.has(opts.phase)) {
    return database
      .prepare(`SELECT * FROM office_tasks WHERE phase = ? ORDER BY updated_at DESC LIMIT ?`)
      .all(opts.phase, limit)
      .map((r) => rowToTask(r as Record<string, unknown>));
  }
  const statusFilter = opts?.status;
  if (statusFilter === "active") {
    return database
      .prepare(
        `SELECT * FROM office_tasks
         WHERE status IN ('queued','thinking','working','blocked','handoff')
         ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(limit)
      .map((r) => rowToTask(r as Record<string, unknown>));
  }
  if (statusFilter && statusFilter !== "all" && STATUSES.has(statusFilter)) {
    return database
      .prepare(`SELECT * FROM office_tasks WHERE status = ? ORDER BY updated_at DESC LIMIT ?`)
      .all(statusFilter, limit)
      .map((r) => rowToTask(r as Record<string, unknown>));
  }
  return database
    .prepare(`SELECT * FROM office_tasks ORDER BY updated_at DESC LIMIT ?`)
    .all(limit)
    .map((r) => rowToTask(r as Record<string, unknown>));
}

export function createOfficeTask(input: {
  title: string;
  brief?: string;
  projectId?: string | null;
  teamId?: string | null;
  status?: OfficeTaskStatus;
  phase?: OfficeTaskPhase;
  assigneeAgentId?: string | null;
  reporterAgentId?: string | null;
  deliverTo?: string | null;
  parentTaskId?: string | null;
  commandId?: string | null;
  meta?: Record<string, unknown>;
}): OfficeTask {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const status = input.status && STATUSES.has(input.status) ? input.status : "queued";
  const phase = input.phase && PHASES.has(input.phase) ? input.phase : "meeting";
  const title = input.title.trim().slice(0, 200) || "Tâche";
  getDb()
    .prepare(
      `INSERT INTO office_tasks (
        id, project_id, team_id, title, brief, status, phase,
        assignee_agent_id, reporter_agent_id, deliver_to, parent_task_id,
        command_id, result_summary, meta, created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL)`,
    )
    .run(
      id,
      input.projectId ?? null,
      input.teamId ?? null,
      title,
      (input.brief ?? "").trim().slice(0, 4000),
      status,
      phase,
      input.assigneeAgentId ?? null,
      input.reporterAgentId ?? null,
      input.deliverTo ?? "user",
      input.parentTaskId ?? null,
      input.commandId ?? null,
      JSON.stringify(input.meta ?? {}),
      now,
      now,
    );
  appendTaskEvent({
    taskId: id,
    kind: "status",
    fromAgent: input.reporterAgentId ?? null,
    toAgent: input.assigneeAgentId ?? null,
    text: `Créée · phase ${phase} · status ${status}`,
  });
  return getOfficeTask(id)!;
}

export function updateOfficeTask(
  id: string,
  patch: Partial<{
    title: string;
    brief: string;
    status: OfficeTaskStatus;
    phase: OfficeTaskPhase;
    assigneeAgentId: string | null;
    reporterAgentId: string | null;
    deliverTo: string | null;
    commandId: string | null;
    resultSummary: string | null;
    meta: Record<string, unknown>;
    completedAt: string | null;
  }>,
  eventNote?: { kind?: string; fromAgent?: string | null; toAgent?: string | null; text?: string },
): OfficeTask | null {
  const current = getOfficeTask(id);
  if (!current) return null;
  const now = new Date().toISOString();
  const status =
    patch.status && STATUSES.has(patch.status) ? patch.status : current.status;
  const phase = patch.phase && PHASES.has(patch.phase) ? patch.phase : current.phase;
  const completedAt =
    patch.completedAt !== undefined
      ? patch.completedAt
      : status === "done" || status === "failed" || status === "cancelled"
        ? (current.completedAt ?? now)
        : current.completedAt;
  const meta = patch.meta ? { ...current.meta, ...patch.meta } : current.meta;

  getDb()
    .prepare(
      `UPDATE office_tasks SET
        title = ?, brief = ?, status = ?, phase = ?,
        assignee_agent_id = ?, reporter_agent_id = ?, deliver_to = ?,
        command_id = ?, result_summary = ?, meta = ?,
        updated_at = ?, completed_at = ?
       WHERE id = ?`,
    )
    .run(
      patch.title != null ? patch.title.trim().slice(0, 200) : current.title,
      patch.brief != null ? patch.brief.trim().slice(0, 4000) : current.brief,
      status,
      phase,
      patch.assigneeAgentId !== undefined ? patch.assigneeAgentId : current.assigneeAgentId,
      patch.reporterAgentId !== undefined ? patch.reporterAgentId : current.reporterAgentId,
      patch.deliverTo !== undefined ? patch.deliverTo : current.deliverTo,
      patch.commandId !== undefined ? patch.commandId : current.commandId,
      patch.resultSummary !== undefined ? patch.resultSummary : current.resultSummary,
      JSON.stringify(meta),
      now,
      completedAt,
      id,
    );

  if (eventNote?.text || patch.status || patch.phase) {
    appendTaskEvent({
      taskId: id,
      kind: eventNote?.kind ?? "status",
      fromAgent: eventNote?.fromAgent ?? null,
      toAgent: eventNote?.toAgent ?? current.assigneeAgentId,
      text:
        eventNote?.text ??
        `${patch.phase ? `phase→${phase}` : ""} ${patch.status ? `status→${status}` : ""}`.trim(),
    });
  }
  return getOfficeTask(id);
}

export function deleteOfficeTask(id: string): boolean {
  const database = getDb();
  database.prepare(`DELETE FROM office_task_events WHERE task_id = ?`).run(id);
  return database.prepare(`DELETE FROM office_tasks WHERE id = ?`).run(id).changes > 0;
}
