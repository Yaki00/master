"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type Team = {
  id: string;
  name: string;
  leadAgentId: string | null;
  members: Array<{ agentId: string; roleInTeam: string }>;
};

type Project = {
  id: string;
  title: string;
  kind: "punctual" | "recurring";
  schedule: string | null;
  status: "draft" | "active" | "paused" | "done";
  notes: string;
  brief: string;
  goals: string;
  teamId: string | null;
  agentId: string | null;
  nextRunAt: string | null;
  priority: number;
  updatedAt: string;
};

type Task = {
  id: string;
  title: string;
  status: string;
  phase: string;
  assigneeAgentId: string | null;
};

const COLS: Array<Project["status"]> = ["draft", "active", "paused", "done"];

export function ProjectBoard({
  onContinue,
}: {
  onContinue?: (project: Project, text: string) => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [selected, setSelected] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [goals, setGoals] = useState("");
  const [kind, setKind] = useState<"punctual" | "recurring">("punctual");
  const [schedule, setSchedule] = useState("");
  const [teamId, setTeamId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [pr, tm] = await Promise.all([
        fetch("/api/office/projects", { cache: "no-store" }),
        fetch("/api/office/teams", { cache: "no-store" }),
      ]);
      if (pr.ok) {
        const j = (await pr.json()) as { projects?: Project[] };
        setProjects(j.projects ?? []);
      }
      if (tm.ok) {
        const j = (await tm.json()) as { teams?: Team[] };
        setTeams(j.teams ?? []);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 12_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!selected) {
      setTasks([]);
      return;
    }
    void (async () => {
      const res = await fetch(
        `/api/office/tasks?projectId=${encodeURIComponent(selected.id)}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const j = (await res.json()) as { tasks?: Task[] };
      setTasks(j.tasks ?? []);
    })();
  }, [selected]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/office/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          kind,
          schedule: schedule.trim() || null,
          brief,
          goals,
          teamId: teamId || null,
          status: "active",
        }),
      });
      if (!res.ok) throw new Error("Création impossible");
      setTitle("");
      setBrief("");
      setGoals("");
      setSchedule("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: string, status: Project["status"]) {
    await fetch("/api/office/projects", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    await load();
    if (selected?.id === id) {
      setSelected((p) => (p ? { ...p, status } : p));
    }
  }

  async function launchMission() {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const text =
        selected.brief ||
        selected.goals ||
        `Continuer le projet « ${selected.title} » : ${selected.notes || "avance"}`;
      const res = await fetch("/api/office/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: selected.title,
          brief: text,
          projectId: selected.id,
          teamId: selected.teamId,
          assigneeAgentId: selected.agentId || "openclaw:chef",
          launch: true,
        }),
      });
      if (!res.ok) throw new Error("Lancement impossible");
      onContinue?.(selected, text);
      await load();
      setSelected({ ...selected });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await fetch(`/api/office/projects?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (selected?.id === id) setSelected(null);
    await load();
  }

  return (
    <div className="pixel-hq-projects">
      <header className="pixel-section-head pixel-hq-projects-head">
        <strong>PROJETS</strong>
      </header>
      <form className="pixel-projects-form" onSubmit={onCreate}>
        <div className="pixel-projects-row">
          <input
            className="pixel-input"
            placeholder="Nouveau projet"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <select className="pixel-input" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="punctual">ponctuel</option>
            <option value="recurring">récurrent</option>
          </select>
          <select className="pixel-input" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">sans équipe</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button className="pixel-btn" type="submit" disabled={busy}>
            +
          </button>
        </div>
        <textarea
          className="pixel-input"
          rows={2}
          placeholder="Brief"
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
        />
        <textarea
          className="pixel-input"
          rows={2}
          placeholder="Objectifs"
          value={goals}
          onChange={(e) => setGoals(e.target.value)}
        />
        {kind === "recurring" && (
          <input
            className="pixel-input"
            placeholder="Planning (ex. chaque lundi 9h)"
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
          />
        )}
      </form>
      {error && <p className="pixel-projects-err">{error}</p>}

      <div className="pixel-project-board">
        {COLS.map((col) => (
          <div key={col} className={`pixel-project-col status-${col}`}>
            <h4>{col}</h4>
            <ul>
              {projects
                .filter((p) => p.status === col)
                .map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className={`pixel-project-card ${selected?.id === p.id ? "is-on" : ""}`}
                      onClick={() => setSelected(p)}
                    >
                      <strong>{p.title}</strong>
                      <span>
                        {p.kind}
                        {p.teamId ? " · équipe" : ""}
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>

      {selected && (
        <aside className="pixel-project-detail">
          <header>
            <strong>{selected.title}</strong>
            <span>{selected.status}</span>
          </header>
          <p>{selected.brief || selected.notes || "Pas de brief"}</p>
          {selected.goals && <p className="goals">Objectifs: {selected.goals}</p>}
          <p className="meta">
            Équipe: {teams.find((t) => t.id === selected.teamId)?.name ?? "—"}
            {selected.schedule ? ` · ${selected.schedule}` : ""}
          </p>
          <div className="pixel-project-actions">
            <button type="button" className="pixel-btn" disabled={busy} onClick={() => void launchMission()}>
              Lancer mission
            </button>
            {selected.status !== "active" && (
              <button type="button" className="pixel-btn" onClick={() => void setStatus(selected.id, "active")}>
                Activer
              </button>
            )}
            {selected.status === "active" && (
              <button type="button" className="pixel-btn" onClick={() => void setStatus(selected.id, "paused")}>
                Pause
              </button>
            )}
            <button type="button" className="pixel-btn" onClick={() => void setStatus(selected.id, "done")}>
              Done
            </button>
            <button type="button" className="pixel-btn" onClick={() => void remove(selected.id)}>
              Suppr
            </button>
          </div>
          <h5>Tâches projet</h5>
          <ul className="pixel-project-tasks">
            {tasks.map((t) => (
              <li key={t.id}>
                <em>{t.phase}</em> {t.title} · {t.status}
              </li>
            ))}
            {tasks.length === 0 && <li>—</li>}
          </ul>
        </aside>
      )}
    </div>
  );
}
