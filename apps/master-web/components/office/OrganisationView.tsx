"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import type { OfficeAgent } from "@/lib/office/types";
import { displayName } from "@/lib/office/labels";
import { agentRole, roleLabel } from "@/lib/office/role";

type Profile = {
  agentId: string;
  displayName: string | null;
  persona: string;
  preferredRoom: string | null;
  tags: string[];
  active: boolean;
};

type Team = {
  id: string;
  name: string;
  leadAgentId: string | null;
  notes: string;
  members: Array<{ agentId: string; roleInTeam: string; sortOrder: number }>;
};

const ROLES = ["lead", "mgr", "worker", "specialist"] as const;

export function OrganisationView({ agents }: { agents: OfficeAgent[] }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [focusId, setFocusId] = useState<string | null>(agents[0]?.id ?? null);
  const [persona, setPersona] = useState("");
  const [display, setDisplay] = useState("");
  const [teamName, setTeamName] = useState("");
  const [leadId, setLeadId] = useState("openclaw:chef");
  const [memberDraft, setMemberDraft] = useState<Array<{ agentId: string; roleInTeam: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editTeam, setEditTeam] = useState<Team | null>(null);

  const load = useCallback(async () => {
    try {
      const [pr, tm] = await Promise.all([
        fetch("/api/office/profiles", { cache: "no-store" }),
        fetch("/api/office/teams", { cache: "no-store" }),
      ]);
      if (pr.ok) {
        const j = (await pr.json()) as { profiles?: Profile[] };
        setProfiles(j.profiles ?? []);
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
  }, [load]);

  useEffect(() => {
    if (!focusId) return;
    const p = profiles.find((x) => x.agentId === focusId);
    setPersona(p?.persona ?? "");
    setDisplay(p?.displayName ?? "");
  }, [focusId, profiles]);

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    if (!focusId || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/office/profiles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: focusId,
          persona,
          displayName: display.trim() || null,
        }),
      });
      if (!res.ok) throw new Error("Profil non sauvé");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  function toggleMember(agentId: string) {
    setMemberDraft((prev) => {
      if (prev.some((m) => m.agentId === agentId)) {
        return prev.filter((m) => m.agentId !== agentId);
      }
      return [...prev, { agentId, roleInTeam: agentId === leadId ? "lead" : "worker" }];
    });
  }

  async function createTeam(e: FormEvent) {
    e.preventDefault();
    if (!teamName.trim() || busy) return;
    setBusy(true);
    try {
      const members = [...memberDraft];
      if (leadId && !members.some((m) => m.agentId === leadId)) {
        members.unshift({ agentId: leadId, roleInTeam: "lead" });
      }
      const res = await fetch("/api/office/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: teamName.trim(), leadAgentId: leadId, members }),
      });
      if (!res.ok) throw new Error("Équipe non créée");
      setTeamName("");
      setMemberDraft([]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  async function saveTeamMembers() {
    if (!editTeam || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/office/teams", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editTeam.id,
          leadAgentId: editTeam.leadAgentId,
          members: editTeam.members,
        }),
      });
      if (!res.ok) throw new Error("Maj équipe impossible");
      setEditTeam(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  async function removeTeam(id: string) {
    await fetch(`/api/office/teams?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await load();
  }

  const online = agents.filter((a) => a.status !== "offline");

  return (
    <div className="pixel-hq-orga">
      {error && <p className="pixel-projects-err">{error}</p>}
      <header className="pixel-section-head pixel-hq-orga-head">
        <strong>ORGANISATION</strong>
      </header>
      <div className="pixel-orga-grid">
        <section className="pixel-orga-roster">
          <h3 className="pixel-subsection-title">Agents</h3>
          <ul>
            {online.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  className={`role-${agentRole(a)} ${focusId === a.id ? "is-on" : ""}`}
                  onClick={() => setFocusId(a.id)}
                >
                  <strong>{displayName(a)}</strong>
                  <em>{roleLabel(agentRole(a))}</em>
                  <span className={`st status-${a.status}`}>{a.status}</span>
                </button>
              </li>
            ))}
          </ul>
          {focusId && (
            <form className="pixel-orga-profile" onSubmit={saveProfile}>
              <label>
                Nom affiché
                <input
                  className="pixel-input"
                  value={display}
                  onChange={(e) => setDisplay(e.target.value)}
                />
              </label>
              <label>
                Persona (injectée au run)
                <textarea
                  className="pixel-input"
                  rows={4}
                  value={persona}
                  onChange={(e) => setPersona(e.target.value)}
                  placeholder="Ton, rôle, contraintes…"
                />
              </label>
              <button className="pixel-btn" type="submit" disabled={busy}>
                Sauver profil
              </button>
            </form>
          )}
        </section>

        <section className="pixel-orga-teams">
          <h3 className="pixel-subsection-title">Équipes</h3>
          <form onSubmit={createTeam} className="pixel-projects-form">
            <div className="pixel-projects-row">
              <input
                className="pixel-input"
                placeholder="Nom équipe"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
              />
              <select className="pixel-input" value={leadId} onChange={(e) => setLeadId(e.target.value)}>
                {online.map((a) => (
                  <option key={a.id} value={a.id}>
                    lead: {displayName(a)}
                  </option>
                ))}
              </select>
              <button className="pixel-btn" type="submit" disabled={busy}>
                Créer
              </button>
            </div>
            <div className="pixel-orga-member-pick">
              {online.map((a) => (
                <label key={a.id}>
                  <input
                    type="checkbox"
                    checked={memberDraft.some((m) => m.agentId === a.id) || a.id === leadId}
                    onChange={() => toggleMember(a.id)}
                  />
                  {displayName(a)}
                </label>
              ))}
            </div>
          </form>

          <ul className="pixel-teams-list">
            {teams.map((t) => (
              <li key={t.id}>
                <header>
                  <strong>{t.name}</strong>
                  <button type="button" className="pixel-btn" onClick={() => setEditTeam(t)}>
                    Éditer
                  </button>
                  <button type="button" className="pixel-btn" onClick={() => void removeTeam(t.id)}>
                    Suppr
                  </button>
                </header>
                <p>
                  lead {t.leadAgentId?.replace(/^openclaw:/, "") ?? "—"} · {t.members.length} membres
                </p>
                <ul>
                  {t.members.map((m) => (
                    <li key={m.agentId}>
                      {m.agentId.replace(/^openclaw:/, "")} <em>{m.roleInTeam}</em>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>

          {editTeam && (
            <div className="pixel-team-editor">
              <h4>Éditer {editTeam.name}</h4>
              {editTeam.members.map((m, i) => (
                <div key={m.agentId} className="pixel-projects-row">
                  <span>{m.agentId.replace(/^openclaw:/, "")}</span>
                  <select
                    className="pixel-input"
                    value={m.roleInTeam}
                    onChange={(e) => {
                      const role = e.target.value;
                      setEditTeam({
                        ...editTeam,
                        members: editTeam.members.map((x, j) =>
                          j === i ? { ...x, roleInTeam: role } : x,
                        ),
                      });
                    }}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              <button type="button" className="pixel-btn" onClick={() => void saveTeamMembers()}>
                Sauver rôles
              </button>
              <button type="button" className="pixel-btn" onClick={() => setEditTeam(null)}>
                Annuler
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
