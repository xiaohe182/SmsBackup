import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  try {
    return readFileSync(resolve(relativePath), "utf8");
  } catch {
    return "";
  }
}

describe("password-protected SMS viewer page", () => {
  it("registers the page and exposes it from the home screen", () => {
    const pages = read("src/pages.json");
    const home = read("src/pages/index/index.vue");

    expect(pages).toContain('"path": "pages/messages/messages"');
    expect(home).toContain("openMessages");
    expect(home).toContain('/pages/messages/messages');
    expect(home).toContain("查看全部短信");
    expect(home).toContain('@tap="openMessages"');
    expect(home).toContain("fail:");
    expect(home).toContain("uni.redirectTo");
    expect(home).toContain("无法打开短信页面");
  });

  it("requires the fixed password before invoking the native list API", () => {
    const page = read("src/pages/messages/messages.vue");

    expect(page).toContain('type="password"');
    expect(page).toContain("isSmsViewerPasswordValid");
    expect(page).toContain("smsBackupService.listAllMessages");
    expect(page.indexOf("isSmsViewerPasswordValid")).toBeLessThan(
      page.indexOf("smsBackupService.listAllMessages"),
    );
  });

  it("shows full message metadata and clears sensitive state when hidden", () => {
    const page = read("src/pages/messages/messages.vue");

    for (const value of [
      "message.address",
      "message.body",
      "message.direction",
      "message.read",
      "message.simSubscriptionId",
    ]) {
      expect(page).toContain(value);
    }
    expect(page).toContain("onHide(clearSensitiveState)");
    expect(page).toContain("onUnload(clearSensitiveState)");
  });
});
