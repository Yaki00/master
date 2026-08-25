import { describe, expect, it } from "vitest";
import {
  isSameSpot,
  shouldWalkBetweenRooms,
} from "@/lib/office/pawn-motion";

describe("pawn-motion", () => {
  it("isSameSpot tolère un micro-delta intra-salle", () => {
    const prev = { x: 30, y: 60, room: "dev" as const };
    expect(isSameSpot(prev, { x: 30.2, y: 60.1 }, "dev")).toBe(true);
    expect(isSameSpot(prev, { x: 31, y: 60 }, "dev")).toBe(false);
  });

  it("isSameSpot exige la même salle", () => {
    const prev = { x: 30, y: 60, room: "dev" as const };
    expect(isSameSpot(prev, { x: 30, y: 60 }, "waiting")).toBe(false);
  });

  it("shouldWalkBetweenRooms uniquement si salle change", () => {
    expect(shouldWalkBetweenRooms("dev", "dev")).toBe(false);
    expect(shouldWalkBetweenRooms("dev", "meeting")).toBe(true);
    expect(shouldWalkBetweenRooms("waiting", "dev")).toBe(true);
  });
});
