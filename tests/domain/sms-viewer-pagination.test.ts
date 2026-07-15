import { describe, expect, it } from "vitest";

import {
  cursorFromMessage,
  mergeMessagePage,
  type ViewerMessage,
} from "@/domain/sms-viewer-pagination";

function message(id: string, timestamp: number): ViewerMessage {
  return {
    id,
    sourceId: id.split(":")[1] ?? id,
    threadId: 7,
    address: "13800138000",
    body: `短信 ${id}`,
    timestamp,
    receivedAt: timestamp,
    sentAt: null,
    type: 1,
    direction: "inbox",
    kind: "sms",
    attachments: [],
    read: true,
    seen: true,
    status: null,
    serviceCenter: null,
    simSubscriptionId: null,
  };
}

describe("SMS viewer pagination", () => {
  it("deduplicates cursor pages and keeps a bounded message window", () => {
    const existing = Array.from({ length: 200 }, (_, index) =>
      message(`sms:${index}`, 1_000 - index),
    );
    const incoming = [message("sms:199", 801), message("sms:200", 800)];

    const merged = mergeMessagePage(existing, incoming, 200);

    expect(merged).toHaveLength(200);
    expect(new Set(merged.map((item) => item.id)).size).toBe(200);
    expect(merged.at(-1)?.id).toBe("sms:200");
  });

  it("creates the stable native cursor from message identity", () => {
    expect(cursorFromMessage(message("mms:42", 123))).toEqual({
      timestamp: 123,
      kind: "sms",
      sourceId: "42",
    });
  });
});
