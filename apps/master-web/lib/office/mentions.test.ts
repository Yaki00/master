import { describe, expect, it } from "vitest";
import { parseMention, allMentionTargets, suggestMentions } from "./mentions";
import type { OfficeAgent } from "./types";

function ag(id: string, name: string): OfficeAgent {
  return {
    id,
    kind: "openclaw",
    name,
    room: "lounge",
    status: "idle",
    task: null,
    currentAction: null,
    lastSeenAt: new Date().toISOString(),
    meta: {},
  };
}

const agents = [
  ag("openclaw:office", "Réception"),
  ag("openclaw:chef", "Chef"),
  ag("openclaw:mgr-dev", "Manager Dev"),
  ag("openclaw:mgr-lab", "Manager Lab"),
];

describe("parseMention", () => {
  it("détecte @all", () => {
    const r = parseMention("@all statut ?", agents);
    expect(r.target.kind).toBe("all");
    expect(r.text).toBe("statut ?");
  });

  it("détecte @chef", () => {
    const r = parseMention("@chef délègue scan", agents);
    expect(r.target).toEqual({ kind: "agent", agentId: "openclaw:chef", label: "Chef" });
    expect(r.text).toBe("délègue scan");
  });

  it("sans @ renvoie none", () => {
    const r = parseMention("salut", agents);
    expect(r.target.kind).toBe("none");
  });
});

describe("allMentionTargets", () => {
  it("liste les openclaw online", () => {
    expect(allMentionTargets(agents).map((a) => a.id)).toContain("openclaw:office");
  });
});

describe("suggestMentions", () => {
  it("vide sans @", () => {
    expect(suggestMentions("salut", agents)).toEqual([]);
  });

  it("filtre par préfixe", () => {
    const r = suggestMentions("@ch", agents);
    expect(r.some((s) => s.token.startsWith("@chef"))).toBe(true);
    expect(r.every((s) => /ch/i.test(s.label))).toBe(true);
  });

  it("ferme après espace", () => {
    expect(suggestMentions("@chef délègue", agents)).toEqual([]);
  });
});
