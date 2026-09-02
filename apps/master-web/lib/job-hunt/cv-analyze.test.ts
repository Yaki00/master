import { describe, expect, it } from "vitest";
import { analyzeCvText } from "./cv-analyze";

describe("analyzeCvText", () => {
  it("extrait compétences, contact et postes", () => {
    const text = `
Jean Dupont
jean.dupont@email.com
+33 6 12 34 56 78
Paris

Développeur Full Stack Senior

Compétences: React, TypeScript, Node.js, Docker, PostgreSQL
Langues: français, anglais

Recherche: Développeur Full Stack remote
`;
    const result = analyzeCvText(text, "cv.txt");
    expect(result.email).toBe("jean.dupont@email.com");
    expect(result.stack).toContain("react");
    expect(result.stack).toContain("typescript");
    expect(result.languages).toContain("français");
    expect(result.targetRoles.some((r) => r.toLowerCase().includes("full stack"))).toBe(true);
  });
});
