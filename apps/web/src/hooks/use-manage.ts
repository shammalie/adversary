import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  bulkDeleteManageScenariosApi,
  deleteManageScenarioApi,
  getManageStatsApi,
  getManageUsageApi,
  listManageScenariosApi,
} from "@/lib/api/manage";
import { queryKeys } from "@/lib/api/query-keys";

export function useManageScenariosQuery(params?: {
  status?: string;
  q?: string;
  limit?: number;
  offset?: number;
}) {
  const resolved = {
    status: params?.status,
    q: params?.q,
    limit: params?.limit ?? 50,
    offset: params?.offset ?? 0,
  };
  return useQuery({
    queryKey: queryKeys.manage.scenarios(resolved),
    queryFn: () => listManageScenariosApi(resolved),
  });
}

export function useManageStatsQuery() {
  return useQuery({
    queryKey: queryKeys.manage.stats(),
    queryFn: getManageStatsApi,
  });
}

export function useManageUsageQuery(params?: { from?: string; to?: string; bucket?: string }) {
  const resolved = {
    from: params?.from,
    to: params?.to,
    bucket: params?.bucket ?? "1h",
  };
  return useQuery({
    queryKey: queryKeys.manage.usage(resolved),
    queryFn: () => getManageUsageApi(resolved),
  });
}

export function useDeleteManageScenarioMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteManageScenarioApi,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.manage.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.scenarios.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.runs.all });
    },
  });
}

export function useBulkDeleteManageScenariosMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: bulkDeleteManageScenariosApi,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.manage.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.scenarios.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.runs.all });
    },
  });
}
