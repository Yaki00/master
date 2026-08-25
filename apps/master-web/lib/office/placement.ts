import type { OfficeAgent, OfficeRoom } from "@/lib/office/types";

export type FloorSlot = { x: number; y: number; pose: "stand" | "sit" };
export type GlobalPoint = { x: number; y: number };

export type AgentPlacement = {
  agent: OfficeAgent;
  room: OfficeRoom;
  slot: FloorSlot;
  global: GlobalPoint;
};

/** Postes « maison » — utilisés quand l’agent est dans cette salle. */
export const PINNED_DESKS: Record<string, { room: OfficeRoom; slot: FloorSlot }> = {
  "openclaw:office": { room: "waiting", slot: { x: 50, y: 30, pose: "sit" } },
  "openclaw:chef": { room: "meeting", slot: { x: 50, y: 48, pose: "sit" } },
  "openclaw:mgr-dev": { room: "dev", slot: { x: 22, y: 58, pose: "sit" } },
  "openclaw:mgr-lab": { room: "research", slot: { x: 24, y: 56, pose: "sit" } },
  "openclaw:telegram-pc": { room: "lounge", slot: { x: 30, y: 62, pose: "sit" } },
  "openclaw:main": { room: "dev", slot: { x: 52, y: 58, pose: "sit" } },
};

const SLOT_POOLS: Record<OfficeRoom, FloorSlot[]> = {
  dev: [
    { x: 22, y: 58, pose: "sit" },
    { x: 52, y: 58, pose: "sit" },
    { x: 78, y: 70, pose: "stand" },
    { x: 36, y: 82, pose: "stand" },
  ],
  research: [
    { x: 24, y: 56, pose: "sit" },
    { x: 54, y: 58, pose: "sit" },
    { x: 80, y: 72, pose: "stand" },
    { x: 42, y: 82, pose: "stand" },
  ],
  meeting: [
    { x: 50, y: 48, pose: "sit" },
    { x: 28, y: 52, pose: "sit" },
    { x: 72, y: 52, pose: "sit" },
    { x: 50, y: 78, pose: "stand" },
  ],
  lounge: [
    { x: 30, y: 62, pose: "sit" },
    { x: 54, y: 62, pose: "sit" },
    { x: 78, y: 74, pose: "stand" },
    { x: 16, y: 80, pose: "stand" },
  ],
  waiting: [
    { x: 50, y: 30, pose: "sit" },
    { x: 42, y: 52, pose: "sit" },
    { x: 58, y: 52, pose: "sit" },
    { x: 42, y: 72, pose: "stand" },
    { x: 58, y: 72, pose: "stand" },
    { x: 50, y: 86, pose: "stand" },
  ],
};

/** Emprise de chaque salle dans l’espace bâtiment (0–100 %). */
const ROOM_BOUNDS: Record<OfficeRoom, { x0: number; y0: number; x1: number; y1: number }> = {
  dev: { x0: 3, y0: 4, x1: 42, y1: 48 },
  waiting: { x0: 42, y0: 4, x1: 58, y1: 96 },
  research: { x0: 58, y0: 4, x1: 97, y1: 48 },
  meeting: { x0: 3, y0: 52, x1: 42, y1: 96 },
  lounge: { x0: 58, y0: 52, x1: 97, y1: 96 },
};

const HALL_HUB: GlobalPoint = { x: 50, y: 50 };

const ROOM_DOORS: Record<Exclude<OfficeRoom, "waiting">, GlobalPoint> = {
  dev: { x: 41, y: 26 },
  research: { x: 59, y: 26 },
  meeting: { x: 41, y: 74 },
  lounge: { x: 59, y: 74 },
};

export function hashSlot(id: string, n: number): number {
  let h = 0;
  for (const c of id) h = (h + c.charCodeAt(0) * 17) % 997;
  return n === 0 ? 0 : h % n;
}

/** Salle logique selon statut + room backend (working→dev, meeting→meet, waiting→hall). */
export function logicalRoom(agent: OfficeAgent): OfficeRoom {
  const pinned = PINNED_DESKS[agent.id];
  if (pinned) return pinned.room;
  if (agent.status === "waiting" || agent.status === "error") return "waiting";
  const r = agent.room;
  if (r === "dev" || r === "research" || r === "meeting" || r === "lounge") return r;
  if (r === "waiting") return "waiting";
  return "lounge";
}

export function localToGlobal(room: OfficeRoom, slot: FloorSlot): GlobalPoint {
  const b = ROOM_BOUNDS[room];
  return {
    x: b.x0 + (slot.x / 100) * (b.x1 - b.x0),
    y: b.y0 + (slot.y / 100) * (b.y1 - b.y0),
  };
}

/** Attribution stable : garde le siège précédent si libre. */
export function assignStableSlots(
  agents: OfficeAgent[],
  slotCount: number,
  prev: Map<string, number>,
  hash: (id: string, n: number) => number,
  reserved: Set<number> = new Set(),
): Map<string, number> {
  const next = new Map<string, number>();
  const used = new Set<number>(reserved);

  for (const a of agents) {
    const p = prev.get(a.id);
    if (p != null && p >= 0 && p < slotCount && !used.has(p)) {
      next.set(a.id, p);
      used.add(p);
    }
  }

  for (const a of agents) {
    if (next.has(a.id)) continue;
    let idx = hash(a.id, slotCount);
    if (used.has(idx)) {
      idx = [...Array(slotCount).keys()].find((i) => !used.has(i)) ?? idx;
    }
    used.add(idx);
    next.set(a.id, idx);
  }

  return next;
}

