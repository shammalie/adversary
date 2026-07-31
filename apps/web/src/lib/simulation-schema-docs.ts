import exampleScenario from "@/lib/fixtures/example-scenario.json";
import {
  AFFILIATIONS,
  TARGET_STATUSES,
  VEHICLE_CATEGORIES,
} from "@/types/target";

/** Static docs example — never call the demo generator during render. */
export function getExampleScenarioJson() {
  return JSON.stringify(exampleScenario, null, 2);
}

export type SchemaDocSection = {
  title: string;
  /** Section-level rule that applies to the whole type, not a single field. */
  notes?: string;
  fields: Array<{ name: string; type: string; required: boolean; notes?: string }>;
};

export const SCHEMA_DOC_SECTIONS: SchemaDocSection[] = [
  {
    title: "Scenario root",
    fields: [
      { name: "schemaVersion", type: "number", required: true, notes: "Must be 2." },
      { name: "id", type: "string", required: true, notes: "Unique scenario identifier." },
      { name: "name", type: "string", required: true, notes: "1–100 characters." },
      { name: "description", type: "string", required: false, notes: "Up to 1000 characters." },
      {
        name: "createdAt",
        type: "ISO datetime",
        required: true,
        notes: "Must include timezone offset.",
      },
      {
        name: "updatedAt",
        type: "ISO datetime",
        required: true,
        notes: "Must include timezone offset.",
      },
      {
        name: "delaySeconds",
        type: "number",
        required: false,
        notes: "Non-negative seconds added to every event.at for scheduling. Omit or 0 = no delay. Does not rewrite authored event times.",
      },
      {
        name: "fastForwardMultiplier",
        type: "number",
        required: false,
        notes:
          "Compresses schedule relative to the earliest event.at. Omit or 1 = off; allowed range is greater than 1 through 10. When set, each event gets firesAt = anchor + (at − anchor) / multiplier. Does not rewrite authored at.",
      },
      {
        name: "priorityTerms",
        type: "string[]",
        required: true,
        notes: "Whole-word message matching terms.",
      },
      { name: "targets", type: "TargetDefinition[]", required: true, notes: "At least one target." },
      { name: "events", type: "SimulationEvent[]", required: true, notes: "At least one event." },
    ],
  },
  {
    title: "TargetDefinition",
    fields: [
      { name: "id", type: "string", required: true, notes: "Unique within the scenario." },
      { name: "callsign", type: "string", required: true, notes: "Unique, case-insensitive." },
      { name: "revealOnFirstEvent", type: "boolean", required: true, notes: "Mutually exclusive with appearOnFirstEvent." },
      {
        name: "appearOnFirstEvent",
        type: "boolean",
        required: false,
        notes:
          "Default false. Hide from roster/map until first event. Mutually exclusive with revealOnFirstEvent.",
      },
      { name: "color", type: "string", required: true, notes: "Hex color #RRGGBB." },
      { name: "profile", type: "TargetProfile", required: true },
      {
        name: "maxCruiseKnots",
        type: "number",
        required: false,
        notes:
          "Optional cruise speed override (knots, ≥ 0) for route generation. Clamped to the subtype/category cruise band and category top speed.",
      },
    ],
  },
  {
    title: "TargetProfile",
    fields: [
      {
        name: "vehicleCategory",
        type: VEHICLE_CATEGORIES.join(" | "),
        required: true,
      },
      { name: "vehicleSubtype", type: "string", required: false },
      { name: "affiliation", type: AFFILIATIONS.join(" | "), required: true },
      { name: "status", type: TARGET_STATUSES.join(" | "), required: true },
      { name: "identifier", type: "string", required: false },
      { name: "description", type: "string", required: false },
    ],
  },
  {
    title: "SimulationEvent",
    notes: "Each event needs a position, message, or both.",
    fields: [
      { name: "id", type: "string", required: true, notes: "Unique within the scenario." },
      { name: "targetId", type: "string", required: true, notes: "Must reference a target id." },
      { name: "at", type: "ISO datetime", required: true, notes: "Must include timezone offset." },
      {
        name: "firesAt",
        type: "ISO datetime",
        required: false,
        notes:
          "Present only when scenario.fastForwardMultiplier is set. Compressed schedule time; authored at is unchanged.",
      },
      {
        name: "position",
        type: "PositionPayload",
        required: false,
        notes: "See PositionPayload. Latitude/longitude required when present.",
      },
      { name: "message", type: "string", required: false, notes: "1–1000 characters." },
    ],
  },
  {
    title: "PositionPayload",
    fields: [
      { name: "latitude", type: "number", required: true, notes: "-90..90." },
      { name: "longitude", type: "number", required: true, notes: "-180..180." },
      { name: "altitude", type: "number", required: false, notes: "Feet. -500..100000." },
      {
        name: "speed",
        type: "number",
        required: false,
        notes: "Knots. 0..2000. Prefer authored speeds from generated routes. When omitted, runtime derives from distance/time and clamps to the vehicle category top speed (aircraft up to 1800 kt for fighters).",
      },
    ],
  },
];

export const SCHEMA_CONSTRAINTS = [
  "Target IDs must be unique.",
  "Callsigns must be unique (case-insensitive).",
  "Event IDs must be unique.",
  "Every event targetId must match an existing target.",
  "Each scenario must include at least one target.",
  "Each target must have at least one event.",
  "Datetimes must be ISO 8601 with an explicit offset.",
  "Optional delaySeconds must be >= 0; omit or 0 means no delay.",
  "Optional maxCruiseKnots on targets must be >= 0 when set.",
  "Optional fastForwardMultiplier must be > 1 and <= 10; omit or 1 means off.",
  "Optional event.firesAt is set only while fast-forward is active; stripped when cleared.",
  "Colors must match #RRGGBB.",
  "Optional position speed is stored in knots (builder accepts mph, km/h, m/s, ft/s, mach).",
  "Generated routes set distance from category speed × elapsed time and always author position.speed.",
  "Vehicle category top speeds (kt): aircraft 1800, boat 80, car 130, truck 85, other 100.",
];
