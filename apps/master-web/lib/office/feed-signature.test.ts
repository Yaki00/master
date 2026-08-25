import { describe, expect, it } from "vitest";
import { feedEventsEqual, feedEventsSignature } from "./feed-signature";
import type { OfficeEvent } from "./types";

function ev(id: string, at: string): OfficeEvent {
  return {
    id,
    agentId: "openclaw:main",
    kind: "agent_message",
    payload: { text: "ok" },
    createdAt: at,
  };
}

describe("feedEventsSignature", () => {
  it("détecte un changement de taille ou de dernier événement", () => {
    const a = [ev("1", "2026-08-24T12:00:00.000Z")];
    const b = [ev("1", "2026-08-24T12:00:00.000Z"), ev("2", "2026-08-24T12:00:01.000Z")];
    expect(feedEventsSignature(a)).not.toBe(feedEventsSignature(b));
    expect(feedEventsEqual(a, b)).toBe(false);
  });

  it("considère identiques deux feeds avec même signature", () => {
    const events = [ev("1", "2026-08-24T12:00:00.000Z")];
    expect(feedEventsEqual(events, [...events])).toBe(true);
  });

  it("retourne 0 pour un feed vide", () => {
    expect(feedEventsSignature([])).toBe("0");
    expect(feedEventsEqual([], [])).toBe(true);
  });
});
