import { describe, expect, it } from "vitest";

import { buildTrackingMapEventPoints } from "@/lib/tracking-map-event-points";

describe("buildTrackingMapEventPoints", () => {
  const targets = [
    { id: "t1", color: "#ff0000" },
    { id: "t2", color: "#00ff00" },
  ];

  it("returns a circle for every event with a position, colored by target", () => {
    const points = buildTrackingMapEventPoints(
      [
        {
          id: "e1",
          targetId: "t1",
          position: { latitude: 51.5, longitude: -0.12 },
        },
        {
          id: "e2",
          targetId: "t2",
          position: { latitude: 52.1, longitude: 0.05 },
        },
        { id: "e3", targetId: "t1" },
      ],
      targets,
    );

    expect(points).toEqual([
      {
        id: "e1",
        targetId: "t1",
        latitude: 51.5,
        longitude: -0.12,
        color: "#ff0000",
      },
      {
        id: "e2",
        targetId: "t2",
        latitude: 52.1,
        longitude: 0.05,
        color: "#00ff00",
      },
    ]);
  });

  it("skips events without position and unknown targets", () => {
    expect(
      buildTrackingMapEventPoints(
        [
          { id: "e1", targetId: "missing", position: { latitude: 1, longitude: 2 } },
          { id: "e2", targetId: "t1" },
          {
            id: "e3",
            targetId: "t1",
            position: { latitude: Number.NaN, longitude: 0 },
          },
        ],
        targets,
      ),
    ).toEqual([]);
  });

  it("only includes events provided by the caller (scrub-due set)", () => {
    const points = buildTrackingMapEventPoints(
      [
        {
          id: "due",
          targetId: "t1",
          position: { latitude: 51.5, longitude: -0.12 },
        },
      ],
      targets,
    );
    expect(points.map((point) => point.id)).toEqual(["due"]);
  });
});
