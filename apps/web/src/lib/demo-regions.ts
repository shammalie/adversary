import geoSeeds from "../../public/geo-seeds.json";
import type { VehicleCategory } from "@/types/target";
import { VEHICLE_CATEGORIES } from "@/types/target";

export interface DemoRegion {
  id: string;
  name: string;
  /** Inclusive WGS84 bbox: [west, south, east, north]. */
  bbox: readonly [west: number, south: number, east: number, north: number];
  /** Categories this region can authentically host (derived at seed-build time). */
  supports: readonly VehicleCategory[];
}

const CATEGORY_SET = new Set<string>(VEHICLE_CATEGORIES);

function parseSupports(raw: readonly string[]): VehicleCategory[] {
  const out: VehicleCategory[] = [];
  for (const entry of raw) {
    if (CATEGORY_SET.has(entry)) {
      out.push(entry as VehicleCategory);
    }
  }
  return out;
}

function parseRegions(
  raw: ReadonlyArray<{
    id: string;
    name: string;
    bbox: readonly number[];
    supports: readonly string[];
  }>,
): DemoRegion[] {
  return raw.map((region) => {
    const [west, south, east, north] = region.bbox;
    return {
      id: region.id,
      name: region.name,
      bbox: [west!, south!, east!, north!] as const,
      supports: parseSupports(region.supports),
    };
  });
}

/**
 * Typed catalogue from `public/geo-seeds.json` (phase 1). Replaces the old
 * maritime-heavy `DEMO_START_LOCATIONS` preset list.
 */
export const DEMO_REGIONS: readonly DemoRegion[] = parseRegions(
  (geoSeeds as { regions: Parameters<typeof parseRegions>[0] }).regions,
);

export function demoRegionById(id: string): DemoRegion | undefined {
  return DEMO_REGIONS.find((region) => region.id === id);
}

export function demoRegionsByIds(ids: readonly string[]): DemoRegion[] {
  const out: DemoRegion[] = [];
  for (const id of ids) {
    const region = demoRegionById(id);
    if (region) out.push(region);
  }
  return out;
}

export function regionCenter(region: DemoRegion): {
  latitude: number;
  longitude: number;
} {
  const [west, south, east, north] = region.bbox;
  return {
    latitude: (south + north) / 2,
    longitude: (west + east) / 2,
  };
}

export function regionsSupporting(
  regions: readonly DemoRegion[],
  category: VehicleCategory,
): DemoRegion[] {
  return regions.filter((region) => region.supports.includes(category));
}
