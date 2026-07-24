import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import Loader from "@/components/loader";

const ScenarioBuilder = lazy(() =>
  import("@/components/scenario-builder").then((module) => ({
    default: module.ScenarioBuilder,
  })),
);

export const Route = createFileRoute("/_map/builder")({
  component: BuilderRoute,
});

function BuilderRoute() {
  return (
    <Suspense fallback={<Loader />}>
      <ScenarioBuilder />
    </Suspense>
  );
}
