import { describe, expect, it } from "vitest";
import {
  availableActions,
  messagePlaceholder,
  primarySendLabel,
  resolvePrimarySend,
} from "./actions-ui";
import type { OfficeAgent } from "./types";

const sources = {
  mac: { online: true, lastSeenAt: null },
  pc: { online: true, lastSeenAt: null },
};

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

describe("availableActions", () => {
  it("openclaw idle → seulement Envoyer", () => {
    const a = availableActions(agent({ id: "openclaw:main", kind: "openclaw", status: "idle" }), sources);
    expect(a.map((x) => x.kind)).toEqual(["message"]);
  });

  it("openclaw working → message + pause + stop", () => {
    const a = availableActions(agent({ id: "openclaw:main", kind: "openclaw", status: "working" }), sources);
    expect(a.map((x) => x.kind)).toEqual(["message", "pause", "stop"]);
  });

  it("openclaw waiting → répondre + stop (pas de Reprendre séparé)", () => {
    const a = availableActions(agent({ id: "openclaw:main", kind: "openclaw", status: "waiting" }), sources);
    expect(a.map((x) => x.kind)).toEqual(["message", "stop"]);
    expect(a[0]?.label).toBe("Répondre");
  });

  it("openclaw offline → envoyer désactivé", () => {
    const a = availableActions(agent({ id: "openclaw:main", kind: "openclaw", status: "offline" }), sources);
    expect(a).toHaveLength(1);
    expect(a[0]?.disabledReason).toMatch(/hors ligne/i);
  });

  it("pc offline → message désactivé", () => {
    const a = availableActions(agent({ id: "pc:main", kind: "pc", status: "idle" }), {
      mac: { online: true, lastSeenAt: null },
      pc: { online: false, lastSeenAt: null },
    });
    expect(a[0]?.disabledReason).toMatch(/PC/i);
  });

  it("job waiting → répondre + annuler", () => {
    const a = availableActions(agent({ id: "job:1", kind: "job", status: "waiting" }), sources);
    expect(a.map((x) => x.kind)).toEqual(["message", "stop"]);
    expect(a[0]?.label).toBe("Répondre");
  });
});

describe("resolvePrimarySend", () => {
  it("waiting sans texte → resume (openclaw)", () => {
    expect(resolvePrimarySend(agent({ id: "x", kind: "openclaw", status: "waiting" }), "")).toEqual({
      kind: "resume",
      text: "reprendre",
    });
  });

  it("waiting avec texte → message", () => {
    expect(resolvePrimarySend(agent({ id: "x", kind: "openclaw", status: "waiting" }), " ok ")).toEqual({
      kind: "message",
      text: "ok",
    });
  });

  it("job waiting sans texte → null", () => {
    expect(resolvePrimarySend(agent({ id: "job:1", kind: "job", status: "waiting" }), "")).toBeNull();
  });

  it("idle sans texte → null", () => {
    expect(resolvePrimarySend(agent({ id: "x", kind: "openclaw", status: "idle" }), "")).toBeNull();
  });
});

describe("primarySendLabel / placeholder", () => {
  it("labels contextuels", () => {
    const a = agent({ id: "x", kind: "openclaw", status: "waiting" });
    expect(primarySendLabel(a, "")).toBe("Reprendre");
    expect(primarySendLabel(a, "hi")).toBe("Répondre");
    expect(messagePlaceholder(a)).toMatch(/réponse/i);
  });
});
