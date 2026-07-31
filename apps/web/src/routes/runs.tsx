import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import Loader from "@/components/loader";

const ActiveRunsPage = lazy(() =>
  import("@/components/active-runs-page").then((module) => ({
    default: module.ActiveRunsPage,
  })),
);

export const Route = createFileRoute("/runs")({
  component: RunsRoute,
});

function RunsRoute() {
  return (
    <Suspense fallback={<Loader />}>
      <ActiveRunsPage />
    </Suspense>
  );
}
