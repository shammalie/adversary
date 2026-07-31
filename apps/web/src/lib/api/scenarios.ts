import { apiRequest } from "@/lib/api/client";
import type {
  GenerateAccepted,
  GenerateJob,
  RouteTargetResult,
  ScenarioDetail,
  ScenarioStatus,
  ScenarioSummary,
} from "@/lib/api/types";

export function listScenariosApi(status?: ScenarioStatus) {
  return apiRequest<ScenarioSummary[]>("/v1/scenarios", {
    searchParams: { status },
  });
}

export function getScenarioApi(id: string) {
  return apiRequest<ScenarioDetail>(`/v1/scenarios/${id}`);
}

export function createScenarioApi(input?: { name?: string; payload?: unknown }) {
  return apiRequest<ScenarioDetail>("/v1/scenarios", {
    method: "POST",
    body: input ?? {},
  });
}

export function putScenarioDraftApi(id: string, payload: unknown) {
  return apiRequest<ScenarioDetail>(`/v1/scenarios/${id}/draft`, {
    method: "PUT",
    body: payload,
  });
}

export function publishScenarioApi(id: string, payload?: unknown) {
  return apiRequest<ScenarioDetail>(`/v1/scenarios/${id}/publish`, {
    method: "POST",
    body: payload,
  });
}

export function validateScenarioApi(id: string, payload?: unknown) {
  return apiRequest<{ valid: boolean; issues: ScenarioDetail["issues"] }>(
    `/v1/scenarios/${id}/validate`,
    {
      method: "POST",
      body: payload,
    },
  );
}

export function importScenarioApi(payload: unknown) {
  return apiRequest<ScenarioDetail>("/v1/scenarios/import", {
    method: "POST",
    body: payload,
  });
}

export function startGenerateApi(input: {
  vehicleSelection?: string[];
  targetCount?: number;
  startAt?: string;
  endAt?: string;
  origin?: { latitude: number; longitude: number };
  regionIds?: string[];
  anywhere?: boolean;
  forceSynthetic?: boolean;
  name?: string;
}) {
  return apiRequest<GenerateAccepted>("/v1/scenarios/generate", {
    method: "POST",
    body: input,
  });
}

export function getGenerateJobApi(jobId: string) {
  return apiRequest<GenerateJob>(`/v1/scenarios/generate/jobs/${jobId}`);
}

export function routeTargetApi(
  scenarioId: string,
  targetId: string,
  input: {
    startAt?: string;
    endAt?: string;
    eventCount?: number;
    regionIds?: string[];
    anywhere?: boolean;
  },
) {
  return apiRequest<RouteTargetResult>(`/v1/scenarios/${scenarioId}/targets/${targetId}/route`, {
    method: "POST",
    body: input,
  });
}

export function deleteScenarioApi(id: string) {
  return apiRequest<void>(`/v1/scenarios/${id}`, { method: "DELETE" });
}

export function patchScenarioNameApi(id: string, name: string) {
  return apiRequest<ScenarioDetail>(`/v1/scenarios/${id}`, {
    method: "PATCH",
    body: { name },
  });
}
