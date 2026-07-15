import { describe, expect, it, vi } from "vitest";

import {
  createDeviceDataService,
  type NativeDeviceDataModule,
} from "@/services/device-data";

function createNative(overrides: Partial<NativeDeviceDataModule> = {}): NativeDeviceDataModule {
  return {
    requestContactsPermission: vi.fn(async () => true),
    getContacts: vi.fn(async () => JSON.stringify({
      authorized: true,
      permissionGranted: true,
      contacts: [
        {
          contactId: "1",
          displayName: "张三",
          phoneNumber: "13800138000",
          normalizedNumber: "+8613800138000",
          photoUri: null,
        },
      ],
    })),
    getDeviceSnapshot: vi.fn(() => JSON.stringify({
      authorized: true,
      snapshot: {
        manufacturer: "HUAWEI",
        model: "TEST",
        androidVersion: "14",
        apiLevel: 34,
        batteryLevel: 86,
        charging: true,
        batteryStatus: "charging",
        batteryHealth: "good",
        batteryTemperatureCelsius: 31.2,
        batteryVoltageMillivolts: 4200,
        batteryTechnology: "Li-ion",
        memoryTotalBytes: 8_000,
        memoryAvailableBytes: 4_000,
        storageTotalBytes: 100_000,
        storageAvailableBytes: 40_000,
        networkConnected: true,
        networkTransport: "wifi",
        ignoringBatteryOptimizations: false,
        capturedAt: 123,
      },
    })),
    ...overrides,
  };
}

describe("device data service", () => {
  it("parses protected contacts and device diagnostics", async () => {
    const native = createNative();
    const service = createDeviceDataService(native);

    await expect(service.requestContactsPermission()).resolves.toBe(true);
    await expect(service.listContacts("88888888")).resolves.toMatchObject({
      authorized: true,
      permissionGranted: true,
      contacts: [expect.objectContaining({ displayName: "张三" })],
    });
    await expect(service.getSnapshot("88888888")).resolves.toMatchObject({
      authorized: true,
      snapshot: expect.objectContaining({
        batteryLevel: 86,
        networkTransport: "wifi",
      }),
    });

    expect(native.getContacts).toHaveBeenCalledWith("88888888");
    expect(native.getDeviceSnapshot).toHaveBeenCalledWith("88888888");
  });

  it("fails closed when native JSON is malformed", async () => {
    const service = createDeviceDataService(createNative({
      getContacts: async () => "broken",
      getDeviceSnapshot: () => "broken",
    }));

    await expect(service.listContacts("88888888")).resolves.toEqual({
      authorized: false,
      permissionGranted: false,
      contacts: [],
    });
    await expect(service.getSnapshot("88888888")).resolves.toEqual({
      authorized: false,
      snapshot: null,
    });
  });
});
