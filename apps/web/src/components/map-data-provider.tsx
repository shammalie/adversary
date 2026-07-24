import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { StyleSpecification } from "maplibre-gl";

import { useTheme } from "@/components/theme-provider";
import { importOfflineRegionZip } from "@/lib/offline-regions/import";
import type { StoredOfflineRegion } from "@/lib/offline-regions/manifest";
import {
  getActiveRegion,
  listStoredRegions,
  purgeIncompatibleRegions,
  removeRegion,
  setActiveRegion,
} from "@/lib/offline-regions/storage";
import { getOnlineMapStyle, type MapColorScheme } from "@/lib/map-styles";

interface MapDataContextValue {
  loading: boolean;
  online: boolean;
  regions: StoredOfflineRegion[];
  activeRegion: StoredOfflineRegion | null;
  mapStyle: string | StyleSpecification;
  mapSource: "local" | "online";
  refresh: () => Promise<void>;
  importPackage: (file: File) => Promise<StoredOfflineRegion>;
  activateRegion: (regionId: string | null) => Promise<void>;
  deleteRegion: (regionId: string) => Promise<void>;
}

const MapDataContext = createContext<MapDataContextValue | null>(null);

function resolveColorScheme(resolvedTheme: string | undefined): MapColorScheme {
  return resolvedTheme === "light" ? "light" : "dark";
}

export function MapDataProvider({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useTheme();
  const colorScheme = resolveColorScheme(resolvedTheme);
  const colorSchemeRef = useRef(colorScheme);
  colorSchemeRef.current = colorScheme;

  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(true);
  const [regions, setRegions] = useState<StoredOfflineRegion[]>([]);
  const [activeRegion, setActiveRegionState] = useState<StoredOfflineRegion | null>(null);
  const [mapStyle, setMapStyle] = useState<string | StyleSpecification>(() =>
    getOnlineMapStyle("dark"),
  );
  const [mapSource, setMapSource] = useState<"local" | "online">("online");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { isOnline, resolveMapStyleWithFallback } = await import("@/lib/maplibre");
      setOnline(isOnline());

      await purgeIncompatibleRegions();

      const [storedRegions, active] = await Promise.all([listStoredRegions(), getActiveRegion()]);
      setRegions(storedRegions);
      setActiveRegionState(active ?? null);

      try {
        const resolved = await resolveMapStyleWithFallback(colorSchemeRef.current);
        setMapStyle(resolved.style);
        setMapSource(resolved.source);
      } catch {
        setMapStyle(getOnlineMapStyle(colorSchemeRef.current));
        setMapSource("online");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (mapSource !== "online") return;
    setMapStyle(getOnlineMapStyle(colorScheme));
  }, [colorScheme, mapSource]);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const importPackage = useCallback(
    async (file: File) => {
      const stored = await importOfflineRegionZip(file, { activate: true });
      await refresh();
      return stored;
    },
    [refresh],
  );

  const activateRegion = useCallback(
    async (regionId: string | null) => {
      await setActiveRegion(regionId);
      await refresh();
    },
    [refresh],
  );

  const deleteRegion = useCallback(
    async (regionId: string) => {
      const { revokePmtilesBlobUrl } = await import("@/lib/maplibre");
      revokePmtilesBlobUrl(regionId);
      await removeRegion(regionId);
      await refresh();
    },
    [refresh],
  );

  const value = useMemo<MapDataContextValue>(
    () => ({
      loading,
      online,
      regions,
      activeRegion,
      mapStyle,
      mapSource,
      refresh,
      importPackage,
      activateRegion,
      deleteRegion,
    }),
    [
      loading,
      online,
      regions,
      activeRegion,
      mapStyle,
      mapSource,
      refresh,
      importPackage,
      activateRegion,
      deleteRegion,
    ],
  );

  return <MapDataContext value={value}>{children}</MapDataContext>;
}

export function useMapData() {
  const context = use(MapDataContext);
  if (!context) {
    throw new Error("useMapData must be used within MapDataProvider.");
  }
  return context;
}

export function useOptionalMapData() {
  return use(MapDataContext);
}

export async function disposeMapDataResources() {
  const { clearPmtilesBlobUrls } = await import("@/lib/maplibre");
  clearPmtilesBlobUrls();
}
