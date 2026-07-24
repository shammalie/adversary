import { describe, expect, it } from "vitest";

import {
  addPriorityTerm,
  isPriorityMessage,
  matchPriorityTerms,
  normalizePriorityTerms,
  removePriorityTerm,
} from "@/lib/priority-terms";

describe("priority terms", () => {
  it("matches whole words case-insensitively", () => {
    expect(matchPriorityTerms("Track is CRITICAL near sector 4", ["critical"])).toEqual([
      "critical",
    ]);
    expect(matchPriorityTerms("Recriticalized contact", ["critical"])).toEqual([]);
  });

  it("matches exact multi-word phrases", () => {
    expect(
      matchPriorityTerms("Proximity threshold exceeded near channel", ["proximity threshold"]),
    ).toEqual(["proximity threshold"]);
    expect(matchPriorityTerms("proximity alert only", ["proximity threshold"])).toEqual([]);
  });

  it("normalizes duplicates and whitespace", () => {
    expect(normalizePriorityTerms([" critical ", "CRITICAL", "proximity  threshold"])).toEqual([
      "critical",
      "proximity threshold",
    ]);
    expect(addPriorityTerm(["alpha"], "Alpha")).toEqual(["alpha"]);
    expect(removePriorityTerm(["Alpha", "Beta"], "alpha")).toEqual(["Beta"]);
  });

  it("detects priority messages", () => {
    expect(isPriorityMessage("Routine update", ["critical"])).toBe(false);
    expect(isPriorityMessage("Critical update", ["critical"])).toBe(true);
  });
});
