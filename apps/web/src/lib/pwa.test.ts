import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("PWA build artifacts", () => {
  it("includes a generated service worker when dist exists", () => {
    const distDir = resolve(process.cwd(), "dist");
    if (!existsSync(distDir)) {
      expect(true).toBe(true);
      return;
    }

    expect(existsSync(resolve(distDir, "sw.js"))).toBe(true);
    expect(existsSync(resolve(distDir, "manifest.webmanifest"))).toBe(true);
    expect(readdirSync(distDir).some((file) => file.startsWith("workbox-"))).toBe(true);
  });

  it("caches local tileserver and openfreemap with a large entry budget", () => {
    const config = readFileSync(resolve(process.cwd(), "vite.config.ts"), "utf8");
    expect(config).toMatch(/cacheName:\s*"local-tileserver"/);
    expect(config).toMatch(/cacheName:\s*"openfreemap-tiles"/);
    expect(config).toMatch(/tiles\\.openfreemap\\.org/);
    const localBlock = config.slice(
      config.indexOf('cacheName: "local-tileserver"'),
      config.indexOf('cacheName: "local-tileserver"') + 280,
    );
    expect(localBlock).toMatch(/maxEntries:\s*512/);
  });
});
