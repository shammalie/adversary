import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getRunApi,
  getRunSnapshotApi,
  getRunViewportApi,
  listRunsApi,
  startRunApi,
  stopRunApi,
} from "@/lib/api/runs";
import { queryKeys } from "@/lib/api/query-keys";
import type { ViewportBBox } from "@/lib/api/types";

export function useRunsQuery(activeOnly = false) {
  return useQuery({
    queryKey: queryKeys.runs.list(activeOnly),
    queryFn: () => listRunsApi(activeOnly),
    refetchInterval: 15_000,
  });
}

export function useRunQuery(id: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.runs.detail(id ?? ""),
    queryFn: () => getRunApi(id!),
    enabled: Boolean(id),
  });
}

export function useRunSnapshotQuery(id: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.runs.snapshot(id ?? ""),
    queryFn: () => getRunSnapshotApi(id!),
    enabled: Boolean(id),
  });
}

export function useRunViewportQuery(
  id: string | null | undefined,
  bbox: ViewportBBox | null,
  includeTargetIds: string[] = [],
  zoom?: number,
) {
  return useQuery({
    queryKey: id && bbox ? queryKeys.runs.viewport(id, bbox, includeTargetIds) : ["runs", "viewport", "disabled"],
    queryFn: () => getRunViewportApi(id!, bbox!, { zoom, includeTargetIds }),
    enabled: Boolean(id && bbox),
  });
}

export function useStartRunMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ scenarioId, startAt }: { scenarioId: string; startAt?: string }) =>
      startRunApi(scenarioId, startAt),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.runs.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.manage.stats() });
    },
  });
}

export function useStopRunMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: stopRunApi,
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.runs.detail(data.id), data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.runs.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.runs.snapshot(data.id) });
    },
  });
}
