import { randomUUID } from "node:crypto";

import { JsonlEventStore } from "./jsonl-store.js";

function isValidRequestEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return false;
  if (event.type !== "created" && event.type !== "completed") return false;
  if (typeof event.deviceId !== "string" || !event.deviceId) return false;
  if (typeof event.requestId !== "string" || !event.requestId) return false;
  if (!Number.isSafeInteger(event.at) || event.at < 0) return false;
  if (event.type === "created") {
    return Number.isSafeInteger(event.windowStart) &&
      Number.isSafeInteger(event.windowEnd) &&
      event.windowStart >= 0 &&
      event.windowEnd >= event.windowStart &&
      Number.isInteger(event.lookbackHours) &&
      event.lookbackHours >= 1 &&
      typeof event.wifiOnly === "boolean" &&
      (event.source === "manual" || event.source === "automatic" || event.source === "app");
  }
  return event.result && typeof event.result === "object" && !Array.isArray(event.result);
}

export class SyncRequestStore {
  constructor(filePath, { clock = Date.now, createId = randomUUID } = {}) {
    this.clock = clock;
    this.createId = createId;
    this.events = new JsonlEventStore(filePath, isValidRequestEvent);
    this.requests = new Map();
  }

  async initialize() {
    await this.events.initialize();
    this.requests.clear();
    for (const event of this.events.events()) this.apply(event);
  }

  async create(deviceId, settings, source = "manual") {
    this.validateDeviceAndSettings(deviceId, settings);
    const pending = this.pendingFor(deviceId);
    if (pending) return pending;

    const windowEnd = this.clock();
    const lookbackMilliseconds = settings.mediaLookbackHours * 60 * 60 * 1000;
    const event = {
      type: "created",
      requestId: this.createId(),
      deviceId,
      source,
      lookbackHours: settings.mediaLookbackHours,
      windowStart: Math.max(0, windowEnd - lookbackMilliseconds),
      windowEnd,
      wifiOnly: settings.wifiOnly,
      at: windowEnd,
    };
    if (!isValidRequestEvent(event)) throw new TypeError("invalid sync request");
    await this.events.append(event);
    this.apply(event);
    return this.snapshot(event.requestId);
  }

  async next(deviceId, settings) {
    this.validateDeviceAndSettings(deviceId, settings);
    const pending = this.pendingFor(deviceId);
    if (pending) return pending;
    if (!settings.autoSyncEnabled) return null;

    const latest = this.latestFor(deviceId);
    const anchor = latest?.completedAt ?? latest?.createdAt ?? 0;
    const interval = settings.autoSyncIntervalMinutes * 60 * 1000;
    if (latest && this.clock() - anchor < interval) return null;
    return this.create(deviceId, settings, "automatic");
  }

  async complete(deviceId, requestId, result) {
    const request = this.requests.get(requestId);
    if (!request || request.deviceId !== deviceId) throw new Error("sync request not found");
    if (request.completedAt !== null) return this.snapshot(requestId);
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new TypeError("completion result must be an object");
    }
    const event = {
      type: "completed",
      requestId,
      deviceId,
      result: { ...result },
      at: this.clock(),
    };
    await this.events.append(event);
    this.apply(event);
    return this.snapshot(requestId);
  }

  list(deviceId = "") {
    return [...this.requests.values()]
      .filter((request) => !deviceId || request.deviceId === deviceId)
      .sort((left, right) => right.createdAt - left.createdAt)
      .map((request) => this.snapshot(request.id));
  }

  apply(event) {
    if (event.type === "created") {
      this.requests.set(event.requestId, {
        id: event.requestId,
        deviceId: event.deviceId,
        source: event.source,
        lookbackHours: event.lookbackHours,
        windowStart: event.windowStart,
        windowEnd: event.windowEnd,
        wifiOnly: event.wifiOnly,
        status: "pending",
        createdAt: event.at,
        completedAt: null,
        result: null,
      });
      return;
    }
    const request = this.requests.get(event.requestId);
    if (!request) return;
    request.status = typeof event.result.status === "string" ? event.result.status : "completed";
    request.completedAt = event.at;
    request.result = { ...event.result };
  }

  pendingFor(deviceId) {
    const request = [...this.requests.values()]
      .filter((item) => item.deviceId === deviceId && item.completedAt === null)
      .sort((left, right) => left.createdAt - right.createdAt)[0];
    return request ? this.snapshot(request.id) : null;
  }

  latestFor(deviceId) {
    return [...this.requests.values()]
      .filter((item) => item.deviceId === deviceId)
      .sort((left, right) => right.createdAt - left.createdAt)[0] ?? null;
  }

  snapshot(requestId) {
    const request = this.requests.get(requestId);
    if (!request) return null;
    return {
      ...request,
      result: request.result ? { ...request.result } : null,
    };
  }

  validateDeviceAndSettings(deviceId, settings) {
    if (typeof deviceId !== "string" || !deviceId) throw new TypeError("deviceId is required");
    if (!settings || !Number.isInteger(settings.mediaLookbackHours)) {
      throw new TypeError("valid settings are required");
    }
    if (!Number.isInteger(settings.autoSyncIntervalMinutes) ||
      typeof settings.autoSyncEnabled !== "boolean" ||
      typeof settings.wifiOnly !== "boolean") {
      throw new TypeError("valid settings are required");
    }
  }
}
