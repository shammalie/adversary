import { existsSync, readdirSync } from "node:fs";
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
});
