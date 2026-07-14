import { describe, expect, it } from "vitest";

import { normalizeServerUrl } from "@/domain/server-url";

describe("normalizeServerUrl", () => {
  it("trims whitespace and trailing slashes", () => {
    expect(normalizeServerUrl(" https://example.com/// ")).toBe(
      "https://example.com",
    );
  });

  it("allows a local HTTP server", () => {
    expect(normalizeServerUrl("http://192.168.1.8:3000/"))
      .toBe("http://192.168.1.8:3000");
  });

  it("rejects unsupported protocols", () => {
    expect(() => normalizeServerUrl("ftp://example.com")).toThrow(
      "仅支持 HTTP 或 HTTPS",
    );
  });

  it("keeps an empty value for an unconfigured server", () => {
    expect(normalizeServerUrl("   ")).toBe("");
  });
});
