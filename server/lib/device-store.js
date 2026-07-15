import { JsonlEventStore } from "./jsonl-store.js";

function isValidDeviceEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return false;
  if (event.type !== "heartbeat" && event.type !== "completion") return false;
  if (typeof event.deviceId !== "string" || !event.deviceId) return false;
  if (!Number.isSafeInteger(event.at) || event.at < 0) return false;
  if (event.type === "heartbeat") {
    return typeof event.deviceName === "string" && typeof event.appVersion === "string";
  }
  return event.result && typeof event.result === "object" && !Array.isArray(event.result);
}

export class DeviceStore {
  constructor(filePath, { clock = Date.now } = {}) {
    this.clock = clock;
    this.events = new JsonlEventStore(filePath, isValidDeviceEvent);
    this.devices = new Map();
  }

  async initialize() {
    await this.events.initialize();
    this.devices.clear();
    for (const event of this.events.events()) this.apply(event);
  }

  async touch({ deviceId, deviceName = "", appVersion = "" }) {
    if (typeof deviceId !== "string" || !deviceId) throw new TypeError("deviceId is required");
    const event = {
      type: "heartbeat",
      deviceId,
      deviceName: String(deviceName),
      appVersion: String(appVersion),
      at: this.clock(),
    };
    await this.events.append(event);
    this.apply(event);
    return this.snapshot(deviceId);
  }

  async recordCompletion(deviceId, result) {
    if (typeof deviceId !== "string" || !deviceId) throw new TypeError("deviceId is required");
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new TypeError("completion result must be an object");
    }
    const event = {
      type: "completion",
      deviceId,
      result: { ...result },
      at: this.clock(),
    };
    await this.events.append(event);
    this.apply(event);
    return this.snapshot(deviceId);
  }

  list() {
    return [...this.devices.keys()]
      .map((deviceId) => this.snapshot(deviceId))
      .sort((left, right) => right.lastSeenAt - left.lastSeenAt);
  }

  apply(event) {
    const current = this.devices.get(event.deviceId) ?? {
      deviceId: event.deviceId,
      deviceName: "",
      appVersion: "",
      lastSeenAt: 0,
      lastResult: null,
    };
    if (event.type === "heartbeat") {
      current.deviceName = event.deviceName;
      current.appVersion = event.appVersion;
      current.lastSeenAt = event.at;
    } else {
      current.lastResult = { ...event.result, completedAt: event.at };
    }
    this.devices.set(event.deviceId, current);
  }

  snapshot(deviceId) {
    const device = this.devices.get(deviceId);
    if (!device) return null;
    return {
      ...device,
      lastResult: device.lastResult ? { ...device.lastResult } : null,
    };
  }
}
