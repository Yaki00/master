"use client";

import type { OfficeAgent, OfficeStatus } from "@/lib/office/types";
import { agentRole, type OfficeRole } from "@/lib/office/role";

type Palette = {
  skin: string;
  shirt: string;
  pants: string;
  hair: string;
  shoe: string;
  accent: string;
};

const ROLE_PALETTE: Record<OfficeRole, Palette> = {
  reception: { skin: "#f0c8a0", shirt: "#1fa89a", pants: "#0f2e2c", hair: "#2b1a12", shoe: "#1a120c", accent: "#ffe566" },
  chef: { skin: "#e8b890", shirt: "#1a1a22", pants: "#0c0c12", hair: "#1a100c", shoe: "#0a0808", accent: "#d4a017" },
  mgr: { skin: "#efc4a0", shirt: "#3d2a6b", pants: "#1a1230", hair: "#2a1810", shoe: "#120c18", accent: "#b8a0ff" },
  coder: { skin: "#e8b48c", shirt: "#2a4a6b", pants: "#142030", hair: "#3d2816", shoe: "#101018", accent: "#4aa3ff" },
  telegram: { skin: "#f0c8a0", shirt: "#2a6db0", pants: "#143050", hair: "#2b1a12", shoe: "#101018", accent: "#6ec8ff" },
  pc: { skin: "#e0b090", shirt: "#3a7cff", pants: "#1a3358", hair: "#3d2816", shoe: "#141014", accent: "#9dffb0" },
  job: { skin: "#f3d0a8", shirt: "#d4a017", pants: "#4a3a14", hair: "#4a2c18", shoe: "#1c140c", accent: "#ffe566" },
  worker: { skin: "#f0c8a0", shirt: "#2ec4b6", pants: "#163d3c", hair: "#2b1a12", shoe: "#1a120c", accent: "#9dffb0" },
};

export type SpritePose = "stand" | "sit" | "walk" | "work";

export function poseForStatus(status: OfficeStatus, slotPose: "stand" | "sit" = "stand"): SpritePose {
  if (status === "working") return "work";
  if (status === "waiting") return "sit";
  if (status === "error") return "stand";
  return slotPose === "sit" ? "sit" : "stand";
}

export function PixelSprite({
  agent,
  pose = "stand",
  size = 56,
  /** live = bob travail / walk cycle · frozen = console (cliquable, sans tremblement) */
  motion = "live",
}: {
  agent: OfficeAgent;
  pose?: SpritePose;
  size?: number;
  motion?: "live" | "frozen";
}) {
  const role = agentRole(agent);
  const pal = ROLE_PALETTE[role];
  const frozen = motion === "frozen";
  const working = !frozen && (agent.status === "working" || pose === "work");
  const waiting = agent.status === "waiting";
  const offline = agent.status === "offline";
  const err = agent.status === "error";
  const idle = agent.status === "idle";
  const blocked = waiting || err;
  const h = Math.round((size * 26) / 18);
  const walk = !frozen && pose === "walk";
  const sit = pose === "sit";
  const workPose = !frozen && pose === "work";

  return (
    <div
      className={`pixel-sprite role-${role} ${frozen ? "is-frozen" : ""} ${working ? "is-working" : ""} ${waiting ? "is-waiting" : ""} ${offline ? "is-offline" : ""} ${idle ? "is-idle" : ""} ${blocked ? "is-blocked" : ""} ${sit ? "is-sit" : ""} ${walk ? "is-walk" : ""} ${workPose ? "is-work-pose" : ""}`}
      aria-hidden
      data-role={role}
      data-pose={pose}
      data-motion={motion}
    >
      <svg viewBox="0 0 18 26" width={size} height={h} shapeRendering="crispEdges">
        {sit && (
          <>
            <rect x="3" y="15" width="12" height="2" fill="#3a2a18" />
            <rect x="4" y="17" width="10" height="6" fill="#2a1e12" />
            <rect x="3" y="17" width="1" height="7" fill="#1a120c" />
            <rect x="14" y="17" width="1" height="7" fill="#1a120c" />
          </>
        )}

        {role === "chef" ? (
          <>
            <rect x="5" y="1" width="8" height="2" fill="#111118" />
            <rect x="4" y="3" width="10" height="2" fill="#111118" />
          </>
        ) : role === "reception" ? (
          <>
            <rect x="5" y="1" width="8" height="2" fill={pal.hair} />
            <rect x="4" y="3" width="10" height="2" fill={pal.hair} />
            <rect x="3" y="4" width="2" height="2" fill={pal.accent} />
            <rect x="13" y="5" width="3" height="2" fill="#2a2a2a" />
          </>
        ) : (
          <>
            <rect x="5" y="1" width="8" height="2" fill={pal.hair} />
            <rect x="4" y="3" width="10" height="2" fill={pal.hair} />
          </>
        )}

        <rect x="5" y="5" width="8" height="6" fill={pal.skin} />
        <rect x="6" y="7" width="1" height="1" fill="#1a120c" />
        <rect x="11" y="7" width="1" height="1" fill="#1a120c" />
        <rect x="8" y="9" width="2" height="1" fill={working ? "#8b3a3a" : "#c47878"} />

        <rect x="4" y="11" width="10" height={sit ? 5 : 6} fill={pal.shirt} />
        {/* bras : work lève un bras, walk décale */}
        <rect x={walk ? 1 : 2} y={working ? 11 : 12} width="2" height={working ? 5 : 4} fill={pal.skin} />
        <rect x={walk ? 15 : 14} y="12" width="2" height="4" fill={pal.skin} />

        {role === "chef" && <rect x="8" y="12" width="2" height="3" fill={pal.accent} />}
        {role === "mgr" && <rect x="7" y="13" width="4" height="1" fill={pal.accent} />}
        {role === "reception" && <rect x="7" y="14" width="4" height="1" fill="#0c4038" />}
        {(role === "coder" || pose === "work") && working && (
          <rect x="15" y="13" width="2" height="4" fill={pal.accent} />
        )}
        {role === "telegram" && <rect x="15" y="13" width="2" height="3" fill={pal.accent} />}
        {role === "job" && <rect x="5" y="12" width="8" height="1" fill="#ffe566" />}

        {!sit && (
          <>
            <rect x={walk ? 4 : 5} y="17" width="3" height="6" fill={pal.pants} />
            <rect x={walk ? 11 : 10} y="17" width="3" height="6" fill={pal.pants} />
            <rect x={walk ? 4 : 5} y="23" width="3" height="2" fill={pal.shoe} />
            <rect x={walk ? 11 : 10} y="23" width="3" height="2" fill={pal.shoe} />
          </>
        )}
        {sit && (
          <>
            <rect x="5" y="16" width="3" height="4" fill={pal.pants} />
            <rect x="10" y="16" width="3" height="4" fill={pal.pants} />
          </>
        )}
      </svg>
      {working && <span className="pixel-spark" />}
      {waiting && <span className="pixel-bang">!</span>}
      {err && <span className="pixel-bang is-err">!</span>}
      {idle && role === "reception" && <span className="pixel-ready" title="ready" />}
    </div>
  );
}

export const PIXEL_STATUS: Record<OfficeStatus, string> = {
  working: "WORK",
  idle: "IDLE",
  waiting: "WAIT",
  error: "ERR",
  offline: "OFF",
};
