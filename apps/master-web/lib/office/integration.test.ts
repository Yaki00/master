import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { closeDb } from "@/lib/db/sqlite";
import { listAiProjects } from "@/lib/db/ai-projects";
import {
  claimOfficeCommands,
  completeOfficeCommand,
  ingestOfficeSnapshot,
  listAggregatedOfficeAgents,
  listOfficeEvents,
} from "@/lib/db/office";
import { dispatchOfficeAction } from "@/lib/office/actions";
import { eventsToBubbles } from "@/lib/office/chat";
import { mergeIngestStatus } from "@/lib/office/ingest-merge";
import {
  buildMeetingStatusReply,
  processMeetingAfterCommand,
  startAllHandsMeeting,
} from "@/lib/office/meeting";
import { parseMeetingStatusQuery } from "@/lib/office/meeting-intent";
import {
  parseMonitorInterval,
  parseProductWatchBrief,
  validateSentinelProject,
} from "@/lib/office/scenario-helpers";
import type { OfficeAgent } from "@/lib/office/types";

describe("integration — meeting status factual", () => {
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "master-integ-meet-"));
    process.env.MASTER_DB_PATH = join(dir, "t.db");
    closeDb();
  });

  afterEach(() => {
    closeDb();
  });

  it("répond avec avancement réel sans LLM", async () => {
    const task = startAllHandsMeeting({
      brief: "meilleur GPU eBay",
      facilitatorAgentId: "openclaw:office",
    });
    const parts = task.meta.participants as Array<{ agentId: string; commandId: string }>;
    processMeetingAfterCommand(parts[0]!.commandId, parts[0]!.agentId, "done", "RTX 4090 à 390€");

    expect(parseMeetingStatusQuery("alors des nouvelles ?")).toBe(true);

    const res = await dispatchOfficeAction("openclaw:office", "message", {
      text: "alors des nouvelles ?",
    });
    expect(res.ok).toBe(true);

    const reply = buildMeetingStatusReply("openclaw:office");
    expect(reply).toMatch(/RTX 4090/);
    expect(reply).not.toMatch(/hallucin/i);

    const bubbles = eventsToBubbles(listOfficeEvents("openclaw:office"));
    const agentBubble = bubbles.find((b) => b.role === "agent" && b.text.includes("RTX 4090"));
    expect(agentBubble).toBeTruthy();
    expect(
      bubbles.filter((b) => b.role === "agent" && /RTX 4090/.test(b.text)).length,
    ).toBeGreaterThanOrEqual(1);
  });
});

describe("integration — sentinelle via speech", () => {
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "master-integ-sent-"));
    process.env.MASTER_DB_PATH = join(dir, "t.db");
    closeDb();
  });

  afterEach(() => {
    closeDb();
  });

  it("crée un projet récurrent validable sentinelle", async () => {
    const speech =
      'Crée un projet « Sentinelle 4090 » récurrent pour surveiller RTX 4090 <400€ sur eBay toutes les 15 min';

    const res = await dispatchOfficeAction("openclaw:office", "message", { text: speech });
    expect(res.ok).toBe(true);

    const projects = listAiProjects();
    const hit = projects.find((p) => /Sentinelle 4090/i.test(p.title));
    expect(hit).toBeTruthy();
    expect(hit?.kind).toBe("recurring");

    const watch = parseProductWatchBrief(hit!.brief);
    expect(watch?.product).toMatch(/RTX 4090/i);
    expect(watch?.maxPriceEur).toBe(400);

    const interval = parseMonitorInterval(speech);
    expect(interval?.minutes).toBe(15);

    const validation = validateSentinelProject({
      kind: hit!.kind,
      status: hit!.status,
      brief: hit!.brief,
      schedule: hit!.schedule,
      nextRunAt: hit!.nextRunAt,
      meta: { watchType: "sentinel" },
    });
    expect(validation.ok).toBe(true);

    const events = listOfficeEvents("openclaw:office");
    expect(events.some((e) => e.payload.projectSpeech === true)).toBe(true);
  });
});

describe("integration — stopRequested + ingest idle", () => {
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "master-integ-stop-"));
    process.env.MASTER_DB_PATH = join(dir, "t.db");
    closeDb();
  });

  afterEach(() => {
    closeDb();
  });

  it("stopRequested persiste tant que le run n'est pas ack", async () => {
    ingestOfficeSnapshot({
      agents: [{ id: "main", name: "main", status: "working", task: "scan ebay" }],
    });

    const stop = await dispatchOfficeAction("openclaw:main", "stop", {});
    expect(stop.ok).toBe(true);

    ingestOfficeSnapshot({
      agents: [{ id: "main", name: "main", status: "idle", task: "agent:main:main" }],
    });

    const duringStop = listAggregatedOfficeAgents().find((a) => a.id === "openclaw:main");
    expect(duringStop?.status).toBe("working");
    expect(duringStop?.meta.stopRequested).toBe(true);
    expect(duringStop?.meta.pendingCommand).toBe("stop");

    const stopCmd = claimOfficeCommands("openclaw-mac", 5).find((c) => c.kind === "stop");
    expect(stopCmd).toBeTruthy();
    completeOfficeCommand(stopCmd!.id, "done", "Stop ack — best-effort");

    ingestOfficeSnapshot({
      agents: [{ id: "main", name: "main", status: "idle", task: "agent:main:main" }],
    });

    const afterAck = listAggregatedOfficeAgents().find((a) => a.id === "openclaw:main");
    expect(afterAck?.status).toBe("idle");
    expect(afterAck?.meta.stopRequested).toBeUndefined();
  });

  it("mergeIngestStatus conserve stopRequested avec ingest idle", () => {
    const existing: OfficeAgent = {
      id: "openclaw:main",
      kind: "openclaw",
      name: "Main",
      room: "dev",
      status: "working",
      task: "scan",
      currentAction: "stop demandé…",
      lastSeenAt: new Date().toISOString(),
      meta: { pendingCommand: "stop", stopRequested: true },
    };
    const merged = mergeIngestStatus(
      existing,
      { status: "idle", task: "idle", currentAction: "idle", meta: { source: "disk" } },
      { liveCommand: false },
    );
    expect(merged.status).toBe("working");
    expect(merged.meta.stopRequested).toBe(true);
    expect(merged.meta.pendingCommand).toBe("stop");
  });
});
