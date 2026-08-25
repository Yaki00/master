import { describe, expect, it } from "vitest";
import { reconcileAgentStatus, WORKING_ORPHAN_MS } from "./status-truth";
import type { OfficeAgent } from "./types";

function ag(partial: Partial<OfficeAgent> & Pick<OfficeAgent, "status">): OfficeAgent {
  return {
    id: "openclaw:office",
    kind: "openclaw",
    name: "Réception",
    room: "lounge",
    task: "x",
    currentAction: "message",
    lastSeenAt: new Date(Date.now() - WORKING_ORPHAN_MS - 1000).toISOString(),
    meta: {},
    ...partial,
  };
}

describe("reconcileAgentStatus", () => {
  it("coupe working orphelin sans commande live", () => {
    const next = reconcileAgentStatus(ag({ status: "working" }), { liveCommand: false });
    expect(next.status).toBe("idle");
    expect(next.meta.reconciled).toBe("orphan-working");
  });

  it("garde working si commande live", () => {
    const next = reconcileAgentStatus(ag({ status: "working" }), { liveCommand: true });
    expect(next.status).toBe("working");
  });

  it("coupe error stale", () => {
    const next = reconcileAgentStatus(ag({ status: "error" }), { liveCommand: false });
    expect(next.status).toBe("idle");
  });
});
