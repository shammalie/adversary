import type { RuntimeTargetState, SimulationEvent, SimulationScenario } from "@/types/target";

export type ScenarioStatus = "draft" | "ready";
export type RunStatus = "running" | "stopped" | "completed";

export type ApiValidationIssue = {
  path: string;
  field?: string;
  message: string;
};

export type ScenarioSummary = {
  id: string;
  name: string;
  status: ScenarioStatus;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
};

export type ScenarioDetail = ScenarioSummary & {
  payload: unknown;
  issues?: ApiValidationIssue[];
};

export type GenerateAccepted = {
  jobId: string;
  status: string;
};

export type GenerateJob = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  progress: string;
  error?: string;
  scenarioId?: string;
  degradedTrackCount?: number;
  anywhereFallbackCount?: number;
  catalogueEmpty?: boolean;
  reseedKicked?: boolean;
  createdAt: string;
  finishedAt?: string;
};

export type RouteTargetResult = {
  scenarioId: string;
  targetId: string;
  events: SimulationEvent[];
  degraded: boolean;
  anywhereFallback: boolean;
  regionId?: string;
  reseedKicked?: boolean;
  catalogueEmpty?: boolean;
};

export type RunSummary = {
  id: string;
  scenarioId: string;
  scenarioName?: string;
  status: RunStatus;
  startAt: string;
  scheduleOffsetMs: number;
  startedAt: string;
  stoppedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateRunResponse = RunSummary & {
  runId: string;
};

export type RunSnapshot = {
  run: RunSummary;
  status: RunStatus;
  processedEventIds: string[];
  ingestedEvents: SimulationEvent[];
  targetStates: Record<string, RuntimeTargetState>;
  criticalAlertIds: string[];
  asOf: string;
};

export type ViewportBBox = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type ViewportSnapshot = {
  run: RunSummary;
  status: RunStatus;
  bbox: ViewportBBox;
  zoom?: number;
  includeTargetIds?: string[];
  targetStates: Record<string, RuntimeTargetState>;
  asOf: string;
};

export type ManageScenarioRow = {
  id: string;
  name: string;
  status: ScenarioStatus;
  updatedAt: string;
  sizeBytes: number;
  targetCount: number;
  eventCount: number;
  ownerUserId?: string;
  activeRuns: number;
};

export type ManageListResult = {
  items: ManageScenarioRow[];
  total: number;
  limit: number;
  offset: number;
};

export type ManageStats = {
  draftCount: number;
  readyCount: number;
  totalPayloadBytes: number;
  runsActive: number;
  runsCompleted: number;
  runsStopped: number;
  scenarioCount: number;
};

export type UsageBucket = {
  bucket: string;
  counts: Record<string, number>;
  total: number;
};

export type UsageMetricsResult = {
  from: string;
  to: string;
  bucket: string;
  totals: Record<string, number>;
  buckets: UsageBucket[];
  userId?: string;
  clientId?: string;
};

export type AuthUser = {
  id: string;
  email: string;
  createdAt?: string;
};

export type GeoRegion = {
  id: string;
  name: string;
  /** `[west, south, east, north]` WGS84 degrees */
  bbox: [number, number, number, number];
  supports?: string[];
};

export type BusMessage = {
  type: string;
  runId: string;
  payload?: unknown;
};

export type ActiveRuntimeView = {
  runId: string;
  scenario: SimulationScenario;
  status: RunStatus;
  startedAt: string;
  stoppedAt?: string;
  completedAt?: string;
  processedEventIds: string[];
  ingestedEvents: SimulationEvent[];
  targetStates: Record<string, RuntimeTargetState>;
  criticalAlertIds: string[];
  lastReconciledAt: string;
};
