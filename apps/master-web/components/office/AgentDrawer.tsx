"use client";

import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { DetailDrawer } from "@/components/ui/DetailDrawer";
import {
  availableActions,
  messagePlaceholder,
  primarySendLabel,
  resolvePrimarySend,
} from "@/lib/office/actions-ui";
import { eventsToBubbles } from "@/lib/office/chat";
import { cleanTask, displayName } from "@/lib/office/labels";
import type {
  OfficeAgent,
  OfficeCommand,
  OfficeCommandKind,
  OfficeEvent,
  OfficeSources,
  OfficeStatus,
} from "@/lib/office/types";

const STATUS_LABEL: Record<OfficeStatus, string> = {
  working: "En cours",
  idle: "",
  waiting: "Attend une réponse",
  error: "Erreur",
  offline: "Hors ligne",
};

export function AgentDrawer({
  open,
  onClose,
  agent,
  sources,
  events,
  pendingCommands = [],
  loading,
  busy,
  actionError,
  onAction,
}: {
  open: boolean;
  onClose: () => void;
  agent: OfficeAgent | null;
  sources: Pick<OfficeSources, "mac" | "pc">;
  events: OfficeEvent[];
  pendingCommands?: OfficeCommand[];
  loading?: boolean;
  busy?: boolean;
  actionError?: string;
  onAction?: (kind: OfficeCommandKind, payload?: { text?: string }) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState("");
  const [confirmStop, setConfirmStop] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setDraft("");
    setConfirmStop(false);
  }, [agent?.id]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => window.clearTimeout(t);
  }, [open, agent?.id]);

  const bubbles = useMemo(() => eventsToBubbles(events, pendingCommands), [events, pendingCommands]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [bubbles.length, agent?.id]);

  const actions = useMemo(() => availableActions(agent, sources), [agent, sources]);
  const messageAction = actions.find((a) => a.kind === "message");
  const sideActions = actions.filter((a) => a.kind !== "message");
  const send = resolvePrimarySend(agent, draft);
  const canMessage = Boolean(onAction && messageAction && !messageAction.disabledReason && !busy && send);
  const task = agent ? cleanTask(agent.task) : null;
  const subtitle = agent ? STATUS_LABEL[agent.status] || undefined : undefined;

  async function submit() {
    if (!onAction || !send || !canMessage) return;
    const ok = await onAction(send.kind, send.text ? { text: send.text } : undefined);
    if (ok) setDraft("");
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await submit();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }

  async function runSide(kind: OfficeCommandKind, needsConfirm?: boolean) {
    if (!onAction || busy) return;
    if (needsConfirm) {
      if (!confirmStop) {
        setConfirmStop(true);
        return;
      }
      setConfirmStop(false);
    } else {
      setConfirmStop(false);
    }
    await onAction(kind);
  }

  const composer =
    onAction && agent ? (
      <div className="space-y-2">
        {messageAction?.disabledReason && (
          <p className="text-base text-amber-200">{messageAction.disabledReason}</p>
        )}
        <form onSubmit={onSubmit} className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            id="office-message"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={messagePlaceholder(agent)}
            disabled={Boolean(messageAction?.disabledReason)}
            className="pixel-input"
          />
          <button type="submit" disabled={!canMessage} className="pixel-btn blue pixel-btn-send">
            {busy ? "…" : primarySendLabel(agent, draft)}
          </button>
        </form>
        {sideActions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {sideActions.map((a) => {
              const confirming = a.needsConfirm && confirmStop && a.kind === "stop";
              return (
                <button
                  key={a.kind}
                  type="button"
                  disabled={busy || Boolean(a.disabledReason)}
                  title={a.disabledReason}
                  onClick={() => void runSide(a.kind, a.needsConfirm)}
                  className={`pixel-btn ghost ${a.danger ? (confirming ? "red-hot" : "red") : "amber"}`}
                >
                  {confirming ? `Confirmer ${a.label}` : a.label}
                </button>
              );
            })}
          </div>
        )}
        {actionError && <p className="text-base text-red-400">{actionError}</p>}
      </div>
    ) : undefined;

  return (
    <DetailDrawer
      open={open}
      onClose={onClose}
      title={agent ? displayName(agent) : "Agent"}
      subtitle={subtitle}
      className="pixel-drawer"
      mode="dock"
      footer={composer}
    >
      {!agent ? (
        <p className="text-sm text-zinc-500">Aucun agent sélectionné.</p>
      ) : (
        <div className="flex min-h-full flex-col">
          {task && agent.status !== "idle" && (
            <p className="mb-3 text-base text-[#c8e0c0]">{task}</p>
          )}

          {loading && bubbles.length === 0 ? (
            <p className="text-base text-zinc-600">Chargement…</p>
          ) : bubbles.length === 0 ? null : (
            <ol ref={listRef} className="space-y-2">
              {bubbles.map((b) => (
                <li
                  key={b.id}
                  className={`flex ${b.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`pixel-bubble ${b.role} ${b.pending ? "is-pending" : ""}`}
                  >
                    <p className="whitespace-pre-wrap break-words">{b.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </DetailDrawer>
  );
}
