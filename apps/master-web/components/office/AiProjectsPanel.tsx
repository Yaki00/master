"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

export type AiProject = {
  id: string;
  title: string;
  kind: "punctual" | "recurring";
  schedule: string | null;
  status: "draft" | "active" | "paused" | "done";
  notes: string;
  agentId: string | null;
  updatedAt: string;
};

export function AiProjectsPanel() {
  const [projects, setProjects] = useState<AiProject[]>([]);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"punctual" | "recurring">("punctual");
  const [schedule, setSchedule] = useState("");
  const [notes, setNotes] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/office/projects", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { projects?: AiProject[] };
      setProjects(json.projects ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 12_000);
    return () => clearInterval(t);
  }, [load]);

  function resetForm() {
    setTitle("");
    setKind("punctual");
    setSchedule("");
    setNotes("");
    setEditId(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      if (editId) {
        const res = await fetch("/api/office/projects", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: editId,
            title: title.trim(),
            kind,
            schedule: schedule.trim() || null,
            notes,
          }),
        });
        if (!res.ok) throw new Error("Maj impossible");
      } else {
        const res = await fetch("/api/office/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title.trim(),
            kind,
            schedule: schedule.trim() || null,
            notes,
            status: "active",
          }),
        });
        if (!res.ok) throw new Error("Création impossible");
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: string, status: AiProject["status"]) {
    await fetch("/api/office/projects", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    await load();
  }

  async function remove(id: string) {
    if (!confirm("Supprimer ce projet ?")) return;
    await fetch(`/api/office/projects?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (editId === id) resetForm();
    await load();
  }

  function startEdit(p: AiProject) {
    setEditId(p.id);
    setTitle(p.title);
    setKind(p.kind);
    setSchedule(p.schedule ?? "");
    setNotes(p.notes);
  }

  return (
    <section className="pixel-projects">
      <header className="pixel-projects-head">
        <span className="pixel-plaque">PROJETS IA</span>
        <em>{projects.filter((p) => p.status === "active").length} actifs</em>
      </header>

      <form className="pixel-projects-form" onSubmit={onSubmit}>
        <input
          className="pixel-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Titre du projet"
          maxLength={160}
        />
        <div className="pixel-projects-row">
          <select
            className="pixel-input"
            value={kind}
            onChange={(e) => setKind(e.target.value as "punctual" | "recurring")}
          >
            <option value="punctual">Ponctuel</option>
            <option value="recurring">Récurrent</option>
          </select>
          <input
            className="pixel-input"
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            placeholder={kind === "recurring" ? "Planning (ex. chaque lundi 9h)" : "Deadline / créneau"}
          />
        </div>
        <textarea
          className="pixel-input"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes / objectifs"
          rows={2}
        />
        <div className="pixel-projects-row">
          <button type="submit" className="pixel-btn blue" disabled={busy || !title.trim()}>
            {editId ? "Enregistrer" : "Ajouter"}
          </button>
          {editId && (
            <button type="button" className="pixel-btn ghost" onClick={resetForm}>
              Annuler
            </button>
          )}
        </div>
        {error && <p className="pixel-console-err">{error}</p>}
      </form>

      <ul className="pixel-projects-list">
        {projects.length === 0 ? (
          <li className="pixel-projects-empty">Aucun projet — crée une mission ponctuelle ou récurrente</li>
        ) : (
          projects.map((p) => (
            <li key={p.id} className={`pixel-project status-${p.status}`}>
              <div className="pixel-project-main">
                <strong>{p.title}</strong>
                <span>
                  {p.kind === "recurring" ? "RÉCURRENT" : "PONCTUEL"}
                  {p.schedule ? ` · ${p.schedule}` : ""}
                  {" · "}
                  {p.status}
                </span>
                {p.notes && <p>{p.notes}</p>}
              </div>
              <div className="pixel-project-actions">
                <button type="button" className="pixel-btn ghost" onClick={() => startEdit(p)}>
                  Modif
                </button>
                {p.status !== "active" && (
                  <button type="button" className="pixel-btn ghost amber" onClick={() => void setStatus(p.id, "active")}>
                    Activer
                  </button>
                )}
                {p.status === "active" && (
                  <button type="button" className="pixel-btn ghost amber" onClick={() => void setStatus(p.id, "paused")}>
                    Pause
                  </button>
                )}
                {p.status !== "done" && (
                  <button type="button" className="pixel-btn ghost" onClick={() => void setStatus(p.id, "done")}>
                    Done
                  </button>
                )}
                <button type="button" className="pixel-btn ghost red" onClick={() => void remove(p.id)}>
                  Del
                </button>
              </div>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
