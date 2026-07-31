import { apiRequest } from "@/lib/api/client";
import type { ManageListResult, ManageStats, UsageMetricsResult } from "@/lib/api/types";

export function listManageScenariosApi(params?: {
  status?: string;
  q?: string;
  limit?: number;
  offset?: number;
}) {
  return apiRequest<ManageListResult>("/v1/manage/scenarios", {
    searchParams: params,
  });
}

export function getManageStatsApi() {
  return apiRequest<ManageStats>("/v1/manage/stats");
}

export function getManageUsageApi(params?: {
  from?: string;
  to?: string;
  bucket?: string;
  clientId?: string;
}) {
  return apiRequest<UsageMetricsResult>("/v1/manage/metrics/usage", {
    searchParams: params,
  });
}

export function deleteManageScenarioApi(id: string) {
  return apiRequest<{ deleted: boolean }>(`/v1/manage/scenarios/${id}`, {
    method: "DELETE",
  });
}

export function bulkDeleteManageScenariosApi(ids: string[]) {
  return apiRequest<{ deleted: number }>("/v1/manage/scenarios/bulk-delete", {
    method: "POST",
    body: { ids },
  });
}
