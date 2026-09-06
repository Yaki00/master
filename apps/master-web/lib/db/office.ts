import type { JobStatus, PipelineJob, WorkerHeartbeat } from "../types";
import type {
  OfficeAgent,
  OfficeAgentKind,
  OfficeCommand,
  OfficeCommandKind,
  OfficeCommandStatus,
  OfficeEvent,
  OfficeIngestAgent,
  OfficeSources,
  OfficeStatus,
  WaitingJobSummary,
} from "../office/types";
import { OFFICE_CLAIM_STALE_MS, OFFICE_OFFLINE_MS } from "../office/types";
import { isOfficeStatus, mapRoom, normalizeTaskSubject } from "../office/mapRoom";
import { mergeIngestStatus } from "../office/ingest-merge";
import { reconcileAgentStatus } from "../office/status-truth";
import { eventFromCommandAck, normalizeOfficeAck } from "../office/ack";
import { filterSummaryForStorage } from "../office/summary-keep";
import { appendAgentLog } from "./agent-logs";
import { getDb } from "./sqlite";
import {
  archiveOfficeConversationFromEvents,
  closeActiveConversations,
  ensureActiveConversation,
} from "./office-conversations";
import {
  getJob,
  listJobEvents,
  listJobs,
  listWorkerHeartbeats,
} from "./jobs";

const ACTIVE_JOB_STATUSES: JobStatus[] = ["queued", "claimed", "running", "paused"];
const OPENCLAW_WORKER_ID = "openclaw-mac";

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return {};
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v)).filter(Boolean);
}

export function normalizeOfficeAgentId(rawId: string, kind: OfficeAgentKind): string {
  const trimmed = rawId.trim();
  if (kind === "openclaw") {
    return trimmed.startsWith("openclaw:") ? trimmed : `openclaw:${trimmed}`;
  }
  if (kind === "pc") {
    return trimmed.startsWith("pc:") ? trimmed : `pc:${trimmed}`;
  }
  if (kind === "job") {
    return trimmed.startsWith("job:") ? trimmed : `job:${trimmed}`;
  }
  return trimmed;
}

export function parseOfficeAgentId(id: string): { kind: OfficeAgentKind; rest: string } | null {
  if (id.startsWith("openclaw:")) return { kind: "openclaw", rest: id.slice("openclaw:".length) };
  if (id.startsWith("pc:")) return { kind: "pc", rest: id.slice("pc:".length) };
  if (id.startsWith("job:")) return { kind: "job", rest: id.slice("job:".length) };
  return null;
}

function coerceStatus(raw: string | undefined): OfficeStatus {
  if (raw && isOfficeStatus(raw)) return raw;
  return "idle";
}

function isStale(lastSeenAt: string, now = Date.now()): boolean {
  const ts = new Date(lastSeenAt).getTime();
  if (!Number.isFinite(ts)) return true;
  return now - ts > OFFICE_OFFLINE_MS;
}

function applyFreshness(agent: OfficeAgent, now = Date.now()): OfficeAgent {
  if (!isStale(agent.lastSeenAt, now)) return agent;
  const status: OfficeStatus = agent.status === "waiting" ? "waiting" : "offline";
  return decorateRoom({ ...agent, status });
}

function decorateRoom(agent: Omit<OfficeAgent, "room"> & { room?: OfficeAgent["room"] }): OfficeAgent {
  const tools = stringArray(agent.meta.tools);
  const meeting = agent.meta.meeting === true;
  return {
    ...agent,
    room: mapRoom({
      status: agent.status,
      currentAction: agent.currentAction,
      tools,
      meeting,
      agentId: agent.id,
    }),
  };
}

type AgentRow = {
  id: string;
  kind: string;
  name: string;
  status: string;
  task: string | null;
  current_action: string | null;
  last_seen_at: string;
  meta: string | null;
};

