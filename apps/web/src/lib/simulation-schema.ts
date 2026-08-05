import { z } from "zod";

import { hasEventPayload } from "@/lib/position-telemetry";
import {
  AFFILIATIONS,
  TARGET_STATUSES,
  VEHICLE_CATEGORIES,
  type SimulationScenario,
} from "@/types/target";

const idSchema = z.string().trim().min(1);
const isoDateSchema = z.iso.datetime({ offset: true });

export const targetProfileSchema = z.object({
  vehicleCategory: z.enum(VEHICLE_CATEGORIES),
  vehicleSubtype: z.string().trim().max(80).optional(),
  affiliation: z.enum(AFFILIATIONS),
  status: z.enum(TARGET_STATUSES),
  identifier: z.string().trim().max(80).optional(),
  description: z.string().trim().max(500).optional(),
});

const targetDefinitionSchema = z
  .object({
    id: idSchema,
    callsign: z
      .string()
      .trim()
      .min(1, "Enter a callsign for this target.")
      .max(40, "Callsigns must be 40 characters or fewer."),
    revealOnFirstEvent: z.boolean(),
    appearOnFirstEvent: z.boolean().default(false),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Choose a valid hex color (#RRGGBB)."),
    profile: targetProfileSchema,
    maxCruiseKnots: z.number().nonnegative().optional(),
  })
  .superRefine((target, context) => {
    if (target.revealOnFirstEvent && target.appearOnFirstEvent) {
      context.addIssue({
        code: "custom",
        message: "Choose reveal on first event or appear on first event, not both.",
        path: ["appearOnFirstEvent"],
      });
    }
  });

const positionPayloadSchema = z.object({
  latitude: z.number().min(-90, "Latitude must be between -90 and 90.").max(90, "Latitude must be between -90 and 90."),
  longitude: z
    .number()
    .min(-180, "Longitude must be between -180 and 180.")
    .max(180, "Longitude must be between -180 and 180."),
  altitude: z
    .number()
    .min(-500, "Altitude must be at least -500 ft.")
    .max(100_000, "Altitude must be 100,000 ft or less.")
    .optional(),
  speed: z.number().min(0, "Speed cannot be negative.").optional(),
});

export const simulationEventSchema = z
  .object({
    id: idSchema,
    targetId: idSchema,
    at: isoDateSchema,
    firesAt: isoDateSchema.optional(),
    position: positionPayloadSchema.optional(),
    message: z
      .string()
      .trim()
      .min(1, "Message text cannot be empty.")
      .max(1_000, "Messages must be 1,000 characters or fewer.")
      .optional(),
    ignoreKinematicLimits: z.boolean().optional(),
  })
  .superRefine((event, context) => {
    if (!hasEventPayload(event)) {
      context.addIssue({
        code: "custom",
        message: "Add a position, a message, or both to this event.",
        path: ["message"],
      });
    }
    const speed = event.position?.speed;
    if (
      typeof speed === "number" &&
      event.ignoreKinematicLimits !== true &&
      speed > 2_000
    ) {
      context.addIssue({
        code: "custom",
        message: "Speed must be 2,000 kt or less.",
        path: ["position", "speed"],
      });
    }
  });

export const simulationScenarioSchema = z
  .object({
    schemaVersion: z.literal(2),
    id: idSchema,
    name: z
      .string()
      .trim()
      .min(1, "Enter a scenario name.")
      .max(100, "Scenario names must be 100 characters or fewer."),
    description: z.string().trim().max(1_000, "Briefs must be 1,000 characters or fewer.").optional(),
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema,
    delaySeconds: z
      .number()
      .nonnegative("Delay cannot be negative.")
      .optional(),
    fastForwardMultiplier: z
      .number()
      .gt(1, "Fast-forward must be greater than 1.")
      .max(10, "Fast-forward must be 10 or less.")
      .optional(),
    priorityTerms: z.array(z.string().trim().min(1).max(80)),
    targets: z
      .array(targetDefinitionSchema)
      .min(1, "Each scenario must include at least one target."),
    events: z
      .array(simulationEventSchema)
      .min(1, "Each target must have at least one event."),
  })
  .superRefine((scenario, context) => {
    const targetIds = new Set<string>();
    const callsigns = new Set<string>();
    const eventsByTarget = new Map<string, number>();

    for (const [index, target] of scenario.targets.entries()) {
      const normalizedCallsign = target.callsign.toLocaleUpperCase();
      if (targetIds.has(target.id)) {
        context.addIssue({
          code: "custom",
          message: "Target IDs must be unique.",
          path: ["targets", index, "id"],
        });
      }
      if (callsigns.has(normalizedCallsign)) {
        context.addIssue({
          code: "custom",
          message: "Callsigns must be unique.",
          path: ["targets", index, "callsign"],
        });
      }
      targetIds.add(target.id);
      callsigns.add(normalizedCallsign);
      eventsByTarget.set(target.id, 0);
    }

    const eventIds = new Set<string>();
    for (const [index, event] of scenario.events.entries()) {
      if (eventIds.has(event.id)) {
        context.addIssue({
          code: "custom",
          message: "Event IDs must be unique.",
          path: ["events", index, "id"],
        });
      }
      if (!targetIds.has(event.targetId)) {
        context.addIssue({
          code: "custom",
          message: "This event references a target that does not exist.",
          path: ["events", index, "targetId"],
        });
      } else {
        eventsByTarget.set(event.targetId, (eventsByTarget.get(event.targetId) ?? 0) + 1);
      }
      eventIds.add(event.id);
    }

    for (const [index, target] of scenario.targets.entries()) {
      if ((eventsByTarget.get(target.id) ?? 0) > 0) continue;
      context.addIssue({
        code: "custom",
        message: "Each target must have at least one event.",
        path: ["targets", index, "callsign"],
      });
    }
  });

export function parseScenario(value: unknown): SimulationScenario {
  return simulationScenarioSchema.parse(value) as SimulationScenario;
}

export function validateScenario(value: unknown) {
  return simulationScenarioSchema.safeParse(value);
}
