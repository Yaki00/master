"use client";

/** Meubles pixel décoratifs (SVG crisp). */

export function Desk({ glow = false }: { glow?: boolean }) {
  return (
    <svg viewBox="0 0 28 16" width="84" height="48" shapeRendering="crispEdges" className="pixel-furn">
      <rect x="1" y="6" width="26" height="7" fill="#6b4a28" />
      <rect x="1" y="6" width="26" height="2" fill="#8a6236" />
      <rect x="2" y="13" width="2" height="3" fill="#3a2814" />
      <rect x="24" y="13" width="2" height="3" fill="#3a2814" />
      <rect x="8" y="1" width="12" height="7" fill="#1a1a22" />
      <rect x="9" y="2" width="10" height="5" fill={glow ? "#7ec8ff" : "#243044"} />
      <rect x="12" y="8" width="4" height="1" fill="#333" />
    </svg>
  );
}

export function Plant() {
  return (
    <svg viewBox="0 0 10 14" width="30" height="42" shapeRendering="crispEdges" className="pixel-furn">
      <rect x="3" y="9" width="4" height="5" fill="#8a4a28" />
      <rect x="2" y="3" width="2" height="6" fill="#2d8a4a" />
      <rect x="6" y="2" width="2" height="7" fill="#247a3e" />
      <rect x="4" y="1" width="2" height="8" fill="#36a85a" />
    </svg>
  );
}

export function Sofa() {
  return (
    <svg viewBox="0 0 32 14" width="96" height="42" shapeRendering="crispEdges" className="pixel-furn">
      <rect x="1" y="5" width="30" height="7" fill="#4a3068" />
      <rect x="1" y="3" width="30" height="3" fill="#5c3d80" />
      <rect x="0" y="6" width="3" height="6" fill="#3a2454" />
      <rect x="29" y="6" width="3" height="6" fill="#3a2454" />
      <rect x="2" y="12" width="3" height="2" fill="#2a1838" />
      <rect x="27" y="12" width="3" height="2" fill="#2a1838" />
    </svg>
  );
}

export function ConferenceTable() {
  return (
    <svg viewBox="0 0 40 18" width="140" height="63" shapeRendering="crispEdges" className="pixel-furn">
      <rect x="4" y="4" width="32" height="10" fill="#5a3a1c" />
      <rect x="4" y="4" width="32" height="2" fill="#7a5228" />
      <rect x="6" y="14" width="2" height="4" fill="#3a2410" />
      <rect x="32" y="14" width="2" height="4" fill="#3a2410" />
      <rect x="18" y="6" width="4" height="3" fill="#c9a227" />
    </svg>
  );
}

export function Bookshelf() {
  return (
    <svg viewBox="0 0 14 22" width="42" height="66" shapeRendering="crispEdges" className="pixel-furn">
      <rect x="1" y="0" width="12" height="22" fill="#4a3018" />
      <rect x="2" y="2" width="2" height="5" fill="#c45c4a" />
      <rect x="5" y="2" width="2" height="5" fill="#4a7ec4" />
      <rect x="8" y="2" width="3" height="5" fill="#d4c48a" />
      <rect x="2" y="9" width="3" height="5" fill="#3a8a5a" />
      <rect x="6" y="9" width="2" height="5" fill="#8a4ac4" />
      <rect x="9" y="9" width="2" height="5" fill="#c48a3a" />
      <rect x="2" y="16" width="10" height="4" fill="#2a1c10" />
    </svg>
  );
}

export function Bench() {
  return (
    <svg viewBox="0 0 24 10" width="72" height="30" shapeRendering="crispEdges" className="pixel-furn">
      <rect x="1" y="3" width="22" height="4" fill="#6a5040" />
      <rect x="2" y="7" width="2" height="3" fill="#3a2c24" />
      <rect x="20" y="7" width="2" height="3" fill="#3a2c24" />
    </svg>
  );
}

export function Coffee() {
  return (
    <svg viewBox="0 0 12 12" width="36" height="36" shapeRendering="crispEdges" className="pixel-furn">
      <rect x="3" y="5" width="6" height="5" fill="#8a8a92" />
      <rect x="4" y="6" width="4" height="3" fill="#3a2214" />
      <rect x="9" y="6" width="2" height="2" fill="#8a8a92" />
    </svg>
  );
}
