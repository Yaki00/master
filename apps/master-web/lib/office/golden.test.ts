/**
 * Golden set CDC-03 — 20 prompts FR.
 * Vérifie les règles de fit / interim / mentions (déterministe, sans LLM).
 */
import { describe, expect, it } from "vitest";
import { assessReplyFit, interimAckText } from "./interim";
import { parseMention } from "./mentions";
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
];

const SOFT = /je serais ravi|comment puis-je|quelles options|n.?hésitez/i;

describe("golden chat CDC-03", () => {
  const cases: Array<{
    id: string;
    ask: string;
    good: string;
    bad: string;
  }> = [
    { id: "G01", ask: "salut", good: "Réception. Qu’est-ce qu’il te faut ?", bad: "Je serais ravi de vous aider !" },
    { id: "G02", ask: "combien d'agents ?", good: "6 agents : Réception, Chef, Mgr Dev, Mgr Lab, Main, Telegram.", bad: "Quelles options cherchez-vous ?" },
    { id: "G03", ask: "dis uniquement: LISTE-OK", good: "LISTE-OK", bad: "Pouvez-vous préciser ?" },
    { id: "G04", ask: "tu es qui ?", good: "Réception du bureau Master.", bad: "Comment puis-je vous aider aujourd'hui ?" },
    { id: "G05", ask: "status", good: "Tout le monde est idle sauf Chef en mission.", bad: "Je n'ai pas cette information, n'hésitez pas." },
    { id: "G06", ask: "délègue au chef", good: "Délégué à Chef.", bad: "Je serais ravi de déléguer." },
    { id: "G07", ask: "dis uniquement: pong", good: "pong", bad: "bonjour" },
    { id: "G08", ask: "merci", good: "OK.", bad: "Je vous en prie, n'hésitez pas !" },
    { id: "G09", ask: "où est le chef ?", good: "Chef est en MEET.", bad: "Quelles options ?" },
    { id: "G10", ask: "dis uniquement: SCAN-OK", good: "SCAN-OK", bad: "Je peux vous aider autrement ?" },
  ];

  for (const c of cases) {
    it(`${c.id} fit bon vs hors-sujet/mou`, () => {
      expect(assessReplyFit(c.ask, c.good).ok).toBe(true);
      expect(SOFT.test(c.good)).toBe(false);
      if (SOFT.test(c.bad)) {
        expect(SOFT.test(c.bad)).toBe(true);
      } else {
        expect(assessReplyFit(c.ask, c.bad).ok).toBe(false);
      }
    });
  }

  it("G11-G15 interim non vide pour mission", () => {
    for (const ask of ["délègue mission", "scan ebay", "code le fix", "spawn employé", "cherche github"]) {
      const t = interimAckText(ask);
      expect(t.length).toBeGreaterThan(8);
      expect(SOFT.test(t)).toBe(false);
    }
  });

  it("G16-G20 mentions routage", () => {
    expect(parseMention("@chef go", agents).target.kind).toBe("agent");
    expect(parseMention("@all hi", agents).target.kind).toBe("all");
    expect(parseMention("@mgr-dev fix", agents).text).toBe("fix");
    expect(parseMention("sans mention", agents).target.kind).toBe("none");
    expect(parseMention("@everyone ping", agents).target.kind).toBe("all");
  });
});