function rowToStoredAgent(row: AgentRow): OfficeAgent {
  return decorateRoom({
    id: String(row.id),
    kind: row.kind as OfficeAgentKind,
    name: String(row.name),
    status: coerceStatus(String(row.status)),
    task: row.task,
    currentAction: row.current_action,
    lastSeenAt: String(row.last_seen_at),
    meta: parseJsonObject(row.meta ?? undefined),
  });
}

export function upsertOfficeAgent(input: {
  id: string;
  kind: OfficeAgentKind;
  name: string;
  status: OfficeStatus;
  task?: string | null;
  currentAction?: string | null;
  lastSeenAt?: string;
  meta?: Record<string, unknown>;
}): OfficeAgent {
  const database = getDb();
  const id = normalizeOfficeAgentId(input.id, input.kind);
  const now = input.lastSeenAt ?? new Date().toISOString();
  const meta = JSON.stringify(input.meta ?? {});
  database
    .prepare(
      `INSERT INTO office_agents (id, kind, name, status, task, current_action, last_seen_at, meta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         kind = excluded.kind,
         name = excluded.name,
         status = excluded.status,
         task = excluded.task,
         current_action = excluded.current_action,
         last_seen_at = excluded.last_seen_at,
         meta = excluded.meta`,
    )
    .run(id, input.kind, input.name, input.status, input.task ?? null, input.currentAction ?? null, now, meta);

  return getStoredOfficeAgent(id)!;
}

export function getStoredOfficeAgent(id: string): OfficeAgent | null {
  const database = getDb();
  const row = database.prepare(`SELECT * FROM office_agents WHERE id = ?`).get(id) as AgentRow | undefined;
  return row ? rowToStoredAgent(row) : null;
}

export function listStoredOfficeAgents(): OfficeAgent[] {
  const database = getDb();
  return database
    .prepare(`SELECT * FROM office_agents ORDER BY last_seen_at DESC`)
    .all()
    .map((r) => rowToStoredAgent(r as AgentRow));
}

