import { Toaster } from "@adversary/ui/components/sonner";
import {
  HeadContent,
  Outlet,
  createRootRouteWithContext,
} from "@tanstack/react-router";

import { RouterDevtoolsGate } from "@/components/router-devtools-gate";
import Header from "@/components/header";
import { SimulationProvider } from "@/components/simulation-provider";
import { ThemeColorSync } from "@/components/theme-color-sync";
import { ThemeProvider } from "@/components/theme-provider";

import "../index.css";

export interface RouterAppContext {}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: RootComponent,
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
      },
    ],
  }),
});

function RootComponent() {
  return (
    <>
      <HeadContent />
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
      <RouterDevtoolsGate />
    </>
  );
}
