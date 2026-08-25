import { describe, expect, it } from "vitest";
import {
  buildOfficeAgentArgs,
  cancelActiveRun,
  DEFAULT_OFFICE_MODEL,
  hasActiveRun,
  officeSessionKey,
  parseMeetingIntent,
  resolveRunAgent,
  runOpenclawTracked,
  shouldUseFastChat,
} from "./office-run";

describe("office-run", () => {
  it("route main → office, garde telegram-pc, chef et managers", () => {
    expect(resolveRunAgent("main")).toBe("office");
    expect(resolveRunAgent("openclaw:main")).toBe("office");
    expect(resolveRunAgent("telegram-pc")).toBe("telegram-pc");
    expect(resolveRunAgent("chef")).toBe("chef");
    expect(resolveRunAgent("mgr-dev")).toBe("mgr-dev");
    expect(resolveRunAgent("mgr-lab")).toBe("mgr-lab");
  });

  it("isole le bureau sur une session + 7b Mac", () => {
    const args = buildOfficeAgentArgs("main", "salut");
    expect(officeSessionKey("office")).toBe("agent:office:bureau");
    expect(args).toContain("agent:office:bureau");
    expect(args).toContain("--agent");
    expect(args).toContain("office");
    expect(args).toContain("--model");
    expect(args).toContain(DEFAULT_OFFICE_MODEL);
    expect(args).toContain("--local");
    expect(args).not.toContain("32b");
  });

  it("peut désactiver --local", () => {
    const args = buildOfficeAgentArgs("main", "salut", { local: false });
    expect(args).not.toContain("--local");
  });

  it("parseMeetingIntent bloque réunion FR explicite", () => {
    expect(parseMeetingIntent("organise une réunion avec tout le monde")).toBe(true);
    expect(parseMeetingIntent("organiser une réunion")).toBe(true);
    expect(parseMeetingIntent("réunion avec tout le monde")).toBe(true);
    expect(parseMeetingIntent("meeting avec tout le monde")).toBe(true);
    expect(parseMeetingIntent("avec tout le monde")).toBe(true);
    expect(parseMeetingIntent("salut")).toBe(false);
  });

  it("chat rapide pour salut, OpenClaw pour mission / réunion / status", () => {
    expect(shouldUseFastChat("salut")).toBe(true);
    expect(shouldUseFastChat("tu fais quoi ?")).toBe(true);
    expect(shouldUseFastChat("délègue une mission code à main")).toBe(false);
    expect(shouldUseFastChat("scan ebay gpu")).toBe(false);
    expect(shouldUseFastChat("alors des nouvelles ?")).toBe(false);
    expect(shouldUseFastChat("salut", true, { forceOpenClaw: true })).toBe(false);
    expect(shouldUseFastChat("salut", true, { taskId: "abc" })).toBe(false);
    expect(shouldUseFastChat("salut", true, { handoff: true })).toBe(false);
    expect(shouldUseFastChat("salut", true, { sentinelTick: true })).toBe(false);
    expect(shouldUseFastChat("surveille RTX 4090")).toBe(false);
    expect(shouldUseFastChat("analyse ma boîte mail")).toBe(false);
    expect(shouldUseFastChat("statut réunion")).toBe(false);
    expect(
      shouldUseFastChat(
        "organise une réunion avec tout le monde pour trouver le meilleur objet à vendre sur eBay",
      ),
    ).toBe(false);
  });

  it("cancelActiveRun sans run → hadRun false", () => {
    expect(hasActiveRun("openclaw:main")).toBe(false);
    const r = cancelActiveRun("openclaw:main");
    expect(r.hadRun).toBe(false);
    expect(r.signalled).toBe(false);
  });

  it("cancelActiveRun envoie SIGTERM sur run suivi", async () => {
    const sleepBin = process.platform === "win32" ? "timeout" : "/bin/sleep";
    const sleepArgs = process.platform === "win32" ? ["/t", "5"] : ["5"];
    const run = runOpenclawTracked(sleepBin, "openclaw:main", sleepArgs, 10);
    await new Promise((r) => setTimeout(r, 80));
    expect(hasActiveRun("openclaw:main")).toBe(true);
    const cancel = cancelActiveRun("openclaw:main");
    expect(cancel.hadRun).toBe(true);
    expect(cancel.signalled).toBe(true);
    expect(cancel.detail).toMatch(/SIGTERM|pid/i);
    await expect(run).rejects.toThrow();
    expect(hasActiveRun("openclaw:main")).toBe(false);
  });
});
