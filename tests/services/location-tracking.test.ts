import { describe, expect, it, vi } from "vitest";

import {
  createLocationTrackingService,
  type NativeLocationModule,
} from "@/services/location-tracking";

function createNative(overrides: Partial<NativeLocationModule> = {}): NativeLocationModule {
  return {
    getLocationStatus: vi.fn((_password: string) => JSON.stringify({
      available: true,
      permissionGranted: true,
      precisePermissionGranted: true,
      notificationPermissionGranted: true,
      locationEnabled: true,
      tracking: true,
      sampleIntervalMs: 180_000,
      pointCount: 2,
      currentSessionId: "session-1",
      startedAt: 1_000,
      lastPoint: {
        id: "2",
        sessionId: "session-1",
        capturedAt: 181_000,
        latitude: 30.1,
        longitude: 120.2,
        accuracy: 12,
        altitude: null,
        speed: 1.5,
        bearing: 90,
        provider: "gps",
      },
      message: "轨迹记录中",
    })),
    requestLocationPermissions: vi.fn(async () => true),
    requestNotificationPermission: vi.fn(async () => true),
    startLocationTracking: vi.fn((_password: string) => true),
    stopLocationTracking: vi.fn(),
    getLocationPoints: vi.fn(async (_password: string, _limit: number) => JSON.stringify({
      points: [
        {
          id: "2",
          sessionId: "session-1",
          capturedAt: 181_000,
          latitude: 30.1,
          longitude: 120.2,
          accuracy: 12,
          altitude: null,
          speed: 1.5,
          bearing: 90,
          provider: "gps",
        },
      ],
    })),
    clearLocationHistory: vi.fn(() => true),
    openBatteryOptimizationSettings: vi.fn(),
    openAppSettings: vi.fn(),
    ...overrides,
  };
}

describe("location tracking service", () => {
  it("parses status and location points while forwarding controls", async () => {
    const native = createNative();
    const service = createLocationTrackingService(native);

    await expect(service.getStatus("88888888")).resolves.toMatchObject({
      tracking: true,
      sampleIntervalMs: 180_000,
      lastPoint: expect.objectContaining({ latitude: 30.1, longitude: 120.2 }),
    });
    await expect(service.listPoints("88888888", 500)).resolves.toEqual([
      expect.objectContaining({ id: "2", sessionId: "session-1" }),
    ]);
    await expect(service.requestLocationPermissions()).resolves.toBe(true);
    await expect(service.requestNotificationPermission()).resolves.toBe(true);
    await expect(service.start("88888888")).resolves.toBe(true);
    await service.stop();
    await expect(service.clearHistory()).resolves.toBe(true);
    await service.openBatterySettings();
    await service.openAppSettings();

    expect(native.getLocationStatus).toHaveBeenCalledWith("88888888");
    expect(native.startLocationTracking).toHaveBeenCalledWith("88888888");
    expect(native.getLocationPoints).toHaveBeenCalledWith("88888888", 500);
    expect(native.stopLocationTracking).toHaveBeenCalled();
    expect(native.openBatteryOptimizationSettings).toHaveBeenCalled();
  });

  it("returns safe fallbacks for malformed native responses", async () => {
    const service = createLocationTrackingService(createNative({
      getLocationStatus: () => "broken",
      getLocationPoints: async () => "broken",
    }));

    await expect(service.getStatus("88888888")).resolves.toMatchObject({
      available: true,
      tracking: false,
      pointCount: 0,
    });
    await expect(service.listPoints("88888888")).resolves.toEqual([]);
  });
});
