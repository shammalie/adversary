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
 * When fast-forward is set, stamp every event's firesAt from authored `at`
 * without mutating `at`. When cleared (omit / ≤1), strip all firesAt.
 *
 * Formula: anchor = earliest event.at; firesAt = anchor + (at − anchor) / multiplier
 */
export function applyFastForwardTimes(scenario: SimulationScenario): SimulationScenario {
  if (!isFastForwardActive(scenario.fastForwardMultiplier)) {
    const events = scenario.events.map(stripFiresAt);
    const unchanged = events.every((event, index) => event === scenario.events[index]);
    return unchanged ? scenario : { ...scenario, events };
  }

  const multiplier = scenario.fastForwardMultiplier;
  let anchorMs = Number.POSITIVE_INFINITY;
  for (const event of scenario.events) {
    const ms = Date.parse(event.at);
    if (Number.isFinite(ms) && ms < anchorMs) anchorMs = ms;
  }

  if (!Number.isFinite(anchorMs)) {
    return { ...scenario, events: scenario.events.map(stripFiresAt) };
  }

  return {
    ...scenario,
    events: scenario.events.map((event) => {
      const atMs = Date.parse(event.at);
      const firesAt = new Date(anchorMs + (atMs - anchorMs) / multiplier).toISOString();
      if (event.firesAt === firesAt) return event;
      return { ...event, firesAt };
    }),
  };
}
