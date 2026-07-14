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

  it("normalizes the server URL before saving", () => {
    const storage = createStorage();
    const saved = saveSettings(
      storage,
      { ...DEFAULT_SETTINGS, serverUrl: " http://192.168.1.8:3000/// " },
    );

    expect(saved.serverUrl).toBe("http://192.168.1.8:3000");
    expect(loadSettings(storage).serverUrl).toBe("http://192.168.1.8:3000");
  });

  it("falls back to defaults for malformed persisted data", () => {
    expect(loadSettings(createStorage({ "sms-backup:settings": "broken" }))).toEqual(
      DEFAULT_SETTINGS,
    );
  });
});
