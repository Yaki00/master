import { getDb } from "./sqlite";

export type AgentProfile = {
  agentId: string;
  displayName: string | null;
  persona: string;
  preferredRoom: string | null;
  tags: string[];
  active: boolean;
  updatedAt: string;
};

function parseTags(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (Array.isArray(v)) return v.map(String).slice(0, 20);
  } catch {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 20);
  }
  return [];
}

function rowToProfile(row: Record<string, unknown>): AgentProfile {
  return {
    agentId: String(row.agent_id),
    displayName: row.display_name != null ? String(row.display_name) : null,
    persona: String(row.persona ?? ""),
    preferredRoom: row.preferred_room != null ? String(row.preferred_room) : null,
    tags: parseTags(row.tags),
    active: Boolean(row.active),
    updatedAt: String(row.updated_at),
  };
}

export function listAgentProfiles(): AgentProfile[] {
  return getDb()
    .prepare(`SELECT * FROM agent_profiles ORDER BY updated_at DESC`)
    .all()
    .map((r) => rowToProfile(r as Record<string, unknown>));
}

export function getAgentProfile(agentId: string): AgentProfile | null {
  const row = getDb().prepare(`SELECT * FROM agent_profiles WHERE agent_id = ?`).get(agentId) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToProfile(row) : null;
}

export function upsertAgentProfile(input: {
  agentId: string;
  displayName?: string | null;
  persona?: string;
  preferredRoom?: string | null;
  tags?: string[];
  active?: boolean;
}): AgentProfile {
  const current = getAgentProfile(input.agentId);
  const now = new Date().toISOString();
  const displayName =
    input.displayName !== undefined
      ? input.displayName?.trim().slice(0, 80) || null
      : (current?.displayName ?? null);
  const persona =
    input.persona !== undefined
      ? input.persona.trim().slice(0, 2000)
      : (current?.persona ?? "");
  const preferredRoom =
    input.preferredRoom !== undefined
      ? input.preferredRoom?.trim().slice(0, 40) || null
      : (current?.preferredRoom ?? null);
  const tags = input.tags ?? current?.tags ?? [];
  const active = input.active ?? current?.active ?? true;

  getDb()
    .prepare(
      `INSERT INTO agent_profiles (agent_id, display_name, persona, preferred_room, tags, active, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(agent_id) DO UPDATE SET
         display_name = excluded.display_name,
         persona = excluded.persona,
         preferred_room = excluded.preferred_room,
         tags = excluded.tags,
         active = excluded.active,
         updated_at = excluded.updated_at`,
    )
    .run(
      input.agentId,
      displayName,
      persona,
      preferredRoom,
      JSON.stringify(tags.slice(0, 20)),
      active ? 1 : 0,
      now,
    );
  return getAgentProfile(input.agentId)!;
}
