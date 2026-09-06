/** Discussions agent : fil actif + archives (snapshot JSON). */
import { getDb } from "@/lib/db/sqlite";
import type { OfficeEvent } from "@/lib/office/types";

export type OfficeConversationStatus = "active" | "archived";

export type OfficeConversation = {
  id: string;
  agentId: string;
  title: string;
  status: OfficeConversationStatus;
  summary: string;
  messageCount: number;
  createdAt: string;
  archivedAt: string | null;
  meta: Record<string, unknown>;
};

export type OfficeConversationDetail = OfficeConversation & {
  events: OfficeEvent[];
};

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function parseEvents(raw: string, agentId: string): OfficeEvent[] {
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v
      .filter((e) => e && typeof e === "object")
      .map((e) => {
        const row = e as Record<string, unknown>;
        return {
          id: String(row.id ?? crypto.randomUUID()),
          agentId: String(row.agentId ?? agentId),
          kind: String(row.kind ?? "system"),
          payload:
            row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
              ? (row.payload as Record<string, unknown>)
              : {},
          createdAt: String(row.createdAt ?? new Date().toISOString()),
        } satisfies OfficeEvent;
      });
  } catch {
    return [];
  }
}

function rowToConversation(row: Record<string, unknown>): OfficeConversation {
  return {
    id: String(row.id),
    agentId: String(row.agent_id),
    title: String(row.title ?? "Discussion"),
    status: String(row.status) === "active" ? "active" : "archived",
    summary: String(row.summary ?? ""),
    messageCount: Number(row.message_count ?? 0),
    createdAt: String(row.created_at),
    archivedAt: row.archived_at == null ? null : String(row.archived_at),
    meta: parseJsonObject(String(row.meta ?? "{}")),
  };
}

export function titleFromEvents(events: OfficeEvent[]): string {
  const chronological = [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const ev of chronological) {
    if (ev.kind !== "user_message") continue;
    const text = typeof ev.payload.text === "string" ? ev.payload.text.trim() : "";
    if (text && !ev.payload.cleared) {
      return text.replace(/\s+/g, " ").slice(0, 80);
    }
  }
  for (const ev of chronological) {
    const text = typeof ev.payload.text === "string" ? ev.payload.text.trim() : "";
    if (text && ev.payload.role !== "system") {
      return text.replace(/\s+/g, " ").slice(0, 80);
    }
  }
  return `Discussion ${new Date().toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}`;
}

export function countMeaningfulMessages(events: OfficeEvent[]): number {
  return events.filter((ev) => {
    if (ev.payload.cleared === true || ev.payload.newDiscussion === true) return false;
    if (ev.kind === "user_message") return true;
    if (ev.kind === "agent_message" && ev.payload.role !== "system") return true;
    return false;
  }).length;
}

export function createOfficeConversation(input: {
  agentId: string;
  title?: string;
  status?: OfficeConversationStatus;
  summary?: string;
  events?: OfficeEvent[];
  meta?: Record<string, unknown>;
}): OfficeConversation {
  const database = getDb();
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const events = input.events ?? [];
  const status = input.status ?? "active";
  const title = (input.title?.trim() || titleFromEvents(events) || "Discussion").slice(0, 160);
  const messageCount = countMeaningfulMessages(events);
  database
    .prepare(
      `INSERT INTO office_conversations
        (id, agent_id, title, status, summary, events_json, message_count, created_at, archived_at, meta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.agentId,
      title,
      status,
      (input.summary ?? "").slice(0, 2000),
      JSON.stringify(events),
      messageCount,
      createdAt,
      status === "archived" ? createdAt : null,
      JSON.stringify(input.meta ?? {}),
    );
  return getOfficeConversation(id)!;
}

export function getOfficeConversation(id: string): OfficeConversation | null {
  const row = getDb()
    .prepare(`SELECT * FROM office_conversations WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToConversation(row) : null;
}

export function getOfficeConversationDetail(id: string): OfficeConversationDetail | null {
  const row = getDb()
    .prepare(`SELECT * FROM office_conversations WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  const base = rowToConversation(row);
  return {
    ...base,
    events: parseEvents(String(row.events_json ?? "[]"), base.agentId),
  };
}

export function listOfficeConversations(
  agentId: string,
  opts?: { status?: OfficeConversationStatus | "all"; limit?: number },
): OfficeConversation[] {
  const limit = Math.max(1, Math.min(opts?.limit ?? 40, 100));
  const status = opts?.status ?? "all";
  const database = getDb();
  const rows =
    status === "all"
      ? (database
          .prepare(
            `SELECT * FROM office_conversations WHERE agent_id = ?
             ORDER BY COALESCE(archived_at, created_at) DESC LIMIT ?`,
          )
          .all(agentId, limit) as Record<string, unknown>[])
      : (database
          .prepare(
            `SELECT * FROM office_conversations WHERE agent_id = ? AND status = ?
             ORDER BY COALESCE(archived_at, created_at) DESC LIMIT ?`,
          )
          .all(agentId, status, limit) as Record<string, unknown>[]);
  return rows.map(rowToConversation);
}

/** Archive le fil courant (snapshot) et retourne la conversation archivée, ou null si rien à garder. */
export function archiveOfficeConversationFromEvents(
  agentId: string,
  events: OfficeEvent[],
  opts?: { summary?: string },
): OfficeConversation | null {
  const meaningful = countMeaningfulMessages(events);
  if (meaningful === 0) return null;
  return createOfficeConversation({
    agentId,
    status: "archived",
    title: titleFromEvents(events),
    summary: opts?.summary ?? "",
    events,
    meta: { archivedFromLive: true },
  });
}

export function ensureActiveConversation(agentId: string): OfficeConversation {
  const existing = listOfficeConversations(agentId, { status: "active", limit: 1 })[0];
  if (existing) return existing;
  return createOfficeConversation({
    agentId,
    title: "Discussion en cours",
    status: "active",
    events: [],
  });
}

/** Supprime les placeholders « active » (le contenu live est dans office_events). */
export function closeActiveConversations(agentId: string): number {
  const info = getDb()
    .prepare(`DELETE FROM office_conversations WHERE agent_id = ? AND status = 'active'`)
    .run(agentId);
  return info.changes;
}
