"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { OfficeAgent } from "@/lib/office/types";
import { displayName } from "@/lib/office/labels";
import { ReceptionTaskBoard, type OfficeTaskCard } from "./ReceptionTaskBoard";

export type OfficeTaskTreeCard = OfficeTaskCard & {
  parentTaskId?: string | null;
};

type PmRollup = {
  projectId: string;
  title: string;
  phase: string;
  percent: number;
  total: number;
  done: number;
  blocked: number;
  working: number;
};

type TreeNode = OfficeTaskTreeCard & { children: TreeNode[] };

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    queued: "file",
    thinking: "réflexion",
    working: "en cours",
    handoff: "passation",
    blocked: "bloqué",
    done: "terminé",
    cancelled: "annulé",
    failed: "échec",
  };
  return map[status] ?? status;
}

function buildTrees(tasks: OfficeTaskTreeCard[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const t of tasks) {
    byId.set(t.id, { ...t, children: [] });
  }
  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    const pid = node.parentTaskId ?? null;
    if (pid && byId.has(pid)) {
      byId.get(pid)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots.filter(
    (r) =>
      r.meta.orchestrationRoot === true ||
      r.meta.awaitingHumanGate === "plan" ||
      r.children.length > 0 ||
      Boolean(r.meta.planSubtaskId) === false,
  );
}

function TreeItem({
  node,
  agents,
  depth = 0,
}: {
  node: TreeNode;
  agents: OfficeAgent[];
  depth?: number;
}) {
  const agent = node.assigneeAgentId
    ? agents.find((a) => a.id === node.assigneeAgentId)
    : null;
  return (
    <li className={`pixel-pm-tree-item depth-${Math.min(depth, 3)} status-${node.status}`}>
      <div className="pixel-pm-tree-row">
        <span className={`pixel-pm-dot status-${node.status}`} aria-hidden />
        <strong>{node.title}</strong>
        <em>{statusLabel(node.status)}</em>
        {agent ? (
          <small>{displayName(agent)}</small>
        ) : node.assigneeAgentId ? (
          <small>{node.assigneeAgentId.replace(/^openclaw:/, "")}</small>
        ) : null}
      </div>
      {node.children.length > 0 ? (
        <ul className="pixel-pm-tree-children">
          {node.children.map((c) => (
            <TreeItem key={c.id} node={c} agents={agents} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function computeRollups(
  projects: Array<{ id: string; title: string; meta?: Record<string, unknown> }>,
  tasks: OfficeTaskTreeCard[],
): PmRollup[] {
  const out: PmRollup[] = [];
  for (const p of projects) {
    const orch = p.meta?.orchestration as Record<string, unknown> | undefined;
    if (!orch || typeof orch !== "object") continue;
    const phase = String(orch.phase ?? "");
    if (!phase || phase === "cancelled") continue;
    const leafs = tasks.filter((t) => t.projectId === p.id && t.parentTaskId);
    const total = leafs.length;
    const done = leafs.filter((t) => t.status === "done").length;
    const blocked = leafs.filter((t) => t.status === "blocked").length;
    const working = leafs.filter((t) =>
      ["working", "thinking", "handoff", "queued"].includes(t.status),
    ).length;
    const percent =
      phase === "delivered"
        ? 100
        : total > 0
          ? Math.round((done / total) * 100)
          : phase === "awaiting_plan_approval"
            ? 5
            : 0;
    out.push({
      projectId: p.id,
      title: p.title,
      phase,
      percent,
      total,
      done,
      blocked,
      working,
    });
  }
  return out;
}

export function PmOrchestrationBoard({ agents = [] }: { agents?: OfficeAgent[] }) {
  const [tasks, setTasks] = useState<OfficeTaskTreeCard[]>([]);
  const [rollups, setRollups] = useState<PmRollup[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [tasksRes, projectsRes] = await Promise.all([
        fetch("/api/office/tasks?status=all", { cache: "no-store" }),
        fetch("/api/office/projects", { cache: "no-store" }),
      ]);
      let nextTasks: OfficeTaskTreeCard[] = [];
      if (tasksRes.ok) {
        const json = (await tasksRes.json()) as { tasks?: OfficeTaskTreeCard[] };
        nextTasks = json.tasks ?? [];
        setTasks(nextTasks);
      }
      if (projectsRes.ok) {
        const json = (await projectsRes.json()) as {
          projects?: Array<{ id: string; title: string; meta?: Record<string, unknown> }>;
        };
        setRollups(computeRollups(json.projects ?? [], nextTasks));
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [load]);

  const trees = useMemo(() => {
    const pmTasks = tasks.filter(
      (t) =>
        t.meta.orchestrationRoot === true ||
        Boolean(t.parentTaskId) ||
        Boolean(t.meta.planSubtaskId) ||
        typeof t.meta.awaitingHumanGate === "string",
    );
    if (pmTasks.length === 0) return [];
    return buildTrees(pmTasks);
  }, [tasks]);

  return (
    <div className="pixel-pm-orchestration">
      <header className="pixel-pipeline-head">
        <h2>Pipeline tâches</h2>
        <p>Réunion → Plan → Décision → Exécution · orchestration PM</p>
      </header>

      {loading ? <p className="pixel-task-board-loading">Chargement orchestration…</p> : null}

      {rollups.length > 0 ? (
        <section className="pixel-pm-rollups" aria-label="Projets PM">
          {rollups.map((r) => (
            <article key={r.projectId} className="pixel-pm-rollup-card">
              <header>
                <strong>{r.title}</strong>
                <em>{r.phase}</em>
              </header>
              <div className="pixel-task-progress" aria-label={`${r.percent}%`}>
                <span className="pixel-task-progress-fill" style={{ width: `${r.percent}%` }} />
              </div>
              <p>
                {r.done}/{r.total || "—"} terminées
                {r.working > 0 ? ` · ${r.working} en cours` : ""}
                {r.blocked > 0 ? ` · ${r.blocked} bloquée${r.blocked > 1 ? "s" : ""}` : ""}
                {" · "}
                {r.percent}%
              </p>
            </article>
          ))}
        </section>
      ) : null}

      {trees.length > 0 ? (
        <section className="pixel-pm-trees" aria-label="Arbre tâches PM">
          <h3>Arbre d&apos;orchestration</h3>
          <ul className="pixel-pm-tree-roots">
            {trees.map((n) => (
              <TreeItem key={n.id} node={n} agents={agents} />
            ))}
          </ul>
        </section>
      ) : null}

      <ReceptionTaskBoard agents={agents} />
    </div>
  );
}
