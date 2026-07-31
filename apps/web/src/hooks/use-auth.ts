import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getMeApi, loginApi, logoutApi, registerApi } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";

export type AuthProbe =
  | { availability: "unused"; user: null }
  | { availability: "session"; user: Awaited<ReturnType<typeof getMeApi>> };

export function useMeQuery() {
  return useQuery({
    queryKey: queryKeys.auth.me(),
    queryFn: async () => {
      try {
        return { availability: "session", user: await getMeApi() } satisfies AuthProbe;
      } catch (error) {
        // AUTH_MODE=off → 503, while an unauthenticated session API returns 401.
        if (error instanceof ApiError && error.status === 503) {
          return { availability: "unused", user: null } satisfies AuthProbe;
        }
        if (error instanceof ApiError && error.status === 401) {
          return { availability: "session", user: null } satisfies AuthProbe;
        }
        throw error;
      }
    },
    retry: false,
    staleTime: 60_000,
  });
}

export function useLoginMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      loginApi(email, password),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.me() });
    },
  });
}

export function useRegisterMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      registerApi(email, password),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.me() });
    },
  });
}

export function useLogoutMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: logoutApi,
    onSuccess: () => {
      queryClient.clear();
    },
  });
}
