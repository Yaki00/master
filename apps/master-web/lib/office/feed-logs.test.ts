import { describe, expect, it } from "vitest";
import { feedEventsToLogs, formatLogTime } from "./feed-logs";
import type { OfficeAgent, OfficeEvent } from "./types";

const agents: OfficeAgent[] = [
  {
    id: "openclaw:chef",
    kind: "openclaw",
    name: "Chef",
    room: "dev",
    status: "idle",
    task: null,
    currentAction: null,
    lastSeenAt: "2026-08-24T12:00:00.000Z",
    meta: {},
  },
];

function ev(partial: Partial<OfficeEvent> & Pick<OfficeEvent, "id" | "kind">): OfficeEvent {
  return {
    agentId: "openclaw:chef",
    payload: {},
    createdAt: "2026-08-24T12:00:01.000Z",
    ...partial,
  };
}

describe("feedEventsToLogs", () => {
  it("transforme les événements feed en lignes de log", () => {
    const events = [
      ev({
        id: "1",
        kind: "user_message",
        payload: { text: "salut", role: "user" },
        createdAt: "2026-08-24T12:00:01.000Z",
      }),
      ev({
        id: "2",
        kind: "agent_message",
        payload: { text: "ok chef", role: "agent" },
        createdAt: "2026-08-24T12:00:02.000Z",
      }),
    ];
    const lines = feedEventsToLogs(events, agents);
    expect(lines).toHaveLength(2);
    expect(lines[0]?.kind).toBe("user");
    expect(lines[0]?.text).toBe("salut");
    expect(lines[1]?.kind).toBe("agent");
    expect(lines[1]?.agentLabel).toBe("Chef");
  });

  it("filtre par agentId", () => {
    const events = [
      ev({ id: "1", kind: "user_message", payload: { text: "a", role: "user" }, agentId: "openclaw:chef" }),
      ev({ id: "2", kind: "user_message", payload: { text: "b", role: "user" }, agentId: "openclaw:office" }),
    ];
    const lines = feedEventsToLogs(events, agents, { agentId: "openclaw:chef" });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe("a");
  });

  it("filtre par kind handoff", () => {
    const events = [
      ev({
        id: "1",
        kind: "agent_message",
        payload: { text: "Handoff vers mgr-dev", role: "agent" },
      }),
      ev({
        id: "2",
        kind: "agent_message",
        payload: { text: "ok", role: "agent" },
      }),
    ];
    const lines = feedEventsToLogs(events, agents, { kind: "handoff" });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.kind).toBe("handoff");
  });
});

describe("formatLogTime", () => {
  it("extrait HH:MM:SS", () => {
    expect(formatLogTime("2026-08-24T14:05:09.123Z")).toBe("14:05:09");
  });
});
