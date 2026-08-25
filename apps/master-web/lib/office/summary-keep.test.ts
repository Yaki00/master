import { describe, expect, it } from "vitest";
import { assessSummaryUsefulness, filterSummaryForStorage } from "./summary-keep";

describe("assessSummaryUsefulness", () => {
  it("rejette le bruit", () => {
    expect(assessSummaryUsefulness("bonjour").keep).toBe(false);
    expect(assessSummaryUsefulness("ok").keep).toBe(false);
    expect(assessSummaryUsefulness("").keep).toBe(false);
  });

  it("garde une mission structurée", () => {
    const s =
      "Mission: déléguer au mgr-dev un scan eBay GPU. Chef a spawn 1 employé. Deadline vendredi.";
    const d = assessSummaryUsefulness(s);
    expect(d.keep).toBe(true);
    expect(filterSummaryForStorage(s).summary).toContain("Mission");
  });
});
