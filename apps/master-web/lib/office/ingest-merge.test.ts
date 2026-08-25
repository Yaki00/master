import { describe, expect, it } from "vitest";
import { mergeIngestStatus } from "./ingest-merge";
import type { OfficeAgent } from "./types";

function agent(partial: Partial<OfficeAgent> & Pick<OfficeAgent, "status">): OfficeAgent {
  return {
    id: "openclaw:main",
    kind: "openclaw",
    name: "Main",
    room: "waiting",
    task: "build",
    currentAction: "pause demandée",
    lastSeenAt: new Date().toISOString(),
    meta: {},
    ...partial,
  };
}

const idleIn = {
  status: "idle" as const,
  task: "rien",
  currentAction: "idle",
  meta: { source: "disk" },
};

describe("mergeIngestStatus", () => {
  it("garde working si pause locale avec commande live", () => {
    const existing = agent({ status: "working", meta: { pendingCommand: "pause", pauseRequested: true } });
    const next = mergeIngestStatus(existing, idleIn, { liveCommand: true });
    expect(next.status).toBe("working");
    expect(next.meta.pauseRequested).toBe(true);
  });

  it("garde waiting si pause locale ack sans commande live", () => {
    const existing = agent({ status: "waiting", meta: { pendingCommand: "pause" } });
    const next = mergeIngestStatus(existing, idleIn);
    expect(next.status).toBe("waiting");
    expect(next.meta.pendingCommand).toBe("pause");
    expect(next.task).toBe("build");
  });

  it("garde working si message live et ingest idle", () => {
    const existing = agent({
      status: "working",
      room: "dev",
      task: "ping",
      meta: { pendingCommand: "message" },
    });
    const next = mergeIngestStatus(existing, idleIn, { liveCommand: true });
    expect(next.status).toBe("working");
    expect(next.task).toBe("ping");
  });

  it("lève un pending message stale sans commande live", () => {
    const existing = agent({
      status: "working",
      room: "dev",
      task: "ping",
      meta: { pendingCommand: "message" },
    });
    const next = mergeIngestStatus(existing, idleIn, { liveCommand: false });
    expect(next.status).toBe("idle");
    expect(next.meta.pendingCommand).toBeUndefined();
  });

  it("working disque lève la pause", () => {
    const existing = agent({ status: "waiting", meta: { pendingCommand: "pause" } });
    const next = mergeIngestStatus(existing, {
      status: "working",
      task: "scan",
      currentAction: "exec",
      meta: { source: "disk" },
    });
    expect(next.status).toBe("working");
    expect(next.meta.pendingCommand).toBeUndefined();
  });

  it("sans pending, ingest tel quel", () => {
    const next = mergeIngestStatus(null, idleIn);
    expect(next.status).toBe("idle");
  });

  it("garde stopRequested + working si stop locale avec ingest idle", () => {
    const existing = agent({
      status: "working",
      meta: { pendingCommand: "stop", stopRequested: true },
      currentAction: "stop demandé…",
    });
    const next = mergeIngestStatus(existing, idleIn, { liveCommand: false });
    expect(next.status).toBe("working");
    expect(next.meta.stopRequested).toBe(true);
    expect(next.meta.pendingCommand).toBe("stop");
  });

  it("garde working si stop locale avec commande live", () => {
    const existing = agent({
      status: "working",
      meta: { pendingCommand: "stop", stopRequested: true },
      currentAction: "stop demandé…",
    });
    const next = mergeIngestStatus(existing, idleIn, { liveCommand: true });
    expect(next.status).toBe("working");
    expect(next.meta.stopRequested).toBe(true);
  });

  it("garde working si réunion active et ingest idle", () => {
    const existing = agent({
      status: "working",
      task: "Réunion: ebay",
      currentAction: "réunion",
      meta: { pendingCommand: "meeting", meetingTaskId: "task-abc" },
    });
    const next = mergeIngestStatus(existing, idleIn, { liveCommand: false });
    expect(next.status).toBe("working");
    expect(next.meta.pendingCommand).toBe("meeting");
    expect(next.currentAction).toBe("réunion");
  });
});
