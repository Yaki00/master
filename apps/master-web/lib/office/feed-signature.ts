import type { OfficeEvent } from "./types";

/** Signature légère pour éviter les re-renders feed si rien n'a changé. */
export function feedEventsSignature(events: OfficeEvent[]): string {
  if (events.length === 0) return "0";
  const last = events[events.length - 1]!;
  return `${events.length}:${last.id}:${last.createdAt}`;
}

export function feedEventsEqual(a: OfficeEvent[], b: OfficeEvent[]): boolean {
  return feedEventsSignature(a) === feedEventsSignature(b);
}
