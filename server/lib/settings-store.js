import { JsonlEventStore } from "./jsonl-store.js";

export const DEFAULT_SYNC_SETTINGS = Object.freeze({
  mediaLookbackHours: 168,
  autoSyncEnabled: true,
  autoSyncIntervalMinutes: 15,
  wifiOnly: false,
});

const ALLOWED_FIELDS = new Set(Object.keys(DEFAULT_SYNC_SETTINGS));

export function validateSettingsPatch(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("settings patch must be an object");
  }
  for (const key of Object.keys(value)) {
    if (!ALLOWED_FIELDS.has(key)) throw new TypeError(`unknown setting: ${key}`);
  }
  if (value.mediaLookbackHours !== undefined && (
    !Number.isInteger(value.mediaLookbackHours) ||
    value.mediaLookbackHours < 1 ||
    value.mediaLookbackHours > 87600
  )) {
    throw new RangeError("mediaLookbackHours must be an integer between 1 and 87600");
  }
  if (value.autoSyncIntervalMinutes !== undefined && (
    !Number.isInteger(value.autoSyncIntervalMinutes) ||
    value.autoSyncIntervalMinutes < 15 ||
    value.autoSyncIntervalMinutes > 10080
  )) {
    throw new RangeError("autoSyncIntervalMinutes must be an integer between 15 and 10080");
  }
  for (const key of ["autoSyncEnabled", "wifiOnly"]) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") {
      throw new TypeError(`${key} must be a boolean`);
    }
  }
  return { ...value };
}

function isValidSettingsEvent(event) {
  if (!event || event.type !== "settings") return false;
  if (event.deviceId !== null && typeof event.deviceId !== "string") return false;
  if (!Number.isSafeInteger(event.at) || event.at < 0) return false;
  try {
    validateSettingsPatch(event.patch);
    return true;
  } catch {
    return false;
  }
}

export class SettingsStore {
  constructor(filePath, { clock = Date.now } = {}) {
    this.clock = clock;
    this.events = new JsonlEventStore(filePath, isValidSettingsEvent);
    this.globalSettings = { ...DEFAULT_SYNC_SETTINGS };
    this.devicePatches = new Map();
  }

  async initialize() {
    await this.events.initialize();
    this.globalSettings = { ...DEFAULT_SYNC_SETTINGS };
    this.devicePatches.clear();
    for (const event of this.events.events()) this.apply(event);
  }

  get(deviceId = null) {
    const patch = deviceId ? this.devicePatches.get(deviceId) : null;
    return { ...this.globalSettings, ...(patch ?? {}) };
  }

  async update(patch, deviceId = null) {
    const validated = validateSettingsPatch(patch);
    const event = {
      type: "settings",
      deviceId: typeof deviceId === "string" && deviceId ? deviceId : null,
      patch: validated,
      at: this.clock(),
    };
    await this.events.append(event);
    this.apply(event);
    return this.get(event.deviceId);
  }

  apply(event) {
    if (event.deviceId === null) {
      Object.assign(this.globalSettings, event.patch);
      return;
    }
    this.devicePatches.set(event.deviceId, {
      ...(this.devicePatches.get(event.deviceId) ?? {}),
      ...event.patch,
    });
  }
}
