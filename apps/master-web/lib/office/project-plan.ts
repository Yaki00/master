/** Contrat plan PM — validation déterministe (pas de Zod). */

export type TeamProposalRole = "lead" | "mgr" | "worker" | "specialist";

export type PlanSubtaskKind = "research" | "code" | "review" | "ops" | "human";

export type PlanGateType = "human_approval" | "human_input";

export type TeamProposalMember = {
  agentId: string;
  role: TeamProposalRole;
  rationale: string;
};

export type PlanSubtask = {
  id: string;
  title: string;
  assigneeAgentId: string;
  dependsOn: string[];
  kind: PlanSubtaskKind;
  acceptance: string;
};

export type PlanGate = {
  afterSubtaskIds: string[];
  type: PlanGateType;
  prompt: string;
};

export type ProjectPlan = {
  version: 1;
  title: string;
  brief: string;
  acceptanceCriteria: string[];
  teamProposal: TeamProposalMember[];
  subtasks: PlanSubtask[];
  gates: PlanGate[];
};

const ROLES = new Set<TeamProposalRole>(["lead", "mgr", "worker", "specialist"]);
const KINDS = new Set<PlanSubtaskKind>(["research", "code", "review", "ops", "human"]);
const GATES = new Set<PlanGateType>(["human_approval", "human_input"]);

const SHORT_TO_OPENCLAW: Record<string, string> = {
  office: "openclaw:office",
  chef: "openclaw:chef",
  "mgr-dev": "openclaw:mgr-dev",
  "mgr-lab": "openclaw:mgr-lab",
  main: "openclaw:main",
  réception: "openclaw:office",
  reception: "openclaw:office",
};

