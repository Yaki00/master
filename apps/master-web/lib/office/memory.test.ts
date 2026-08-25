import { describe, expect, it } from "vitest";
import {
  historyChars,
  memoryOverQuota,
  MEMORY_MAX_TURNS,
  splitForCompaction,
  turnsFromOfficeEvents,
} from "./memory";
import type { OfficeEvent } from "./types";

function ev(partial: Partial<OfficeEvent> & Pick<OfficeEvent, "id" | "kind">): OfficeEvent {
  return {
    agentId: "openclaw:office",
    payload: {},
    createdAt: "2026-08-24T12:00:00.000Z",
    ...partial,
  };
}

describe("turnsFromOfficeEvents", () => {
  it("extrait user/assistant dans l’ordre", () => {
    const turns = turnsFromOfficeEvents([
      ev({
        id: "1",
        kind: "user_message",
        payload: { text: "combien d'agents ?", role: "user" },
        createdAt: "2026-08-24T12:00:01.000Z",
      }),
      ev({
        id: "2",
        kind: "agent_message",
        payload: { text: "Vous avez 5 agents.", role: "agent" },
        createdAt: "2026-08-24T12:00:02.000Z",
      }),
      ev({
        id: "3",
        kind: "user_message",
        payload: { text: "lesquels ?", role: "user" },
        createdAt: "2026-08-24T12:00:03.000Z",
      }),
    ]);
    expect(turns.map((t) => t.content)).toEqual([
      "combien d'agents ?",
      "Vous avez 5 agents.",
      "lesquels ?",
    ]);
    expect(turns.map((t) => t.role)).toEqual(["user", "assistant", "user"]);
  });
});

describe("memoryOverQuota / splitForCompaction", () => {
  it("détecte trop de tours", () => {
    const turns = Array.from({ length: MEMORY_MAX_TURNS + 1 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `m${i}`,
    }));
    expect(memoryOverQuota(turns)).toBe(true);
    expect(memoryOverQuota(turns.slice(0, 2))).toBe(false);
  });

  it("détecte trop de caractères", () => {
    expect(memoryOverQuota([{ role: "user", content: "x".repeat(5000) }])).toBe(true);
  });

  it("sépare ancien / récent", () => {
    const turns = Array.from({ length: 10 }, (_, i) => ({
      role: "user" as const,
      content: `t${i}`,
    }));
    const { older, recent } = splitForCompaction(turns, 4);
    expect(older.map((t) => t.content)).toEqual(["t0", "t1", "t2", "t3", "t4", "t5"]);
    expect(recent.map((t) => t.content)).toEqual(["t6", "t7", "t8", "t9"]);
    expect(historyChars(recent)).toBeGreaterThan(0);
  });
});
