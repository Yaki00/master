"use client";

import { VT323 } from "next/font/google";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfficeFloor } from "@/components/office/OfficeFloor";
import { OfficeConsole } from "@/components/office/OfficeConsole";
import { AgentLogsPanel } from "@/components/office/AgentLogsPanel";
import { PmOrchestrationBoard } from "@/components/office/PmOrchestrationBoard";
import { TaskStrip } from "@/components/office/TaskStrip";
import { ProjectBoard } from "@/components/office/ProjectBoard";
import { OrganisationView } from "@/components/office/OrganisationView";
import { ProjectsLibraryModal } from "@/components/office/ProjectsLibraryModal";
import { useOfficeAgents, useOfficeDetail, type OfficeDetail } from "@/hooks/useOffice";
import { allMentionTargets, parseMention } from "@/lib/office/mentions";
import { parseMeetingIntent } from "@/lib/office/meeting-intent";
import { feedEventsEqual } from "@/lib/office/feed-signature";
import type { OfficeCommandKind, OfficeEvent } from "@/lib/office/types";

const pixelBody = VT323({ weight: "400", subsets: ["latin"] });

type TabId = "bureau" | "pipeline" | "projets" | "orga";

const TABS: Array<{ id: TabId; label: string; icon: string }> = [
  { id: "bureau", label: "Bureau", icon: "🏢" },
  { id: "pipeline", label: "Pipeline", icon: "🗂️" },
  { id: "projets", label: "Projets", icon: "📁" },
  { id: "orga", label: "Organisation", icon: "👥" },
];

