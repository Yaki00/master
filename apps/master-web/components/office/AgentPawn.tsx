"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { OfficeAgent, OfficeRoom } from "@/lib/office/types";
import type { FloorSlot, GlobalPoint } from "@/lib/office/placement";
import { segmentDurationMs, walkWaypoints } from "@/lib/office/placement";
import {
  isSameSpot,
  ROOM_CHANGE_DEBOUNCE_MS,
  shouldWalkBetweenRooms,
} from "@/lib/office/pawn-motion";
import { PixelSprite, PIXEL_STATUS, poseForStatus, type SpritePose } from "./PixelSprite";
import { displayName, speechBubble } from "@/lib/office/labels";
import { agentRole, roleLabel } from "@/lib/office/role";

export type { FloorSlot };

export type PawnMotion = "live" | "frozen";

type PawnPhase = "idle" | "walking" | "working" | "meeting";

function phaseFor(agent: OfficeAgent, walking: boolean): PawnPhase {
  if (walking) return "walking";
  if (agent.status === "working") return "working";
  if (agent.room === "meeting" || agent.status === "waiting") return "meeting";
  return "idle";
}

/**
 * Pion plancher : déplacement fluide via waypoints (hall) lors d’un changement de salle.
 */
export function AgentPawn({
  agent,
  selected,
  onSelect,
  slot,
  global: target,
  room,
  motion = "live",
}: {
  agent: OfficeAgent;
  selected?: boolean;
  onSelect: (id: string) => void;
  slot: FloorSlot;
  global: GlobalPoint;
  room: OfficeRoom;
  motion?: PawnMotion;
}) {
  const frozen = motion === "frozen";
  const role = agentRole(agent);
  const isQueueWait =
    (agent.status === "waiting" || agent.status === "error") && role !== "reception";
  const isReceptionDesk = role === "reception";

  const committed = useRef({ x: target.x, y: target.y, room });
  const animToken = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = useState<GlobalPoint>(target);
  const [walking, setWalking] = useState(false);
  const [ready, setReady] = useState(false);
  const [transitionMs, setTransitionMs] = useState(0);

  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    if (frozen) {
      committed.current = { x: target.x, y: target.y, room };
      setPos(target);
      setWalking(false);
      return;
    }

    const prev = committed.current;

    if (!ready) {
      committed.current = { x: target.x, y: target.y, room };
      setPos(target);
      return;
    }

    // Même salle : snap silencieux, zéro mouvement (stabilité poll).
    if (!shouldWalkBetweenRooms(prev.room, room)) {
      if (!isSameSpot(prev, target, room)) {
        committed.current = { x: target.x, y: target.y, room };
        setPos(target);
      }
      setWalking(false);
      return;
    }

    // Changement de salle : debounce puis marche hall.
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      const from = committed.current;
      if (!shouldWalkBetweenRooms(from.room, room)) return;

      const token = ++animToken.current;
      const waypoints = walkWaypoints(from.room, room, target);
      let cursor = { x: from.x, y: from.y };

      async function runPath() {
        setWalking(true);
        for (const wp of waypoints) {
          if (animToken.current !== token) return;
          const ms = segmentDurationMs(cursor, wp);
          setTransitionMs(ms);
          setPos(wp);
          cursor = wp;
          await new Promise<void>((resolve) => setTimeout(resolve, ms + 20));
        }
        if (animToken.current !== token) return;
        committed.current = { x: target.x, y: target.y, room };
        setTransitionMs(0);
        setWalking(false);
      }

      void runPath();
    }, ROOM_CHANGE_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [target.x, target.y, room, ready, frozen]);

  const phase = phaseFor(agent, walking);
  const restPose: SpritePose = poseForStatus(agent.status, slot.pose);
  const pose: SpritePose = !frozen && walking ? "walk" : restPose;
  const sayRaw = speechBubble(agent);
  const say = sayRaw ? (sayRaw.length <= 18 ? sayRaw : `${sayRaw.slice(0, 16)}…`) : null;
  const showSay = Boolean(say && selected);
  const showRoleTag = selected || room !== "waiting";
  const depth = Math.round(pos.y);
  const depthScale = 0.85 + (depth / 100) * 0.3;

  const style: CSSProperties = {
    left: `${pos.x}%`,
    top: `${pos.y}%`,
    zIndex: 5 + depth,
    transition:
      frozen || !ready
        ? "none"
        : transitionMs > 0
          ? `left ${transitionMs}ms linear, top ${transitionMs}ms linear`
          : undefined,
    ["--pawn-depth" as string]: depthScale,
  };

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onSelect(agent.id);
      }}
      className={`pixel-actor phase-${phase} ${selected ? "is-on" : ""} ${isQueueWait ? "is-queue-wait" : ""} ${isReceptionDesk ? "is-reception" : ""} ${agent.status === "working" ? "is-work" : ""} ${walking ? "is-walking" : ""}`}
      style={style}
      title={`${displayName(agent)} · ${PIXEL_STATUS[agent.status]}`}
    >
      {showSay && <span className={`pixel-say ${isQueueWait ? "is-wait" : ""}`}>{say}</span>}
      <PixelSprite agent={agent} pose={pose} size={48} motion={frozen ? "frozen" : "live"} />
      <span className={`pixel-tag role-${role}`}>
        <span
          className={`pixel-status-dot status-${agent.status}`}
          title={PIXEL_STATUS[agent.status]}
          aria-hidden
        />
        <span className="pixel-tag-body">
          <span className="pixel-tag-name">{displayName(agent)}</span>
          {showRoleTag ? (
            <span className={`pixel-tag-role role-${role}`}>{roleLabel(role)}</span>
          ) : null}
        </span>
      </span>
      <span className="pixel-shadow" aria-hidden />
    </button>
  );
}
