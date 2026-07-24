import { lazy, Suspense, useSyncExternalStore } from "react";

const TanStackRouterDevtools = lazy(() =>
  import("@tanstack/react-router-devtools").then((module) => ({
    default: module.TanStackRouterDevtools,
  })),
);

const DEVTOOLS_STORAGE_KEY = "router-devtools";

function subscribeToDevtoolsFlag(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  return () => window.removeEventListener("storage", onStoreChange);
}

function getDevtoolsEnabled() {
  return localStorage.getItem(DEVTOOLS_STORAGE_KEY) === "true";
}

export function RouterDevtoolsGate() {
  const enabled = useSyncExternalStore(
    subscribeToDevtoolsFlag,
    getDevtoolsEnabled,
    () => false,
  );

  if (!import.meta.env.DEV || !enabled) {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <TanStackRouterDevtools position="bottom-left" />
    </Suspense>
  );
}