export type SlotRegistry = Map<string, { room: OfficeRoom; slotIndex: number }>;

function slotPoolIndex(pool: FloorSlot[], slot: FloorSlot): number {
  return pool.findIndex((s) => s.x === slot.x && s.y === slot.y && s.pose === slot.pose);
}

export function resolvePlacements(
  agents: OfficeAgent[],
  registry: SlotRegistry,
): { placements: AgentPlacement[]; registry: SlotRegistry } {
  const nextRegistry: SlotRegistry = new Map(registry);
  const byRoom = new Map<OfficeRoom, OfficeAgent[]>();

  for (const a of agents) {
    const room = logicalRoom(a);
    const list = byRoom.get(room) ?? [];
    list.push(a);
    byRoom.set(room, list);
  }

  const placements: AgentPlacement[] = [];

  for (const [room, roomAgents] of byRoom) {
    const pool = SLOT_POOLS[room];
    const pinnedIndices = new Set<number>();
    const unpinned: OfficeAgent[] = [];
    const prevUnpinned = new Map<string, number>();

    for (const a of roomAgents) {
      const pinned = PINNED_DESKS[a.id];
      if (pinned?.room === room) {
        const idx = slotPoolIndex(pool, pinned.slot);
        if (idx >= 0) pinnedIndices.add(idx);
        continue;
      }
      unpinned.push(a);
      const prev = nextRegistry.get(a.id);
      if (prev?.room === room && prev.slotIndex >= 0 && prev.slotIndex < pool.length) {
        prevUnpinned.set(a.id, prev.slotIndex);
      }
    }

    const slotMap = assignStableSlots(unpinned, pool.length, prevUnpinned, hashSlot, pinnedIndices);

    for (const a of roomAgents) {
      const pinned = PINNED_DESKS[a.id];
      let slot: FloorSlot;
      let slotIndex: number;

      if (pinned?.room === room) {
        slot = pinned.slot;
        slotIndex = slotPoolIndex(pool, pinned.slot);
        if (slotIndex < 0) slotIndex = slotMap.get(a.id) ?? 0;
      } else {
        slotIndex = slotMap.get(a.id) ?? 0;
        slot = pool[slotIndex] ?? pool[0]!;
      }

      nextRegistry.set(a.id, { room, slotIndex });
      placements.push({
        agent: { ...a, room },
        room,
        slot,
        global: localToGlobal(room, slot),
      });
    }
  }

  return { placements, registry: nextRegistry };
}

const OVERLAP_EPS = 2.8;

function spotKey(g: GlobalPoint): string {
  return `${Math.round(g.x * 10) / 10},${Math.round(g.y * 10) / 10}`;
}

/** Écarte les pions qui partagent la même position globale (évite le stack visuel). */
export function spreadOverlappingPlacements(placements: AgentPlacement[]): AgentPlacement[] {
  const seen = new Map<string, number>();
  const offsets = [
    { dx: 0, dy: 0 },
    { dx: -4, dy: 0 },
    { dx: 4, dy: 0 },
    { dx: 0, dy: -3 },
    { dx: 0, dy: 3 },
    { dx: -3, dy: -2 },
    { dx: 3, dy: -2 },
    { dx: -3, dy: 2 },
    { dx: 3, dy: 2 },
  ];

  return placements.map((p) => {
    const key = spotKey(p.global);
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    if (n === 0) return p;

    const off = offsets[n % offsets.length] ?? offsets[1]!;
    const global = {
      x: Math.min(96, Math.max(4, p.global.x + off.dx)),
      y: Math.min(94, Math.max(6, p.global.y + off.dy)),
    };
    const slot = {
      ...p.slot,
      x: Math.min(96, Math.max(4, p.slot.x + off.dx)),
      y: Math.min(94, Math.max(6, p.slot.y + off.dy)),
    };
    return { ...p, global, slot };
  });
}

export function hasOverlappingPlacements(placements: AgentPlacement[], eps = OVERLAP_EPS): boolean {
  for (let i = 0; i < placements.length; i++) {
    for (let j = i + 1; j < placements.length; j++) {
      const a = placements[i]!.global;
      const b = placements[j]!.global;
      if (Math.hypot(a.x - b.x, a.y - b.y) < eps) return true;
    }
  }
  return false;
}

/** Chemin hall-centré — max 3 segments rapides (400–600 ms chacun). */
export function walkWaypoints(
  fromRoom: OfficeRoom,
  toRoom: OfficeRoom,
  target: GlobalPoint,
): GlobalPoint[] {
  if (fromRoom === toRoom) return [target];

  if (fromRoom === "waiting") return [target];

  if (toRoom === "waiting") return [HALL_HUB, target];

  return [ROOM_DOORS[fromRoom], HALL_HUB, target];
}

export function segmentDurationMs(from: GlobalPoint, to: GlobalPoint): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  return Math.min(600, Math.max(400, Math.round(400 + dist * 4)));
}

/** @deprecated — compat tests / imports legacy */
export function resolveAgentPlacement(agent: OfficeAgent): { room: OfficeRoom; slot: FloorSlot } {
  const room = logicalRoom(agent);
  const pinned = PINNED_DESKS[agent.id];
  if (pinned?.room === room) return { room, slot: pinned.slot };
  const pool = SLOT_POOLS[room];
  const idx = hashSlot(agent.id, pool.length);
  return { room, slot: pool[idx]! };
}