export function appendOfficeEvent(
  agentId: string,
  kind: string,
  payload: Record<string, unknown> = {},
): OfficeEvent {
  const database = getDb();
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  database
    .prepare(`INSERT INTO office_events (id, agent_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(id, agentId, kind, JSON.stringify(payload), createdAt);
  return { id, agentId, kind, payload, createdAt };
}

export function listOfficeEvents(agentId: string, limit = 50): OfficeEvent[] {
  const database = getDb();
  return database
    .prepare(`SELECT * FROM office_events WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?`)
    .all(agentId, limit)
    .map((r) => {
      const row = r as Record<string, unknown>;
      return {
        id: String(row.id),
        agentId: String(row.agent_id),
        kind: String(row.kind),
        payload: parseJsonObject(String(row.payload ?? "{}")),
        createdAt: String(row.created_at),
      };
    });
}

/** Fil global multi-agents (CDC-02). */
export function listOfficeFeed(limit = 80): OfficeEvent[] {
  const database = getDb();
  const cap = Math.max(10, Math.min(limit, 200));
  return database
    .prepare(`SELECT * FROM office_events ORDER BY created_at DESC LIMIT ?`)
    .all(cap)
    .map((r) => {
      const row = r as Record<string, unknown>;
      return {
        id: String(row.id),
        agentId: String(row.agent_id),
        kind: String(row.kind),
        payload: parseJsonObject(String(row.payload ?? "{}")),
        createdAt: String(row.created_at),
      };
    });
}

/**
 * Nouvelle discussion : archive le fil courant (si contenu utile), puis vide les events live.
 * Conserves un résumé court seulement s’il est utile (filterSummaryForStorage).
 */
export function clearOfficeEvents(agentId: string): number {
  const database = getDb();
  const priorEvents = listOfficeEvents(agentId, 500).slice().reverse(); // chronologique
  const agent = getStoredOfficeAgent(agentId);
  let keptSummary = false;
  let dropReason = "";
  let archivedId: string | null = null;
  let summaryForArchive = "";

  if (agent) {
    const meta = { ...agent.meta };
    const prev = typeof meta.chatSummary === "string" ? String(meta.chatSummary) : "";
    const { summary, decision } = filterSummaryForStorage(prev);
    summaryForArchive = summary || prev.slice(0, 800);
    if (summary) {
      meta.chatSummary = summary;
      meta.chatSummaryAt = new Date().toISOString();
      meta.summaryKept = true;
      keptSummary = true;
      appendAgentLog(agentId, "summary", `Résumé conservé (score ${decision.score}): ${summary.slice(0, 400)}`, {
        decision,
      });
    } else {
      dropReason = decision.reason;
      delete meta.chatSummary;
      delete meta.chatSummaryAt;
      delete meta.summaryKept;
      if (prev) {
        appendAgentLog(agentId, "summary", `Résumé abandonné (${decision.reason}): ${prev.slice(0, 200)}`, {
          decision,
        });
      }
    }

    const archived = archiveOfficeConversationFromEvents(agentId, priorEvents, {
      summary: summaryForArchive,
    });
    if (archived) {
      archivedId = archived.id;
      appendAgentLog(agentId, "reflection", `Discussion archivée · ${archived.title.slice(0, 80)}`, {
        conversationId: archived.id,
        messageCount: archived.messageCount,
      });
    }

    closeActiveConversations(agentId);
    const active = ensureActiveConversation(agentId);
    meta.activeConversationId = active.id;
    if (archivedId) {
      meta.lastArchivedConversationId = archivedId;
    }

    upsertOfficeAgent({
      id: agent.id,
      kind: agent.kind,
      name: agent.name,
      status: agent.status,
      task: agent.task,
      currentAction: agent.currentAction,
      lastSeenAt: agent.lastSeenAt ?? new Date().toISOString(),
      meta,
    });
  } else {
    archiveOfficeConversationFromEvents(agentId, priorEvents, { summary: "" });
    closeActiveConversations(agentId);
    ensureActiveConversation(agentId);
  }

  const info = database.prepare(`DELETE FROM office_events WHERE agent_id = ?`).run(agentId);

  const archiveNote = archivedId
    ? ` Discussion précédente archivée (${archivedId.slice(0, 8)}).`
    : "";
  appendOfficeEvent(agentId, "agent_message", {
    text: keptSummary
      ? `Nouvelle discussion — fil vidé, résumé utile conservé.${archiveNote}`
      : dropReason
        ? `Nouvelle discussion — fil vidé (résumé écarté: ${dropReason}).${archiveNote}`
        : `Nouvelle discussion ouverte.${archiveNote}`,
    role: "system",
    cleared: true,
    newRequest: true,
    newDiscussion: true,
    archivedConversationId: archivedId,
  });
  return info.changes;
}

export function ingestOfficeSnapshot(input: {
  source?: string;
  hostname?: string | null;
  agents?: OfficeIngestAgent[];
  events?: { agentId: string; kind: string; payload?: Record<string, unknown> }[];
}): { agents: OfficeAgent[]; ingested: number } {
  failStaleClaimedOfficeCommands();
  const agentsIn = Array.isArray(input.agents) ? input.agents : [];
  const upserted: OfficeAgent[] = [];

  for (const raw of agentsIn) {
    if (!raw?.id) continue;
    const kind: OfficeAgentKind = raw.kind === "pc" || raw.kind === "job" ? raw.kind : "openclaw";
    const id = normalizeOfficeAgentId(String(raw.id), kind);
    const existing = getStoredOfficeAgent(id);
    const incomingStatus = coerceStatus(raw.status ? String(raw.status) : undefined);
    const incomingMeta: Record<string, unknown> = { ...(raw.meta ?? {}) };
    if (raw.tools) incomingMeta.tools = raw.tools;
    if (raw.meeting === true) incomingMeta.meeting = true;
    if (input.source) incomingMeta.source = input.source;

    const merged = mergeIngestStatus(
      existing,
      {
        status: incomingStatus,
        task: raw.task ?? null,
        currentAction: raw.currentAction ?? null,
        meta: incomingMeta,
      },
      { liveCommand: hasLiveOfficeCommand(id) },
    );

    const agent = upsertOfficeAgent({
      id,
      kind,
      name: raw.name?.trim() || existing?.name || id.replace(/^(openclaw|pc|job):/, ""),
      status: merged.status,
      task: merged.task,
      currentAction: merged.currentAction,
      meta: merged.meta,
    });
    upserted.push(agent);
  }

  for (const ev of input.events ?? []) {
    if (!ev?.agentId || !ev.kind) continue;
    const parsed = parseOfficeAgentId(ev.agentId);
    const agentId = parsed
      ? normalizeOfficeAgentId(ev.agentId, parsed.kind)
      : normalizeOfficeAgentId(ev.agentId, "openclaw");
    appendOfficeEvent(agentId, ev.kind, ev.payload ?? {});
  }

  return { agents: upserted, ingested: upserted.length };
}

export function enqueueOfficeCommand(
  agentId: string,
  kind: OfficeCommandKind,
  payload: Record<string, unknown> = {},
): OfficeCommand {
  const database = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO office_commands (id, agent_id, kind, payload, status, claimed_by, result, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'queued', NULL, NULL, ?, ?)`,
    )
    .run(id, agentId, kind, JSON.stringify(payload), now, now);
  return getOfficeCommand(id)!;
}

