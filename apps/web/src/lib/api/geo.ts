import { apiRequest } from "@/lib/api/client";
import type { GeoRegion } from "@/lib/api/types";

export function listGeoRegionsApi() {
  return apiRequest<GeoRegion[]>("/v1/geo/regions");
}
