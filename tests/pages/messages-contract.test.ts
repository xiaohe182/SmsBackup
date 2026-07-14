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

  it("keeps an active ten-minute session across page hiding and exposes conversation tabs", () => {
    const page = read("src/pages/messages/messages.vue");

    for (const value of [
      "smsViewerSession",
      "remainingMs",
      "lockViewer",
      '"conversations"',
      '"all"',
      '"inbox"',
      '"sent"',
      '"media"',
      "openConversation",
      "requestMediaPermissions",
    ]) {
      expect(page).toContain(value);
    }
    expect(page).not.toContain("onHide(clearSensitiveState)");
    expect(page).not.toContain("onUnload(clearSensitiveState)");
  });
});