export function getOfficeCommand(id: string): OfficeCommand | null {
  const database = getDb();
  const row = database.prepare(`SELECT * FROM office_commands WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  return row ? rowToCommand(row) : null;
}

function rowToCommand(row: Record<string, unknown>): OfficeCommand {
  return {
    id: String(row.id),
    agentId: String(row.agent_id),
    kind: row.kind as OfficeCommandKind,
    payload: parseJsonObject(String(row.payload ?? "{}")),
    status: row.status as OfficeCommandStatus,
    claimedBy: row.claimed_by != null ? String(row.claimed_by) : null,
    result: row.result != null ? String(row.result) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function hasLiveOfficeCommand(agentId: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 AS ok FROM office_commands WHERE agent_id = ? AND status IN ('queued', 'claimed') LIMIT 1`,
    )
    .get(agentId) as { ok?: number } | undefined;
  return Boolean(row);
}

/** Annule les messages encore en file (pause/stop) — ne touche pas aux claimed en cours. */
export function cancelQueuedOfficeCommands(
  agentId: string,
  kinds: OfficeCommandKind[] = ["message", "resume"],
): number {
  if (kinds.length === 0) return 0;
  const database = getDb();
  const now = new Date().toISOString();
  const placeholders = kinds.map(() => "?").join(",");
  const result = database
    .prepare(
      `UPDATE office_commands
       SET status = 'failed', result = ?, updated_at = ?
       WHERE agent_id = ? AND status = 'queued' AND kind IN (${placeholders})`,
    )
    .run("annulé (pause/stop)", now, agentId, ...kinds);
  return Number(result.changes ?? 0);
}

