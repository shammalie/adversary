import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import Loader from "@/components/loader";

const SimulationImport = lazy(() =>
  import("@/components/simulation-import").then((module) => ({
    default: module.SimulationImport,
  })),
);

export const Route = createFileRoute("/import")({
  component: ImportRoute,
});

function ImportRoute() {
  return (
    <Suspense fallback={<Loader />}>
      <SimulationImport />
    </Suspense>
  );
}
