"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { DetailDrawer } from "@/components/ui/DetailDrawer";
import { htmlToPlainText, looksLikeHtml } from "@/lib/job-hunt/html-text";
import {
  DEFAULT_PLATFORMS,
  EVENT_KIND_LABEL,
  LISTING_STATUS_LABEL,
  type JobHuntAutomationStatus,
  type JobHuntEvent,
  type JobHuntListing,
  type JobHuntListingStatus,
  type JobHuntProfile,
  type JobHuntSearchRun,
  type JobHuntStats,
  type JobPlatformCredential,
} from "@/lib/job-hunt/types";

type Tab = "candidatures" | "offres" | "recherches" | "profil" | "comptes";

type Overview = {
  profile: JobHuntProfile;
  stats: JobHuntStats;
  automation: JobHuntAutomationStatus;
  listings: JobHuntListing[];
  searchHistory: JobHuntSearchRun[];
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function scoreColor(score: number): string {
  if (score >= 70) return "text-emerald-400";
  if (score >= 45) return "text-amber-400";
  return "text-zinc-500";
}

function StatusPill({ status }: { status: JobHuntListingStatus }) {
  const colors: Record<JobHuntListingStatus, string> = {
    new: "bg-blue-500/15 text-blue-300 ring-blue-500/30",
    reviewed: "bg-violet-500/15 text-violet-300 ring-violet-500/30",
    queued: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
    applied: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
    interview: "bg-cyan-500/15 text-cyan-300 ring-cyan-500/30",
    offer: "bg-green-500/15 text-green-300 ring-green-500/30",
    rejected: "bg-red-500/15 text-red-300 ring-red-500/30",
    skipped: "bg-zinc-500/15 text-zinc-400 ring-zinc-500/30",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${colors[status]}`}>
      {LISTING_STATUS_LABEL[status]}
    </span>
  );
}

export default function CarrierePage() {
  const [tab, setTab] = useState<Tab>("candidatures");
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<JobHuntListing | null>(null);
  const [selectedEvents, setSelectedEvents] = useState<JobHuntEvent[]>([]);
  const [statusFilter, setStatusFilter] = useState<JobHuntListingStatus | "">("");

  const [profileDraft, setProfileDraft] = useState<JobHuntProfile | null>(null);
  const [stackInput, setStackInput] = useState("");
  const [rolesInput, setRolesInput] = useState("");
  const [langsInput, setLangsInput] = useState("");
  const [regionsInput, setRegionsInput] = useState("");
  const [cvAnalysisMsg, setCvAnalysisMsg] = useState<string | null>(null);

  const [credentials, setCredentials] = useState<JobPlatformCredential[]>([]);
  const [credDrafts, setCredDrafts] = useState<
    Record<string, { email: string; password: string; loginUrl: string; notes: string; useGoogleSso: boolean }>
  >({});

  const [newTitle, setNewTitle] = useState("");
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [newCompany, setNewCompany] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newDescription, setNewDescription] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/job-hunt", { cache: "no-store" });
    if (!res.ok) throw new Error(`Erreur ${res.status}`);
    const json = (await res.json()) as Overview;
    setData(json);
    setProfileDraft(json.profile);
    setStackInput(json.profile.stack.join(", "));
    setRolesInput(json.profile.targetRoles.join(", "));
    setLangsInput(json.profile.languages.join(", "));
    setRegionsInput(json.profile.preferredRegions.join(", "));

    const credRes = await fetch("/api/job-hunt/credentials", { cache: "no-store" });
    if (credRes.ok) {
      const credJson = (await credRes.json()) as { credentials: JobPlatformCredential[] };
      setCredentials(credJson.credentials);
      const drafts: typeof credDrafts = {};
      for (const c of credJson.credentials) {
        drafts[c.platform] = {
          email: c.email,
          password: "",
          loginUrl: c.loginUrl,
          notes: c.notes,
          useGoogleSso: c.useGoogleSso,
        };
      }
      setCredDrafts(drafts);
    }
    return json;
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Chargement impossible");
      } finally {
        setLoading(false);
      }
    })();
  }, [load]);

  useEffect(() => {
    const interval = window.setInterval(() => void load().catch(() => {}), 20_000);
    return () => clearInterval(interval);
  }, [load]);

  const applications = useMemo(
    () =>
      (data?.listings ?? [])
        .filter((l) => ["queued", "applied", "interview", "offer", "rejected"].includes(l.status))
        .sort((a, b) => (b.appliedAt ?? b.updatedAt).localeCompare(a.appliedAt ?? a.updatedAt)),
    [data?.listings],
  );

  const offers = useMemo(() => {
    let list = data?.listings ?? [];
    if (statusFilter) list = list.filter((l) => l.status === statusFilter);
    return list;
  }, [data?.listings, statusFilter]);

  async function openListing(listing: JobHuntListing) {
    setSelected(listing);
    const res = await fetch(`/api/job-hunt/listings/${listing.id}/detail`, { cache: "no-store" });
    if (res.ok) {
      const json = (await res.json()) as { listing: JobHuntListing; events: JobHuntEvent[] };
      setSelected(json.listing);
      setSelectedEvents(json.events);
    }
  }

  async function saveProfile() {
    if (!profileDraft) return;
    setBusy(true);
    try {
      const res = await fetch("/api/job-hunt/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...profileDraft,
          stack: stackInput.split(",").map((s) => s.trim()).filter(Boolean),
          targetRoles: rolesInput.split(",").map((s) => s.trim()).filter(Boolean),
          languages: langsInput.split(",").map((s) => s.trim()).filter(Boolean),
          preferredRegions: regionsInput.split(",").map((s) => s.trim()).filter(Boolean),
          rescoreListings: true,
        }),
      });
      if (!res.ok) throw new Error("Sauvegarde impossible");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  async function uploadCv(file: File) {
    setBusy(true);
    setCvAnalysisMsg(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/job-hunt/cv", { method: "POST", body: form });
      const json = (await res.json()) as { error?: string; analysis?: { summary: string } };
      if (!res.ok) throw new Error(json.error ?? "Analyse impossible");
      setCvAnalysisMsg(json.analysis?.summary ?? "CV analysé");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload échoué");
    } finally {
      setBusy(false);
    }
  }

  async function runAuto() {
    setBusy(true);
    try {
      const res = await fetch("/api/job-hunt/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forceSearch: true }),
      });
      if (!res.ok) throw new Error("Cycle auto échoué");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  async function listingAction(id: string, action: "apply" | "tailor") {
    setBusy(true);
    try {
      const res = await fetch(`/api/job-hunt/listings/${id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Action échouée");
      await load();
      if (selected?.id === id) {
        const detail = await fetch(`/api/job-hunt/listings/${id}/detail`, { cache: "no-store" });
        if (detail.ok) {
          const d = (await detail.json()) as { listing: JobHuntListing; events: JobHuntEvent[] };
          setSelected(d.listing);
          setSelectedEvents(d.events);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  async function updateStatus(id: string, status: JobHuntListingStatus) {
    setBusy(true);
    try {
      await fetch(`/api/job-hunt/listings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          appliedAt: status === "applied" ? new Date().toISOString() : undefined,
        }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  async function saveCredential(platform: string) {
    const draft = credDrafts[platform];
    if (!draft) return;
    setBusy(true);
    try {
      await fetch("/api/job-hunt/credentials", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, ...draft, password: draft.password || undefined }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  const auto = data?.automation;

  return (
    <>
      <PageHeader
        title="Carrière"
        description="Automatisation plug-and-play — recherche, adaptation CV et candidatures sur le PC fixe"
      />

      {error && (
        <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
          <button type="button" className="ml-3 underline" onClick={() => setError(null)}>Fermer</button>
        </div>
      )}

      {auto && (
        <Card padding="sm" className="mb-6">
          <div className="flex flex-wrap items-center gap-3">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ring-1 ${auto.pcOnline ? "bg-emerald-500/10 text-emerald-400 ring-emerald-500/30" : "bg-zinc-500/10 text-zinc-500 ring-zinc-500/30"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${auto.pcOnline ? "bg-emerald-400 animate-pulse" : "bg-zinc-600"}`} />
              PC {auto.pcOnline ? "connecté — automation active" : "déconnecté"}
            </span>
            <span className={`text-xs ${auto.profileReady ? "text-emerald-400" : "text-amber-400"}`}>
              {auto.profileReady ? "Profil prêt" : "Importez votre CV pour démarrer"}
            </span>
            {auto.autoSearchEnabled && <span className="text-xs text-zinc-500">Recherche auto</span>}
            {auto.autoApplyEnabled && <span className="text-xs text-zinc-500">Candidatures auto</span>}
            <span className="text-xs text-zinc-600">
              {auto.applicationsRemainingToday} candidature(s) restante(s) aujourd&apos;hui
            </span>
            {auto.lastAutoRunAt && (
              <span className="text-xs text-zinc-600">Dernier cycle : {formatTime(auto.lastAutoRunAt)}</span>
            )}
            <button
              type="button"
              disabled={busy || !auto.pcOnline}
              onClick={() => void runAuto()}
              className="ml-auto rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              Lancer un cycle
            </button>
          </div>
        </Card>
      )}

      {data && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          {[
            ["Offres", data.stats.total],
            ["Nouvelles", data.stats.new],
            ["En cours", data.stats.queued],
            ["Postulées", data.stats.applied],
            ["Entretiens", data.stats.interview],
            ["Offres reçues", data.stats.offer],
            ["Refus", data.stats.rejected],
            ["Aujourd'hui", data.stats.appliedToday],
          ].map(([label, value]) => (
            <Card key={String(label)} padding="sm" className="text-center">
              <p className="text-[10px] text-zinc-500">{label}</p>
              <p className="text-lg font-semibold text-white">{value}</p>
            </Card>
          ))}
        </div>
      )}

      <div className="mb-6 flex flex-wrap gap-2">
        {(
          [
            ["candidatures", "Candidatures"],
            ["offres", "Offres"],
            ["recherches", "Recherches"],
            ["profil", "Profil"],
            ["comptes", "Comptes"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === id ? "bg-blue-600/20 text-white ring-1 ring-blue-500/40" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && !data ? (
        <div className="h-64 animate-pulse rounded-2xl bg-surface-raised" />
      ) : tab === "candidatures" ? (
        <div className="space-y-2">
          {applications.length === 0 ? (
            <Card padding="lg" className="text-center text-sm text-zinc-500">
              Aucune candidature encore. Connectez le PC fixe — le cycle démarre automatiquement.
            </Card>
          ) : (
            applications.map((listing) => (
              <button
                key={listing.id}
                type="button"
                onClick={() => void openListing(listing)}
                className="flex w-full gap-4 rounded-xl border border-surface-border bg-surface-raised/40 px-4 py-4 text-left hover:bg-surface-raised/60"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-white">{listing.title}</p>
                    <StatusPill status={listing.status} />
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    {listing.company || "—"} · {listing.source} · {listing.location}
                    {listing.salary ? ` · ${listing.salary}` : ""}
                  </p>
                  {listing.agentResult && (
                    <p className="mt-2 line-clamp-2 text-xs text-zinc-400">{listing.agentResult}</p>
                  )}
                  {listing.agentError && (
                    <p className="mt-1 text-xs text-red-400">{listing.agentError}</p>
                  )}
                </div>
                <div className="shrink-0 text-right text-xs text-zinc-600">
                  <p className={`font-mono font-semibold ${scoreColor(listing.score)}`}>{listing.score}</p>
                  <p className="mt-2">{listing.appliedAt ? formatTime(listing.appliedAt) : formatTime(listing.updatedAt)}</p>
                </div>
              </button>
            ))
          )}
        </div>
      ) : tab === "recherches" ? (
        <div className="space-y-4">
          <Card padding="sm">
            <p className="text-xs text-zinc-500">
              Les 10 dernières recherches sont conservées. Chaque offre analysée est notée : retenue ou écartée, avec la raison.
            </p>
          </Card>
          {(data?.searchHistory ?? []).length === 0 ? (
            <Card padding="lg" className="text-center text-sm text-zinc-500">
              Aucune recherche enregistrée. Lancez un cycle ou connectez le PC fixe.
            </Card>
          ) : (
            (data?.searchHistory ?? []).map((run) => (
              <Card key={run.id} padding="sm">
                <button
                  type="button"
                  className="flex w-full items-center gap-4 text-left"
                  onClick={() => setExpandedRun(expandedRun === run.id ? null : run.id)}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-white">{formatTime(run.createdAt)}</p>
                    <p className="text-xs text-zinc-500">
                      {run.sources.join(", ") || "—"} · min score {run.minScore}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-3 text-xs">
                    <span className="text-emerald-400">{run.importedCount} retenues</span>
                    <span className="text-zinc-500">{run.skippedCount} écartées</span>
                    <span className="text-zinc-600">{expandedRun === run.id ? "▲" : "▼"}</span>
                  </div>
                </button>
                {expandedRun === run.id && (
                  <ul className="mt-4 max-h-96 space-y-2 overflow-y-auto border-t border-surface-border pt-4">
                    {run.decisions.map((d) => (
                      <li
                        key={d.id}
                        className={`rounded-lg border px-3 py-2 text-xs ${
                          d.decision === "imported"
                            ? "border-emerald-500/30 bg-emerald-500/5"
                            : "border-surface-border bg-surface/40"
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-zinc-200">{d.title}</p>
                            <p className="text-zinc-500">
                              {d.company || "—"} · {d.source}
                              {d.score != null ? ` · score ${d.score}` : ""}
                            </p>
                          </div>
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              d.decision === "imported"
                                ? "bg-emerald-500/20 text-emerald-300"
                                : "bg-zinc-600/30 text-zinc-400"
                            }`}
                          >
                            {d.decision === "imported" ? "Retenue" : "Écartée"}
                          </span>
                        </div>
                        <p className="mt-1.5 text-zinc-400">{d.reason}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            ))
          )}
        </div>
      ) : tab === "offres" ? (
        <div className="space-y-4">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as JobHuntListingStatus | "")}
            className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-zinc-300"
          >
            <option value="">Tous statuts</option>
            {(Object.keys(LISTING_STATUS_LABEL) as JobHuntListingStatus[]).map((s) => (
              <option key={s} value={s}>{LISTING_STATUS_LABEL[s]}</option>
            ))}
          </select>
          <div className="space-y-2">
            {offers.map((listing) => (
              <button
                key={listing.id}
                type="button"
                onClick={() => void openListing(listing)}
                className="flex w-full items-center gap-4 rounded-xl border border-surface-border bg-surface-raised/40 px-4 py-3 text-left hover:bg-surface-raised/60"
              >
                <span className={`w-10 font-mono text-sm font-semibold ${scoreColor(listing.score)}`}>{listing.score}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-white">{listing.title}</p>
                  <p className="truncate text-xs text-zinc-500">{listing.company} · {listing.source}</p>
                </div>
                <StatusPill status={listing.status} />
              </button>
            ))}
          </div>
        </div>
      ) : tab === "profil" && profileDraft ? (
        <div className="space-y-6">
          <Card>
            <h3 className="mb-3 text-sm font-medium text-white">Automation</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-sm text-zinc-400">
                <input type="checkbox" checked={profileDraft.autoSearchEnabled} onChange={(e) => setProfileDraft({ ...profileDraft, autoSearchEnabled: e.target.checked })} />
                Recherche auto (RemoteOK + Remotive)
              </label>
              <label className="flex items-center gap-2 text-sm text-zinc-400">
                <input type="checkbox" checked={profileDraft.autoApplyEnabled} onChange={(e) => setProfileDraft({ ...profileDraft, autoApplyEnabled: e.target.checked })} />
                Candidatures auto sur le PC
              </label>
              <label className="text-xs text-zinc-500">
                Score minimum auto
                <input type="number" min={0} max={100} className="mt-1 w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-white" value={profileDraft.minScoreAutoApply} onChange={(e) => setProfileDraft({ ...profileDraft, minScoreAutoApply: Number(e.target.value) })} />
              </label>
              <label className="text-xs text-zinc-500">
                Max candidatures / jour
                <input type="number" min={1} max={30} className="mt-1 w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-white" value={profileDraft.maxApplicationsPerDay} onChange={(e) => setProfileDraft({ ...profileDraft, maxApplicationsPerDay: Number(e.target.value) })} />
              </label>
            </div>
          </Card>

          <Card>
            <h3 className="mb-2 text-sm font-medium text-white">Importer un CV</h3>
            <label className="flex cursor-pointer flex-col items-center rounded-xl border border-dashed border-surface-border px-6 py-8 hover:border-blue-500/40">
              <span className="text-sm text-zinc-400">{busy ? "Analyse…" : "PDF, TXT ou MD"}</span>
              <input type="file" accept=".pdf,.txt,.md" className="sr-only" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadCv(f); e.target.value = ""; }} />
            </label>
            {cvAnalysisMsg && <p className="mt-2 text-xs text-emerald-400">{cvAnalysisMsg}</p>}
          </Card>

          <Card>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-xs text-zinc-500">Nom<input className="mt-1 w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-white" value={profileDraft.fullName} onChange={(e) => setProfileDraft({ ...profileDraft, fullName: e.target.value })} /></label>
              <label className="text-xs text-zinc-500">Email<input type="email" className="mt-1 w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-white" value={profileDraft.email} onChange={(e) => setProfileDraft({ ...profileDraft, email: e.target.value })} /></label>
              <label className="text-xs text-zinc-500 sm:col-span-2">Compétences<input className="mt-1 w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-white" value={stackInput} onChange={(e) => setStackInput(e.target.value)} /></label>
              <label className="text-xs text-zinc-500 sm:col-span-2">Postes recherchés<input className="mt-1 w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-white" value={rolesInput} onChange={(e) => setRolesInput(e.target.value)} /></label>
            </div>
            <textarea className="mt-4 min-h-[200px] w-full rounded-lg border border-surface-border bg-surface px-3 py-2 font-mono text-xs text-zinc-200" value={profileDraft.cvBase} onChange={(e) => setProfileDraft({ ...profileDraft, cvBase: e.target.value })} />
          </Card>

          <button type="button" disabled={busy} onClick={() => void saveProfile()} className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm text-white disabled:opacity-50">Enregistrer</button>
        </div>
      ) : (
        <div className="space-y-4">
          <Card padding="sm"><p className="text-xs text-zinc-500">Google Password Manager par défaut. Identifiants de secours chiffrés dans Master.</p></Card>
          {credentials.map((cred) => {
            const draft = credDrafts[cred.platform] ?? { email: cred.email, password: "", loginUrl: cred.loginUrl, notes: cred.notes, useGoogleSso: cred.useGoogleSso };
            return (
              <Card key={cred.platform}>
                <h3 className="mb-3 text-sm font-medium text-white">{cred.label}</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <input placeholder="Email" className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-white" value={draft.email} onChange={(e) => setCredDrafts((p) => ({ ...p, [cred.platform]: { ...draft, email: e.target.value } }))} />
                  <input type="password" placeholder={cred.passwordSet ? "•••• (inchangé)" : "Mot de passe"} className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-white" value={draft.password} onChange={(e) => setCredDrafts((p) => ({ ...p, [cred.platform]: { ...draft, password: e.target.value } }))} />
                  <label className="flex items-center gap-2 text-sm text-zinc-400 sm:col-span-2">
                    <input type="checkbox" checked={draft.useGoogleSso} onChange={(e) => setCredDrafts((p) => ({ ...p, [cred.platform]: { ...draft, useGoogleSso: e.target.checked } }))} />
                    Continuer avec Google
                  </label>
                </div>
                <button type="button" disabled={busy} onClick={() => void saveCredential(cred.platform)} className="mt-3 rounded-lg bg-surface px-4 py-2 text-xs text-zinc-300 ring-1 ring-surface-border">Enregistrer</button>
              </Card>
            );
          })}
        </div>
      )}

      <DetailDrawer open={selected != null} onClose={() => { setSelected(null); setSelectedEvents([]); }} title={selected?.title ?? ""} subtitle={selected ? `${selected.company} · score ${selected.score}` : undefined}>
        {selected && (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2">
              <StatusPill status={selected.status} />
              <a href={selected.url} target="_blank" rel="noopener noreferrer" className="ml-auto text-xs text-blue-400 hover:underline">Voir l&apos;offre ↗</a>
            </div>

            <Card padding="sm">
              <dl className="grid grid-cols-2 gap-3 text-xs">
                <div><dt className="text-zinc-500">Entreprise</dt><dd className="text-white">{selected.company || "—"}</dd></div>
                <div><dt className="text-zinc-500">Source</dt><dd className="text-white">{selected.source}</dd></div>
                <div><dt className="text-zinc-500">Lieu</dt><dd className="text-white">{selected.location}</dd></div>
                <div><dt className="text-zinc-500">Salaire</dt><dd className="text-white">{selected.salary || "—"}</dd></div>
                <div><dt className="text-zinc-500">Type</dt><dd className="text-white">{selected.employmentType || selected.remoteType}</dd></div>
                <div><dt className="text-zinc-500">Postulé le</dt><dd className="text-white">{selected.appliedAt ? formatTime(selected.appliedAt) : "—"}</dd></div>
              </dl>
              {selected.tags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {selected.tags.slice(0, 24).map((t) => (
                    <span key={t} className="rounded bg-surface px-2 py-0.5 text-[10px] text-zinc-400">
                      {t}
                    </span>
                  ))}
                  {selected.tags.length > 24 ? (
                    <span className="text-[10px] text-zinc-500">+{selected.tags.length - 24}</span>
                  ) : null}
                </div>
              )}
            </Card>

            {selected.description && (
              <Card padding="sm">
                <h4 className="mb-2 text-xs font-medium uppercase text-zinc-500">Description</h4>
                <p className="whitespace-pre-wrap text-xs text-zinc-400">
                  {looksLikeHtml(selected.description)
                    ? htmlToPlainText(selected.description)
                    : selected.description}
                </p>
              </Card>
            )}

            {selected.agentResult && (
              <Card padding="sm">
                <h4 className="mb-2 text-xs font-medium uppercase text-zinc-500">Résultat agent</h4>
                <p className="whitespace-pre-wrap text-xs text-zinc-300">{selected.agentResult}</p>
              </Card>
            )}

            {selectedEvents.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-medium uppercase text-zinc-500">Historique</h4>
                <ul className="space-y-2">
                  {selectedEvents.map((ev) => (
                    <li key={ev.id} className="rounded-lg border border-surface-border px-3 py-2 text-xs">
                      <span className="text-zinc-500">{formatTime(ev.createdAt)}</span>
                      <span className="ml-2 text-zinc-300">{EVENT_KIND_LABEL[ev.kind] ?? ev.kind}</span>
                      {ev.message && <p className="mt-1 text-zinc-500">{ev.message}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => void listingAction(selected.id, "tailor")} className="rounded-lg bg-violet-600/20 px-3 py-2 text-xs text-violet-200 ring-1 ring-violet-500/40">Adapter CV</button>
              <button type="button" disabled={busy || !auto?.pcOnline} onClick={() => void listingAction(selected.id, "apply")} className="rounded-lg bg-blue-600 px-3 py-2 text-xs text-white">Postuler (agent PC)</button>
            </div>

            <div className="flex flex-wrap gap-2">
              {(Object.keys(LISTING_STATUS_LABEL) as JobHuntListingStatus[]).map((s) => (
                <button key={s} type="button" onClick={() => void updateStatus(selected.id, s)} className={`rounded px-2 py-1 text-xs ${selected.status === s ? "bg-blue-600/20 text-white" : "text-zinc-500"}`}>{LISTING_STATUS_LABEL[s]}</button>
              ))}
            </div>
          </div>
        )}
      </DetailDrawer>
    </>
  );
}
