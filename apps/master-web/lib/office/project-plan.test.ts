import { describe, expect, it } from "vitest";
import {
  buildDeterministicPlanFromBrief,
  normalizeAgentId,
  parsePlanFromAgentText,
  validateProjectPlan,
} from "./project-plan";

describe("project-plan", () => {
  it("normalizeAgentId", () => {
    expect(normalizeAgentId("chef")).toBe("openclaw:chef");
    expect(normalizeAgentId("openclaw:main")).toBe("openclaw:main");
    expect(normalizeAgentId("mgr-lab")).toBe("openclaw:mgr-lab");
  });

  it("valide un bon plan", () => {
    const plan = buildDeterministicPlanFromBrief("Lance surveillance eBay GPU", "GPU eBay");
    const v = validateProjectPlan(plan);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.plan.subtasks.length).toBe(3);
      expect(v.plan.teamProposal.some((m) => m.role === "lead")).toBe(true);
    }
  });

  it("rejette cycle et dependsOn fantôme", () => {
    const bad = {
      version: 1,
      title: "X",
      brief: "Y",
      acceptanceCriteria: ["a"],
      teamProposal: [{ agentId: "chef", role: "lead", rationale: "r" }],
      subtasks: [
        {
          id: "a",
          title: "A",
          assigneeAgentId: "openclaw:main",
          dependsOn: ["b"],
          kind: "code",
          acceptance: "ok",
        },
        {
          id: "b",
          title: "B",
          assigneeAgentId: "openclaw:main",
          dependsOn: ["a"],
          kind: "code",
          acceptance: "ok",
        },
      ],
      gates: [],
    };
    const v = validateProjectPlan(bad);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.some((e) => /cycle/i.test(e))).toBe(true);

    const ghost = {
      ...bad,
      subtasks: [
        {
          id: "a",
          title: "A",
          assigneeAgentId: "openclaw:main",
          dependsOn: ["ghost"],
          kind: "code",
          acceptance: "ok",
        },
      ],
    };
    const v2 = validateProjectPlan(ghost);
    expect(v2.ok).toBe(false);
  });

  it("rejette rôle invalide", () => {
    const v = validateProjectPlan({
      version: 1,
      title: "X",
      brief: "Y",
      acceptanceCriteria: ["a"],
      teamProposal: [{ agentId: "chef", role: "boss", rationale: "r" }],
      subtasks: [
        {
          id: "a",
          title: "A",
          assigneeAgentId: "main",
          dependsOn: [],
          kind: "ops",
          acceptance: "ok",
        },
      ],
      gates: [],
    });
    expect(v.ok).toBe(false);
  });

  it("parsePlanFromAgentText depuis fence json", () => {
    const plan = buildDeterministicPlanFromBrief("brief test");
    const text = `Voici le plan:\n\`\`\`json\n${JSON.stringify(plan)}\n\`\`\`\nfin`;
    const parsed = parsePlanFromAgentText(text);
    expect(parsed).toBeTruthy();
    const v = validateProjectPlan(parsed);
    expect(v.ok).toBe(true);
  });
});
