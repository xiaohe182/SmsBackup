import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type KeyValueStorage,
} from "@/stores/settings";

function createStorage(seed: Record<string, unknown> = {}): KeyValueStorage {
  const values = new Map(Object.entries(seed));
  return {
    get: (key) => values.get(key),
    set: (key, value) => values.set(key, value),
  };
}

describe("settings store", () => {
  it("uses safe defaults when storage is empty", () => {
    expect(loadSettings(createStorage())).toEqual(DEFAULT_SETTINGS);
  });

  it("defaults to the configured public TXT server and compatibility token", () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      serverUrl: "http://119.91.65.202:8787",
      apiToken: "88888888",
      syncEnabled: true,
      allowInsecureHttp: true,
    });
  });

  it("migrates legacy settings without losing the configured device", () => {
    const settings = loadSettings(createStorage({
      "sms-backup:settings": {
        serverUrl: "",
        deviceName: "父亲手机",
        syncEnabled: true,
        allowInsecureHttp: false,
      },
    }));

    expect(settings).toEqual({
      ...DEFAULT_SETTINGS,
      deviceName: "父亲手机",
    });
  });

  it("normalizes the server URL before saving", () => {
    const storage = createStorage();
    const saved = saveSettings(
      storage,
      { ...DEFAULT_SETTINGS, serverUrl: " http://192.168.1.8:3000/// " },
    );

    expect(saved.serverUrl).toBe("http://192.168.1.8:3000");
    expect(loadSettings(storage).serverUrl).toBe("http://192.168.1.8:3000");
  });

  it("normalizes an empty token to the compatibility token", () => {
    const saved = saveSettings(createStorage(), {
      ...DEFAULT_SETTINGS,
      apiToken: "   ",
    });

    expect(saved.apiToken).toBe("88888888");
  });

  it("falls back to defaults for malformed persisted data", () => {
    expect(loadSettings(createStorage({ "sms-backup:settings": "broken" }))).toEqual(
      DEFAULT_SETTINGS,
    );
  });
});
