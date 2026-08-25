"use client";

import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  agentStatusLabel,
  bubbleAlign,
  eventsToBubbles,
  formatBubbleTime,
  formatTimeSeparator,
  needsTimeSeparator,
  resolveBubbleRole,
  rosterTaskLine,
} from "@/lib/office/chat";
import { feedToBubbles, type FeedBubble } from "@/lib/office/feed";
import { displayName, runtimeRouteHint } from "@/lib/office/labels";
import { parseMention, suggestMentions } from "@/lib/office/mentions";
import { agentRole, roleLabel } from "@/lib/office/role";
import { availableActions, messagePlaceholder, primarySendLabel } from "@/lib/office/actions-ui";
import type { OfficeAgent, OfficeCommand, OfficeCommandKind, OfficeEvent, OfficeSources } from "@/lib/office/types";
import { PixelSprite } from "./PixelSprite";

type ViewMode = "global" | "bot";

const QUICK_MENTIONS = [
  { token: "@chef ", label: "@chef" },
  { token: "@mgr-dev ", label: "@mgr-dev" },
  { token: "@mgr-lab ", label: "@mgr-lab" },
  { token: "@all ", label: "@all" },
];

const ROSTER_SORT = (a: OfficeAgent, b: OfficeAgent) => {
  const rank = (s: OfficeAgent["status"]) =>
    s === "working" ? 0 : s === "waiting" ? 1 : s === "idle" ? 2 : s === "error" ? 3 : 4;
  const dr = rank(a.status) - rank(b.status);
  if (dr !== 0) return dr;
  return a.id.localeCompare(b.id);
};

const MIN_ROSTER_WIDTH = 140;
const MAX_ROSTER_WIDTH = 280;
const DEFAULT_ROSTER_WIDTH = 196;
const ROSTER_STORAGE_KEY = "pixel-console-roster-width-v1";

function loadRosterWidth(): number {
  if (typeof window === "undefined") return DEFAULT_ROSTER_WIDTH;
  try {
    const raw = localStorage.getItem(ROSTER_STORAGE_KEY);
    const n = raw ? Number(raw) : DEFAULT_ROSTER_WIDTH;
    if (!Number.isFinite(n)) return DEFAULT_ROSTER_WIDTH;
    return Math.min(MAX_ROSTER_WIDTH, Math.max(MIN_ROSTER_WIDTH, n));
  } catch {
    return DEFAULT_ROSTER_WIDTH;
  }
}

function FeedSkeleton() {
  return (
    <div className="pixel-feed-skeleton" aria-hidden>
      <div className="pixel-feed-skeleton-row">
        <span className="pixel-feed-skeleton-avatar" />
        <span className="pixel-feed-skeleton-bubble w-60" />
      </div>
      <div className="pixel-feed-skeleton-row align-right">
        <span className="pixel-feed-skeleton-bubble w-45" />
      </div>
      <div className="pixel-feed-skeleton-row">
        <span className="pixel-feed-skeleton-avatar" />
        <span className="pixel-feed-skeleton-bubble w-70" />
      </div>
    </div>
  );
}