export function normalizeAgentId(id: string): string {
  const raw = id.trim();
  if (!raw) return raw;
  if (raw.startsWith("openclaw:")) return raw;
  const lower = raw.toLowerCase();
  return SHORT_TO_OPENCLAW[lower] ?? (raw.includes(":") ? raw : `openclaw:${raw}`);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function hasCycle(subtasks: PlanSubtask[]): boolean {
  const byId = new Map(subtasks.map((s) => [s.id, s]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function dfs(id: string): boolean {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const node = byId.get(id);
    for (const dep of node?.dependsOn ?? []) {
      if (dfs(dep)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  }

  for (const s of subtasks) {
    if (dfs(s.id)) return true;
  }
  return false;
}

export function validateProjectPlan(
  raw: unknown,
): { ok: true; plan: ProjectPlan } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["plan doit être un objet"] };
  }
  const o = raw as Record<string, unknown>;
  if (o.version !== 1) errors.push("version doit être 1");

  const title = typeof o.title === "string" ? o.title.trim() : "";
  const brief = typeof o.brief === "string" ? o.brief.trim() : "";
  if (!title) errors.push("title requis");
  if (!brief) errors.push("brief requis");

  if (!isStringArray(o.acceptanceCriteria) || o.acceptanceCriteria.length === 0) {
    errors.push("acceptanceCriteria: tableau non vide requis");
  }

  if (!Array.isArray(o.teamProposal) || o.teamProposal.length === 0) {
    errors.push("teamProposal: tableau non vide requis");
  }

  const teamProposal: TeamProposalMember[] = [];
  if (Array.isArray(o.teamProposal)) {
    o.teamProposal.forEach((m, i) => {
      if (!m || typeof m !== "object") {
        errors.push(`teamProposal[${i}] invalide`);
        return;
      }
      const row = m as Record<string, unknown>;
      const agentId = normalizeAgentId(String(row.agentId ?? ""));
      const role = String(row.role ?? "") as TeamProposalRole;
      if (!agentId) errors.push(`teamProposal[${i}].agentId requis`);
      if (!ROLES.has(role)) errors.push(`teamProposal[${i}].role invalide`);
      teamProposal.push({
        agentId,
        role: ROLES.has(role) ? role : "worker",
        rationale: String(row.rationale ?? "").slice(0, 400),
      });
    });
  }

  if (!Array.isArray(o.subtasks) || o.subtasks.length === 0) {
    errors.push("subtasks: tableau non vide requis");
  }

  const subtasks: PlanSubtask[] = [];
  const ids = new Set<string>();
  if (Array.isArray(o.subtasks)) {
    o.subtasks.forEach((s, i) => {
      if (!s || typeof s !== "object") {
        errors.push(`subtasks[${i}] invalide`);
        return;
      }
      const row = s as Record<string, unknown>;
      const id = String(row.id ?? "").trim();
      const kind = String(row.kind ?? "") as PlanSubtaskKind;
      if (!id) errors.push(`subtasks[${i}].id requis`);
      if (ids.has(id)) errors.push(`subtasks id dupliqué: ${id}`);
      ids.add(id);
      if (!KINDS.has(kind)) errors.push(`subtasks[${i}].kind invalide`);
      const dependsOn = isStringArray(row.dependsOn) ? row.dependsOn.map((d) => d.trim()) : [];
      subtasks.push({
        id,
        title: String(row.title ?? "").trim().slice(0, 200) || id,
        assigneeAgentId: normalizeAgentId(String(row.assigneeAgentId ?? "")),
        dependsOn,
        kind: KINDS.has(kind) ? kind : "ops",
        acceptance: String(row.acceptance ?? "").slice(0, 500),
      });
      if (!subtasks[subtasks.length - 1]!.assigneeAgentId) {
        errors.push(`subtasks[${i}].assigneeAgentId requis`);
      }
    });
  }

  for (const s of subtasks) {
    for (const dep of s.dependsOn) {
      if (!ids.has(dep)) errors.push(`dependsOn inconnu: ${dep} (depuis ${s.id})`);
    }
  }
  if (subtasks.length > 0 && hasCycle(subtasks)) {
    errors.push("cycle détecté dans dependsOn");
  }

  const gates: PlanGate[] = [];
  if (o.gates !== undefined && !Array.isArray(o.gates)) {
    errors.push("gates doit être un tableau");
  }
  if (Array.isArray(o.gates)) {
    o.gates.forEach((g, i) => {
      if (!g || typeof g !== "object") {
        errors.push(`gates[${i}] invalide`);
        return;
      }
      const row = g as Record<string, unknown>;
      const type = String(row.type ?? "") as PlanGateType;
      if (!GATES.has(type)) errors.push(`gates[${i}].type invalide`);
      const after = isStringArray(row.afterSubtaskIds) ? row.afterSubtaskIds : [];
      for (const a of after) {
        if (!ids.has(a)) errors.push(`gates[${i}] afterSubtaskIds inconnu: ${a}`);
      }
      gates.push({
        afterSubtaskIds: after,
        type: GATES.has(type) ? type : "human_approval",
        prompt: String(row.prompt ?? "").slice(0, 500),
      });
    });
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    plan: {
      version: 1,
      title,
      brief,
      acceptanceCriteria: (o.acceptanceCriteria as string[]).map((c) => c.trim()).filter(Boolean),
      teamProposal,
      subtasks,
      gates,
    },
  };
}

/** Extrait un objet JSON d’un texte agent (fence ```json ou premier {…}). */
export function parsePlanFromAgentText(text: string): unknown | null {
  const raw = text.trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

/**
 * Plan déterministe sans LLM — base fiable pour tests et MVP.
 * DAG: research ∥ (puis) code → review ; gate humaine après review.
 */
export function buildDeterministicPlanFromBrief(brief: string, title?: string): ProjectPlan {
  const t = (title?.trim() || brief.trim().slice(0, 80) || "Projet").slice(0, 120);
  const b = brief.trim().slice(0, 4000) || t;
  const plan: ProjectPlan = {
    version: 1,
    title: t,
    brief: b,
    acceptanceCriteria: [
      "Sous-tâches research et code livrées",
      "Revue lead validée",
      "Synthèse remise à l'humain",
    ],
    teamProposal: [
      {
        agentId: "openclaw:chef",
        role: "lead",
        rationale: "Pilotage et synthèse",
      },
      {
        agentId: "openclaw:mgr-lab",
        role: "mgr",
        rationale: "Recherche / veille",
      },
      {
        agentId: "openclaw:mgr-dev",
        role: "mgr",
        rationale: "Implémentation / connecteurs",
      },
      {
        agentId: "openclaw:main",
        role: "worker",
        rationale: "Exécution technique",
      },
    ],
    subtasks: [
      {
        id: "research",
        title: "Recherche & cadrage",
        assigneeAgentId: "openclaw:mgr-lab",
        dependsOn: [],
        kind: "research",
        acceptance: "Brief analysé + sources / contraintes listées",
      },
      {
        id: "build",
        title: "Implémentation / ops",
        assigneeAgentId: "openclaw:mgr-dev",
        dependsOn: [],
        kind: "code",
        acceptance: "Livrable technique ou stub opérationnel",
      },
      {
        id: "review",
        title: "Revue & synthèse",
        assigneeAgentId: "openclaw:chef",
        dependsOn: ["research", "build"],
        kind: "review",
        acceptance: "Synthèse validée pour livraison",
      },
    ],
    gates: [
      {
        afterSubtaskIds: ["review"],
        type: "human_approval",
        prompt: "Valider la livraison du projet ?",
      },
    ],
  };
  const v = validateProjectPlan(plan);
  if (!v.ok) {
    throw new Error(`plan déterministe invalide: ${v.errors.join("; ")}`);
  }
  return v.plan;
}

export function formatPlanSummaryForHuman(plan: ProjectPlan): string {
  const lines = [
    `Plan proposé · « ${plan.title} »`,
    "",
    `Brief: ${plan.brief.slice(0, 280)}`,
    "",
    "Équipe:",
    ...plan.teamProposal.map(
      (m) => `· ${m.role} ${m.agentId.replace(/^openclaw:/, "")} — ${m.rationale}`,
    ),
    "",
    "Sous-tâches:",
    ...plan.subtasks.map((s) => {
      const deps = s.dependsOn.length ? ` (après ${s.dependsOn.join(", ")})` : " (parallèle)";
      return `· [${s.id}] ${s.title} → ${s.assigneeAgentId.replace(/^openclaw:/, "")}${deps}`;
    }),
    "",
    "Réponds « ok go » pour approuver, « révision » + note, ou « rejette ».",
  ];
  return lines.join("\n");
}
