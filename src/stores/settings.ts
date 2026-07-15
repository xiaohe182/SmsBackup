import { normalizeServerUrl } from "@/domain/server-url";

const SETTINGS_KEY = "sms-backup:settings";

export const DEFAULT_SERVER_URL = "http://119.91.65.202:8787";
export const DEFAULT_API_TOKEN = "88888888";

export interface KeyValueStorage {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

export interface AppSettings {
  serverUrl: string;
  apiToken: string;
  deviceName: string;
  syncEnabled: boolean;
  allowInsecureHttp: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  serverUrl: DEFAULT_SERVER_URL,
  apiToken: DEFAULT_API_TOKEN,
  deviceName: "家人手机",
  syncEnabled: true,
  allowInsecureHttp: true,
};

export const uniKeyValueStorage: KeyValueStorage = {
  get: (key) => uni.getStorageSync(key),
  set: (key, value) => uni.setStorageSync(key, value),
};

function parseAppSettings(value: unknown): AppSettings | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const settings = value as Record<string, unknown>;
  if (
    typeof settings.serverUrl !== "string" ||
    typeof settings.deviceName !== "string" ||
    typeof settings.syncEnabled !== "boolean" ||
    typeof settings.allowInsecureHttp !== "boolean"
  ) {
    return null;
  }

  const storedServerUrl = settings.serverUrl.trim();
  const usesDefaultServer = storedServerUrl.length === 0;
  const storedToken = typeof settings.apiToken === "string"
    ? settings.apiToken.trim()
    : "";

  // 旧版本没有令牌且服务器地址可能为空；升级时只补齐新字段，不丢失设备名称和同步开关。
  return {
    serverUrl: usesDefaultServer ? DEFAULT_SERVER_URL : storedServerUrl,
    apiToken: storedToken || DEFAULT_API_TOKEN,
    deviceName: settings.deviceName,
    syncEnabled: settings.syncEnabled,
    allowInsecureHttp: usesDefaultServer ? true : settings.allowInsecureHttp,
  };
}

export function loadSettings(storage: KeyValueStorage): AppSettings {
  return parseAppSettings(storage.get(SETTINGS_KEY)) ?? { ...DEFAULT_SETTINGS };
}

export function saveSettings(
  storage: KeyValueStorage,
  settings: AppSettings,
): AppSettings {
  const normalized: AppSettings = {
    ...settings,
    serverUrl: normalizeServerUrl(settings.serverUrl) || DEFAULT_SERVER_URL,
    apiToken: settings.apiToken.trim() || DEFAULT_API_TOKEN,
    deviceName: settings.deviceName.trim() || DEFAULT_SETTINGS.deviceName,
  };
  storage.set(SETTINGS_KEY, normalized);
  return normalized;
}
