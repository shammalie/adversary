import type { ViewportBBox } from "@/lib/api/types";

function viewportKeyPart(bbox: ViewportBBox, includeTargetIds: string[] = []) {
  const ids = [...includeTargetIds].toSorted().join(",");
  return [
    bbox.west.toFixed(5),
    bbox.south.toFixed(5),
    bbox.east.toFixed(5),
    bbox.north.toFixed(5),
    ids,
  ] as const;
}

export const queryKeys = {
  auth: {
    all: ["auth"] as const,
    me: () => [...queryKeys.auth.all, "me"] as const,
  },
  scenarios: {
    all: ["scenarios"] as const,
    list: (status?: string) => [...queryKeys.scenarios.all, "list", status ?? "all"] as const,
    detail: (id: string) => [...queryKeys.scenarios.all, "detail", id] as const,
    generateJob: (jobId: string) => [...queryKeys.scenarios.all, "generate-job", jobId] as const,
  },
  runs: {
    all: ["runs"] as const,
    list: (activeOnly?: boolean) =>
      [...queryKeys.runs.all, "list", activeOnly ? "active" : "recent"] as const,
    detail: (id: string) => [...queryKeys.runs.all, "detail", id] as const,
    snapshot: (id: string) => [...queryKeys.runs.all, "snapshot", id] as const,
    viewport: (id: string, bbox: ViewportBBox, includeTargetIds: string[] = []) =>
      [
        ...queryKeys.runs.all,
        "viewport",
        id,
        ...viewportKeyPart(bbox, includeTargetIds),
      ] as const,
  },
  manage: {
    all: ["manage"] as const,
    scenarios: (params: { status?: string; q?: string; limit?: number; offset?: number }) =>
      [...queryKeys.manage.all, "scenarios", params] as const,
    stats: () => [...queryKeys.manage.all, "stats"] as const,
    usage: (params: { from?: string; to?: string; bucket?: string }) =>
      [...queryKeys.manage.all, "usage", params] as const,
  },
  geo: {
    all: ["geo"] as const,
    regions: () => [...queryKeys.geo.all, "regions"] as const,
  },
};
