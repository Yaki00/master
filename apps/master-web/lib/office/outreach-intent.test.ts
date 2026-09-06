import { describe, expect, it } from "vitest";
import { parseOutreachListIntent, outreachCsvTemplate, outreachMailDraft } from "./outreach-intent";

describe("outreach-intent", () => {
  it("parse boulangeries Trappes", () => {
    const r = parseOutreachListIntent(
      "Liste les boulangeries sans site autour de Trappes puis crée un csv et un mail",
    );
    expect(r).toBeTruthy();
    expect(r!.kind).toBe("boulangerie");
    expect(r!.zone).toMatch(/Trappes/i);
    expect(outreachCsvTemplate(r!)).toMatch(/nom,adresse/);
    expect(outreachMailDraft(r!)).toMatch(/Trappes/);
  });

  it("ignore hors sujet", () => {
    expect(parseOutreachListIntent("salut")).toBeNull();
    expect(parseOutreachListIntent("liste les boulangeries de Paris")).toBeNull(); // sans « sans site »
  });
});
