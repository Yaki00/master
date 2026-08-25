"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { OfficeAgent } from "@/lib/office/types";
import { displayName } from "@/lib/office/labels";
import { PixelSprite } from "./PixelSprite";

export type OfficeTaskCard = {
  id: string;
  title: string;
  brief: string;
  status: string;
  phase: string;
  assigneeAgentId: string | null;
  projectId: string | null;
  teamId: string | null;
  parentTaskId?: string | null;
  updatedAt: string;
  resultSummary: string | null;
  meta: Record<string, unknown>;
};

export type TaskEvent = {
  id: string;
  kind: string;
  fromAgent: string | null;
  toAgent: string | null;
  text: string;
  createdAt: string;
};

const PHASES = [
  { id: "meeting", label: "Réunion", emoji: "🗣️" },
  { id: "plan", label: "Plan", emoji: "📋" },
  { id: "decision", label: "Décision", emoji: "⚖️" },
  { id: "execution", label: "Exécution", emoji: "⚡" },
] as const;

const PHASE_BASE: Record<string, number> = {
  meeting: 12,
  plan: 32,
  decision: 52,
  execution: 72,
};

const STATUS_BONUS: Record<string, number> = {
  queued: 0,
  thinking: 6,
  working: 18,
  handoff: 10,
  blocked: 0,
  done: 100,
};

function ageLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  if (ms < 3600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3600_000)}h`;
}

function taskProgress(task: OfficeTaskCard): number {
  const metaPct = task.meta.progress;
  if (typeof metaPct === "number" && metaPct >= 0 && metaPct <= 100) return metaPct;
  const base = PHASE_BASE[task.phase] ?? 40;
  const bonus = STATUS_BONUS[task.status] ?? 0;
  return Math.min(100, base + bonus);
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    queued: "file",
    thinking: "réflexion",
    working: "en cours",
    handoff: "passation",
    blocked: "bloqué",
    done: "terminé",
  };
  return map[status] ?? status;
}

export function ReceptionTaskBoard({
  agents = [],
  selectedTaskId,
  onSelectTask,
}: {
  agents?: OfficeAgent[];
  selectedTaskId?: string | null;
  onSelectTask?: (id: string | null) => void;
}) {
  const [tasks, setTasks] = useState<OfficeTaskCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [events, setEvents] = useState<TaskEvent[]>([]);

  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/office/tasks?status=active", { cache: "no-store" });
      if (!res.ok) {
        setLoadError("Impossible de charger les tâches");
        return;
      }
      setLoadError("");
      const json = (await res.json()) as { tasks?: OfficeTaskCard[] };
      setTasks(json.tasks ?? []);
    } catch {
      setLoadError("Réseau indisponible — tâches non chargées");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const id = detailId || selectedTaskId;
    if (!id) {
      setEvents([]);
      return;
    }
    void (async () => {
      try {
        const res = await fetch(`/api/office/tasks?id=${encodeURIComponent(id)}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = (await res.json()) as { events?: TaskEvent[] };
        setEvents(json.events ?? []);
      } catch {
        /* ignore */
      }
    })();
  }, [detailId, selectedTaskId, tasks]);

  const byPhase = useMemo(() => {
    const map: Record<string, OfficeTaskCard[]> = {
      meeting: [],
      plan: [],
      decision: [],
      execution: [],
    };
    for (const t of tasks) {
      const p = PHASES.some((x) => x.id === t.phase) ? t.phase : "execution";
      map[p] = map[p] ?? [];
      map[p]!.push(t);
    }
    return map;
  }, [tasks]);

  const activeDetail = detailId || selectedTaskId;
  const isEmpty = tasks.length === 0;

  return (
    <section className="pixel-task-board pixel-reception-board">
      <header className="pixel-reception-head">
        <strong>RÉCEPTION · TÂCHES</strong>
        <em>{tasks.length} active{tasks.length !== 1 ? "s" : ""}</em>
      </header>

      {loading && (
        <p className="pixel-task-board-loading" role="status">
          <span className="pixel-logs-pulse" aria-hidden />
          Chargement des tâches…
        </p>
      )}

      {loadError && !loading && (
        <p className="pixel-task-board-err" role="alert">{loadError}</p>
      )}

      {isEmpty && !loading && (
        <div className="pixel-task-board-empty">
          <span className="pixel-task-empty-icon" aria-hidden>
            📋
          </span>
          <strong>Aucune tâche active</strong>
          <p className="pixel-task-empty-lead">
            Parle à la Réception via la console pour lancer une mission.
          </p>
          <ul className="pixel-task-empty-examples">
            <li>
              <code>@chef lance une réunion sur …</code>
            </li>
            <li>
              <code>@all brief du projet X</code>
            </li>
          </ul>
          <p className="pixel-task-empty-cta">
            Ouvre la console en bas → tape ton message → Entrée
          </p>
        </div>
      )}

      {!isEmpty && !loading && (
        <p className="pixel-task-select-hint" aria-hidden>
          Clique une carte pour voir sa timeline · glisse pour parcourir les lanes
        </p>
      )}

      <div className="pixel-reception-lanes">
        {PHASES.map((ph) => (
          <div key={ph.id} className={`pixel-reception-lane phase-${ph.id}`}>
            <h4>
              <span className="pixel-lane-emoji" aria-hidden>{ph.emoji}</span>
              {ph.label}
              <span className="pixel-lane-count">{(byPhase[ph.id] ?? []).length}</span>
            </h4>
            <ul>
              {(byPhase[ph.id] ?? []).map((t) => {
                const assignee = t.assigneeAgentId ? agentById.get(t.assigneeAgentId) : null;
                const pct = taskProgress(t);
                const phaseInfo = PHASES.find((p) => p.id === t.phase);
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      className={`pixel-task-card status-${t.status} ${activeDetail === t.id ? "is-on" : ""}`}
                      onClick={() => {
                        setDetailId(t.id);
                        onSelectTask?.(t.id);
                      }}
                    >
                      <div className="pixel-task-card-top">
                        <span className={`pixel-task-phase-badge phase-${t.phase}`}>
                          {phaseInfo?.label ?? t.phase}
                        </span>
                        {assignee ? (
                          <span className="pixel-task-avatar" title={displayName(assignee)}>
                            <PixelSprite
                              agent={assignee}
                              pose={assignee.status === "working" ? "work" : "stand"}
                              size={22}
                              motion="frozen"
                            />
                          </span>
                        ) : (
                          <span className="pixel-task-avatar is-empty" title="Non assigné">?</span>
                        )}
                      </div>
                      <span className="pixel-task-title">{t.title}</span>
                      <div className="pixel-task-progress" aria-hidden>
                        <span className="pixel-task-progress-fill" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="pixel-task-meta">
                        {statusLabel(t.status)} · {ageLabel(t.updatedAt)}
                        {assignee ? ` · ${displayName(assignee)}` : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
              {(byPhase[ph.id] ?? []).length === 0 && !isEmpty && (
                <li className="pixel-task-empty">—</li>
              )}
            </ul>
          </div>
        ))}
      </div>

      {activeDetail && (
        <div className="pixel-reception-timeline">
          <header className="pixel-section-head">
            <strong>Timeline</strong>
            <button type="button" className="pixel-btn" onClick={() => setDetailId(null)}>
              fermer
            </button>
          </header>
          <ol>
            {events.map((e) => (
              <li key={e.id}>
                <time>{e.createdAt.slice(11, 19)}</time>
                <span className="kind">{e.kind}</span>
                {e.fromAgent && <span className="from">{e.fromAgent.replace(/^openclaw:/, "")}</span>}
                {e.toAgent && <span className="to">→ {e.toAgent.replace(/^openclaw:/, "")}</span>}
                <p>{e.text}</p>
              </li>
            ))}
            {events.length === 0 && <li className="pixel-task-empty">Pas d&apos;événements</li>}
          </ol>
        </div>
      )}
    </section>
  );
}
