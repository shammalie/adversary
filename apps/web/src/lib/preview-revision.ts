import { effectiveEventAtMs, sortEvents } from "@/lib/simulation-engine";
import type { SimulationScenario } from "@/types/target";

/** Stable revision key for preview reset when targets or events change. */
export function computePreviewRevision(scenario: SimulationScenario): string {
  const targetPart = scenario.targets
    .map(
      (target) =>
        `${target.id}:${target.callsign}:${target.color}:${target.revealOnFirstEvent}:${target.appearOnFirstEvent}:${JSON.stringify(target.profile)}`,
    )
    .toSorted()
    .join("|");

  const eventPart = sortEvents(scenario.events)
    .map(
      (event) =>
        `${event.id}:${event.targetId}:${event.at}:${event.firesAt ?? ""}:${JSON.stringify(event.position ?? null)}:${event.message ?? ""}`,
    )
    .join("|");

  return `${targetPart}::${eventPart}::d${scenario.delaySeconds ?? 0}::ff${scenario.fastForwardMultiplier ?? 1}`;
}

/** Preview range spans from the first to the last scheduled event (effective times). */
export function getPreviewRangeMs(
  scenario: SimulationScenario,
): { startMs: number; endMs: number } | null {
  const sorted = sortEvents(scenario.events);
  if (sorted.length === 0) return null;

  const delaySeconds = scenario.delaySeconds ?? 0;
  const startMs = effectiveEventAtMs(sorted[0]!, delaySeconds);
  const endMs = effectiveEventAtMs(sorted[sorted.length - 1]!, delaySeconds);
  return { startMs, endMs: endMs > startMs ? endMs : startMs + 1_000 };
}

/** Preview starts at the first scheduled event. */
export function getPreviewStartMs(scenario: SimulationScenario): number {
  return getPreviewRangeMs(scenario)?.startMs ?? Date.now();
}

export function clampPreviewTimeMs(
  timeMs: number,
  range: { startMs: number; endMs: number },
): number {
  return Math.min(Math.max(timeMs, range.startMs), range.endMs);
}
