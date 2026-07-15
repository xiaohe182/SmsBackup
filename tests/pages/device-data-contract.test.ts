import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  try {
    return readFileSync(resolve(path), "utf8");
  } catch {
    return "";
  }
}

describe("protected device center page contract", () => {
  it("registers a protected device center entry", () => {
    expect(read("src/pages.json")).toContain("pages/device/device");
    const home = read("src/pages/index/index.vue");
    expect(home).toContain("设备与轨迹");
    expect(home).toContain("/pages/device/device");
  });

  it("shares the ten-minute password session and supports immediate lock", () => {
    const page = read("src/pages/device/device.vue");
    expect(page).toContain("smsViewerSession");
    expect(page).toContain("isSmsViewerPasswordValid");
    expect(page).toContain("10 分钟");
    expect(page).toContain("lockViewer");
  });

  it("offers route, contacts, and device diagnostics tabs", () => {
    const page = read("src/pages/device/device.vue");
    for (const value of [
      'key: "route"',
      'key: "contacts"',
      'key: "device"',
      "locationTrackingService",
      "deviceDataService",
      "analyzeRoute",
      "requestContactsPermission",
      "openBatterySettings",
      "openAppSettings",
      "uni.openLocation",
    ]) {
      expect(page).toContain(value);
    }
  });
});
