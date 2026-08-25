import { describe, expect, it } from "vitest";
import { cleanTask, displayName, runtimeRouteHint, speechBubble, waitingJobTarget } from "./labels";
import type { OfficeAgent, WaitingJobSummary } from "./types";

function agent(partial: Partial<OfficeAgent> & Pick<OfficeAgent, "id" | "kind" | "status">): OfficeAgent {
  return {
    name: "Test",
    room: "lounge",
    task: null,
    currentAction: null,
    lastSeenAt: new Date().toISOString(),
    meta: {},
    ...partial,
  };
}

describe("displayName", () => {
  it("humanise les ids techniques", () => {
    expect(displayName(agent({ id: "openclaw:main", kind: "openclaw", status: "idle", name: "main" }))).toBe(
      "Main",
    );
    expect(displayName(agent({ id: "openclaw:office", kind: "openclaw", status: "idle", name: "Réception" }))).toBe(
      "Réception",
    );
    expect(
      displayName(agent({ id: "openclaw:telegram-pc", kind: "openclaw", status: "idle", name: "telegram-pc" })),
    ).toBe("Telegram");
    expect(displayName(agent({ id: "pc:yaki-pc", kind: "pc", status: "idle", name: "Yaki-pc" }))).toBe("PC");
  });

  it("job → extrait de la tâche, pas l’UUID", () => {
    expect(
      displayName(
        agent({
          id: "job:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          kind: "job",
          status: "waiting",
          name: "Job aaaaaaaa",
          task: "installe rust",
        }),
      ),
    ).toBe("installe rust");
  });
});

describe("cleanTask / speechBubble", () => {
  it("supprime les clés internes", () => {
    expect(cleanTask("agent:main:main")).toBeNull();
    expect(cleanTask("heartbeat")).toBeNull();
    expect(cleanTask("scan ebay gpu")).toBe("scan ebay gpu");
    expect(cleanTask("qwen2.5:32b")).toBeNull();
    expect(cleanTask("ollama-pc/qwen2.5:32b")).toBeNull();
  });

  it("idle ne parle pas, waiting oui", () => {
    expect(speechBubble(agent({ id: "x", kind: "openclaw", status: "idle", task: "rien" }))).toBeNull();
    expect(
      speechBubble(agent({ id: "x", kind: "openclaw", status: "waiting", task: "pause demandée" })),
    ).toBe("besoin de toi");
  });

  it("humanise l’outil live en bulle working", () => {
    expect(
      speechBubble(
        agent({ id: "x", kind: "openclaw", status: "working", task: null, currentAction: "exec" }),
      ),
    ).toBe("terminal");
  });

  it("bulle honnête pendant un stop demandé", () => {
    expect(
      speechBubble(
        agent({ id: "x", kind: "openclaw", status: "working", meta: { stopRequested: true } }),
      ),
    ).toBe("arrêt en cours…");
  });
});

describe("runtimeRouteHint", () => {
  it("main affiche la route runtime", () => {
    expect(runtimeRouteHint(agent({ id: "openclaw:main", kind: "openclaw", status: "idle" }))).toBe("→ office");
    expect(runtimeRouteHint(agent({ id: "openclaw:office", kind: "openclaw", status: "idle" }))).toBeNull();
  });
});

describe("waitingJobTarget", () => {
  it("ouvre le PC si le job lui appartient", () => {
    const job: WaitingJobSummary = {
      id: "j1",
      prompt: "npm test",
      claimedBy: "yaki-pc",
      status: "paused",
      updatedAt: "2026-08-24T12:00:00.000Z",
    };
    const agents = [agent({ id: "pc:yaki-pc", kind: "pc", status: "waiting", meta: { workerId: "yaki-pc" } })];
    expect(waitingJobTarget(job, agents)).toBe("pc:yaki-pc");
  });

  it("sinon cible le job", () => {
    const job: WaitingJobSummary = {
      id: "j1",
      prompt: "npm test",
      claimedBy: null,
      status: "paused",
      updatedAt: "2026-08-24T12:00:00.000Z",
    };
    expect(waitingJobTarget(job, [])).toBe("job:j1");
  });
});
