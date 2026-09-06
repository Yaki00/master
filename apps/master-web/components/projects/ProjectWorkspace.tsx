"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { eventsToBubbles } from "@/lib/office/chat";
import type { OfficeEvent } from "@/lib/office/types";

type AiProject = {
  id: string;
  title: string;
  kind: string;
  status: string;
  brief: string;
  notes: string;
  updatedAt: string;
  meta?: Record<string, unknown>;
};

type ProjectFile = {
  id: string;
  path: string;
  mime: string;
  size: number;
  updatedAt: string;
};

type FileDetail = ProjectFile & { content: string };

export function ProjectWorkspace() {
  const [projects, setProjects] = useState<AiProject[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [activeFile, setActiveFile] = useState<FileDetail | null>(null);
  const [draftContent, setDraftContent] = useState("");
  const [events, setEvents] = useState<OfficeEvent[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const selected = projects.find((p) => p.id === selectedId) ?? null;

  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/office/projects", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { projects?: AiProject[] };
      const list = json.projects ?? [];
      setProjects(list);
      setSelectedId((cur) => cur ?? list[0]?.id ?? null);
    } catch {
      /* ignore */
    }
  }, []);

  const loadFiles = useCallback(async (projectId: string) => {
    try {
      const res = await fetch(`/api/office/projects/${encodeURIComponent(projectId)}/files`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const json = (await res.json()) as { files?: ProjectFile[] };
      setFiles(json.files ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  const loadChat = useCallback(async (projectId: string) => {
    try {
      const res = await fetch(`/api/office/agents/${encodeURIComponent("openclaw:office")}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const json = (await res.json()) as { events?: OfficeEvent[] };
      const all = json.events ?? [];
      const filtered = all.filter((e) => {
        const pid = e.payload?.projectId;
        return pid === projectId || e.payload?.workspace === true;
      });
      // Si peu d’events liés, montrer aussi le fil récent réception (contexte)
      setEvents(filtered.length >= 2 ? filtered : all.slice(0, 40));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadProjects();
    const t = setInterval(() => void loadProjects(), 10_000);
    return () => clearInterval(t);
  }, [loadProjects]);

  useEffect(() => {
    if (!selectedId) {
      setFiles([]);
      setActiveFile(null);
      setEvents([]);
      return;
    }
    void loadFiles(selectedId);
    void loadChat(selectedId);
    const t = setInterval(() => {
      void loadFiles(selectedId);
      void loadChat(selectedId);
    }, 5000);
    return () => clearInterval(t);
  }, [selectedId, loadFiles, loadChat]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  const filteredProjects = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.brief.toLowerCase().includes(q) ||
        p.status.toLowerCase().includes(q),
    );
  }, [projects, query]);

  const bubbles = useMemo(() => eventsToBubbles(events).slice(-60), [events]);

  async function openFile(file: ProjectFile) {
    if (!selectedId) return;
    const res = await fetch(
      `/api/office/projects/${encodeURIComponent(selectedId)}/files/${encodeURIComponent(file.id)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return;
    const json = (await res.json()) as { file?: FileDetail };
    if (!json.file) return;
    setActiveFile(json.file);
    setDraftContent(json.file.content);
  }

  async function saveFile() {
    if (!selectedId || !activeFile || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(
        `/api/office/projects/${encodeURIComponent(selectedId)}/files/${encodeURIComponent(activeFile.id)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: draftContent }),
        },
      );
      if (!res.ok) throw new Error("Enregistrement impossible");
      const json = (await res.json()) as { file?: FileDetail };
      if (json.file) {
        setActiveFile(json.file);
        setDraftContent(json.file.content);
      }
      await loadFiles(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  async function createEmptyFile() {
    if (!selectedId || busy) return;
    const path = window.prompt("Chemin du fichier (ex. notes.md)", "notes.md");
    if (!path?.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/office/projects/${encodeURIComponent(selectedId)}/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: path.trim(), content: "" }),
      });
      if (!res.ok) throw new Error("Création impossible");
      await loadFiles(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  async function onDropFile(file: File) {
    if (!selectedId || busy) return;
    setBusy(true);
    setError("");
    try {
      const content = await file.text();
      const res = await fetch(`/api/office/projects/${encodeURIComponent(selectedId)}/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: file.name, content }),
      });
      if (!res.ok) throw new Error("Dépôt impossible");
      await loadFiles(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  async function createProject(e: FormEvent) {
    e.preventDefault();
    if (!newTitle.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/office/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle.trim(),
          kind: "punctual",
          status: "active",
          brief: "",
          agentId: "openclaw:office",
        }),
      });
      if (!res.ok) throw new Error("Création projet impossible");
      const json = (await res.json()) as { project?: AiProject };
      setNewTitle("");
      await loadProjects();
      if (json.project) setSelectedId(json.project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  async function sendChat(e: FormEvent) {
    e.preventDefault();
    const text = chatDraft.trim();
    if (!text || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/office/act", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: "openclaw:office",
          kind: "message",
          text,
          ...(selectedId ? { projectId: selectedId, createTask: true } : {}),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        projectId?: string;
      };
      if (!res.ok) throw new Error(body.error || "Envoi impossible");
      setChatDraft("");
      if (body.projectId) {
        setSelectedId(body.projectId);
        await loadProjects();
        await loadFiles(body.projectId);
      } else if (selectedId) {
        await loadFiles(selectedId);
      }
      await loadChat(body.projectId || selectedId || "");
      await loadProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  const phase =
    selected?.meta?.orchestration && typeof selected.meta.orchestration === "object"
      ? String((selected.meta.orchestration as { phase?: string }).phase ?? "")
      : "";

  return (
    <div className="pw-root">
      <div className="pw-main">
        <header className="pw-top">
          <div>
            <p className="pw-kicker">Workspace</p>
            <h1 className="pw-title">{selected ? selected.title : "Projets"}</h1>
            {phase ? <span className="pw-phase">{phase}</span> : null}
          </div>
          {error ? <p className="pw-error">{error}</p> : null}
        </header>

        <div className="pw-split">
          <section className="pw-chat">
            <header className="pw-pane-head">Chat agent</header>
            <div className="pw-chat-feed">
              {bubbles.length === 0 ? (
                <p className="pw-empty">
                  Ex. « Liste les boulangeries sans site autour de Trappes puis prépare un CSV et un
                  mail »
                </p>
              ) : (
                bubbles.map((b) => (
                  <div key={b.id} className={`pw-bubble role-${b.role}`}>
                    <span className="pw-bubble-meta">{b.role}</span>
                    <p>{b.text}</p>
                  </div>
                ))
              )}
              <div ref={chatEndRef} />
            </div>
            <form className="pw-chat-form" onSubmit={sendChat}>
              <textarea
                value={chatDraft}
                onChange={(e) => setChatDraft(e.target.value)}
                placeholder="Demande à la secrétaire / manager…"
                rows={3}
                disabled={busy}
              />
              <button type="submit" className="pixel-btn blue" disabled={busy || !chatDraft.trim()}>
                Envoyer
              </button>
            </form>
          </section>

          <section
            className="pw-files"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) void onDropFile(f);
            }}
          >
            <aside className="pw-file-tree">
              <header className="pw-pane-head">
                <span>Fichiers</span>
                <span className="pw-file-actions">
                  <button type="button" className="pixel-btn ghost compact" onClick={() => void createEmptyFile()} disabled={!selectedId || busy}>
                    +
                  </button>
                  <button
                    type="button"
                    className="pixel-btn ghost compact"
                    disabled={!selectedId || busy}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    ↑
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void onDropFile(f);
                      e.target.value = "";
                    }}
                  />
                </span>
              </header>
              <ul>
                {files.length === 0 ? (
                  <li className="pw-empty">Dépose un fichier ou lance une mission</li>
                ) : (
                  files.map((f) => (
                    <li key={f.id}>
                      <button
                        type="button"
                        className={activeFile?.id === f.id ? "is-active" : ""}
                        onClick={() => void openFile(f)}
                      >
                        {f.path}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </aside>
            <div className="pw-editor">
              <header className="pw-pane-head">
                <span>{activeFile ? activeFile.path : "Éditeur"}</span>
                {activeFile ? (
                  <button type="button" className="pixel-btn blue compact" disabled={busy} onClick={() => void saveFile()}>
                    Sauver
                  </button>
                ) : null}
              </header>
              {activeFile ? (
                <textarea
                  className="pw-code"
                  value={draftContent}
                  onChange={(e) => setDraftContent(e.target.value)}
                  spellCheck={false}
                />
              ) : (
                <p className="pw-empty">Ouvre un fichier à gauche (CSV, mail, notes…)</p>
              )}
            </div>
          </section>
        </div>
      </div>

      <aside className="pw-sidebar">
        <header className="pw-pane-head">Projets</header>
        <form className="pw-new" onSubmit={createProject}>
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Nouveau projet…"
            maxLength={120}
          />
          <button type="submit" className="pixel-btn ghost compact" disabled={busy || !newTitle.trim()}>
            +
          </button>
        </form>
        <input
          className="pw-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher…"
        />
        <ul className="pw-project-list">
          {filteredProjects.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className={p.id === selectedId ? "is-active" : ""}
                onClick={() => setSelectedId(p.id)}
              >
                <strong>{p.title}</strong>
                <em>
                  {p.status}
                  {p.kind === "recurring" ? " · récurrent" : ""}
                </em>
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