export function applyOfficeAckToAgent(
  command: Pick<OfficeCommand, "agentId" | "kind">,
  status: "done" | "failed",
  resultText: string,
): void {
  const agent = getStoredOfficeAgent(command.agentId);
  if (!agent) return;
  const now = new Date().toISOString();
  const meta = { ...agent.meta };

  if (command.kind === "pause") {
    delete meta.pauseRequested;
    upsertOfficeAgent({
      id: agent.id,
      kind: agent.kind,
      name: agent.name,
      status: "waiting",
      task: agent.task,
      currentAction: "pause demandée",
      lastSeenAt: now,
      meta: { ...meta, pendingCommand: "pause" },
    });
    return;
  }

  if (command.kind === "stop") {
    delete meta.stopRequested;
    const stillLive = hasLiveOfficeCommand(agent.id);
    if (stillLive) {
      upsertOfficeAgent({
        id: agent.id,
        kind: agent.kind,
        name: agent.name,
        status: "working",
        task: agent.task,
        currentAction: "stop demandé…",
        lastSeenAt: now,
        meta: { ...meta, stopRequested: true, pendingCommand: "stop" },
      });
      return;
    }
    delete meta.pendingCommand;
    upsertOfficeAgent({
      id: agent.id,
      kind: agent.kind,
      name: agent.name,
      status: "idle",
      task: null,
      currentAction: "stop demandé",
      lastSeenAt: now,
      meta,
    });
    return;
  }

  delete meta.pendingCommand;
  delete meta.pauseRequested;
  delete meta.stopRequested;
  const failed = status === "failed";
  const stopPending = agent.meta.stopRequested === true || agent.meta.pendingCommand === "stop";
  upsertOfficeAgent({
    id: agent.id,
    kind: agent.kind,
    name: agent.name,
    status: failed ? "error" : "idle",
    task: stopPending ? null : agent.task,
    currentAction: failed ? resultText.slice(0, 80) || "échec" : "répondu",
    lastSeenAt: now,
    meta,
  });
}

export function completeOfficeCommand(
  id: string,
  status: "done" | "failed",
  result?: string | null,
  opts?: { summary?: string | null },
): OfficeCommand | null {
  const command = getOfficeCommand(id);
  if (!command) return null;
  // Déjà terminé : idempotent (évite double handoff)
  if (command.status === "done" || command.status === "failed") {
    return command;
  }
  const norm = normalizeOfficeAck(status, result ?? null);
  ackOfficeCommand(id, norm.status, norm.result || null);
  applyOfficeAckToAgent(command, norm.status, norm.result);
  const ev = eventFromCommandAck(command, norm.status, norm.result);
  if (ev) appendOfficeEvent(command.agentId, ev.kind, ev.payload);

  if (norm.result && (command.kind === "message" || command.kind === "resume")) {
    appendAgentLog(command.agentId, "outcome", norm.result.slice(0, 2000), {
      commandId: command.id,
      status: norm.status,
      ask: typeof command.payload.text === "string" ? String(command.payload.text).slice(0, 300) : undefined,
    });
  }

  const rawSummary = typeof opts?.summary === "string" ? opts.summary.trim() : "";
  if (rawSummary) {
    const { summary, decision } = filterSummaryForStorage(rawSummary);
    const agent = getStoredOfficeAgent(command.agentId);
    if (agent) {
      const meta = { ...agent.meta };
      if (summary) {
        meta.chatSummary = summary;
        meta.chatSummaryAt = new Date().toISOString();
        meta.summaryKept = true;
        appendAgentLog(command.agentId, "summary", `Synthèse gardée (score ${decision.score})`, {
          decision,
          preview: summary.slice(0, 240),
        });
      } else {
        appendAgentLog(command.agentId, "summary", `Synthèse ignorée (${decision.reason})`, {
          decision,
          preview: rawSummary.slice(0, 240),
        });
      }
      upsertOfficeAgent({
        id: agent.id,
        kind: agent.kind,
        name: agent.name,
        status: agent.status,
        task: agent.task,
        currentAction: agent.currentAction,
        lastSeenAt: agent.lastSeenAt ?? new Date().toISOString(),
        meta,
      });
    }
  }
  return getOfficeCommand(id);
}

export function failStaleClaimedOfficeCommands(now = Date.now()): number {
  const cutoff = new Date(now - OFFICE_CLAIM_STALE_MS).toISOString();
  const rows = getDb()
    .prepare(`SELECT id FROM office_commands WHERE status = 'claimed' AND updated_at < ?`)
    .all(cutoff) as { id: string }[];
  for (const row of rows) {
    completeOfficeCommand(row.id, "failed", "Pas de réponse du Mac (commande expirée). Réessaie.");
  }
  return rows.length;
}

