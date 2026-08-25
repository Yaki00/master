"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type Project = {
  id: string;
  title: string;
  kind: "punctual" | "recurring";
  schedule: string | null;
  status: "draft" | "active" | "paused" | "done";
  notes: string;
  brief: string;
  goals: string;
  updatedAt: string;
};

export function ProjectsLibraryModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [edit, setEdit] = useState<Project | null>(null);
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [notes, setNotes] = useState("");
  const [kind, setKind] = useState<"punctual" | "recurring">("punctual");
  const [schedule, setSchedule] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/office/projects", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { projects?: Project[] };
      setProjects((json.projects ?? []).filter((p) => p.status !== "done"));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void load();
    const t = setInterval(() => void load(), 8_000);
    return () => clearInterval(t);
  }, [open, load]);

  useEffect(() => {
    if (!edit) {
      setTitle("");
      setBrief("");
      setNotes("");
      setKind("punctual");
      setSchedule("");
      return;
    }
    setTitle(edit.title);
    setBrief(edit.brief || "");
    setNotes(edit.notes || "");
    setKind(edit.kind);
    setSchedule(edit.schedule || "");
  }, [edit]);

  if (!open) return null;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      if (edit) {
        const res = await fetch("/api/office/projects", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: edit.id,
            title: title.trim(),
            brief,
            notes,
            kind,
            schedule: schedule.trim() || null,
          }),
        });
        if (!res.ok) throw new Error("Maj impossible");
      } else {
        const res = await fetch("/api/office/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title.trim(),
            brief,
            notes,
            kind,
            schedule: schedule.trim() || null,
            status: "active",
          }),
        });
        if (!res.ok) throw new Error("Création impossible");
      }
      setEdit(null);
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
  }

  async function remove(id: string) {
    await fetch(`/api/office/projects?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (edit?.id === id) setEdit(null);
    await load();
  }

  return (
    <div className="pixel-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="pixel-modal pixel-library-modal"
        role="dialog"
        aria-label="Bibliothèque projets"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="pixel-modal-head">
          <strong>BIBLIOTHÈQUE · PROJETS</strong>
          <button type="button" className="pixel-btn" onClick={onClose}>
            Fermer
          </button>
        </header>
        <p className="pixel-modal-hint">
          Dis à un agent : « Crée un projet Scan GPU » · « Mets le projet X en pause »
        </p>
        {error && <p className="pixel-projects-err">{error}</p>}
        <div className="pixel-library-body">
          <ul className="pixel-library-list">
            {projects.map((p) => (
              <li key={p.id} className={`status-${p.status}`}>
                <button type="button" onClick={() => setEdit(p)}>
                  <strong>{p.title}</strong>
                  <span>
                    {p.status} · {p.kind}
                    {p.schedule ? ` · ${p.schedule}` : ""}
                  </span>
                </button>
                <div className="pixel-project-actions">
                  {p.status === "active" && (
                    <button type="button" className="pixel-btn" onClick={() => void setStatus(p.id, "paused")}>
                      Pause
                    </button>
                  )}
                  {p.status !== "active" && (
                    <button type="button" className="pixel-btn" onClick={() => void setStatus(p.id, "active")}>
                      Actif
                    </button>
                  )}
                  <button type="button" className="pixel-btn" onClick={() => void setStatus(p.id, "done")}>
                    Done
                  </button>
                  <button type="button" className="pixel-btn" onClick={() => void remove(p.id)}>
                    Suppr
                  </button>
                </div>
              </li>
            ))}
            {projects.length === 0 && <li className="pixel-projects-empty">Aucun projet en cours</li>}
          </ul>
          <form className="pixel-library-form" onSubmit={save}>
            <h4>{edit ? "Modifier" : "Nouveau"}</h4>
            <input
              className="pixel-input"
              placeholder="Titre"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <select
              className="pixel-input"
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
            >
              <option value="punctual">ponctuel</option>
              <option value="recurring">récurrent</option>
            </select>
            {kind === "recurring" && (
              <input
                className="pixel-input"
                placeholder="Planning"
                value={schedule}
                onChange={(e) => setSchedule(e.target.value)}
              />
            )}
            <textarea
              className="pixel-input"
              rows={3}
              placeholder="Brief"
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
            />
            <textarea
              className="pixel-input"
              rows={2}
              placeholder="Notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <div className="pixel-projects-row">
              <button className="pixel-btn" type="submit" disabled={busy}>
                {edit ? "Sauver" : "Créer"}
              </button>
              {edit && (
                <button
                  className="pixel-btn"
                  type="button"
                  onClick={() => setEdit(null)}
                >
                  Nouveau
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
