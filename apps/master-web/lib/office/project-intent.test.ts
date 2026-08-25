import { describe, expect, it } from "vitest";
import { matchProjectByTitle, parseProjectSpeech } from "./project-intent";

describe("parseProjectSpeech", () => {
  it("crée un projet nommé", () => {
    const r = parseProjectSpeech('Crée un projet « Scan GPU » pour surveiller eBay');
    expect(r?.kind).toBe("create");
    if (r?.kind === "create") {
      expect(r.title).toMatch(/Scan GPU/i);
      expect(r.projectKind).toBe("punctual");
    }
  });

  it("crée récurrent", () => {
    const r = parseProjectSpeech("Ajoute un projet veille GPU récurrent chaque lundi");
    expect(r?.kind).toBe("create");
    if (r?.kind === "create") {
      expect(r.projectKind).toBe("recurring");
      expect(r.schedule).toMatch(/lundi/i);
    }
  });

  it("met en pause", () => {
    const r = parseProjectSpeech("Mets le projet Scan GPU en pause");
    expect(r?.kind).toBe("update");
    if (r?.kind === "update") {
      expect(r.titleQuery).toMatch(/Scan GPU/i);
      expect(r.patch.status).toBe("paused");
    }
  });

  it("supprime", () => {
    const r = parseProjectSpeech('Supprime le projet "Scan GPU"');
    expect(r?.kind).toBe("delete");
    if (r?.kind === "delete") expect(r.titleQuery).toMatch(/Scan GPU/i);
  });

  it("ignore hors projet", () => {
    expect(parseProjectSpeech("salut ça va")).toBeNull();
  });

  it("match titre", () => {
    const list = [
      { id: "1", title: "Scan GPU" },
      { id: "2", title: "Site vitrine" },
    ];
    expect(matchProjectByTitle(list, "scan")?.id).toBe("1");
  });
});
