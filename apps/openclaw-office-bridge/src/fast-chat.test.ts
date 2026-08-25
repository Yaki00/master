import { describe, expect, it } from "vitest";
import { buildFastChatMessages, hardenReply } from "./fast-chat";
import { memoryOverQuota, parseHistoryPayload, splitForCompaction } from "./memory";

describe("parseHistoryPayload", () => {
  it("normalise history + roster", () => {
    const p = parseHistoryPayload({
      history: [
        { role: "user", content: "combien ?" },
        { role: "agent", content: "5 agents" },
      ],
      summary: "On parlait du roster",
      roster: ["Réception", "Chef"],
    });
    expect(p.history).toEqual([
      { role: "user", content: "combien ?" },
      { role: "assistant", content: "5 agents" },
    ]);
    expect(p.summary).toMatch(/roster/);
    expect(p.roster).toEqual(["Réception", "Chef"]);
  });
});

describe("buildFastChatMessages", () => {
  it("enchaîne résumé + historique + message", () => {
    const msgs = buildFastChatMessages({
      message: "lesquels ?",
      summary: "Discussion sur les agents du bureau",
      history: [
        { role: "user", content: "combien d'agents ?" },
        { role: "assistant", content: "Vous avez 5 agents disponibles." },
      ],
      roster: ["Réception", "Chef", "Main"],
    });
    expect(msgs[0]?.role).toBe("system");
    expect(msgs[0]?.content).toMatch(/Réception/);
    expect(msgs.some((m) => m.content.includes("Résumé"))).toBe(true);
    expect(msgs.at(-1)).toEqual({ role: "user", content: "lesquels ?" });
    expect(msgs.some((m) => m.role === "assistant" && m.content.includes("5 agents"))).toBe(true);
  });
});

describe("hardenReply", () => {
  it("coupe les ouvertures molles", () => {
    expect(hardenReply("Bonjour! Les agents sont prêts.")).toBe("Les agents sont prêts.");
    expect(hardenReply("Je serais ravi de vous aider. Chef est idle.")).toMatch(/^Chef/);
    expect(hardenReply("Bien sûr! 3 agents online.")).toBe("3 agents online.");
  });
});

describe("quota", () => {
  it("compact split", () => {
    expect(memoryOverQuota(Array.from({ length: 20 }, () => ({ role: "user" as const, content: "x" })))).toBe(
      true,
    );
    const { recent } = splitForCompaction(
      Array.from({ length: 10 }, (_, i) => ({ role: "user" as const, content: `t${i}` })),
      4,
    );
    expect(recent).toHaveLength(4);
  });
});
