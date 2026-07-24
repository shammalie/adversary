import { Outlet, createFileRoute } from "@tanstack/react-router";

import { MapDataProvider } from "@/components/map-data-provider";

export const Route = createFileRoute("/_map")({
  component: MapLayout,
});

function MapLayout() {
  return (
    <MapDataProvider>
      <Outlet />
    </MapDataProvider>
  );
}
