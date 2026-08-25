import { describe, expect, it } from "vitest";
import { filterHallJobPlacements, hallShowsWaitingStyle } from "./hall-layout";
import type { AgentPlacement } from "./placement";
import type { OfficeAgent, WaitingJobSummary } from "./types";

function agent(partial: Partial<OfficeAgent> & Pick<OfficeAgent, "id" | "kind" | "status">): OfficeAgent {
  return {
    name: partial.id,
    room: "waiting",
    task: null,
    currentAction: null,
    lastSeenAt: new Date().toISOString(),
    meta: {},
    ...partial,
  };
}

function placement(partial: Partial<AgentPlacement> & Pick<AgentPlacement, "agent">): AgentPlacement {
  return {
    room: "waiting",
    slot: { x: 50, y: 62, pose: "sit" },
    global: { x: 50, y: 50 },
    ...partial,
  };
}

describe("hallShowsWaitingStyle", () => {
  it("ignore la réception idle au hall", () => {
    expect(
      hallShowsWaitingStyle([
        { agent: agent({ id: "openclaw:office", kind: "openclaw", status: "idle" }) },
      ]),
    ).toBe(false);
  });

  it("allume le style attente si quelqu’un attend", () => {
    expect(
      hallShowsWaitingStyle([
        { agent: agent({ id: "openclaw:office", kind: "openclaw", status: "idle" }) },
        { agent: agent({ id: "pc:yaki-pc", kind: "pc", status: "waiting" }) },
      ]),
    ).toBe(true);
  });
});

describe("filterHallJobPlacements", () => {
  it("masque le job si le PC représentant est déjà dans le hall", () => {
    const hallCore = [
      placement({
        agent: agent({
          id: "pc:yaki-pc",
          kind: "pc",
          status: "waiting",
          meta: { workerId: "yaki-pc" },
        }),
      }),
    ];
    const jobs: WaitingJobSummary[] = [
      {
        id: "j1",
        prompt: "npm test",
        claimedBy: "yaki-pc",
        status: "paused",
        updatedAt: "2026-08-24T12:00:00.000Z",
      },
    ];
    expect(filterHallJobPlacements(hallCore, jobs)).toHaveLength(0);
  });

  it("garde le job sans PC correspondant", () => {
    const jobs: WaitingJobSummary[] = [
      {
        id: "j2",
        prompt: "deploy",
        claimedBy: null,
        status: "queued",
        updatedAt: "2026-08-24T12:00:00.000Z",
      },
    ];
    expect(filterHallJobPlacements([], jobs)).toHaveLength(1);
    expect(filterHallJobPlacements([], jobs)[0]?.agent.id).toBe("job:j2");
  });
});
