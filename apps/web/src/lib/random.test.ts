import { describe, expect, it } from "vitest";

import {
  createSeededIdFactory,
  createSeededRandom,
  resolveIdFactory,
} from "@/lib/random";

describe("createSeededRandom", () => {
  it("returns values in [0, 1)", () => {
    const random = createSeededRandom(11);
    for (let i = 0; i < 100; i += 1) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("is deterministic for the same seed", () => {
    const a = createSeededRandom(42);
    const b = createSeededRandom(42);
    const sequenceA = Array.from({ length: 20 }, () => a());
    const sequenceB = Array.from({ length: 20 }, () => b());
    expect(sequenceA).toEqual(sequenceB);
  });

  it("diverges for different seeds", () => {
    const a = createSeededRandom(1);
    const b = createSeededRandom(2);
    expect(Array.from({ length: 5 }, () => a())).not.toEqual(
      Array.from({ length: 5 }, () => b()),
    );
  });

  it("matches the historical docs LCG starting at 0.37", () => {
    const random = createSeededRandom(0.37);
    let seed = 0.37;
    const legacy = () => {
      seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296;
      return seed / 4_294_967_296;
    };
    for (let i = 0; i < 10; i += 1) {
      expect(random()).toBe(legacy());
    }
  });
});

describe("createSeededIdFactory", () => {
  it("emits stable sequential ids for the same seed", () => {
    const a = createSeededIdFactory(99);
    const b = createSeededIdFactory(99);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("resolveIdFactory prefers explicit factory, then seed, then uuid", () => {
    const explicit = () => "fixed";
    expect(resolveIdFactory({ idFactory: explicit })()).toBe("fixed");
    expect(resolveIdFactory({ seed: 1 })()).toMatch(/^s/);
    expect(resolveIdFactory({})()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});
