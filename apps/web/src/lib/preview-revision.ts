import { sortEvents } from "@/lib/simulation-engine";
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
        `${event.id}:${event.targetId}:${event.at}:${JSON.stringify(event.position ?? null)}:${event.message ?? ""}`,
    )
    .join("|");

  return `${targetPart}::${eventPart}`;
}

/** Preview range spans from the first to the last scheduled event. */
export function getPreviewRangeMs(
  scenario: SimulationScenario,
): { startMs: number; endMs: number } | null {
  const sorted = sortEvents(scenario.events);
  if (sorted.length === 0) return null;

  const startMs = Date.parse(sorted[0]!.at);
  const endMs = Date.parse(sorted[sorted.length - 1]!.at);
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