export function OfficeConsole({
  agents,
  selectedId,
  onSelect,
  events,
  globalEvents,
  pendingCommands,
  sources,
  busy,
  actionError,
  onAction,
  collapsed,
  onToggleCollapse,
  feedLoading,
  feedRefreshing,
}: {
  agents: OfficeAgent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  events: OfficeEvent[];
  globalEvents?: OfficeEvent[];
  pendingCommands: OfficeCommand[];
  sources: Pick<OfficeSources, "mac" | "pc">;
  busy?: boolean;
  actionError?: string;
  onAction?: (
    kind: OfficeCommandKind | "clear",
    payload?: { text?: string },
    agentId?: string,
  ) => Promise<boolean>;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  feedLoading?: boolean;
  feedRefreshing?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [view, setView] = useState<ViewMode>("bot");
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [rosterWidth, setRosterWidth] = useState(DEFAULT_ROSTER_WIDTH);
  const [rosterDragging, setRosterDragging] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const rosterDragRef = useRef<{ startX: number; startW: number } | null>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);

  useEffect(() => {
    setRosterWidth(loadRosterWidth());
  }, []);

  const focusId = selectedId ?? agents.find((a) => a.id === "openclaw:office")?.id ?? agents[0]?.id ?? null;
  const agent = agents.find((a) => a.id === focusId) ?? null;

  const botBubbles = useMemo(
    () => eventsToBubbles(events, pendingCommands).slice(-40),
    [events, pendingCommands],
  );
  const globalBubbles = useMemo(
    () => feedToBubbles(globalEvents ?? events, agents, 50),
    [globalEvents, events, agents],
  );
  const bubbles = view === "global" ? globalBubbles : botBubbles;

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onScroll = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
      setShowScrollDown(!nearBottom);
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [focusId, view]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) {
      el.scrollTop = el.scrollHeight;
      setShowScrollDown(false);
    }
  }, [bubbles.length, focusId, view]);

  function scrollFeedToBottom() {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setShowScrollDown(false);
  }

  useEffect(() => {
    setDraft("");
    setConfirmClear(false);
    setConfirmStop(false);
  }, [focusId]);

  const hasPending = botBubbles.some((b) => b.pending);

  const pendingAnnouncement = useMemo(() => {
    if (view !== "bot" || !hasPending) return "";
    const thinking = botBubbles.find((b) => b.pending && b.role === "agent" && (b.text === "…" || b.text.startsWith("…")));
    if (!thinking) return "";
    const age = Math.max(0, Math.floor((nowMs - Date.parse(thinking.at)) / 1000));
    const who = agent ? displayName(agent) : "Agent";
    return age > 0 ? `${who} réfléchit depuis ${age} seconde${age !== 1 ? "s" : ""}` : `${who} réfléchit`;
  }, [view, hasPending, botBubbles, nowMs, agent]);

  const applyRosterWidth = useCallback((px: number) => {
    const clamped = Math.min(MAX_ROSTER_WIDTH, Math.max(MIN_ROSTER_WIDTH, px));
    setRosterWidth(clamped);
    try {
      localStorage.setItem(ROSTER_STORAGE_KEY, String(clamped));
    } catch {
      /* ignore */
    }
  }, []);

  const onRosterDragMove = useCallback(
    (clientX: number) => {
      const drag = rosterDragRef.current;
      if (!drag) return;
      applyRosterWidth(drag.startW + (clientX - drag.startX));
    },
    [applyRosterWidth],
  );

  useEffect(() => {
    if (!rosterDragging) return;
    const onMove = (e: MouseEvent | TouchEvent) => {
      const x = "touches" in e ? (e.touches[0]?.clientX ?? 0) : e.clientX;
      onRosterDragMove(x);
    };
    const onUp = () => {
      rosterDragRef.current = null;
      setRosterDragging(false);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
    };
  }, [rosterDragging, onRosterDragMove]);

  const startRosterDrag = useCallback(
    (clientX: number) => {
      rosterDragRef.current = { startX: clientX, startW: rosterWidth };
      setRosterDragging(true);
    },
    [rosterWidth],
  );
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!hasPending) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [hasPending]);

  const actions = useMemo(() => availableActions(agent, sources), [agent, sources]);
  const messageAction = actions.find((a) => a.kind === "message");
  const sideActions = actions.filter((a) => a.kind === "pause" || a.kind === "stop" || a.kind === "resume");
  const mention = useMemo(() => parseMention(draft, agents), [draft, agents]);
  const mentionSuggestions = useMemo(() => suggestMentions(draft, agents), [draft, agents]);
  const mentionChips = mentionSuggestions.length > 0 ? mentionSuggestions : QUICK_MENTIONS;
  const sendText = draft.trim();
  const canMessage = Boolean(
    onAction && agent && messageAction && !messageAction.disabledReason && !busy && sendText,
  );

  function applyMentionToken(token: string) {
    const mention = `${token.trim()} `;
    setDraft((d) => {
      const partial = d.match(/@[\w-]*$/);
      if (partial) {
        return d.slice(0, partial.index!) + mention;
      }
      const sep = d.length > 0 && !/\s$/.test(d) ? " " : "";
      return `${d}${sep}${mention}`;
    });
    setConfirmClear(false);
    setConfirmStop(false);
    inputRef.current?.focus();
  }

  async function submit() {
    if (!onAction || !canMessage || !focusId) return;
    const ok = await onAction("message", { text: draft.trim() }, focusId);
    if (ok) setDraft("");
  }

  async function clearChat() {
    if (!onAction || !focusId || busy) return;
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setConfirmClear(false);
    await onAction("clear", undefined, focusId);
  }

  async function runSide(kind: OfficeCommandKind, needsConfirm?: boolean) {
    if (!onAction || !focusId || busy) return;
    if (needsConfirm) {
      if (!confirmStop) {
        setConfirmStop(true);
        return;
      }
      setConfirmStop(false);
    } else {
      setConfirmStop(false);
    }
    await onAction(kind, undefined, focusId);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void submit();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") {
      if (confirmClear || confirmStop) {
        e.preventDefault();
        setConfirmClear(false);
        setConfirmStop(false);
      }
      return;
    }
    if (e.key === "Tab" && mentionSuggestions[0]) {
      e.preventDefault();
      applyMentionToken(mentionSuggestions[0].token);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }

  function bubbleText(b: { role: string; text: string; at: string; pending?: boolean }): string {
    if (b.pending && b.role === "agent" && (b.text === "…" || b.text.startsWith("…"))) {
      const age = Math.max(0, Math.floor((nowMs - Date.parse(b.at)) / 1000));
      return age > 0 ? `${age}s` : "";
    }
    return b.text;
  }

  function isPendingThinking(b: { role: string; text: string; pending?: boolean }): boolean {
    return Boolean(
      b.pending && b.role === "agent" && (b.text === "…" || b.text.startsWith("…")),
    );
  }

  const roster = useMemo(
    () => [...agents].filter((a) => a.status !== "offline").sort(ROSTER_SORT).slice(0, 14),
    [agents],
  );

  if (collapsed) {
    return (
      <div className="pixel-console is-collapsed">
        <button type="button" className="pixel-console-expand" onClick={onToggleCollapse}>
          CONSOLE · {agent ? displayName(agent) : "bureau"} · clic pour ouvrir
        </button>
      </div>
    );
  }

  const headTitle =
    view === "global" ? (
      <>Fil global</>
    ) : agent ? (
      <>{displayName(agent)}</>
    ) : (
      "Console"
    );

  const headSubtitle =
    view === "global"
      ? "Tous les agents"
      : agent
        ? runtimeRouteHint(agent) ?? roleLabel(agentRole(agent))
        : null;

  return (
    <div
      className={`pixel-console ${rosterDragging ? "is-resizing" : ""}`}
      style={{ "--pixel-console-roster-width": `${rosterWidth}px` } as React.CSSProperties}
    >
      <aside className="pixel-console-roster pixel-roster" aria-label="Agents">
        <button
          type="button"
          className={`pixel-roster-card is-global ${view === "global" ? "is-on" : ""}`}
          onClick={() => setView("global")}
        >
          <span className="pixel-roster-icon" aria-hidden>
            ◈
          </span>
          <span className="pixel-roster-meta">
            <span className="pixel-roster-top">
              <strong>Global</strong>
              <span className="pixel-roster-badge status-idle">ALL</span>
            </span>
            <em className="pixel-roster-task">Fil multi-agents</em>
          </span>
        </button>
        {roster.map((a) => {
          const role = agentRole(a);
          const on = a.id === focusId && view === "bot";
          const taskLine = rosterTaskLine(a);
          return (
            <button
              key={a.id}
              type="button"
              className={`pixel-roster-card role-${role} ${on ? "is-on" : ""} status-${a.status}`}
              onClick={() => {
                setView("bot");
                onSelect(a.id);
              }}
              title={`${displayName(a)} · ${taskLine}`}
            >
              <PixelSprite
                agent={a}
                pose={a.status === "waiting" ? "sit" : a.status === "working" ? "work" : "stand"}
                size={28}
                motion="frozen"
              />
              <span className="pixel-roster-meta">
                <span className="pixel-roster-top">
                  <strong>{displayName(a)}</strong>
                  <span className={`pixel-roster-badge status-${a.status}`}>
                    {agentStatusLabel(a.status)}
                  </span>
                </span>
                <em className="pixel-roster-task">{taskLine}</em>
              </span>
            </button>
          );
        })}
      </aside>

      <div
        className="pixel-console-split-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Redimensionner le roster"
        tabIndex={0}
        onMouseDown={(e) => startRosterDrag(e.clientX)}
        onTouchStart={(e) => startRosterDrag(e.touches[0]?.clientX ?? 0)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") applyRosterWidth(rosterWidth - 12);
          if (e.key === "ArrowRight") applyRosterWidth(rosterWidth + 12);
        }}
      />

      <div className="pixel-console-main">
        <header className="pixel-console-head">
          <div className="pixel-console-head-main">
            {view === "bot" && agent ? (
              <PixelSprite
                agent={agent}
                pose={agent.status === "working" ? "work" : agent.status === "waiting" ? "sit" : "stand"}
                size={34}
                motion="frozen"
              />
            ) : (
              <span className="pixel-console-head-icon" aria-hidden>
                ◈
              </span>
            )}
            <div className="pixel-console-head-text">
              <span className="pixel-console-title">{headTitle}</span>
              {headSubtitle ? (
                <span className="pixel-console-subtitle">{headSubtitle}</span>
              ) : null}
            </div>
            {agent && view === "bot" && (
              <span className={`pixel-console-status-pill status-${agent.status}`}>
                <span className="pixel-console-status-dot" aria-hidden />
                {agent.status === "working" ? "Working" : agent.status === "idle" ? "Idle" : agentStatusLabel(agent.status)}
              </span>
            )}
          </div>
          <span className="pixel-console-head-actions">
            <div className="pixel-console-segment" role="group" aria-label="Sources et session">
              <span
                className={`pixel-console-seg ${sources.mac.online ? "is-on" : ""}`}
                title="Mac OpenClaw"
              >
                Mac
              </span>
              <span
                className={`pixel-console-seg ${sources.pc.online ? "is-on" : ""}`}
                title="PC worker"
              >
                PC
              </span>
              {view === "bot" && focusId && (
                <button
                  type="button"
                  className={`pixel-console-seg pixel-console-seg-btn ${confirmClear ? "is-armed" : ""}`}
                  disabled={busy}
                  onClick={() => void clearChat()}
                >
                  {confirmClear ? "Confirmer ?" : "Nouvelle demande"}
                </button>
              )}
            </div>
            {view === "bot" &&
              agent &&
              sideActions.map((a) => {
                const confirming = a.needsConfirm && confirmStop && a.kind === "stop";
                return (
                  <button
                    key={a.kind}
                    type="button"
                    className={`pixel-btn ghost compact ${a.danger ? (confirming ? "red-hot" : "red") : "amber"}`}
                    disabled={busy || Boolean(a.disabledReason)}
                    title={a.disabledReason}
                    onClick={() => void runSide(a.kind, a.needsConfirm)}
                  >
                    {confirming ? `Confirmer ${a.label}` : a.label}
                  </button>
                );
              })}
            {onToggleCollapse && (
              <button type="button" className="pixel-btn ghost compact" onClick={onToggleCollapse} aria-label="Réduire">
                −
              </button>
            )}
          </span>
        </header>

        <div
          className={`pixel-console-feed-wrap ${feedLoading && view === "global" ? "is-feed-loading" : ""}${showScrollDown ? " has-scroll-hint" : ""}`}
        >
          <div className="pixel-sr-live" aria-live="assertive" aria-atomic="true">
            {pendingAnnouncement}
          </div>
          {feedLoading && view === "global" && bubbles.length === 0 ? <FeedSkeleton /> : null}
          <ol ref={listRef} className="pixel-console-feed pixel-chat" aria-live="polite" aria-busy={feedRefreshing || undefined}>
            {bubbles.length === 0 && !feedLoading ? (
              <li className="pixel-chat-empty">
                <span className="pixel-chat-empty-icon" aria-hidden>
                  ◎
                </span>
                <p className="pixel-chat-empty-title">Aucun message pour l&apos;instant</p>
                <p className="pixel-chat-empty-hint">
                  {view === "global"
                    ? "Les échanges de tous les agents apparaîtront ici."
                    : agent
                      ? `Envoie un message à ${displayName(agent)} ou tape @chef pour déléguer.`
                      : "Choisis un agent dans le roster pour commencer."}
                </p>
              </li>
            ) : (
              bubbles.map((b, index) => {
                const prev = index > 0 ? bubbles[index - 1] : null;
                const fb = b as FeedBubble & {
                  spawn?: boolean;
                  pending?: boolean;
                };
                const prevFb = prev as FeedBubble | null;
                const grouped =
                  prev &&
                  !(fb.spawn || prevFb?.spawn) &&
                  (view === "global"
                    ? fb.agentId === prevFb?.agentId && prev.role === b.role
                    : prev.role === b.role);
                const agentBlockStart =
                  view === "global" &&
                  fb.agentId &&
                  b.role !== "user" &&
                  (!prev || prevFb?.agentId !== fb.agentId);
                const showAgentDivider = agentBlockStart && index > 0;
                const showSeparator = needsTimeSeparator(prev?.at, b.at);
              const bubbleAgent =
                view === "global" && fb.agentId
                  ? agents.find((x) => x.id === fb.agentId) ?? null
                  : agent;
              const visualRole = resolveBubbleRole(
                b.role as "user" | "agent" | "system",
                bubbleAgent,
              );
              const align = bubbleAlign(b.role as "user" | "agent" | "system");
              const showAvatar =
                view === "global" && Boolean(bubbleAgent) && b.role !== "user" && !fb.spawn;
              const who =
                view === "global"
                  ? fb.role === "user"
                    ? "TOI"
                    : fb.spawn
                      ? "SPAWN"
                      : fb.roleTag || fb.agentLabel || "AGT"
                  : fb.role === "user"
                    ? "TOI"
                    : fb.role === "system"
                      ? "SEC"
                      : agent
                        ? roleLabel(agentRole(agent))
                        : "AGT";

              return (
                <li
                  key={b.id}
                  className={`pixel-chat-row align-${align} ${b.pending ? "is-pending" : ""} ${fb.spawn ? "is-spawn" : ""} ${grouped ? "is-grouped" : ""} ${view === "global" && grouped && fb.agentId ? "is-agent-grouped" : ""} ${showAvatar ? "has-avatar" : ""}`}
                >
                  {showAgentDivider && fb.agentLabel ? (
                    <div className="pixel-agent-divider">
                      <strong>{fb.agentLabel}</strong>
                    </div>
                  ) : null}
                  {showSeparator ? (
                    <div className="pixel-chat-time-sep" aria-hidden>
                      <span>{formatTimeSeparator(b.at, nowMs)}</span>
                    </div>
                  ) : null}
                  {showAvatar ? (
                    grouped ? (
                      <span className="pixel-bubble-avatar is-spacer" aria-hidden />
                    ) : (
                      <span className="pixel-bubble-avatar" aria-hidden>
                        <PixelSprite
                          agent={bubbleAgent!}
                          pose={
                            bubbleAgent!.status === "working"
                              ? "work"
                              : bubbleAgent!.status === "waiting"
                                ? "sit"
                                : "stand"
                          }
                          size={22}
                          motion="frozen"
                        />
                      </span>
                    )
                  ) : null}
                  <article
                    className={`pixel-bubble ${b.role} role-${visualRole} ${b.pending ? "is-pending" : ""} ${fb.spawn ? "is-spawn" : ""}`}
                  >
                    {!grouped ? (
                      <header className="pixel-bubble-head">
                        <span className="pixel-bubble-tag">{who}</span>
                        {view === "global" && fb.agentLabel && fb.role !== "user" ? (
                          <span className="pixel-bubble-agent">{fb.agentLabel}</span>
                        ) : null}
                        <time className="pixel-bubble-time" dateTime={b.at}>
                          {formatBubbleTime(b.at)}
                        </time>
                      </header>
                    ) : (
                      <time className="pixel-bubble-time is-inline" dateTime={b.at}>
                        {formatBubbleTime(b.at)}
                      </time>
                    )}
                    <p className="pixel-bubble-body">
                      {isPendingThinking(b) ? (
                        <span className="pixel-pending-body">
                          <span className="pixel-typing-dots" aria-hidden>
                            <span />
                            <span />
                            <span />
                          </span>
                          <span className="pixel-pending-label">
                            réfléchit
                            {bubbleText(b) ? ` · ${bubbleText(b)}` : ""}
                          </span>
                        </span>
                      ) : (
                        bubbleText(b)
                      )}
                    </p>
                  </article>
                </li>
              );
            })
          )}
          </ol>
        </div>

        {showScrollDown && bubbles.length > 0 ? (
          <button
            type="button"
            className="pixel-chat-scroll-down"
            onClick={scrollFeedToBottom}
            aria-label="Aller aux messages récents"
          >
            ↓ récents
          </button>
        ) : null}

        <div className="pixel-compose">
          {actionError && (
            <p className="pixel-console-err" role="alert">
              {actionError}
            </p>
          )}

          <div className="pixel-compose-mentions">
            {mentionChips.map((m) => (
              <button
                key={m.token}
                type="button"
                className={`pixel-compose-mention ${mentionSuggestions.length > 0 ? "is-suggest" : ""}`}
                onClick={() => applyMentionToken(m.token)}
              >
                {m.label}
              </button>
            ))}
          </div>

          <form onSubmit={onSubmit} className="pixel-compose-form">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setConfirmClear(false);
                setConfirmStop(false);
              }}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder={
                agent ? `${messagePlaceholder(agent)} · @ pour mentionner` : "@chef … ou choisis un agent"
              }
              disabled={!agent || Boolean(messageAction?.disabledReason)}
              className="pixel-input pixel-compose-input"
            />
            <button type="submit" disabled={!canMessage} className="pixel-btn blue pixel-btn-send pixel-compose-send">
              {busy
                ? "…"
                : mention.target.kind === "all"
                  ? "@ALL"
                  : agent
                    ? primarySendLabel(agent, mention.target.kind === "none" ? draft : mention.text)
                    : "—"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
