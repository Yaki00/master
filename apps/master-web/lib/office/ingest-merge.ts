import type { OfficeAgent, OfficeStatus } from "./types";

export type IngestPatch = {
  status: OfficeStatus;
  task: string | null;
  currentAction: string | null;
  meta: Record<string, unknown>;
};

export type MergeIngestOpts = {
  /** Une commande queued/claimed existe encore pour cet agent. */
  liveCommand?: boolean;
};

/**
 * L’ingest disque ne doit pas annuler une pause / un message en cours
 * tant que la session n’est pas vraiment working à nouveau.
 * Un `pendingCommand: "message"` sans commande live ne doit pas bloquer working.
 */
export function mergeIngestStatus(
  existing: OfficeAgent | null,
  incoming: IngestPatch,
  opts: MergeIngestOpts = {},
): IngestPatch {
  const pending = existing?.meta.pendingCommand;
  const meta = { ...incoming.meta };

  if (incoming.status === "working") {
    delete meta.pendingCommand;
    return { ...incoming, meta };
  }

  if (pending === "pause" && existing) {
    if (opts.liveCommand || existing.meta.pauseRequested === true) {
      return {
        status: "working",
        task: existing.task ?? incoming.task,
        currentAction: existing.currentAction ?? "pause demandée…",
        meta: { ...meta, pendingCommand: "pause", pauseRequested: true },
      };
    }
    return {
      status: "waiting",
      task: existing.task,
      currentAction: existing.currentAction ?? "pause demandée",
      meta: { ...meta, pendingCommand: "pause" },
    };
  }

  if (pending === "message" && existing) {
    if (opts.liveCommand) {
      return {
        status: "working",
        task: existing.task ?? incoming.task,
        currentAction: existing.currentAction ?? "message",
        meta: { ...meta, pendingCommand: "message" },
      };
    }
    delete meta.pendingCommand;
    return { ...incoming, meta };
  }

  if (pending === "meeting" && existing) {
    return {
      status: "working",
      task: existing.task ?? incoming.task,
      currentAction: existing.currentAction ?? "réunion",
      meta: {
        ...meta,
        pendingCommand: "meeting",
        meetingTaskId: existing.meta.meetingTaskId,
      },
    };
  }

  if (pending === "stop" && existing) {
    if (opts.liveCommand || existing.meta.stopRequested === true) {
      return {
        status: "working",
        task: existing.task ?? incoming.task,
        currentAction: existing.currentAction ?? "stop demandé…",
        meta: { ...meta, pendingCommand: "stop", stopRequested: true },
      };
    }
    return {
      status: "idle",
      task: null,
      currentAction: existing.currentAction ?? "stop demandé",
      meta: { ...meta, pendingCommand: "stop" },
    };
  }

  return { ...incoming, meta };
}
