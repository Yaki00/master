import { describe, expect, it } from "vitest";
import { assessReplyFit, interimAckText } from "./interim";

describe("interim", () => {
  it("accusé + fit", () => {
    expect(interimAckText("mission spawn manager")).toMatch(/délègue/i);
    expect(assessReplyFit("dis uniquement EMP-OK", "EMP-OK").ok).toBe(true);
    expect(assessReplyFit("dis uniquement EMP-OK", "fait").ok).toBe(false);
  });
});
