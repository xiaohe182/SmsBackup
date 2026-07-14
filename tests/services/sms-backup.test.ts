import { describe, expect, it } from "vitest";

import { createUnavailableSmsBackupService } from "@/services/sms-backup";

describe("unavailable SMS backup service", () => {
  it("returns a clear Android-only status instead of throwing", async () => {
    const service = createUnavailableSmsBackupService();

    await expect(service.getStatus()).resolves.toMatchObject({
      available: false,
      message: "仅支持 Android App",
      pendingCount: 0,
    });
    await expect(service.requestPermissions()).resolves.toBe(false);
  });
});