export default function AgentsPage() {
  const { data, error, loading, refresh } = useOfficeAgents();
  const [selectedId, setSelectedId] = useState<string | null>("openclaw:office");
  const [hideOffline, setHideOffline] = useState(true);
  const detail = useOfficeDetail(selectedId);
  const selected = data?.agents.find((a) => a.id === selectedId) ?? detail.data?.agent ?? null;
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [globalEvents, setGlobalEvents] = useState<OfficeEvent[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedRefreshing, setFeedRefreshing] = useState(false);
  const feedInFlightRef = useRef(false);
  const [consoleCollapsed, setConsoleCollapsed] = useState(false);
  const [tab, setTab] = useState<TabId>("bureau");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [mobileDrawer, setMobileDrawer] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const sync = () => setMobileDrawer(mq.matches);
    sync();
    if (mq.matches) setConsoleCollapsed(true);
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const sources = data?.sources ?? {
    mac: { online: false, lastSeenAt: null },
    pc: { online: false, lastSeenAt: null },
    waitingJobs: [],
  };

  const agents = data?.agents ?? [];

  const refreshFeed = useCallback(async () => {
    if (feedInFlightRef.current) return;
    feedInFlightRef.current = true;
    setFeedRefreshing(true);
    try {
      const res = await fetch("/api/office/feed?limit=80", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { events?: OfficeEvent[] };
      const next = json.events ?? [];
      setGlobalEvents((prev) => (feedEventsEqual(prev, next) ? prev : next));
    } catch {
      /* ignore */
    } finally {
      feedInFlightRef.current = false;
      setFeedLoading(false);
      setFeedRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refreshFeed();
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const intervalMs = document.hidden ? 5000 : 2500;
      timer = setTimeout(async () => {
        await refreshFeed();
        tick();
      }, intervalMs);
    };
    tick();
    const onVis = () => {
      if (!document.hidden) void refreshFeed();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refreshFeed]);

  const actOnce = useCallback(
    async (kind: OfficeCommandKind, targetId: string, payload?: { text?: string; projectId?: string; teamId?: string }) => {
      const text = payload?.text?.trim() ?? "";
      if (kind === "message" && text && targetId === selectedId) {
        const optimistic: OfficeEvent = {
          id: `optimistic-${Date.now()}`,
          agentId: targetId,
          kind: "user_message",
          payload: { text, role: "user" },
          createdAt: new Date().toISOString(),
        };
        detail.setData((prev: OfficeDetail | null) =>
          prev && prev.agent?.id === targetId
            ? { ...prev, events: [optimistic, ...prev.events] }
            : prev,
        );
      }
      const res = await fetch("/api/office/act", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: targetId, kind, ...(payload ?? {}) }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error || "Action impossible");
      return true;
    },
    [selectedId, detail],
  );

  const onAction = useCallback(
    async (kind: OfficeCommandKind | "clear", payload?: { text?: string }, agentId?: string) => {
      const targetId = agentId ?? selectedId;
      if (!targetId) return false;
      const rawText = payload?.text?.trim() ?? "";
      setBusy(true);
      setActionError("");

      try {
        if (kind === "clear") {
          const res = await fetch("/api/office/act", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ agentId: targetId, kind: "clear" }),
          });
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error || "Clear impossible");
          }
          await Promise.all([refresh(), detail.refresh(), refreshFeed()]);
          return true;
        }

        if (kind === "message" && rawText) {
          const parsed = parseMention(rawText, agents);
          if (parsed.target.kind === "all") {
            if (parseMeetingIntent(parsed.text)) {
              setSelectedId("openclaw:office");
              await actOnce("message", "openclaw:office", { text: parsed.text });
              await Promise.all([refresh(), detail.refresh(), refreshFeed()]);
              return true;
            }
            const targets = allMentionTargets(agents);
            if (targets.length === 0) throw new Error("Aucun agent pour @all");
            for (const a of targets) {
              await actOnce("message", a.id, { text: parsed.text });
            }
            setSelectedId("openclaw:office");
            await Promise.all([refresh(), detail.refresh(), refreshFeed()]);
            return true;
          }
          if (parsed.target.kind === "agent") {
            setSelectedId(parsed.target.agentId);
            await actOnce("message", parsed.target.agentId, { text: parsed.text });
            await Promise.all([refresh(), detail.refresh(), refreshFeed()]);
            return true;
          }
        }

        if (targetId !== selectedId) setSelectedId(targetId);
        await actOnce(kind, targetId, payload);
        await Promise.all([refresh(), detail.refresh(), refreshFeed()]);
        return true;
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Réseau indisponible");
        await detail.refresh();
        return false;
      } finally {
        setBusy(false);
      }
    },
    [selectedId, agents, actOnce, detail, refresh, refreshFeed],
  );

  const pick = useCallback((id: string | null) => {
    setActionError("");
    if (id === null) {
      setSelectedId("openclaw:office");
      return;
    }
    setSelectedId(id);
  }, []);

  const onlineCount = useMemo(() => agents.filter((a) => a.status !== "offline").length, [agents]);
  const [tabCounts, setTabCounts] = useState({ projects: 0, teams: 0 });

  const refreshTabCounts = useCallback(async () => {
    try {
      const [pr, tm] = await Promise.all([
        fetch("/api/office/projects", { cache: "no-store" }),
        fetch("/api/office/teams", { cache: "no-store" }),
      ]);
      if (pr.ok) {
        const j = (await pr.json()) as { projects?: Array<{ status: string }> };
        const active = (j.projects ?? []).filter((p) => p.status === "active").length;
        setTabCounts((c) => ({ ...c, projects: active }));
      }
      if (tm.ok) {
        const j = (await tm.json()) as { teams?: unknown[] };
        setTabCounts((c) => ({ ...c, teams: (j.teams ?? []).length }));
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refreshTabCounts();
    const t = setInterval(() => void refreshTabCounts(), 15_000);
    return () => clearInterval(t);
  }, [refreshTabCounts]);

  return (
    <div className={`${pixelBody.className} pixel-world`}>
      {error && (
        <p className="mb-2 border-4 border-red-800 bg-red-950 px-4 py-3 text-lg text-red-200">{error}</p>
      )}

      <nav className="pixel-tabs pixel-hq-tabs" aria-label="Vues bureau" data-active={tab}>
        <span className="pixel-tabs-indicator" aria-hidden />
        {TABS.map(({ id, label, icon }) => (
          <button
            key={id}
            type="button"
            className={`pixel-tab pixel-hq-tab ${tab === id ? "is-on" : ""}`}
            onClick={() => setTab(id)}
            data-tab={id}
            aria-current={tab === id ? "page" : undefined}
          >
            <span className="pixel-tab-icon" aria-hidden>{icon}</span>
            <span className="pixel-tab-label">{label}</span>
            {id === "bureau" && onlineCount > 0 ? (
              <span className="pixel-tab-count" title={`${onlineCount} agent${onlineCount !== 1 ? "s" : ""} en ligne`}>
                {onlineCount}
              </span>
            ) : null}
            {id === "projets" && tabCounts.projects > 0 ? (
              <span className="pixel-tab-count pixel-tab-count-projects" title={`${tabCounts.projects} projet${tabCounts.projects !== 1 ? "s" : ""} actif${tabCounts.projects !== 1 ? "s" : ""}`}>
                {tabCounts.projects}
              </span>
            ) : null}
            {id === "orga" && tabCounts.teams > 0 ? (
              <span className="pixel-tab-count pixel-tab-count-teams" title={`${tabCounts.teams} équipe${tabCounts.teams !== 1 ? "s" : ""}`}>
                {tabCounts.teams}
              </span>
            ) : null}
          </button>
        ))}
      </nav>

      {loading && !data ? (
        <div className="pixel-bureau-layout pixel-bureau-skeleton" aria-busy="true" aria-label="Chargement du bureau">
          <div className="pixel-section pixel-section-strip">
            <div className="pixel-skeleton-bar h-10" />
          </div>
          <div className="pixel-section pixel-section-floor">
            <div className="pixel-skeleton-panel h-full min-h-[280px]" />
          </div>
          <div className="pixel-section pixel-section-logs">
            <div className="pixel-skeleton-panel h-56" />
          </div>
          <div className="pixel-section pixel-section-console">
            <div className="pixel-skeleton-panel h-40" />
          </div>
        </div>
      ) : tab === "pipeline" ? (
        <div className="pixel-pipeline-page">
          <PmOrchestrationBoard agents={agents} />
        </div>
      ) : tab === "projets" ? (
        <ProjectBoard
          onContinue={(project) => {
            setTab("bureau");
            setSelectedId(project.agentId || "openclaw:chef");
          }}
        />
      ) : tab === "orga" ? (
        <OrganisationView agents={agents} />
      ) : (
        <div className={`pixel-bureau-layout ${mobileDrawer ? "has-mobile-drawer" : ""} ${mobileDrawer && !consoleCollapsed ? "is-drawer-expanded" : ""}`}>
          <section className="pixel-section pixel-section-strip">
            <TaskStrip />
          </section>

          <section className="pixel-section pixel-section-floor">
            <div className="pixel-stage pixel-stage-floor">
              <OfficeFloor
                agents={agents}
                sources={sources}
                selectedId={selectedId}
                onSelect={pick}
                hideOffline={hideOffline}
                onToggleOffline={() => setHideOffline((v) => !v)}
                onOpenLibrary={() => setLibraryOpen(true)}
              />
            </div>
          </section>

          <ProjectsLibraryModal open={libraryOpen} onClose={() => setLibraryOpen(false)} />

          <section className="pixel-section pixel-section-logs">
            <AgentLogsPanel agentId={selectedId} agents={agents} globalEvents={globalEvents} />
          </section>

          {mobileDrawer && !consoleCollapsed ? (
            <button
              type="button"
              className="pixel-console-drawer-scrim"
              aria-label="Fermer la console"
              onClick={() => setConsoleCollapsed(true)}
            />
          ) : null}

          <section
            className={`pixel-section pixel-section-console ${mobileDrawer ? "is-mobile-drawer" : ""} ${!consoleCollapsed ? "is-drawer-open" : ""}`}
          >
            <OfficeConsole
              agents={agents}
              selectedId={selectedId}
              onSelect={pick}
              events={detail.data?.events ?? []}
              globalEvents={globalEvents}
              pendingCommands={detail.data?.pendingCommands ?? []}
              sources={sources}
              busy={busy}
              actionError={actionError}
              onAction={onAction}
              collapsed={consoleCollapsed}
              onToggleCollapse={() => setConsoleCollapsed((v) => !v)}
              feedLoading={feedLoading}
              feedRefreshing={feedRefreshing}
            />
            {consoleCollapsed && (
              <p className="pixel-console-hint">
                {onlineCount} agent{onlineCount !== 1 ? "s" : ""} en ligne
                {selected ? ` · ${selected.name}` : ""}
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
