import { describe, expect, it } from "vitest";

import { createRecordId, isUploadRecord } from "@/domain/upload-record";

describe("createRecordId", () => {
  it("creates a stable escaped idempotency key", () => {
    expect(createRecordId("device 1", "42", "inbox")).toBe(
      "device%201:42:inbox",
    );
  });
});

describe("isUploadRecord", () => {
  it("accepts the documented upload contract", () => {
    expect(
      isUploadRecord({
        recordId: "device:42:inbox",
        deviceId: "device",
        deviceName: "家人手机",
        sourceId: "42",
        sender: "10086",
        body: "短信正文",
        receivedAt: 1_783_900_800_000,
        direction: "inbox",
        simSubscriptionId: 1,
      }),
    ).toBe(true);
  });

  it("rejects an invalid direction", () => {
    expect(
      isUploadRecord({
        recordId: "device:42:unknown",
        deviceId: "device",
        deviceName: "家人手机",
        sourceId: "42",
        sender: "10086",
        body: "短信正文",
        receivedAt: 1,
        direction: "unknown",
        simSubscriptionId: null,
      }),
    ).toBe(false);
  });
});
