import { normalizeServerUrl } from "@/domain/server-url";

const SETTINGS_KEY = "sms-backup:settings";

export interface KeyValueStorage {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

export interface AppSettings {
  serverUrl: string;
  deviceName: string;
  syncEnabled: boolean;
  allowInsecureHttp: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  serverUrl: "",
  deviceName: "家人手机",
  syncEnabled: true,
  allowInsecureHttp: false,
};

export const uniKeyValueStorage: KeyValueStorage = {
  get: (key) => uni.getStorageSync(key),
  set: (key, value) => uni.setStorageSync(key, value),
};

function isAppSettings(value: unknown): value is AppSettings {
  if (!value || typeof value !== "object") {
    return false;
  }
  const settings = value as Record<string, unknown>;
  return (
    typeof settings.serverUrl === "string" &&
    typeof settings.deviceName === "string" &&
    typeof settings.syncEnabled === "boolean" &&
    typeof settings.allowInsecureHttp === "boolean"
  );
}

export function loadSettings(storage: KeyValueStorage): AppSettings {
  const stored = storage.get(SETTINGS_KEY);
  return isAppSettings(stored) ? { ...stored } : { ...DEFAULT_SETTINGS };
}

export function saveSettings(
  storage: KeyValueStorage,
  settings: AppSettings,
): AppSettings {
  const normalized: AppSettings = {
    ...settings,
    serverUrl: normalizeServerUrl(settings.serverUrl),
    deviceName: settings.deviceName.trim() || DEFAULT_SETTINGS.deviceName,
  };
  storage.set(SETTINGS_KEY, normalized);
  return normalized;
}
