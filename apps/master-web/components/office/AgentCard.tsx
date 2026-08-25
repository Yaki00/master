"use client";

import type { OfficeAgent, OfficeStatus } from "@/lib/office/types";

const STATUS_LABEL: Record<OfficeStatus, string> = {
  working: "En cours",
  idle: "Idle",
  waiting: "En attente",
  error: "Erreur",
  offline: "Hors ligne",
};

const STATUS_DOT: Record<OfficeStatus, string> = {
  working: "bg-emerald-400",
  idle: "bg-zinc-400",
  waiting: "bg-amber-400",
  error: "bg-red-400",
  offline: "bg-zinc-600",
};

const KIND_LABEL: Record<OfficeAgent["kind"], string> = {
  openclaw: "OpenClaw",
  pc: "PC",
  job: "Job",
};

export function agentInitial(name: string): string {
  const trimmed = name.trim();
  return (trimmed[0] ?? "?").toUpperCase();
}

export function AgentCard({
  agent,
  selected,
  onSelect,
}: {
  agent: OfficeAgent;
  selected?: boolean;
  onSelect: (id: string) => void;
}) {
  const working = agent.status === "working";

  return (
    <button
      type="button"
      onClick={() => onSelect(agent.id)}
      className={`group w-full rounded-xl border p-3 text-left transition ${
        selected
          ? "border-blue-500/50 bg-blue-600/10 ring-1 ring-blue-500/30"
          : "border-surface-border/80 bg-surface/70 hover:border-zinc-500/40 hover:bg-surface-raised"
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-sm font-semibold text-white ring-1 ring-white/10">
          {agentInitial(agent.name)}
          <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3">
            {working && (
              <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${STATUS_DOT[agent.status]}`} />
            )}
            <span className={`relative inline-flex h-3 w-3 rounded-full ring-2 ring-surface ${STATUS_DOT[agent.status]}`} />
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-white">{agent.name}</p>
            <span className="shrink-0 rounded-md bg-zinc-800/80 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500">
              {KIND_LABEL[agent.kind]}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-zinc-500">{STATUS_LABEL[agent.status]}</p>
          <p className="mt-1 truncate text-xs text-zinc-400" title={agent.task ?? undefined}>
            {agent.task || agent.currentAction || "Aucune tâche"}
          </p>
        </div>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-zinc-800">
        <div
          className={`h-full rounded-full ${
            working ? "w-2/3 animate-pulse bg-emerald-400/80" : agent.status === "waiting" ? "w-1/3 bg-amber-400/70" : "w-0 bg-transparent"
          }`}
        />
      </div>
    </button>
  );
}
