import { describe, expect, it, vi } from "vitest";

import { bootstrapSmsBackup } from "@/services/bootstrap";
import type { SmsBackupService } from "@/services/sms-backup";
import { DEFAULT_SETTINGS } from "@/stores/settings";

describe("bootstrapSmsBackup", () => {
  it("persists native settings before scheduling background work", async () => {
    const calls: string[] = [];
    const service = {
      saveSettings: vi.fn(async () => calls.push("settings")),
      initialize: vi.fn(async () => calls.push("initialize")),
    } as unknown as SmsBackupService;

    await bootstrapSmsBackup(service, DEFAULT_SETTINGS);

    expect(calls).toEqual(["settings", "initialize"]);
  });
});
