import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import Loader from "@/components/loader";

const ManagePage = lazy(() =>
  import("@/components/manage-page").then((module) => ({
    default: module.ManagePage,
  })),
);

export const Route = createFileRoute("/manage")({
  component: ManageRoute,
});

function ManageRoute() {
  return (
    <Suspense fallback={<Loader />}>
      <ManagePage />
    </Suspense>
  );
}
