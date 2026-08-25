import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, getDb } from "./sqlite";
import { createJob, pauseJob, upsertWorkerHeartbeat } from "./jobs";
import {
  ackOfficeCommand,
  appendOfficeEvent,
  claimOfficeCommands,
  completeOfficeCommand,
  enqueueOfficeCommand,
  failStaleClaimedOfficeCommands,
  ingestOfficeSnapshot,
  listAggregatedOfficeAgents,
  listOfficeEvents,
  officeSources,
  upsertOfficeAgent,
} from "./office";
import { dispatchOfficeAction } from "../office/actions";
import { eventFromCommandAck } from "../office/ack";
import { eventsToBubbles } from "../office/chat";

function uniqueDb() {
  const dir = mkdtempSync(join(tmpdir(), "master-office-"));
  process.env.MASTER_DB_PATH = join(dir, "test.db");
  closeDb();
  return dir;
}

describe("office db", () => {
  let dir: string;

  beforeEach(() => {
    dir = uniqueDb();
  });

  afterEach(() => {
    closeDb();
    rmSync(dir, { recursive: true, force: true });
  });

  it("ingère des agents OpenClaw et enqueue des commandes", () => {
    const { ingested } = ingestOfficeSnapshot({
      source: "openclaw-mac",
      agents: [
        {
          id: "main",
          name: "main",
          status: "working",
          task: "lire la doc",
          currentAction: "browser",
          tools: ["browser"],
        },
      ],
    });
    expect(ingested).toBe(1);

    const agents = listAggregatedOfficeAgents();
    const oc = agents.find((a) => a.id === "openclaw:main");
    expect(oc).toBeTruthy();
    expect(oc?.room).toBe("research");
    expect(oc?.kind).toBe("openclaw");

    const cmd = enqueueOfficeCommand("openclaw:main", "message", { text: "bonjour" });
    expect(cmd.status).toBe("queued");
    const claimed = claimOfficeCommands("openclaw-mac", 5);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.id).toBe(cmd.id);
    expect(claimed[0]?.status).toBe("claimed");

    const done = ackOfficeCommand(cmd.id, "done", "ok");
    expect(done?.status).toBe("done");
  });

  it("agrège PC sans dupliquer chaque job sur le plancher", () => {
    upsertWorkerHeartbeat({ workerId: "yaki-pc", hostname: "yaki-pc", meta: { role: "pc" } });
    const job = createJob({
      target: "agent",
      prompt: "npm test",
      waChatId: "office",
    });
    pauseJob(job.id, "besoin d'un avis");

    const agents = listAggregatedOfficeAgents();
    const pc = agents.find((a) => a.id === "pc:yaki-pc");
    const jobCards = agents.filter((a) => a.kind === "job");
    expect(pc).toBeTruthy();
    expect(pc?.kind).toBe("pc");
    expect(agents.find((a) => a.id === `job:${job.id}`)).toBeUndefined();
    expect(jobCards.length).toBeLessThanOrEqual(1);
    expect(officeSources().waitingJobs.some((j) => j.id === job.id)).toBe(true);
  });

  it("ignore les jobs externes pausés dans le hall (hors canal office)", () => {
    upsertWorkerHeartbeat({ workerId: "yaki-pc", hostname: "yaki-pc", meta: { role: "pc" } });
    const external = createJob({ target: "agent", prompt: "canal externe", waChatId: "external-legacy" });
    pauseJob(external.id, "question externe");
    const office = createJob({ target: "agent", prompt: "depuis bureau", waChatId: "office" });
    pauseJob(office.id, "question office");

    const waiting = officeSources().waitingJobs;
    expect(waiting.some((j) => j.id === office.id)).toBe(true);
    expect(waiting.some((j) => j.id === external.id)).toBe(false);
  });

  it("ingest idle ne casse pas une pause locale", async () => {
    ingestOfficeSnapshot({
      agents: [{ id: "main", name: "main", status: "working", task: "build" }],
    });
    await dispatchOfficeAction("openclaw:main", "pause", {});
    ingestOfficeSnapshot({
      agents: [{ id: "main", name: "main", status: "idle", task: "agent:main:main" }],
    });
    const duringPause = listAggregatedOfficeAgents().find((a) => a.id === "openclaw:main");
    expect(duringPause?.status).toBe("working");
    expect(duringPause?.meta.pauseRequested).toBe(true);

    const pauseCmd = claimOfficeCommands("openclaw-mac", 5).find((c) => c.kind === "pause");
    expect(pauseCmd).toBeTruthy();
    completeOfficeCommand(pauseCmd!.id, "done", "pause ok");
    ingestOfficeSnapshot({
      agents: [{ id: "main", name: "main", status: "idle", task: "agent:main:main" }],
    });
    const agent = listAggregatedOfficeAgents().find((a) => a.id === "openclaw:main");
    expect(agent?.status).toBe("waiting");
    expect(agent?.room).toBe("waiting");
  });

  it("working périmé devient offline / lounge", () => {
    const stale = new Date(Date.now() - 180_000).toISOString();
    upsertOfficeAgent({
      id: "openclaw:stale",
      kind: "openclaw",
      name: "stale",
      status: "working",
      lastSeenAt: stale,
      currentAction: "exec",
    });
    const agent = listAggregatedOfficeAgents().find((a) => a.id === "openclaw:stale");
    expect(agent?.status).toBe("offline");
    expect(agent?.room).toBe("lounge");
  });

  it("meeting si deux working partagent le même sujet", () => {
    ingestOfficeSnapshot({
      agents: [
        { id: "a", name: "A", status: "working", task: "scan ebay gpu", currentAction: "exec", tools: ["exec"] },
        { id: "b", name: "B", status: "working", task: "scan ebay gpu", currentAction: "exec", tools: ["exec"] },
      ],
    });
    const agents = listAggregatedOfficeAgents().filter((a) => a.id === "openclaw:a" || a.id === "openclaw:b");
    expect(agents.every((a) => a.room === "meeting")).toBe(true);
  });

  it("dispatch message/stop sur un job PC", async () => {
    upsertWorkerHeartbeat({ workerId: "pc-main", hostname: "pc-main", meta: { role: "pc" } });
    const job = createJob({ target: "agent", prompt: "hello", waChatId: "office" });
    pauseJob(job.id);

    const resumed = await dispatchOfficeAction(`job:${job.id}`, "message", { text: "continue" });
    expect(resumed.ok).toBe(true);
    expect(resumed.jobId).toBe(job.id);

    const stopped = await dispatchOfficeAction(`job:${job.id}`, "stop", {});
    expect(stopped.ok).toBe(true);

    const events = listOfficeEvents(`job:${job.id}`);
    expect(events.some((e) => e.kind === "user_message")).toBe(true);
    expect(events.some((e) => e.kind === "command_stop")).toBe(true);
  });

  it("message OpenClaw enqueue une commande queued", async () => {
    ingestOfficeSnapshot({
      agents: [{ id: "main", name: "main", status: "idle" }],
    });
    const res = await dispatchOfficeAction("openclaw:main", "message", { text: "ping" });
    expect(res.ok).toBe(true);
    expect(res.commandId).toBeTruthy();
    const claimed = claimOfficeCommands("openclaw-mac", 5);
    expect(claimed[0]?.kind).toBe("message");
    expect(claimed[0]?.status).toBe("claimed");
  });

  it("pause OpenClaw → working jusqu'à ack si run actif", async () => {
    ingestOfficeSnapshot({
      agents: [{ id: "main", name: "main", status: "working", task: "build" }],
    });
    const res = await dispatchOfficeAction("openclaw:main", "pause", {});
    expect(res.ok).toBe(true);
    const agent = listAggregatedOfficeAgents().find((a) => a.id === "openclaw:main");
    expect(agent?.status).toBe("working");
    expect(agent?.meta.pauseRequested).toBe(true);
    const events = listOfficeEvents("openclaw:main");
    expect(events.some((e) => e.kind === "command_pause")).toBe(true);
    expect(events.some((e) => e.payload.text?.includes("jusqu'à ack"))).toBe(true);
    expect(events.every((e) => e.kind !== "agent_message")).toBe(true);
  });

  it("stop annule les messages encore queued", async () => {
    ingestOfficeSnapshot({
      agents: [{ id: "main", name: "main", status: "working", task: "build" }],
    });
    const queued = await dispatchOfficeAction("openclaw:main", "message", { text: "encore" });
    expect(queued.ok).toBe(true);
    const stop = await dispatchOfficeAction("openclaw:main", "stop", {});
    expect(stop.ok).toBe(true);
    const claimed = claimOfficeCommands("openclaw-mac", 5);
    expect(claimed.some((c) => c.kind === "message")).toBe(false);
    expect(claimed.some((c) => c.kind === "stop")).toBe(true);
    const agent = listAggregatedOfficeAgents().find((a) => a.id === "openclaw:main");
    expect(agent?.status).toBe("working");
    expect(agent?.meta.stopRequested).toBe(true);
  });

  it("refuse message PC si worker hors ligne", async () => {
    const res = await dispatchOfficeAction("pc:ghost", "message", { text: "hello pc" });
    expect(res.ok).toBe(false);
  });

  it("ack JSON OpenClaw → événement agent lisible, pause ack silencieux", () => {
    ingestOfficeSnapshot({
      agents: [{ id: "main", name: "main", status: "idle" }],
    });
    const msg = enqueueOfficeCommand("openclaw:main", "message", { text: "ping" });
    const raw = JSON.stringify({ payloads: [{ text: "pong" }] });
    ackOfficeCommand(msg.id, "done", raw);
    const ev = eventFromCommandAck(msg, "done", raw);
    expect(ev?.kind).toBe("agent_message");
    appendOfficeEvent("openclaw:main", ev!.kind, ev!.payload);

    const pause = enqueueOfficeCommand("openclaw:main", "pause", {});
    expect(eventFromCommandAck(pause, "done", "best-effort pause")).toBeNull();

    const bubbles = eventsToBubbles(listOfficeEvents("openclaw:main"));
    expect(bubbles.some((b) => b.role === "agent" && b.text === "pong")).toBe(true);
    expect(bubbles.every((b) => !/best-effort/i.test(b.text))).toBe(true);
  });

  it("ack message lève le working fantôme après ingest idle", async () => {
    ingestOfficeSnapshot({
      agents: [{ id: "main", name: "main", status: "idle" }],
    });
    const res = await dispatchOfficeAction("openclaw:main", "message", { text: "ping" });
    expect(res.ok).toBe(true);
    const claimed = claimOfficeCommands("openclaw-mac", 5);
    expect(claimed).toHaveLength(1);

    completeOfficeCommand(claimed[0]!.id, "done", JSON.stringify({ payloads: [{ text: "pong" }] }));
    ingestOfficeSnapshot({
      agents: [{ id: "main", name: "main", status: "idle", task: "rien" }],
    });

    const agent = listAggregatedOfficeAgents().find((a) => a.id === "openclaw:main");
    expect(agent?.status).toBe("idle");
    expect(agent?.meta.pendingCommand).toBeUndefined();
    const bubbles = eventsToBubbles(listOfficeEvents("openclaw:main"));
    expect(bubbles.some((b) => b.role === "agent" && b.text === "pong")).toBe(true);
  });

  it("timeout JSON OpenClaw n’est pas une réponse agent", async () => {
    ingestOfficeSnapshot({
      agents: [{ id: "main", name: "main", status: "idle" }],
    });
    await dispatchOfficeAction("openclaw:main", "message", { text: "ping" });
    const claimed = claimOfficeCommands("openclaw-mac", 5);
    completeOfficeCommand(
      claimed[0]!.id,
      "done",
      JSON.stringify({
        status: "timeout",
        timeoutPhase: "provider",
        result: { payloads: [{ text: "LLM request failed: network connection error." }] },
      }),
    );
    const agent = listAggregatedOfficeAgents().find((a) => a.id === "openclaw:main");
    expect(agent?.status).toBe("error");
    expect(agent?.meta.pendingCommand).toBeUndefined();
    const bubbles = eventsToBubbles(listOfficeEvents("openclaw:main"));
    expect(bubbles.some((b) => b.role === "system" && /erreur réseau/i.test(b.text))).toBe(true);
    expect(bubbles.every((b) => b.role !== "agent" || b.text === "…")).toBe(true);
  });

  it("claimed trop vieux → failed", async () => {
    ingestOfficeSnapshot({
      agents: [{ id: "main", name: "main", status: "idle" }],
    });
    await dispatchOfficeAction("openclaw:main", "message", { text: "ping" });
    const claimed = claimOfficeCommands("openclaw-mac", 5);
    const stale = new Date(Date.now() - 10 * 60_000).toISOString();
    getDb().prepare(`UPDATE office_commands SET updated_at = ? WHERE id = ?`).run(stale, claimed[0]!.id);
    expect(failStaleClaimedOfficeCommands()).toBe(1);
    const agent = listAggregatedOfficeAgents().find((a) => a.id === "openclaw:main");
    expect(agent?.meta.pendingCommand).toBeUndefined();
    expect(listOfficeEvents("openclaw:main").some((e) => e.kind === "command_failed")).toBe(true);
  });

  it("signale Mac/PC hors ligne sans heartbeat récent", () => {
    const sources = officeSources();
    expect(sources.mac.online).toBe(false);
    expect(sources.pc.online).toBe(false);
    expect(sources.waitingJobs).toEqual([]);
  });
});
