import { afterEach, describe, expect, it, vi } from "vitest";

import { normalizeServerUrl } from "@/domain/server-url";

describe("normalizeServerUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("trims whitespace and trailing slashes", () => {
    expect(normalizeServerUrl(" https://example.com/// ")).toBe(
      "https://example.com",
    );
  });

  it("allows a local HTTP server", () => {
    expect(normalizeServerUrl("http://192.168.1.8:3000/"))
      .toBe("http://192.168.1.8:3000");
  });

  it("accepts the public IPv4 server when Android does not provide URL", () => {
    vi.stubGlobal("URL", undefined);

    expect(normalizeServerUrl("http://119.91.65.202:8787/"))
      .toBe("http://119.91.65.202:8787");
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
