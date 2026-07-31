import type { SimulationEvent, SimulationScenario } from "@/types/target";

/** True when fast-forward is active (strictly greater than 1, at most 10). */
export function isFastForwardActive(
  multiplier: number | undefined,
): multiplier is number {
  return (
    typeof multiplier === "number" &&
    Number.isFinite(multiplier) &&
    multiplier > 1 &&
    multiplier <= 10
  );
}

function stripFiresAt(event: SimulationEvent): SimulationEvent {
  if (event.firesAt === undefined) return event;
  const { firesAt: _removed, ...rest } = event;
  return rest;
}

/**
 * Earliest authored event.at in the scenario (fast-forward anchor), or null.
 */
export function scenarioScheduleAnchorMs(
  events: readonly Pick<SimulationEvent, "at">[],
): number | null {
  let anchorMs = Number.POSITIVE_INFINITY;
  for (const event of events) {
    const ms = Date.parse(event.at);
    if (Number.isFinite(ms) && ms < anchorMs) anchorMs = ms;
  }
  return Number.isFinite(anchorMs) ? anchorMs : null;
}

/**
 * Multiplicative compression: sim elapsed = authored elapsed / multiplier.
 * Example: 1 hour after the first event at 10× → fires 6 minutes after that event.
 */
export function compressedScheduleMs(
  atMs: number,
  anchorMs: number,
  multiplier: number,
): number {
  return anchorMs + (atMs - anchorMs) / multiplier;
}

/** Format elapsed ms from the schedule anchor for timeline labels (e.g. "sim +6m"). */
export function formatSimOffsetFromAnchor(
  firesAtIso: string,
  anchorMs: number,
): string | null {
  const firesMs = Date.parse(firesAtIso);
  if (!Number.isFinite(firesMs)) return null;
  const elapsedMs = Math.max(0, firesMs - anchorMs);
  if (elapsedMs < 1_000) return "sim +0s";
  const totalSeconds = Math.round(elapsedMs / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (hours === 0 && (seconds > 0 || minutes === 0)) parts.push(`${seconds}s`);
  return `sim +${parts.join(" ")}`;
}

/**
 * When fast-forward is set, stamp every event's firesAt from authored `at`
 * without mutating `at`. When cleared (omit / ≤1), strip all firesAt.
 *
 * Formula: anchor = earliest event.at;
 * firesAt = anchor + (at − anchor) / multiplier  (multiplicative speed-up)
 */
export function applyFastForwardTimes(scenario: SimulationScenario): SimulationScenario {
  if (!isFastForwardActive(scenario.fastForwardMultiplier)) {
    const events = scenario.events.map(stripFiresAt);
    const unchanged = events.every((event, index) => event === scenario.events[index]);
    return unchanged ? scenario : { ...scenario, events };
  }

  const multiplier = scenario.fastForwardMultiplier;
  const anchorMs = scenarioScheduleAnchorMs(scenario.events);

  if (anchorMs === null) {
    return { ...scenario, events: scenario.events.map(stripFiresAt) };
  }

  return {
    ...scenario,
    events: scenario.events.map((event) => {
      const atMs = Date.parse(event.at);
      const firesAt = new Date(
        compressedScheduleMs(atMs, anchorMs, multiplier),
      ).toISOString();
      if (event.firesAt === firesAt) return event;
      return { ...event, firesAt };
    }),
  };
}
