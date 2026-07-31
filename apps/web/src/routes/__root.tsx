import { Button } from "@adversary/ui/components/button";
import { Toaster } from "@adversary/ui/components/sonner";
import {
  HeadContent,
  Outlet,
  createRootRouteWithContext,
  type ErrorComponentProps,
} from "@tanstack/react-router";

import { RouterDevtoolsGate } from "@/components/router-devtools-gate";
import Header from "@/components/header";
import { QueryProvider } from "@/components/query-provider";
import { SimulationProvider } from "@/components/simulation-provider";
import { ThemeColorSync } from "@/components/theme-color-sync";
import { ThemeProvider } from "@/components/theme-provider";

import "../index.css";

export interface RouterAppContext {}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: RootComponent,
  errorComponent: RootErrorComponent,
  head: () => ({
    meta: [
      {
        title: "Adversary",
      },
      {
        name: "description",
        content:
          "Frontend target-tracking simulation and operations dashboard.",
      },
    ],
    links: [
      {
        rel: "icon",
        href: "/favicon.ico",
        sizes: "any",
      },
      {
        rel: "icon",
        type: "image/svg+xml",
        href: "/icon.svg",
      },
      {
        rel: "apple-touch-icon",
        href: "/apple-touch-icon.png",
      },
    ],
  }),
});

function RootErrorComponent({ error, reset }: ErrorComponentProps) {
  const message = error instanceof Error ? error.message : String(error);

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      disableTransitionOnChange
      storageKey="vite-ui-theme"
    >
      <ThemeColorSync />
      <div className="grid min-h-svh grid-rows-[auto_1fr]">
        <Header />
        <main className="mx-auto flex w-full max-w-lg flex-col justify-center gap-4 p-6">
          <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">
            The page hit an unexpected error. You can try again or reload.
          </p>
          <pre className="overflow-auto rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
            {message}
          </pre>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={reset}>
              Try again
            </Button>
            <Button type="button" variant="outline" onClick={() => window.location.assign("/")}>
              Go home
            </Button>
          </div>
        </main>
      </div>
      <Toaster richColors />
    </ThemeProvider>
  );
}

function RootComponent() {
  return (
    <>
      <HeadContent />
      <QueryProvider>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          disableTransitionOnChange
          storageKey="vite-ui-theme"
        >
          <ThemeColorSync />
          <SimulationProvider>
            <div className="grid min-h-svh grid-rows-[auto_1fr]">
              <Header />
              <Outlet />
            </div>
          </SimulationProvider>
          <Toaster richColors />
        </ThemeProvider>
      </QueryProvider>
      <RouterDevtoolsGate />
    </>
  );
}
