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

describe("SMS conversation page", () => {
  it("registers a non-sensitive conversation route", () => {
    const pages = read("src/pages.json");
    const messages = read("src/pages/messages/messages.vue");

    expect(pages).toContain('"path": "pages/conversation/conversation"');
    expect(messages).toContain("/pages/conversation/conversation?key=");
    expect(messages).toContain("encodeURIComponent");
  });

  it("uses the active viewer session and bounded pages for complete chat details", () => {
    const conversation = read("src/pages/conversation/conversation.vue");

    for (const value of [
      "smsViewerSession",
      "smsBackupService.listMessagePage",
      "remainingMs",
      "lockViewer",
      "uni.previewImage",
      "white-space: pre-wrap",
      "message.attachments",
      "contact.avatarUri",
      "contact.displayName",
      "contact.phoneNumber",
      "message.body",
      "message.direction",
      "message.status",
      "message.simSubscriptionId",
      '@scrolltoupper="loadOlderMessages"',
      'lazy-load="true"',
    ]) {
      expect(conversation).toContain(value);
    }
    expect(conversation).not.toContain("messagesForConversation");
  });
});
