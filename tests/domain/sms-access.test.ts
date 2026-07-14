import { describe, expect, it } from "vitest";

import {
  SMS_VIEWER_PASSWORD,
  isSmsViewerPasswordValid,
} from "@/domain/sms-access";

describe("SMS viewer access", () => {
  it("accepts only the exact hard-coded password", () => {
    expect(SMS_VIEWER_PASSWORD).toBe("88888888");
    expect(isSmsViewerPasswordValid("88888888")).toBe(true);
    expect(isSmsViewerPasswordValid("8888888")).toBe(false);
    expect(isSmsViewerPasswordValid(" 88888888 ")).toBe(false);
    expect(isSmsViewerPasswordValid("")).toBe(false);
  });
});
