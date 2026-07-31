import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import {
  createScenarioApi,
  deleteScenarioApi,
  getGenerateJobApi,
  getScenarioApi,
  importScenarioApi,
  listScenariosApi,
  publishScenarioApi,
  putScenarioDraftApi,
  routeTargetApi,
  startGenerateApi,
} from "@/lib/api/scenarios";
import { queryKeys } from "@/lib/api/query-keys";
import type { ScenarioStatus } from "@/lib/api/types";

export function useScenariosQuery(status?: ScenarioStatus) {
  return useQuery({
    queryKey: queryKeys.scenarios.list(status),
    queryFn: () => listScenariosApi(status),
  });
}

export function useScenarioQuery(id: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.scenarios.detail(id ?? ""),
    queryFn: () => getScenarioApi(id!),
    enabled: Boolean(id),
  });
}

export function useCreateScenarioMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createScenarioApi,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.scenarios.all });
    },
  });
}

export function usePutDraftMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: unknown }) =>
      putScenarioDraftApi(id, payload),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.scenarios.detail(data.id), data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.scenarios.list() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.scenarios.list("draft") });
      void queryClient.invalidateQueries({ queryKey: queryKeys.scenarios.list("ready") });
    },
  });
}

export function usePublishScenarioMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload?: unknown }) =>
      publishScenarioApi(id, payload),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.scenarios.detail(data.id), data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.scenarios.all });
    },
  });
}

export function useImportScenarioMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: importScenarioApi,
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.scenarios.detail(data.id), data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.scenarios.all });
    },
  });
}

export function useGenerateScenarioMutation() {
  return useMutation({
    mutationFn: startGenerateApi,
  });
}

export function useGenerateJobQuery(jobId: string | null | undefined) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.scenarios.generateJob(jobId ?? ""),
    queryFn: () => getGenerateJobApi(jobId!),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "queued" || status === "running" ? 750 : false;
    },
  });
  const status = query.data?.status;
  useEffect(() => {
    if (status === "succeeded") {
      void queryClient.invalidateQueries({ queryKey: queryKeys.scenarios.all });
    }
  }, [queryClient, status]);
  return query;
}

export function useRouteTargetMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      scenarioId,
      targetId,
      input,
    }: {
      scenarioId: string;
      targetId: string;
      input: Parameters<typeof routeTargetApi>[2];
    }) => routeTargetApi(scenarioId, targetId, input),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.scenarios.detail(data.scenarioId),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.scenarios.list() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.scenarios.list("draft") });
    },
  });
}

export function useDeleteScenarioMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteScenarioApi,
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.scenarios.detail(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.scenarios.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.manage.all });
    },
  });
}
