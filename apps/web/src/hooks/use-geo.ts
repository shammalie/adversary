import { useQuery } from "@tanstack/react-query";

import { listGeoRegionsApi } from "@/lib/api/geo";
import { queryKeys } from "@/lib/api/query-keys";

export function useGeoRegionsQuery() {
  return useQuery({
    queryKey: queryKeys.geo.regions(),
    queryFn: listGeoRegionsApi,
    staleTime: 5 * 60_000,
  });
}
