"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { feedEventsToLogs, formatLogTime, type FeedLogKind } from "@/lib/office/feed-logs";
import type { OfficeAgent, OfficeEvent } from "@/lib/office/types";

type ScopeFilter = "all" | "agent";
type KindFilter = "all" | FeedLogKind;
type HeightPreset = "compact" | "normal" | "extended";

const HEIGHT_PRESETS: Record<HeightPreset, number> = {
  compact: 180,
  normal: 320,
  extended: 480,
};

const MIN_HEIGHT = 120;
const MAX_HEIGHT = 560;
const STORAGE_KEY = "pixel-logs-height-v1";

const KIND_FILTERS: Array<{ id: KindFilter; label: string }> = [
  { id: "all", label: "Tous" },
  { id: "spawn", label: "Spawn" },
  { id: "handoff", label: "Handoff" },
  { id: "error", label: "Erreur" },
  { id: "progress", label: "Progress" },
];

function loadStoredHeight(): { px: number; preset: HeightPreset | null } {
  if (typeof window === "undefined") return { px: HEIGHT_PRESETS.compact, preset: "compact" };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { px: HEIGHT_PRESETS.compact, preset: "compact" };
    const parsed = JSON.parse(raw) as { px?: number; preset?: HeightPreset | null };
    const px = typeof parsed.px === "number" ? parsed.px : HEIGHT_PRESETS.compact;
    return {
      px: Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, px)),
      preset: parsed.preset ?? null,
    };
  } catch {
    return { px: HEIGHT_PRESETS.compact, preset: "compact" };
  }
}

export function AgentLogsPanel({
  agentId,
  agents,
  globalEvents,
}: {
  agentId: string | null;
  agents: OfficeAgent[];
  globalEvents: OfficeEvent[];
}) {
  const [open, setOpen] = useState(true);
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [kind, setKind] = useState<KindFilter>("all");
  const [heightPx, setHeightPx] = useState(HEIGHT_PRESETS.compact);
  const [heightPreset, setHeightPreset] = useState<HeightPreset | null>("compact");
  const [dragging, setDragging] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  useEffect(() => {
    const stored = loadStoredHeight();
    setHeightPx(stored.px);
    setHeightPreset(stored.preset);
  }, []);

  const persistHeight = useCallback((px: number, preset: HeightPreset | null) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ px, preset }));
    } catch {
      /* ignore */
    }
  }, []);

  const applyHeight = useCallback(
    (px: number, preset: HeightPreset | null) => {
      const clamped = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, px));
      setHeightPx(clamped);
      setHeightPreset(preset);
      persistHeight(clamped, preset);
    },
    [persistHeight],
  );

  const onDragMove = useCallback(
    (clientY: number) => {
      const drag = dragRef.current;
      if (!drag) return;
      const delta = drag.startY - clientY;
      applyHeight(drag.startH + delta, null);
    },
    [applyHeight],
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent | TouchEvent) => {
      const y = "touches" in e ? (e.touches[0]?.clientY ?? 0) : e.clientY;
      onDragMove(y);
    };
    const onUp = () => {
      dragRef.current = null;
      setDragging(false);
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
  }, [dragging, onDragMove]);

  const startDrag = useCallback(
    (clientY: number) => {
      dragRef.current = { startY: clientY, startH: heightPx };
      setDragging(true);
    },
    [heightPx],
  );

  const filterAgentId = scope === "agent" ? agentId : null;

  const lines = useMemo(
    () =>
      feedEventsToLogs(globalEvents, agents, {
        agentId: filterAgentId,
        kind: kind === "all" ? "all" : kind,
        limit: 120,
      }),
    [globalEvents, agents, filterAgentId, kind],
  );

  useEffect(() => {
    const el = listRef.current;
    if (!el || !open) return;
    el.scrollTop = el.scrollHeight;
  }, [lines.length, open, scope, kind]);

  const agentShort = agentId?.replace(/^openclaw:/, "") ?? "—";
  const listMaxHeight = Math.max(80, heightPx - 12);

  return (
    <section
      className={`pixel-logs ${open ? "is-open" : ""} ${dragging ? "is-resizing" : ""}`}
      style={{ "--pixel-logs-height": `${heightPx}px` } as React.CSSProperties}
    >
      <header className="pixel-logs-head">
        <button type="button" className="pixel-logs-toggle" onClick={() => setOpen((v) => !v)}>
          <span className="pixel-logs-title">LOGS RÉFLEXION</span>
          <span className="pixel-logs-chevron">{open ? "−" : "+"}</span>
        </button>
        {open && (
          <>
            <div className="pixel-logs-height-presets" role="group" aria-label="Hauteur du panneau">
              {(Object.keys(HEIGHT_PRESETS) as HeightPreset[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`pixel-logs-height-btn ${heightPreset === p ? "is-on" : ""}`}
                  onClick={() => applyHeight(HEIGHT_PRESETS[p], p)}
                  title={p === "compact" ? "Compact" : p === "extended" ? "Étendu" : "Normal"}
                  aria-pressed={heightPreset === p}
                >
                  {p === "compact" ? "S" : p === "extended" ? "L" : "M"}
                </button>
              ))}
            </div>
            <div className="pixel-logs-filters">
              <button
                type="button"
                className={`pixel-logs-filter ${scope === "all" ? "is-on" : ""}`}
                onClick={() => setScope("all")}
              >
                Tous
              </button>
              <button
                type="button"
                className={`pixel-logs-filter ${scope === "agent" ? "is-on" : ""}`}
                onClick={() => setScope("agent")}
                disabled={!agentId}
                title={agentId ? `Filtrer ${agentShort}` : "Sélectionne un agent"}
              >
                {agentShort}
              </button>
              <span className="pixel-logs-filter-sep" aria-hidden />
              {KIND_FILTERS.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  className={`pixel-logs-filter kind-${k.id} ${kind === k.id ? "is-on" : ""}`}
                  onClick={() => setKind(k.id)}
                >
                  {k.label}
                </button>
              ))}
            </div>
          </>
        )}
      </header>
      {open && (
        <button
          type="button"
          className="pixel-logs-resize-handle"
          aria-label="Glisser pour ajuster la hauteur des logs"
          onMouseDown={(e) => {
            e.preventDefault();
            startDrag(e.clientY);
          }}
          onTouchStart={(e) => {
            const touch = e.touches[0];
            if (touch) startDrag(touch.clientY);
          }}
        >
          <span className="pixel-logs-resize-grip" aria-hidden />
        </button>
      )}
      <div className={`pixel-logs-body ${open ? "is-open" : ""}`}>
        <ol ref={listRef} className="pixel-logs-list" style={{ maxHeight: listMaxHeight }}>
          {lines.length === 0 ? (
            <li className="pixel-logs-empty">
              <span className="pixel-logs-pulse" aria-hidden />
              <span>
                {kind !== "all" || scope === "agent"
                  ? "Aucun log pour ce filtre"
                  : "En attente d'activité…"}
              </span>
              <p className="pixel-logs-empty-hint">
                {kind !== "all"
                  ? "Essaie un autre filtre ou repasse sur « Tous »."
                  : "Les réflexions et événements système des agents s'affichent ici en temps réel."}
              </p>
            </li>
          ) : (
            lines.map((l) => (
              <li key={l.id} className={`pixel-log kind-${l.kind}`}>
                <time dateTime={l.createdAt}>{formatLogTime(l.createdAt)}</time>
                <span className="who">{l.agentLabel}</span>
                <span className="msg">{l.text}</span>
              </li>
            ))
          )}
        </ol>
      </div>
    </section>
  );
}
