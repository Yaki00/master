import type { OfficeRoom } from "@/lib/office/types";
import type { GlobalPoint } from "@/lib/office/placement";

/** Délai avant de lancer une marche inter-salles (évite le flap poll). */
export const ROOM_CHANGE_DEBOUNCE_MS = 180;

/** Seuil de distance (% plancher) pour considérer la position identique. */
export const SAME_SPOT_EPS = 0.4;

export function isSameSpot(
  prev: GlobalPoint & { room: OfficeRoom },
  target: GlobalPoint,
  room: OfficeRoom,
): boolean {
  return (
    Math.abs(prev.x - target.x) < SAME_SPOT_EPS &&
    Math.abs(prev.y - target.y) < SAME_SPOT_EPS &&
    prev.room === room
  );
}

/** Marche uniquement si la salle logique change. */
export function shouldWalkBetweenRooms(prevRoom: OfficeRoom, nextRoom: OfficeRoom): boolean {
  return prevRoom !== nextRoom;
}
