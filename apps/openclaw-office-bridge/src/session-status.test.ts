import { describe, expect, it } from "vitest";
import { readableTask, pickBureauSession, sessionAgeMs, statusFromSession, toolsFromSession } from "./session-status";

describe("statusFromSession", () => {
  const now = Date.parse("2026-08-24T12:00:00.000Z");

  it("idle si aucune session", () => {
    expect(statusFromSession(null, now)).toBe("idle");
  });

  it("working si running", () => {
    expect(statusFromSession({ status: "running", updatedAt: now - 10_000 }, now)).toBe("working");
  });

  it("idle pour killed/done anciens (pas error)", () => {
    expect(
      statusFromSession({ status: "killed", abortedLastRun: true, updatedAt: now - 10 * 60_000 }, now),
    ).toBe("idle");
    expect(statusFromSession({ status: "done", updatedAt: now - 5 * 60_000 }, now)).toBe("idle");
  });

  it("error seulement si échec récent", () => {
    expect(
      statusFromSession({ status: "killed", abortedLastRun: true, updatedAt: now - 60_000 }, now),
    ).toBe("error");
    expect(statusFromSession({ status: "error", updatedAt: now - 30_000 }, now)).toBe("error");
  });
});

describe("readableTask", () => {
  it("utilise le message user ou le titre", () => {
    expect(readableTask({ lastUserMessage: "Scan eBay GPU" }, "main")).toBe("Scan eBay GPU");
    expect(readableTask({ title: "Mission RTX" }, "main")).toBe("Mission RTX");
  });

  it("nettoie les clés agent:…", () => {
    expect(readableTask({ key: "agent:main:mission-42" }, "main")).toBe("mission-42");
  });

  it("ne montre pas un id de modèle comme tâche", () => {
    expect(readableTask({ model: "qwen2.5:32b", key: "agent:main:main" }, "Mac polyvalent")).toBe(
      "Mac polyvalent",
    );
  });
});

describe("pickBureauSession", () => {
  it("préfère bureau puis office", () => {
    const picked = pickBureauSession(
      [
        { key: "agent:main:main", updatedAt: 200, session: { title: "grosse mission", model: "qwen2.5:32b" } },
        { key: "agent:main:office", updatedAt: 50, session: { lastUserMessage: "salut" } },
        { key: "agent:main:bureau", updatedAt: 80, session: { lastUserMessage: "bureau-hi" } },
      ],
      "main",
    );
    expect(picked?.lastUserMessage).toBe("bureau-hi");
  });
});

describe("toolsFromSession", () => {
  it("préfère lastTool à la config", () => {
    const r = toolsFromSession({ lastTool: "exec", status: "running" }, ["coding", "browser"]);
    expect(r.tools).toEqual(["exec"]);
  });

  it("ne dump pas le profil config en idle", () => {
    const r = toolsFromSession({ status: "done" }, ["coding", "browser"]);
    expect(r.tools).toEqual([]);
  });
});

describe("sessionAgeMs", () => {
  it("retourne infinity si pas de timestamp", () => {
    expect(sessionAgeMs({})).toBe(Number.POSITIVE_INFINITY);
  });
});
