import { describe, expect, it } from "vitest";
import { agentRole, roleLabel } from "./role";

describe("agentRole", () => {
  it("détecte les rôles orga", () => {
    expect(agentRole({ id: "openclaw:office", kind: "openclaw", name: "Réception" })).toBe("reception");
    expect(agentRole({ id: "openclaw:chef", kind: "openclaw", name: "Chef" })).toBe("chef");
    expect(agentRole({ id: "openclaw:mgr-dev", kind: "openclaw", name: "Manager Dev" })).toBe("mgr");
    expect(agentRole({ id: "openclaw:main", kind: "openclaw", name: "Main" })).toBe("coder");
    expect(roleLabel("reception")).toBe("SEC");
  });
});