export function claimOfficeCommands(claimedBy: string, limit = 5): OfficeCommand[] {
  failStaleClaimedOfficeCommands();
  const database = getDb();
  const cap = Math.max(1, Math.min(limit, 20));
  const now = new Date().toISOString();
  const claimed: OfficeCommand[] = [];

  const tx = database.transaction(() => {
    const rows = database
      .prepare(
        `SELECT * FROM office_commands WHERE status = 'queued' ORDER BY created_at ASC LIMIT ?`,
      )
      .all(cap) as Record<string, unknown>[];

    const update = database.prepare(
      `UPDATE office_commands SET status = 'claimed', claimed_by = ?, updated_at = ? WHERE id = ? AND status = 'queued'`,
    );

    for (const row of rows) {
      const result = update.run(claimedBy, now, String(row.id));
      if (result.changes > 0) {
        const next = getOfficeCommand(String(row.id));
        if (next) claimed.push(next);
      }
    }
  });
  tx();
  return claimed;
}

export function listOfficeCommandsForAgent(agentId: string, limit = 20): OfficeCommand[] {
  const database = getDb();
  return database
    .prepare(
      `SELECT * FROM office_commands WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?`,
    )
    .all(agentId, limit)
    .map((r) => rowToCommand(r as Record<string, unknown>));
}

export function ackOfficeCommand(
  id: string,
  status: "done" | "failed",
  result?: string | null,
): OfficeCommand | null {
  const current = getOfficeCommand(id);
  if (!current) return null;
  const now = new Date().toISOString();
  getDb()
    .prepare(`UPDATE office_commands SET status = ?, result = ?, updated_at = ? WHERE id = ?`)
    .run(status, result ?? null, now, id);
  return getOfficeCommand(id);
}

function parseHeartbeatMeta(hb: WorkerHeartbeat): Record<string, unknown> {
  return parseJsonObject(hb.meta ?? undefined);
}

function jobToOfficeAgent(job: PipelineJob): OfficeAgent {
  const status: OfficeStatus =
    job.status === "paused"
      ? "waiting"
      : job.status === "failed"
        ? "error"
        : job.status === "queued" || job.status === "claimed" || job.status === "running"
          ? "working"
          : "idle";

  const currentAction =
    job.status === "paused"
      ? "en attente d’une réponse"
      : job.status === "failed"
        ? "erreur"
        : job.target;

  return decorateRoom({
    id: `job:${job.id}`,
    kind: "job",
    name: `Job ${job.id.slice(0, 8)}`,
    status,
    task: job.prompt.slice(0, 240),
    currentAction,
    lastSeenAt: job.updatedAt,
    meta: {
      jobId: job.id,
      jobStatus: job.status,
      target: job.target,
      claimedBy: job.claimedBy,
    },
  });
}

function toolsFromJob(job: PipelineJob | undefined): string[] {
  if (!job) return [];
  if (job.target === "screen") return ["browser"];
  if (job.target === "pc" || job.target === "agent") return ["exec"];
  return [];
}

function pcToOfficeAgent(hb: WorkerHeartbeat, activeJobs: PipelineJob[]): OfficeAgent {
  const jobsForWorker = activeJobs.filter((j) => j.claimedBy === hb.workerId);
  const running = jobsForWorker.find((j) => j.status === "running" || j.status === "claimed");
  const paused = jobsForWorker.find((j) => j.status === "paused");
  const failed = jobsForWorker.find((j) => j.status === "failed");
  const stale = isStale(hb.lastSeenAt);

  let status: OfficeStatus = "idle";
  if (stale) status = "offline";
  else if (paused) status = "waiting";
  else if (failed && !running) status = "error";
  else if (running || jobsForWorker.some((j) => j.status === "queued")) status = "working";

  const focus = running ?? paused ?? failed ?? jobsForWorker[0];
  const meta = parseHeartbeatMeta(hb);
  if (focus) meta.tools = toolsFromJob(focus);

  return decorateRoom({
    id: `pc:${hb.workerId}`,
    kind: "pc",
    name: hb.hostname || hb.workerId,
    status,
    task: focus?.prompt.slice(0, 240) ?? null,
    currentAction: focus ? (focus.status === "paused" ? "en attente" : focus.target) : "heartbeat",
    lastSeenAt: hb.lastSeenAt,
    meta: {
      ...meta,
      workerId: hb.workerId,
      jobId: focus?.id ?? null,
    },
  });
}

