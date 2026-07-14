import { describe, expect, it, vi } from "vitest";

import { createAndroidSmsBackupService, type NativeSmsModule } from "@/services/sms-backup";
import { DEFAULT_SETTINGS } from "@/stores/settings";

function createNative(overrides: Partial<NativeSmsModule> = {}): NativeSmsModule {
  return {
    initialize: vi.fn(),
    getPermissionState: vi.fn(() => '{"allGranted":true}'),
    requestPermissions: vi.fn(async () => true),
    scanExistingMessages: vi.fn(async () => 7),
    getAllMessages: vi.fn(async () =>
      JSON.stringify({
        authorized: true,
        permissionGranted: true,
        messages: [
          {
            sourceId: "42",
            threadId: 7,
            address: "10086",
            body: "账户余额提醒",
            receivedAt: 1783900800000,
            sentAt: null,
            type: 1,
            direction: "inbox",
            read: false,
            seen: true,
            status: -1,
            serviceCenter: "+8613800100500",
            simSubscriptionId: 1,
          },
        ],
      }),
    ),
    getBackupStatus: vi.fn(
      () =>
        '{"available":true,"permissionGranted":true,"pendingCount":2,"uploadedCount":3,"filteredCount":4,"lastSyncAt":1783900800000,"message":"就绪"}',
    ),
    saveNativeSettings: vi.fn(),
    saveNativeRules: vi.fn(),
    syncNow: vi.fn(),
    testConnection: vi.fn(async () => true),
    clearQueue: vi.fn(),
    ...overrides,
  };
}

describe("Android SMS backup service", () => {
  it("parses native status and forwards asynchronous operations", async () => {
    const native = createNative();
    const service = createAndroidSmsBackupService(native);

    await expect(service.getStatus()).resolves.toMatchObject({
      permissionGranted: true,
      pendingCount: 2,
      uploadedCount: 3,
      filteredCount: 4,
    });
    await expect(service.requestPermissions()).resolves.toBe(true);
    await expect(service.scanExistingMessages()).resolves.toBe(7);
    await expect(service.testConnection("https://example.com")).resolves.toBe(true);
  });

  it("serializes settings and blacklist rules for killed-process native storage", async () => {
    const native = createNative();
    const service = createAndroidSmsBackupService(native);
    const rules = [{ id: "one", kind: "sender" as const, value: "淘宝", enabled: true }];

    await service.saveSettings(DEFAULT_SETTINGS);
    await service.saveRules(rules);

    expect(native.saveNativeSettings).toHaveBeenCalledWith(JSON.stringify(DEFAULT_SETTINGS));
    expect(native.saveNativeRules).toHaveBeenCalledWith(JSON.stringify(rules));
  });

  it("returns a safe status when native JSON is malformed", async () => {
    const service = createAndroidSmsBackupService(
      createNative({ getBackupStatus: () => "broken" }),
    );

    await expect(service.getStatus()).resolves.toMatchObject({
      available: true,
      message: "原生状态读取失败",
    });
  });

  it("forwards the fixed password and parses every native SMS field", async () => {
    const native = createNative();
    const service = createAndroidSmsBackupService(native);

    const result = await service.listAllMessages("88888888");

    expect(native.getAllMessages).toHaveBeenCalledWith("88888888");
    expect(result).toEqual({
      authorized: true,
      permissionGranted: true,
      messages: [
        {
          sourceId: "42",
          threadId: 7,
          address: "10086",
          body: "账户余额提醒",
          receivedAt: 1783900800000,
          sentAt: null,
          type: 1,
          direction: "inbox",
          read: false,
          seen: true,
          status: -1,
          serviceCenter: "+8613800100500",
          simSubscriptionId: 1,
        },
      ],
    });
  });

  it("keeps the viewer locked when native authorization fails", async () => {
    const native = createNative({
      getAllMessages: vi.fn(async () =>
        '{"authorized":false,"permissionGranted":true,"messages":[]}',
      ),
    });
    const service = createAndroidSmsBackupService(native);

    await expect(service.listAllMessages("wrong")).resolves.toEqual({
      authorized: false,
      permissionGranted: true,
      messages: [],
    });
  });
});
