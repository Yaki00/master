"use client";

import { useCallback, useEffect, useState } from "react";

export type TaskStripItem = {
  id: string;
  title: string;
  status: string;
  phase: string;
  assigneeAgentId: string | null;
};

const PHASE_LABEL: Record<string, string> = {
  meeting: "Réunion",
  plan: "Plan",
  decision: "Décision",
  execution: "Exécution",
};

const STATUS_DOT: Record<string, string> = {
  thinking: "thinking",
  working: "working",
  handoff: "handoff",
  blocked: "blocked",
  queued: "queued",
};

export function TaskStrip() {
  const [tasks, setTasks] = useState<TaskStripItem[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/office/tasks?status=active", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { tasks?: TaskStripItem[] };
      setTasks((json.tasks ?? []).slice(0, 8));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className={`pixel-task-strip ${tasks.length === 0 ? "is-empty" : ""}`} aria-label="Tâches en cours">
      <span className="pixel-task-strip-label">Tâches</span>
      <div className="pixel-task-strip-track">
        {tasks.length === 0 ? (
          <span className="pixel-task-strip-empty">Aucune tâche active</span>
        ) : (
          tasks.map((t) => (
            <span
              key={t.id}
              className={`pixel-task-chip status-${t.status} phase-${t.phase}`}
              title={t.title}
            >
              <span className={`pixel-task-dot ${STATUS_DOT[t.status] ?? "queued"}`} aria-hidden />
              <em>{PHASE_LABEL[t.phase] ?? t.phase}</em>
              <strong>{t.title.slice(0, 40)}{t.title.length > 40 ? "…" : ""}</strong>
              {t.assigneeAgentId ? (
                <small>{t.assigneeAgentId.replace(/^openclaw:/, "")}</small>
              ) : null}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