function isOpenclawHeartbeat(hb: WorkerHeartbeat): boolean {
  if (hb.workerId === OPENCLAW_WORKER_ID || hb.workerId.startsWith("openclaw")) return true;
  const meta = parseHeartbeatMeta(hb);
  return meta.role === "openclaw" || meta.source === "office-ingest";
}

function isPcHeartbeat(hb: WorkerHeartbeat): boolean {
  if (isOpenclawHeartbeat(hb)) return false;
  const meta = parseHeartbeatMeta(hb);
  const role = String(meta.role ?? "");
  if (role === "orchestrator" || role === "openclaw") return false;
  if (hb.workerId.includes("orchestrator")) return false;
  return true;
}

export function listAggregatedOfficeAgents(now = Date.now()): OfficeAgent[] {
  const stored = listStoredOfficeAgents().map((a) => applyFreshness(a, now));
  const jobs = listJobs({ status: ACTIVE_JOB_STATUSES, limit: 80 });
  const heartbeats = listWorkerHeartbeats();
  const pcAgents = heartbeats.filter(isPcHeartbeat).map((hb) => {
    const agent = pcToOfficeAgent(hb, jobs);
    const pausedForPc = jobs.filter((j) => j.status === "paused" && j.claimedBy === hb.workerId);
    return decorateRoom({
      ...agent,
      meta: {
        ...agent.meta,
        pausedJobCount: pausedForPc.length,
        pausedJobIds: pausedForPc.map((j) => j.id),
      },
    });
  });

  // Plancher : workers seulement (OpenClaw + PC). Jobs → waitingJobs séparés.
  const byId = new Map<string, OfficeAgent>();
  for (const agent of [...stored, ...pcAgents]) {
    byId.set(agent.id, agent);
  }

  // Orphelin : jobs pausés sans worker online → une carte synthétique max
  const pcOnlineIds = new Set(
    heartbeats.filter((hb) => isPcHeartbeat(hb) && !isStale(hb.lastSeenAt, now)).map((hb) => hb.workerId),
  );
  const orphanPaused = jobs.filter(
    (j) =>
      j.waChatId === "office" &&
      j.status === "paused" &&
      (!j.claimedBy || !pcOnlineIds.has(j.claimedBy)),
  );
  if (orphanPaused.length > 0) {
    const first = orphanPaused[0]!;
    byId.set("job:waiting-queue", decorateRoom({
      id: "job:waiting-queue",
      kind: "job",
      name: orphanPaused.length === 1 ? `Job ${first.id.slice(0, 8)}` : `${orphanPaused.length} jobs en attente`,
      status: "waiting",
      task: first.prompt.slice(0, 240),
      currentAction: "en attente d’une réponse",
      lastSeenAt: first.updatedAt,
      meta: {
        jobIds: orphanPaused.map((j) => j.id),
        jobCount: orphanPaused.length,
        compact: true,
      },
    }));
  }

  let agents = [...byId.values()].map((a) =>
    reconcileAgentStatus(a, {
      now,
      liveCommand: a.kind === "openclaw" ? hasLiveOfficeCommand(a.id) : false,
    }),
  );

  // Meeting : ≥2 working avec même sujet normalisé
  const subjectCounts = new Map<string, number>();
  for (const a of agents) {
    if (a.status !== "working") continue;
    const subj = normalizeTaskSubject(a.task);
    if (!subj) continue;
    subjectCounts.set(subj, (subjectCounts.get(subj) ?? 0) + 1);
  }
  agents = agents.map((a) => {
    if (a.status !== "working") return a;
    const subj = normalizeTaskSubject(a.task);
    const meeting = Boolean(subj && (subjectCounts.get(subj) ?? 0) >= 2);
    if (!meeting && !a.meta.meeting) return a;
    return decorateRoom({
      ...a,
      meta: { ...a.meta, meeting: meeting || a.meta.meeting === true },
    });
  });

  return agents.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}

