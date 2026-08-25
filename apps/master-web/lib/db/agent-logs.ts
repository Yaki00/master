import { getDb } from "./sqlite";

export type AgentLogKind = "reflection" | "outcome" | "system" | "summary";

export type AgentLog = {
  id: string;
  agentId: string;
  kind: AgentLogKind;
  content: string;
  meta: Record<string, unknown> | null;
  createdAt: string;
};

function rowToLog(row: Record<string, unknown>): AgentLog {
  let meta: Record<string, unknown> | null = null;
  if (row.meta != null && String(row.meta)) {
    try {
      meta = JSON.parse(String(row.meta)) as Record<string, unknown>;
    } catch {
      meta = null;
    }
  }
  return {
    id: String(row.id),
    agentId: String(row.agent_id),
    kind: String(row.kind) as AgentLogKind,
    content: String(row.content),
    meta,
    createdAt: String(row.created_at),
  };
}

export function appendAgentLog(
  agentId: string,
  kind: AgentLogKind,
  content: string,
  meta?: Record<string, unknown> | null,
): AgentLog {
  const database = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const text = content.trim().slice(0, 4000);
  database
    .prepare(
      `INSERT INTO agent_logs (id, agent_id, kind, content, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, agentId, kind, text, meta ? JSON.stringify(meta) : null, now);
  // garde les 200 derniers par agent
  database
    .prepare(
      `DELETE FROM agent_logs WHERE agent_id = ? AND id NOT IN (
         SELECT id FROM agent_logs WHERE agent_id = ? ORDER BY created_at DESC LIMIT 200
       )`,
    )
    .run(agentId, agentId);
  return getAgentLog(id)!;
}

export function getAgentLog(id: string): AgentLog | null {
  const row = getDb().prepare(`SELECT * FROM agent_logs WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToLog(row) : null;
}

export function listAgentLogs(agentId: string | null, limit = 40): AgentLog[] {
  const database = getDb();
  const cap = Math.max(5, Math.min(limit, 100));
  if (agentId) {
    return database
      .prepare(`SELECT * FROM agent_logs WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?`)
      .all(agentId, cap)
      .map((r) => rowToLog(r as Record<string, unknown>));
  }
  return database
    .prepare(`SELECT * FROM agent_logs ORDER BY created_at DESC LIMIT ?`)
    .all(cap)
    .map((r) => rowToLog(r as Record<string, unknown>));
}
