"use client";

import { useMemo, useRef, type ReactNode } from "react";
import type { OfficeAgent, OfficeRoom, OfficeSources } from "@/lib/office/types";
import { AgentPawn } from "./AgentPawn";
import { Bench, Bookshelf, Coffee, ConferenceTable, Desk, Plant, Sofa } from "./PixelFurniture";
import { waitingJobTarget } from "@/lib/office/labels";
import {
  filterHallJobPlacements,
  hallShowsWaitingStyle,
} from "@/lib/office/hall-layout";
import { agentRole } from "@/lib/office/role";
import {
  resolvePlacements,
  spreadOverlappingPlacements,
  type AgentPlacement,
  type SlotRegistry,
} from "@/lib/office/placement";

function Room({
  id,
  title,
  children,
  busy,
}: {
  id: Exclude<OfficeRoom, "waiting">;
  title: string;
  children?: ReactNode;
  busy?: boolean;
}) {
  return (
    <section className={`pixel-cell ${id}${busy ? " is-busy" : ""}`}>
      <div className="pixel-plaque">
        <span className="pixel-plaque-dot" aria-hidden />
        {title}
      </div>
      <div className="pixel-decor">{children}</div>
    </section>
  );
}

export function OfficeFloor({
  agents,
  sources,
  selectedId,
  onSelect,
  hideOffline,
  onToggleOffline,
  onOpenLibrary,
}: {
  agents: OfficeAgent[];
  sources: OfficeSources;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  hideOffline?: boolean;
  onToggleOffline?: () => void;
  onOpenLibrary?: () => void;
}) {
  const slotRegistry = useRef<SlotRegistry>(new Map());
  const visible = hideOffline ? agents.filter((a) => a.status !== "offline") : agents;

  const placements = useMemo(() => {
    const { placements: core, registry } = resolvePlacements(visible, slotRegistry.current);
    slotRegistry.current = registry;

    const waitingJobs = sources.waitingJobs ?? [];
    const hallCore = core.filter((p) => p.room === "waiting");
    const jobs = filterHallJobPlacements(hallCore, waitingJobs);

    return spreadOverlappingPlacements([...core, ...jobs]);
  }, [visible, sources.waitingJobs]);

  const byRoom = (room: OfficeRoom) => placements.filter((p) => p.room === room);
  const waitingJobs = sources.waitingJobs ?? [];
  const offlineCount = useMemo(() => agents.filter((a) => a.status === "offline").length, [agents]);
  const macOk = sources.mac.online;
  const pcOk = sources.pc.online;
  const hallAgents = byRoom("waiting");
  const hallBusy = hallShowsWaitingStyle(hallAgents);
  const hallReception = hallAgents.some(
    (p) =>
      agentRole(p.agent) === "reception" &&
      p.agent.status !== "waiting" &&
      p.agent.status !== "error",
  );
  const showHud = !macOk || !pcOk || offlineCount > 0;

  const shelfBtn = (key: string) =>
    onOpenLibrary ? (
      <button
        key={key}
        type="button"
        className="pixel-library-hotspot"
        aria-label="Bibliothèque projets"
        onClick={(e) => {
          e.stopPropagation();
          onOpenLibrary();
        }}
      >
        <Bookshelf />
      </button>
    ) : (
      <Bookshelf />
    );

  function renderPawn(p: AgentPlacement) {
    return (
      <AgentPawn
        key={p.agent.id}
        agent={p.agent}
        selected={selectedId === p.agent.id}
        onSelect={(id) => {
          if (p.agent.kind === "job") {
            const job = waitingJobs.find((j) => `job:${j.id}` === id);
            onSelect(job ? waitingJobTarget(job, agents) : id);
            return;
          }
          onSelect(id);
        }}
        slot={p.slot}
        global={p.global}
        room={p.room}
        motion="live"
      />
    );
  }

  return (
    <div className="pixel-office">
      {showHud && (
        <div className="pixel-hud pixel-hud-slim">
          {!macOk && (
            <div className="pixel-sys warn">
              <strong>MAC</strong> OFF
            </div>
          )}
          {!pcOk && (
            <div className="pixel-sys warn">
              <strong>PC</strong> OFF
            </div>
          )}
          <div className="pixel-hud-spacer" />
          {offlineCount > 0 && onToggleOffline && (
            <button type="button" className="pixel-filter" onClick={onToggleOffline}>
              {hideOffline ? `+${offlineCount} off` : "Masquer off"}
            </button>
          )}
        </div>
      )}

      <div className="pixel-building" onClick={() => onSelect(null)}>
        <div className="pixel-building-glow" aria-hidden />

        <Room id="dev" title="DEV" busy={byRoom("dev").some((p) => p.agent.status === "working")}>
          <span className="furn f-desk-a">
            <Desk glow={byRoom("dev").some((p) => p.agent.status === "working")} />
          </span>
          <span className="furn f-desk-b">
            <Desk glow={byRoom("dev").filter((p) => p.agent.status === "working").length > 1} />
          </span>
          <span className="furn f-plant-a">
            <Plant />
          </span>
          <span className="furn f-shelf">{shelfBtn("dev")}</span>
        </Room>

        <section
          className={`pixel-hall${hallBusy ? " has-wait" : ""}${hallReception ? " has-reception" : ""}`}
        >
          <p className="pixel-plaque">
            <span className="pixel-plaque-dot" aria-hidden />
            HALL
          </p>
          <div className="pixel-hall-zone pixel-hall-reception" aria-hidden />
          <div className="pixel-hall-zone pixel-hall-queue" aria-hidden />
          <span className="furn f-bench">
            <Bench />
          </span>
          <span className="furn f-plant-h">
            <Plant />
          </span>
          <span className="furn f-shelf-hall">{shelfBtn("hall")}</span>
        </section>

        <Room
          id="research"
          title="LAB"
          busy={byRoom("research").some((p) => p.agent.status === "working")}
        >
          <span className="furn f-desk-a">
            <Desk glow={byRoom("research").some((p) => p.agent.status === "working")} />
          </span>
          <span className="furn f-desk-b">
            <Desk />
          </span>
          <span className="furn f-shelf">{shelfBtn("lab")}</span>
        </Room>

        <Room id="meeting" title="MEET" busy={byRoom("meeting").length > 1}>
          <span className="furn f-table">
            <ConferenceTable />
          </span>
          <span className="furn f-plant-a">
            <Plant />
          </span>
        </Room>

        <Room id="lounge" title="LOUNGE">
          <span className="furn f-sofa">
            <Sofa />
          </span>
          <span className="furn f-coffee">
            <Coffee />
          </span>
          <span className="furn f-plant-a">
            <Plant />
          </span>
        </Room>

        <div className="pixel-actors-layer" aria-label="Agents">
          {placements.map(renderPawn)}
        </div>
      </div>
    </div>
  );
}
