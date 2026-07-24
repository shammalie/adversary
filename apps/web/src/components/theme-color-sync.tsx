import { useEffect } from "react";

import { useTheme } from "@/components/theme-provider";

const FALLBACK_THEME_COLORS = {
  light: "#f5f8f9",
  dark: "#0c1014",
} as const;

function readThemeColorCssVar(): string | null {
  if (typeof document === "undefined") return null;
  const value = getComputedStyle(document.documentElement).getPropertyValue("--theme-color").trim();
  return value || null;
}

/** Keeps <meta name="theme-color"> in sync with resolvedTheme. */
export function ThemeColorSync() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const scheme = resolvedTheme === "light" ? "light" : "dark";
    const color = readThemeColorCssVar() ?? FALLBACK_THEME_COLORS[scheme];

    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "theme-color");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", color);
  }, [resolvedTheme]);

  return null;
}
