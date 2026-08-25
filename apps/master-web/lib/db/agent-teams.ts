import { getDb } from "./sqlite";

export type TeamMemberRole = "lead" | "mgr" | "worker" | "specialist";

export type AgentTeamMember = {
  teamId: string;
  agentId: string;
  roleInTeam: TeamMemberRole;
  sortOrder: number;
};

export type AgentTeam = {
  id: string;
  name: string;
  leadAgentId: string | null;
  notes: string;
  members: AgentTeamMember[];
  createdAt: string;
  updatedAt: string;
};

const ROLES = new Set<TeamMemberRole>(["lead", "mgr", "worker", "specialist"]);

function parseRole(v: unknown): TeamMemberRole {
  const s = String(v ?? "worker");
  return ROLES.has(s as TeamMemberRole) ? (s as TeamMemberRole) : "worker";
}

function listMembers(teamId: string): AgentTeamMember[] {
  return getDb()
    .prepare(
      `SELECT team_id, agent_id, role_in_team, sort_order FROM agent_team_members
       WHERE team_id = ? ORDER BY sort_order ASC, agent_id ASC`,
    )
    .all(teamId)
    .map((r) => {
      const row = r as Record<string, unknown>;
      return {
        teamId: String(row.team_id),
        agentId: String(row.agent_id),
        roleInTeam: parseRole(row.role_in_team),
        sortOrder: Number(row.sort_order ?? 0),
      };
    });
}

function rowToTeam(row: Record<string, unknown>): AgentTeam {
  const id = String(row.id);
  return {
    id,
    name: String(row.name),
    leadAgentId: row.lead_agent_id != null ? String(row.lead_agent_id) : null,
    notes: String(row.notes ?? ""),
    members: listMembers(id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function listAgentTeams(): AgentTeam[] {
  return getDb()
    .prepare(`SELECT * FROM agent_teams ORDER BY updated_at DESC`)
    .all()
    .map((r) => rowToTeam(r as Record<string, unknown>));
}

export function getAgentTeam(id: string): AgentTeam | null {
  const row = getDb().prepare(`SELECT * FROM agent_teams WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToTeam(row) : null;
}

export function createAgentTeam(input: {
  name: string;
  leadAgentId?: string | null;
  notes?: string;
  members?: Array<{ agentId: string; roleInTeam?: TeamMemberRole; sortOrder?: number }>;
}): AgentTeam {
  const database = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const name = input.name.trim().slice(0, 120) || "Équipe";
  const lead = input.leadAgentId?.trim() || null;
  database
    .prepare(
      `INSERT INTO agent_teams (id, name, lead_agent_id, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, name, lead, (input.notes ?? "").trim().slice(0, 4000), now, now);

  const members = input.members ?? [];
  if (lead && !members.some((m) => m.agentId === lead)) {
    members.unshift({ agentId: lead, roleInTeam: "lead", sortOrder: 0 });
  }
  const insert = database.prepare(
    `INSERT OR REPLACE INTO agent_team_members (team_id, agent_id, role_in_team, sort_order)
     VALUES (?, ?, ?, ?)`,
  );
  members.forEach((m, i) => {
    insert.run(id, m.agentId, parseRole(m.roleInTeam ?? (m.agentId === lead ? "lead" : "worker")), m.sortOrder ?? i);
  });
  return getAgentTeam(id)!;
}

export function updateAgentTeam(
  id: string,
  patch: Partial<{
    name: string;
    leadAgentId: string | null;
    notes: string;
    members: Array<{ agentId: string; roleInTeam?: TeamMemberRole; sortOrder?: number }>;
  }>,
): AgentTeam | null {
  const current = getAgentTeam(id);
  if (!current) return null;
  const now = new Date().toISOString();
  const name = patch.name != null ? patch.name.trim().slice(0, 120) : current.name;
  const lead = patch.leadAgentId !== undefined ? patch.leadAgentId : current.leadAgentId;
  const notes = patch.notes != null ? patch.notes.trim().slice(0, 4000) : current.notes;
  const database = getDb();
  database
    .prepare(
      `UPDATE agent_teams SET name = ?, lead_agent_id = ?, notes = ?, updated_at = ? WHERE id = ?`,
    )
    .run(name, lead, notes, now, id);

  if (patch.members) {
    database.prepare(`DELETE FROM agent_team_members WHERE team_id = ?`).run(id);
    const insert = database.prepare(
      `INSERT INTO agent_team_members (team_id, agent_id, role_in_team, sort_order) VALUES (?, ?, ?, ?)`,
    );
    patch.members.forEach((m, i) => {
      insert.run(id, m.agentId, parseRole(m.roleInTeam ?? "worker"), m.sortOrder ?? i);
    });
  }
  return getAgentTeam(id);
}

export function deleteAgentTeam(id: string): boolean {
  const database = getDb();
  database.prepare(`DELETE FROM agent_team_members WHERE team_id = ?`).run(id);
  const r = database.prepare(`DELETE FROM agent_teams WHERE id = ?`).run(id);
  return r.changes > 0;
}

/** Chaîne de remise : assignee → mgr(s) → lead → user */
export function resolveHandoffChain(
  teamId: string | null | undefined,
  assigneeAgentId: string,
): string[] {
  const chain: string[] = [];
  const team = teamId ? getAgentTeam(teamId) : null;
  if (!team) {
    return ["user"];
  }
  const assignee = team.members.find((m) => m.agentId === assigneeAgentId);
  const role = assignee?.roleInTeam ?? "worker";

  if (role === "worker" || role === "specialist") {
    const mgrs = team.members
      .filter((m) => m.roleInTeam === "mgr")
      .sort((a, b) => a.sortOrder - b.sortOrder);
    for (const m of mgrs) {
      if (m.agentId !== assigneeAgentId) chain.push(m.agentId);
    }
  }
  if (role !== "lead" && team.leadAgentId && team.leadAgentId !== assigneeAgentId) {
    if (!chain.includes(team.leadAgentId)) chain.push(team.leadAgentId);
  }
  chain.push("user");
  return chain;
}
