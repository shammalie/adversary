import { apiRequest } from "@/lib/api/client";
import type {
  CreateRunResponse,
  RunSnapshot,
  RunSummary,
  ViewportBBox,
  ViewportSnapshot,
} from "@/lib/api/types";

export function listRunsApi(activeOnly = false) {
  return apiRequest<RunSummary[]>("/v1/runs", {
    searchParams: activeOnly ? { active: true } : undefined,
  });
}

export function getRunApi(id: string) {
  return apiRequest<RunSummary>(`/v1/runs/${id}`);
}

export function startRunApi(scenarioId: string, startAt?: string) {
  return apiRequest<CreateRunResponse>("/v1/runs", {
    method: "POST",
    body: {
      scenarioId,
      ...(startAt ? { startAt } : {}),
    },
  });
}

export function stopRunApi(id: string) {
  return apiRequest<RunSummary>(`/v1/runs/${id}/stop`, { method: "POST" });
}

export function getRunSnapshotApi(id: string) {
  return apiRequest<RunSnapshot>(`/v1/runs/${id}/snapshot`);
}

export function getRunViewportApi(
  id: string,
  bbox: ViewportBBox,
  options?: { zoom?: number; includeTargetIds?: string[] },
) {
  const include = options?.includeTargetIds?.length
    ? options.includeTargetIds.join(",")
    : undefined;
  return apiRequest<ViewportSnapshot>(`/v1/runs/${id}/viewport`, {
    searchParams: {
      west: bbox.west,
      south: bbox.south,
      east: bbox.east,
      north: bbox.north,
      zoom: options?.zoom,
      includeTargetIds: include,
    },
  });
}
