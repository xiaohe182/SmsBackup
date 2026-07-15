import { describe, expect, it } from "vitest";

import {
  analyzeRoute,
  haversineDistanceMeters,
  type LocationPoint,
} from "@/domain/route-analysis";

function point(
  id: string,
  sessionId: string,
  capturedAt: number,
  latitude: number,
  longitude: number,
  accuracy = 10,
): LocationPoint {
  return {
    id,
    sessionId,
    capturedAt,
    latitude,
    longitude,
    accuracy,
    altitude: null,
    speed: null,
    bearing: null,
    provider: "gps",
  };
}

describe("route analysis", () => {
  it("calculates geographic distance with the haversine formula", () => {
    const distance = haversineDistanceMeters(
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 0.001 },
    );

    expect(distance).toBeGreaterThan(110);
    expect(distance).toBeLessThan(112.5);
  });

  it("filters inaccurate fixes and impossible jumps from the actual route", () => {
    const start = 1_800_000_000_000;
    const result = analyzeRoute([
      point("1", "walk", start, 30, 120),
      point("2", "walk", start + 180_000, 30.0009, 120),
      point("bad-accuracy", "walk", start + 360_000, 31, 121, 500),
      point("bad-jump", "walk", start + 540_000, 32, 122, 8),
      point("3", "walk", start + 720_000, 30.0018, 120),
    ]);

    expect(result.rawPointCount).toBe(5);
    expect(result.acceptedPointCount).toBe(3);
    expect(result.rejectedPointCount).toBe(2);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].points.map((value) => value.id)).toEqual(["1", "2", "3"]);
    expect(result.totalDistanceMeters).toBeGreaterThan(190);
    expect(result.totalDistanceMeters).toBeLessThan(210);
  });

  it("keeps tracking sessions separate and reports the latest accepted point", () => {
    const result = analyzeRoute([
      point("a1", "morning", 1_000, 30, 120),
      point("a2", "morning", 181_000, 30.0005, 120),
      point("b1", "evening", 900_000, 31, 121),
      point("b2", "evening", 1_080_000, 31.0005, 121),
    ]);

    expect(result.sessions.map((session) => session.sessionId)).toEqual([
      "evening",
      "morning",
    ]);
    expect(result.latestPoint?.id).toBe("b2");
    expect(result.totalDistanceMeters).toBeGreaterThan(100);
    expect(result.totalDistanceMeters).toBeLessThan(120);
  });
});
