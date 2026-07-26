import {
  createContext,
  use,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { useTheme } from "@/components/theme-provider";
import { getOnlineMapStyle, type MapColorScheme } from "@/lib/map-styles";

interface MapDataContextValue {
  mapStyle: string;
}

const MapDataContext = createContext<MapDataContextValue | null>(null);

function resolveColorScheme(resolvedTheme: string | undefined): MapColorScheme {
  return resolvedTheme === "light" ? "light" : "dark";
}

export function MapDataProvider({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useTheme();
  const colorScheme = resolveColorScheme(resolvedTheme);
  const [mapStyle, setMapStyle] = useState(() => getOnlineMapStyle("dark"));

  useEffect(() => {
    setMapStyle(getOnlineMapStyle(colorScheme));
  }, [colorScheme]);

  const value = useMemo<MapDataContextValue>(() => ({ mapStyle }), [mapStyle]);

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