export function listWaitingJobs(limit = 20): WaitingJobSummary[] {
  return listJobs({ status: ["paused"], limit: Math.max(limit, 80) })
    .filter((j) => j.waChatId === "office")
    .slice(0, limit)
    .map((j) => ({
      id: j.id,
      prompt: j.prompt.slice(0, 160),
      claimedBy: j.claimedBy,
      status: j.status,
      updatedAt: j.updatedAt,
    }));
}

export function getAggregatedOfficeAgent(id: string, now = Date.now()): OfficeAgent | null {
  if (id === "job:waiting-queue") {
    return listAggregatedOfficeAgents(now).find((a) => a.id === id) ?? null;
  }
  // Jobs individuels toujours adressables pour actions, même hors plancher
  const parsed = parseOfficeAgentId(id);
  if (parsed?.kind === "job" && id !== "job:waiting-queue") {
    const job = getJob(parsed.rest);
    if (job && ACTIVE_JOB_STATUSES.includes(job.status)) {
      return applyFreshness(jobToOfficeAgent(job), now);
    }
  }
  return listAggregatedOfficeAgents(now).find((a) => a.id === id) ?? null;
}

export function listAgentEvents(id: string, limit = 50): OfficeEvent[] {
  const officeEvents = listOfficeEvents(id, limit);
  const parsed = parseOfficeAgentId(id);
  const extra: OfficeEvent[] = [];

  if (parsed?.kind === "job") {
    extra.push(
      ...listJobEvents(parsed.rest, limit).map((ev) => ({
        id: ev.id,
        agentId: id,
        kind: ev.kind,
        payload: parseJsonObject(ev.payload),
        createdAt: ev.createdAt,
      })),
    );
  }

  if (parsed?.kind === "pc") {
    const jobs = listJobs({ status: ACTIVE_JOB_STATUSES, limit: 20 }).filter((j) => j.claimedBy === parsed.rest);
    for (const job of jobs.slice(0, 3)) {
      extra.push(
        ...listJobEvents(job.id, 15).map((ev) => ({
          id: ev.id,
          agentId: id,
          kind: ev.kind,
          payload: { ...parseJsonObject(ev.payload), jobId: job.id },
          createdAt: ev.createdAt,
        })),
      );
    }
  }

  return [...officeEvents, ...extra]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export function officeSources(now = Date.now()): OfficeSources {
  const heartbeats = listWorkerHeartbeats();
  const macHb = heartbeats.find((hb) => isOpenclawHeartbeat(hb));
  const pcHb = heartbeats.find((hb) => isPcHeartbeat(hb));
  const macAgents = listStoredOfficeAgents().filter((a) => a.kind === "openclaw");
  const macSeen = [macHb?.lastSeenAt, ...macAgents.map((a) => a.lastSeenAt)]
    .filter((v): v is string => Boolean(v))
    .sort()
    .at(-1) ?? null;
  const pcSeen = pcHb?.lastSeenAt ?? null;

  return {
    mac: { online: Boolean(macSeen && !isStale(macSeen, now)), lastSeenAt: macSeen },
    pc: { online: Boolean(pcSeen && !isStale(pcSeen, now)), lastSeenAt: pcSeen },
    waitingJobs: listWaitingJobs(20),
  };
}

export function jobsForOfficeAgent(id: string): PipelineJob[] {
  const parsed = parseOfficeAgentId(id);
  if (!parsed) return [];
  if (parsed.kind === "job") {
    const job = getJob(parsed.rest);
    return job ? [job] : [];
  }
  if (parsed.kind === "pc") {
    return listJobs({ status: ACTIVE_JOB_STATUSES, limit: 80 }).filter(
      (j) => j.claimedBy === parsed.rest || (!j.claimedBy && j.status === "queued"),
    );
  }
  return [];
}
