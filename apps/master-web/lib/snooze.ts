import { getAppSnoozeOverride } from "./db/snooze";
import { APPS } from "./types";

/** Fallback code (avant override DB). EchoWork snoozé par défaut tant que standby VPS. */
const CODE_DEFAULT_SNOOZE = new Set(
  APPS.filter((a) => a.snoozed).map((a) => a.id),
);

export function isAppSnoozed(appId: string): boolean {
  const override = getAppSnoozeOverride(appId);
  if (override != null) return override;
  return CODE_DEFAULT_SNOOZE.has(appId);
}

export function listEffectiveSnoozedIds(): string[] {
  const ids = new Set<string>([...CODE_DEFAULT_SNOOZE, ...APPS.map((a) => a.id)]);
  return [...ids].filter((id) => isAppSnoozed(id));
}
