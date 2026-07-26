import { describe, expect, it } from "vitest";

import {
  vehicleCategoryHeadingOffsetDegrees,
  vehicleCategoryMarkerRotationDegrees,
} from "./vehicle-icon";

describe("vehicleCategoryHeadingOffsetDegrees", () => {
  it("offsets Lucide Plane so nose-north is heading 0", () => {
    expect(vehicleCategoryHeadingOffsetDegrees("aircraft")).toBe(-45);
  });

  it("leaves Ship (mast-up) unoffset", () => {
    expect(vehicleCategoryHeadingOffsetDegrees("boat")).toBe(0);
  });

  it("offsets side-profile road vehicles from east-facing art", () => {
    expect(vehicleCategoryHeadingOffsetDegrees("car")).toBe(-90);
    expect(vehicleCategoryHeadingOffsetDegrees("truck")).toBe(-90);
  });
});

describe("vehicleCategoryMarkerRotationDegrees", () => {
  it("applies artwork offset when heading is 0", () => {
    expect(vehicleCategoryMarkerRotationDegrees(0, "aircraft")).toBe(-45);
  });

  it("adds offset to navigation heading", () => {
    expect(vehicleCategoryMarkerRotationDegrees(90, "aircraft")).toBe(45);
  });

  it("returns 0 when heading is missing", () => {
    expect(vehicleCategoryMarkerRotationDegrees(undefined, "aircraft")).toBe(0);
  });
});
