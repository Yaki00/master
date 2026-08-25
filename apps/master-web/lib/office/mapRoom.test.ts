import { describe, expect, it } from "vitest";
import { mapRoom, normalizeTaskSubject } from "./mapRoom";

describe("mapRoom", () => {
  it("envoie waiting/error vers waiting", () => {
    expect(mapRoom({ status: "waiting" })).toBe("waiting");
    expect(mapRoom({ status: "error", currentAction: "exec" })).toBe("waiting");
  });

  it("meeting seulement si working + flag", () => {
    expect(mapRoom({ status: "working", meeting: true, tools: ["exec"] })).toBe("meeting");
    expect(mapRoom({ status: "working", tools: ["exec"] })).toBe("dev");
    expect(mapRoom({ status: "idle", meeting: true })).toBe("lounge");
  });

  it("postes fixes CDC-06", () => {
    expect(mapRoom({ status: "idle", agentId: "openclaw:office" })).toBe("lounge");
    expect(mapRoom({ status: "idle", agentId: "openclaw:chef" })).toBe("meeting");
    expect(mapRoom({ status: "idle", agentId: "openclaw:mgr-dev" })).toBe("dev");
    expect(mapRoom({ status: "idle", agentId: "openclaw:mgr-lab" })).toBe("research");
  });

  it("envoie idle et offline vers lounge", () => {
    expect(mapRoom({ status: "idle" })).toBe("lounge");
    expect(mapRoom({ status: "offline", tools: ["browser"] })).toBe("lounge");
  });

  it("envoie working + outils browser vers research", () => {
    expect(mapRoom({ status: "working", tools: ["web_search"] })).toBe("research");
    expect(mapRoom({ status: "working", currentAction: "web search" })).toBe("research");
    expect(mapRoom({ status: "working", currentAction: "fetch docs" })).toBe("research");
    expect(mapRoom({ status: "working", currentAction: "browser" })).toBe("research");
  });

  it("envoie working + exec/write vers dev", () => {
    expect(mapRoom({ status: "working", tools: ["exec"] })).toBe("dev");
    expect(mapRoom({ status: "working", currentAction: "write file" })).toBe("dev");
    expect(mapRoom({ status: "working", currentAction: "git commit" })).toBe("dev");
    expect(mapRoom({ status: "working", currentAction: "apply_patch" })).toBe("dev");
  });

  it("ignore le profil coding+browser sans action live", () => {
    expect(mapRoom({ status: "working", tools: ["coding", "browser"] })).toBe("dev");
    expect(mapRoom({ status: "working", tools: ["coding", "browser"], agentId: "openclaw:mgr-lab" })).toBe(
      "research",
    );
  });

  it("currentAction prime sur les tools", () => {
    expect(mapRoom({ status: "working", currentAction: "exec", tools: ["web_search"] })).toBe("dev");
    expect(mapRoom({ status: "working", currentAction: "web_fetch", tools: ["exec"] })).toBe("research");
  });

  it("fallback working sans indice → dev", () => {
    expect(mapRoom({ status: "working" })).toBe("dev");
  });
});

describe("normalizeTaskSubject", () => {
  it("normalise et ignore trop court", () => {
    expect(normalizeTaskSubject("Scan eBay GPU 3090")).toBe("scan ebay gpu 3090");
    expect(normalizeTaskSubject("ab")).toBeNull();
  });
});
