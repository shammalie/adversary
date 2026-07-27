import { afterEach, describe, expect, it, vi } from "vitest";

import { createRuntime } from "@/lib/simulation-engine";
import { createSyntheticDemoScenario } from "@/lib/demo-scenario";
import { saveRuntime } from "@/lib/simulation-storage";

describe("saveRuntime quota visibility", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("warns instead of silently swallowing quota failures", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const setItem = vi.fn(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });
    vi.stubGlobal("window", {
      localStorage: {
        setItem,
        getItem: () => null,
        removeItem: () => {},
      },
    });

    const scenario = createSyntheticDemoScenario(1_000, () => 0.5, {
      seed: 1,
      targetCount: 2,
      vehicleSelection: ["aircraft"],
    });
    const ok = saveRuntime(createRuntime(scenario));

    expect(ok).toBe(false);
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/quota exceeded/i);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/adversary:active-runtime:v2/);
  });
});
