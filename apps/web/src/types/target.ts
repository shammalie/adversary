export const VEHICLE_CATEGORIES = ["aircraft", "boat", "car", "truck", "other"] as const;
export const AFFILIATIONS = ["unknown", "friendly", "neutral", "hostile"] as const;
export const TARGET_STATUSES = ["unknown", "active", "stationary", "lost", "inactive"] as const;

export type VehicleCategory = (typeof VEHICLE_CATEGORIES)[number];
export type Affiliation = (typeof AFFILIATIONS)[number];
export type TargetStatus = (typeof TARGET_STATUSES)[number];
export type MapMode = "2d" | "globe";

export interface TargetProfile {
  vehicleCategory: VehicleCategory;
  vehicleSubtype?: string;
  affiliation: Affiliation;
  status: TargetStatus;
  identifier?: string;
  description?: string;
}

export interface TargetDefinition {
  id: string;
  callsign: string;
  revealOnFirstEvent: boolean;
  /** When true, contact stays off roster/map until any event is ingested. Mutually exclusive with revealOnFirstEvent. */
  appearOnFirstEvent: boolean;
  color: string;
  profile: TargetProfile;
}

export interface PositionPayload {
  latitude: number;
  longitude: number;
  altitude?: number;
  /** Knots. When omitted, runtime derives speed from consecutive positions. */
  speed?: number;
}

export interface SimulationEvent {
  id: string;
  targetId: string;
  at: string;
  position?: PositionPayload;
  message?: string;
}

export interface SimulationScenario {
  schemaVersion: 2;
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  /** Seconds added to every event.at for scheduling. Omit or 0 = no delay. */
  delaySeconds?: number;
  priorityTerms: string[];
  targets: TargetDefinition[];
  events: SimulationEvent[];
}

export interface PositionSnapshot {
  latitude: number;
  longitude: number;
  altitude: number;
  speed: number;
  heading: number;
  course: number;
  at: string;
}

export interface RuntimeTargetState {
  targetId: string;
  callsign: string;
  color: string;
  profile: Partial<TargetProfile>;
  revealed: boolean;
  /** False while appearOnFirstEvent is pending the first ingested event. */
  appeared: boolean;
  position?: PositionSnapshot;
  trail: PositionSnapshot[];
  lastEventAt?: string;
}

export type RuntimeStatus = "running" | "stopped" | "completed";

export interface SimulationRuntime {
  schemaVersion: 2;
  scenario: SimulationScenario;
  status: RuntimeStatus;
  startedAt: string;
  stoppedAt?: string;
  completedAt?: string;
  processedEventIds: string[];
  ingestedEvents: SimulationEvent[];
  targetStates: Record<string, RuntimeTargetState>;
  criticalAlertIds: string[];
  lastReconciledAt: string;
}

/** @deprecated Legacy v1 event types retained for migration only */
export const LEGACY_EVENT_TYPES = ["position", "message", "status", "identity", "alert"] as const;
export type LegacyEventType = (typeof LEGACY_EVENT_TYPES)[number];
export type LegacyPriority = 1 | 2 | 3 | 4 | 5;

export interface LegacySimulationScenario {
  schemaVersion: 1;
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  targets: Array<{
    id: string;
    callsign: string;
    startsUnknown: boolean;
    color: string;
    initialProfile?: Partial<TargetProfile>;
  }>;
  events: Array<
    | {
        id: string;
        targetId: string;
        at: string;
        type: "position";
        latitude: number;
        longitude: number;
        altitude: number;
        speed: number;
        heading: number;
        course: number;
      }
    | {
        id: string;
        targetId: string;
        at: string;
        type: "message";
        priority: LegacyPriority;
        message: string;
      }
    | {
        id: string;
        targetId: string;
        at: string;
        type: "status";
        status: TargetStatus;
        message?: string;
      }
    | {
        id: string;
        targetId: string;
        at: string;
        type: "identity";
        profile: Partial<TargetProfile>;
        message?: string;
      }
    | {
        id: string;
        targetId: string;
        at: string;
        type: "alert";
        priority: LegacyPriority;
        message: string;
        code?: string;
      }
  >;
}
