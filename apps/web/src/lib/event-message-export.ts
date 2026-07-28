import { derivePositionSnapshot } from "@/lib/position-telemetry";
import { sortEvents } from "@/lib/simulation-engine";
import type {
  PositionSnapshot,
  SimulationEvent,
  SimulationScenario,
  TargetDefinition,
} from "@/types/target";

export interface EventMessageExportOptions {
  includeAltitude: boolean;
  includeHeading: boolean;
  includeSpeed: boolean;
}

export const DEFAULT_EVENT_MESSAGE_EXPORT_OPTIONS: EventMessageExportOptions = {
  includeAltitude: true,
  includeHeading: true,
  includeSpeed: true,
};

function formatLatitude(latitude: number) {
  return `${Math.abs(latitude).toFixed(2)}${latitude >= 0 ? "N" : "S"}`;
}

function formatLongitude(longitude: number) {
  return `${Math.abs(longitude).toFixed(2)}${longitude >= 0 ? "E" : "W"}`;
}

function messageFaceValue(message: string | undefined) {
  if (message == null || message.trim() === "") return undefined;
  return message;
}

function targetsById(targets: TargetDefinition[]) {
  return new Map(targets.map((target) => [target.id, target]));
}

function formatOrdinal(n: number) {
  return String(n).padStart(3, "0");
}

/**
 * Export positioned scenario events as tactical message lines.
 * Message-only events (no position) are skipped and do not consume ordinals.
 * Each line ends with cumulative relative seconds from the first exported line
 * in the whole file (`OUT 0`, then `OUT 90`, …).
 */
export function formatEventMessages(
  scenario: SimulationScenario,
  options: EventMessageExportOptions = DEFAULT_EVENT_MESSAGE_EXPORT_OPTIONS,
): string {
  const targetMap = targetsById(scenario.targets);
  const previousByTarget = new Map<string, PositionSnapshot>();
  const ordinalByTarget = new Map<string, number>();
  const lines: string[] = [];
  let fileOriginMs: number | undefined;

  for (const event of sortEvents(scenario.events)) {
    const eventMs = Date.parse(event.at);
    const relativeSeconds =
      fileOriginMs === undefined
        ? 0
        : Math.round((eventMs - fileOriginMs) / 1000);

    const line = formatPositionedEventLine(
      event,
      targetMap,
      previousByTarget,
      ordinalByTarget,
      options,
      relativeSeconds,
    );
    if (!line) continue;

    if (fileOriginMs === undefined) {
      fileOriginMs = eventMs;
    }
    lines.push(line);
  }

  return lines.join("\n");
}

function formatPositionedEventLine(
  event: SimulationEvent,
  targetMap: Map<string, TargetDefinition>,
  previousByTarget: Map<string, PositionSnapshot>,
  ordinalByTarget: Map<string, number>,
  options: EventMessageExportOptions,
  relativeSeconds: number,
): string | null {
  const position = event.position;
  if (!position) return null;

  const target = targetMap.get(event.targetId);
  if (!target) return null;

  const previous = previousByTarget.get(event.targetId);
  const snapshot = derivePositionSnapshot(
    position,
    event.at,
    previous,
    target.profile.vehicleCategory,
  );
  previousByTarget.set(event.targetId, snapshot);

  const ordinal = (ordinalByTarget.get(event.targetId) ?? 0) + 1;
  ordinalByTarget.set(event.targetId, ordinal);

  const parts = [
    target.callsign,
    formatOrdinal(ordinal),
    "POS",
    formatLatitude(position.latitude),
    formatLongitude(position.longitude),
  ];

  if (
    options.includeAltitude &&
    typeof position.altitude === "number" &&
    Number.isFinite(position.altitude)
  ) {
    parts.push("ALT", String(Math.round(position.altitude)));
  }

  // First point: derive invents heading 0 — omit unless there is a prior position.
  if (options.includeHeading && previous) {
    parts.push("HDG", String(Math.round(snapshot.heading)));
  }

  const authoredSpeed =
    typeof position.speed === "number" && Number.isFinite(position.speed)
      ? position.speed
      : undefined;
  // Authored speed always usable; derived speed only when a prior position exists
  // (avoid inventing SPD 0 on the first point).
  if (options.includeSpeed && (authoredSpeed !== undefined || previous)) {
    const speed = authoredSpeed !== undefined ? authoredSpeed : snapshot.speed;
    parts.push("SPD", String(Math.round(speed)));
  }

  const message = messageFaceValue(event.message);
  if (message !== undefined) {
    parts.push(message);
  }

  parts.push("OUT", String(relativeSeconds));
  return parts.join(" ");
}

export function downloadEventMessages(scenarioName: string, text: string) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${scenarioName.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-") || "scenario"}-messages.txt`;
  anchor.click();
  URL.revokeObjectURL(url);
}
