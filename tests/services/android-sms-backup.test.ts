import { describe, expect, it, vi } from "vitest";

import { createAndroidSmsBackupService, type NativeSmsModule } from "@/services/sms-backup";
import { DEFAULT_SETTINGS } from "@/stores/settings";

function createNative(overrides: Partial<NativeSmsModule> = {}): NativeSmsModule {
  return {
    initialize: vi.fn(),
    getPermissionState: vi.fn(() => '{"allGranted":true}'),
    requestPermissions: vi.fn(async () => true),
    requestMediaPermissions: vi.fn(async () => true),
    requestContactsPermission: vi.fn(async () => true),
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
    getAllMmsMessages: vi.fn(async () =>
      '{"authorized":true,"permissionGranted":true,"messages":[]}',
    ),
    getGalleryPhotos: vi.fn(async () =>
      '{"authorized":true,"permissionGranted":true,"photos":[]}',
    ),
    getConversationSummaries: vi.fn(async () =>
      JSON.stringify({
        authorized: true,
        permissionGranted: true,
        conversations: [
          {
            key: "thread:7",
            threadId: 7,
            address: "13800138000",
            contact: {
              key: "contact:13800138000",
              displayName: "家人备注",
              phoneNumber: "13800138000",
              phoneLabel: "手机",
              avatarUri: "content://contacts/1/photo",
              isResolved: true,
            },
            preview: "晚上回家吃饭",
            latestAt: 1783900800000,
            messageCount: 12,
            unreadCount: 1,
          },
        ],
      }),
    ),
    getMessagePage: vi.fn(async () =>
      JSON.stringify({
        authorized: true,
        permissionGranted: true,
        messages: [],
        nextCursor: null,
        hasMore: false,
        totalCount: 12,
      }),
    ),
    getGalleryAlbums: vi.fn(async () =>
      JSON.stringify({
        authorized: true,
        permissionGranted: true,
        albums: [{ id: "camera", name: "相机", photoCount: 10_000, coverUri: null }],
      }),
    ),
    getGalleryPage: vi.fn(async () =>
      JSON.stringify({
        authorized: true,
        permissionGranted: true,
        albumId: "camera",
        offset: 0,
        totalCount: 10_000,
        photos: Array.from({ length: 80 }, (_, index) => ({
          id: String(index),
          uri: `content://media/${index}`,
          albumId: "camera",
          albumName: "相机",
          displayName: `IMG_${index}.jpg`,
          takenAt: 1783900800000 - index,
          mimeType: "image/jpeg",
        })),
      }),
    ),
    getBackupStatus: vi.fn(
      () =>
        '{"available":true,"permissionGranted":true,"pendingCount":2,"uploadedCount":3,"pendingImageCount":4,"uploadedImageCount":5,"pendingVideoCount":6,"uploadedVideoCount":7,"mediaBytesUploaded":8388608,"lastMediaSyncAt":1783904400000,"lastMediaError":null,"lastSyncAt":1783900800000,"message":"就绪"}',
    ),
    saveNativeSettings: vi.fn(),
    syncNow: vi.fn(),
    testConnection: vi.fn(async () => true),
    clearQueue: vi.fn(),
    ...overrides,
  };
}

describe("Android SMS backup service", () => {
  it("rejects a native permission call that never settles", async () => {
    vi.useFakeTimers();
    try {
      const service = createAndroidSmsBackupService(
        createNative({
          requestPermissions: vi.fn(() => new Promise<boolean>(() => undefined)),
        }),
        { nativeCallTimeoutMs: 100 },
      );

      const outcome = service.requestPermissions().then(
        () => "resolved",
        (error: Error) => error.message,
      );
      await vi.advanceTimersByTimeAsync(100);

      await expect(Promise.race([outcome, Promise.resolve("still pending")]))
        .resolves.toBe("短信权限请求超时，请重新打开应用后重试");
    } finally {
      vi.useRealTimers();
    }
  });

  it("parses native status and forwards asynchronous operations", async () => {
    const native = createNative();
    const service = createAndroidSmsBackupService(native);

    await expect(service.getStatus()).resolves.toMatchObject({
      permissionGranted: true,
      pendingCount: 2,
      uploadedCount: 3,
      pendingImageCount: 4,
      uploadedImageCount: 5,
      pendingVideoCount: 6,
      uploadedVideoCount: 7,
      mediaBytesUploaded: 8_388_608,
      lastMediaSyncAt: 1_783_904_400_000,
      lastMediaError: null,
    });
    await expect(service.requestPermissions()).resolves.toBe(true);
    await expect(service.scanExistingMessages()).resolves.toBe(7);
    await expect(service.testConnection("https://example.com")).resolves.toBe(true);
  });

  it("serializes settings for killed-process native storage", async () => {
    const native = createNative();
    const service = createAndroidSmsBackupService(native);

    await service.saveSettings(DEFAULT_SETTINGS);

    expect(native.saveNativeSettings).toHaveBeenCalledWith(JSON.stringify(DEFAULT_SETTINGS));
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

  it("defaults new media counters when an older native module omits them", async () => {
    const service = createAndroidSmsBackupService(
      createNative({
        getBackupStatus: () =>
          '{"available":true,"permissionGranted":true,"pendingCount":2,"uploadedCount":3,"lastSyncAt":null,"message":"就绪"}',
      }),
    );

    await expect(service.getStatus()).resolves.toMatchObject({
      pendingImageCount: 0,
      uploadedImageCount: 0,
      pendingVideoCount: 0,
      uploadedVideoCount: 0,
      mediaBytesUploaded: 0,
      lastMediaSyncAt: null,
      lastMediaError: null,
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

  it("parses contact-aware conversations and bounded gallery pages", async () => {
    const native = createNative();
    const service = createAndroidSmsBackupService(native);

    const summaries = await service.listConversationSummaries("88888888");
    expect(summaries.conversations[0]).toMatchObject({
      key: "thread:7",
      contact: { displayName: "家人备注", phoneNumber: "13800138000" },
    });

    const page = await service.listGalleryPage("88888888", "camera", 0, 60);
    expect(page.totalCount).toBe(10_000);
    expect(page.photos).toHaveLength(60);
    expect(native.getGalleryPage).toHaveBeenCalledWith("88888888", "camera", 0, 60);
  });
});
