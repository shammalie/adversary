import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import Loader from "@/components/loader";

const OperationsDashboard = lazy(() =>
  import("@/components/operations-dashboard").then((module) => ({
    default: module.OperationsDashboard,
  })),
);

export const Route = createFileRoute("/_map/operations")({
  component: OperationsRoute,
});

function OperationsRoute() {
  return (
    <Suspense fallback={<Loader />}>
      <OperationsDashboard />
    </Suspense>
  );
}
