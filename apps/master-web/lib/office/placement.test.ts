import { describe, expect, it } from "vitest";
import {
  assignStableSlots,
  hashSlot,
  hasOverlappingPlacements,
  logicalRoom,
  resolvePlacements,
  segmentDurationMs,
  spreadOverlappingPlacements,
  walkWaypoints,
  type SlotRegistry,
} from "@/lib/office/placement";
import type { OfficeAgent } from "@/lib/office/types";

function ag(id: string, overrides: Partial<OfficeAgent> = {}): OfficeAgent {
  return {
    id,
    kind: "openclaw",
    name: id,
    room: "lounge",
    status: "idle",
    task: null,
    currentAction: null,
    lastSeenAt: new Date().toISOString(),
    meta: {},
    ...overrides,
  };
}

describe("assignStableSlots", () => {
  it("garde le siège précédent si libre", () => {
    const prev = new Map([["a", 2], ["b", 0]]);
    const next = assignStableSlots([ag("a"), ag("b")], 4, prev, () => 0);
    expect(next.get("a")).toBe(2);
    expect(next.get("b")).toBe(0);
  });

  it("évite les collisions", () => {
    const next = assignStableSlots([ag("a"), ag("b"), ag("c")], 3, new Map(), () => 0);
    expect(new Set(next.values()).size).toBe(3);
  });
});

describe("logicalRoom", () => {
  it("envoie waiting/error au hall (sans pin)", () => {
    expect(logicalRoom(ag("x", { status: "waiting", room: "dev" }))).toBe("waiting");
    expect(logicalRoom(ag("x", { status: "error", room: "meeting" }))).toBe("waiting");
  });

  it("respecte la salle backend quand actif", () => {
    expect(logicalRoom(ag("x", { status: "working", room: "dev" }))).toBe("dev");
    expect(logicalRoom(ag("x", { status: "idle", room: "meeting" }))).toBe("meeting");
  });

  it("poste épinglé : réception au hall, autres au desk même en waiting", () => {
    expect(logicalRoom(ag("openclaw:office", { status: "idle", room: "lounge" }))).toBe("waiting");
    expect(logicalRoom(ag("openclaw:office", { status: "working", room: "dev" }))).toBe("waiting");
    expect(logicalRoom(ag("openclaw:chef", { status: "waiting", room: "dev" }))).toBe("meeting");
    expect(logicalRoom(ag("openclaw:mgr-dev", { status: "error", room: "waiting" }))).toBe("dev");
  });
});

describe("resolvePlacements", () => {
  it("garde le même slot entre deux polls dans la même salle", () => {
    const registry: SlotRegistry = new Map();
    const agents = [ag("worker-1", { room: "dev", status: "working" })];
    const first = resolvePlacements(agents, registry);
    const second = resolvePlacements(
      [ag("worker-1", { room: "dev", status: "working", task: "build" })],
      first.registry,
    );
    expect(first.placements[0]?.slot).toEqual(second.placements[0]?.slot);
  });

  it("change de salle quand le statut devient waiting (sans pin)", () => {
    const registry: SlotRegistry = new Map();
    const working = resolvePlacements([ag("worker-1", { room: "dev", status: "working" })], registry);
    const waiting = resolvePlacements(
      [ag("worker-1", { room: "dev", status: "waiting" })],
      working.registry,
    );
    expect(working.placements[0]?.room).toBe("dev");
    expect(waiting.placements[0]?.room).toBe("waiting");
  });

  it("reste au poste épinglé quand le statut devient waiting", () => {
    const registry: SlotRegistry = new Map();
    const working = resolvePlacements(
      [ag("openclaw:mgr-dev", { room: "dev", status: "working" })],
      registry,
    );
    const waiting = resolvePlacements(
      [ag("openclaw:mgr-dev", { room: "dev", status: "waiting" })],
      working.registry,
    );
    expect(working.placements[0]?.room).toBe("dev");
    expect(waiting.placements[0]?.room).toBe("dev");
    expect(waiting.placements[0]?.slot).toEqual(working.placements[0]?.slot);
  });

  it("ne stack pas chef + invité sur le même slot MEET", () => {
    const registry: SlotRegistry = new Map();
    const { placements } = resolvePlacements(
      [
        ag("openclaw:chef", { room: "meeting", status: "working" }),
        ag("guest-1", { room: "meeting", status: "working" }),
      ],
      registry,
    );
    const spread = spreadOverlappingPlacements(placements);
    expect(spread).toHaveLength(2);
    expect(hasOverlappingPlacements(spread)).toBe(false);
  });
});

describe("walkWaypoints", () => {
  it("passe par le hall entre deux salles (max 3 segments)", () => {
    const path = walkWaypoints("dev", "meeting", { x: 20, y: 70 });
    expect(path.length).toBeLessThanOrEqual(3);
    expect(path.length).toBeGreaterThan(1);
    expect(path[path.length - 1]).toEqual({ x: 20, y: 70 });
  });

  it("hall → salle : direct au poste", () => {
    const target = { x: 30, y: 60 };
    expect(walkWaypoints("waiting", "dev", target)).toEqual([target]);
  });

  it("salle → hall : hub puis poste", () => {
    const target = { x: 50, y: 62 };
    const path = walkWaypoints("dev", "waiting", target);
    expect(path).toHaveLength(2);
    expect(path[path.length - 1]).toEqual(target);
  });

  it("reste direct intra-salle", () => {
    const target = { x: 30, y: 60 };
    expect(walkWaypoints("dev", "dev", target)).toEqual([target]);
  });
});

describe("segmentDurationMs", () => {
  it("reste dans la fenêtre 400–600 ms", () => {
    const ms = segmentDurationMs({ x: 10, y: 10 }, { x: 90, y: 90 });
    expect(ms).toBeGreaterThanOrEqual(400);
    expect(ms).toBeLessThanOrEqual(600);
  });
});

describe("hashSlot", () => {
  it("est déterministe", () => {
    expect(hashSlot("openclaw:main", 4)).toBe(hashSlot("openclaw:main", 4));
  });
});
