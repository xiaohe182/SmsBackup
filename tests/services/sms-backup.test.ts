import { describe, expect, it } from "vitest";

import {
  createAndroidSmsBackupService,
  createUnavailableSmsBackupService,
} from "@/services/sms-backup";

describe("unavailable SMS backup service", () => {
  it("returns a clear Android-only status instead of throwing", async () => {
    const service = createUnavailableSmsBackupService();

    await expect(service.getStatus()).resolves.toMatchObject({
      available: false,
      message: "仅支持 Android App",
      pendingCount: 0,
    });
    await expect(service.requestPermissions()).resolves.toBe(false);
    await expect(service.requestMediaPermissions()).resolves.toBe(false);
    await expect(service.listMmsMessages("88888888")).resolves.toEqual({
      authorized: false,
      permissionGranted: false,
      messages: [],
    });
    await expect(service.listGalleryPhotos("88888888")).resolves.toEqual({
      authorized: false,
      permissionGranted: false,
      photos: [],
    });
  });

  it("parses MMS attachments and gallery photos from the native module", async () => {
    const service = createAndroidSmsBackupService({
      initialize: () => undefined,
      getPermissionState: () => "{}",
      requestPermissions: async () => true,
      requestMediaPermissions: async () => true,
      scanExistingMessages: async () => 0,
      getAllMessages: async () => "{}",
      getAllMmsMessages: async () => JSON.stringify({
        authorized: true,
        permissionGranted: true,
        messages: [
          {
            sourceId: "mms-1",
            threadId: 2,
            address: "10086",
            body: "彩信正文",
            receivedAt: 100,
            direction: "inbox",
            read: false,
            seen: false,
            attachments: [
              { id: "part-1", uri: "content://mms/part/1", mimeType: "image/jpeg" },
            ],
          },
        ],
      }),
      getGalleryPhotos: async () => JSON.stringify({
        authorized: true,
        permissionGranted: true,
        photos: [
          {
            id: "photo-1",
            uri: "content://media/external/images/media/1",
            albumId: "camera",
            albumName: "相机",
            displayName: "IMG_001.jpg",
            takenAt: 200,
            mimeType: "image/jpeg",
          },
        ],
      }),
      getBackupStatus: () => "{}",
      saveNativeSettings: () => undefined,
      syncNow: () => undefined,
      testConnection: async () => false,
      clearQueue: () => undefined,
    });

    await expect(service.listMmsMessages("88888888")).resolves.toMatchObject({
      authorized: true,
      permissionGranted: true,
      messages: [
        expect.objectContaining({
          sourceId: "mms-1",
          attachments: [expect.objectContaining({ uri: "content://mms/part/1" })],
        }),
      ],
    });
    await expect(service.listGalleryPhotos("88888888")).resolves.toMatchObject({
      authorized: true,
      permissionGranted: true,
      photos: [expect.objectContaining({ albumName: "相机" })],
    });
  });
});
