import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm, stat, truncate } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

import { JsonlEventStore } from "./jsonl-store.js";
import {
  extensionForMimeType,
  isSafeDeviceId,
  isSafeMediaId,
  isValidMediaManifestItem,
  isValidStoredMediaRecord,
} from "./media-record.js";

export class MediaOffsetMismatchError extends Error {
  constructor(expectedOffset) {
    super(`media offset mismatch; expected ${expectedOffset}`);
    this.name = "MediaOffsetMismatchError";
    this.expectedOffset = expectedOffset;
  }
}

export class MediaSizeError extends Error {}

async function fileSize(filePath) {
  try {
    return (await stat(filePath)).size;
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }
}

function dateFolder(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function safeRelativePath(item) {
  return [
    item.deviceId,
    dateFolder(item.takenAt),
    `${item.mediaId}${extensionForMimeType(item.mimeType)}`,
  ].join("/");
}

export function parseByteRange(header, size) {
  if (!Number.isSafeInteger(size) || size < 1) return null;
  if (header === null || header === undefined || header === "") {
    return { start: 0, end: size - 1, partial: false };
  }
  const match = /^bytes=(\d*)-(\d*)$/u.exec(String(header));
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const suffix = Number.parseInt(match[2], 10);
    if (!Number.isSafeInteger(suffix) || suffix < 1) return null;
    return {
      start: Math.max(0, size - suffix),
      end: size - 1,
      partial: true,
    };
  }
  const start = Number.parseInt(match[1], 10);
  const requestedEnd = match[2] ? Number.parseInt(match[2], 10) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd)) return null;
  if (start < 0 || requestedEnd < start || start >= size) return null;
  return { start, end: Math.min(requestedEnd, size - 1), partial: true };
}

export class MediaStore {
  constructor({
    recordsFile,
    mediaDirectory,
    maxMediaBytes = 10 * 1024 * 1024 * 1024,
    clock = Date.now,
  }) {
    if (!Number.isSafeInteger(maxMediaBytes) || maxMediaBytes < 1) {
      throw new TypeError("maxMediaBytes must be a positive safe integer");
    }
    this.recordsFile = recordsFile;
    this.mediaDirectory = resolve(mediaDirectory);
    this.maxMediaBytes = maxMediaBytes;
    this.clock = clock;
    this.events = new JsonlEventStore(recordsFile, isValidStoredMediaRecord);
    this.completed = new Map();
    this.pending = new Map();
    this.writeQueues = new Map();
  }

  async initialize() {
    await mkdir(this.mediaDirectory, { recursive: true });
    await this.events.initialize();
    this.completed.clear();
    this.pending.clear();
    for (const record of this.events.events()) {
      if (!this.completed.has(record.mediaId)) this.completed.set(record.mediaId, record);
    }
  }

  async registerManifest({ command, deviceId, items }) {
    if (!command || !Number.isSafeInteger(command.windowStart) ||
      !Number.isSafeInteger(command.windowEnd) || command.windowEnd < command.windowStart) {
      throw new TypeError("valid sync command is required");
    }
    if (!Array.isArray(items) || items.length > 100) {
      throw new RangeError("manifest items must contain at most 100 records");
    }

    const missing = [];
    const existing = [];
    const rejected = [];
    for (const rawItem of items) {
      const mediaId = typeof rawItem?.mediaId === "string" ? rawItem.mediaId : "";
      if (!isSafeDeviceId(deviceId) || command.deviceId !== deviceId ||
        !isValidMediaManifestItem(rawItem) || rawItem.deviceId !== deviceId) {
        rejected.push({ mediaId, error: "invalid_media_record" });
        continue;
      }
      if (rawItem.takenAt < command.windowStart || rawItem.takenAt > command.windowEnd) {
        rejected.push({ mediaId, error: "outside_time_window" });
        continue;
      }
      if (rawItem.size > this.maxMediaBytes) {
        rejected.push({ mediaId, error: "media_too_large" });
        continue;
      }

      const completed = this.completed.get(mediaId);
      if (completed) {
        if (completed.deviceId === deviceId && completed.size === rawItem.size) {
          // TXT 索引不能代表二进制文件一定仍存在；缺失或损坏时要求手机重传。
          const storedBytes = await fileSize(this.absoluteRecordPath(completed));
          if (storedBytes === completed.size) {
            existing.push(mediaId);
            continue;
          }
          this.completed.delete(mediaId);
          await rm(this.absoluteRecordPath(completed), { force: true });
        } else {
          rejected.push({ mediaId, error: "media_id_conflict" });
          continue;
        }
      }

      const item = { ...rawItem, commandId: String(command.id ?? "") };
      const paths = this.pathsFor(item);
      const finalBytes = await fileSize(paths.finalPath);
      if (finalBytes === item.size) {
        const record = await this.finalizeExistingFile(item, paths.relativePath);
        existing.push(record.mediaId);
        continue;
      }
      // 不完整的正式文件不能覆盖新的分块结果，先安全移除再恢复上传。
      await rm(paths.finalPath, { force: true });
      let partBytes = await fileSize(paths.partPath);
      if (partBytes === item.size) {
        await rename(paths.partPath, paths.finalPath);
        const record = await this.finalizeExistingFile(item, paths.relativePath);
        existing.push(record.mediaId);
        continue;
      }
      if (partBytes > item.size) {
        await truncate(paths.partPath, 0);
        partBytes = 0;
      }
      this.pending.set(mediaId, item);
      missing.push({
        mediaId,
        offset: partBytes,
        size: item.size,
      });
    }
    return { missing, existing, rejected };
  }

  writeChunk(argumentsValue) {
    const mediaId = argumentsValue.mediaId;
    const previous = this.writeQueues.get(mediaId) ?? Promise.resolve();
    const operation = previous.then(() => this.writeChunkSerial(argumentsValue));
    this.writeQueues.set(mediaId, operation.catch(() => undefined));
    return operation;
  }

  async writeChunkSerial({ deviceId, mediaId, start, end, total, stream }) {
    if (!isSafeDeviceId(deviceId) || !isSafeMediaId(mediaId)) {
      throw new TypeError("invalid media identity");
    }
    const alreadyCompleted = this.completed.get(mediaId);
    if (alreadyCompleted) {
      return {
        complete: true,
        duplicate: true,
        offset: alreadyCompleted.size,
        path: this.absoluteRecordPath(alreadyCompleted),
        record: { ...alreadyCompleted },
      };
    }
    const item = this.pending.get(mediaId);
    if (!item || item.deviceId !== deviceId) throw new Error("media manifest not registered");
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
      !Number.isSafeInteger(total) || start < 0 || end < start || total !== item.size ||
      end >= total) {
      throw new MediaSizeError("invalid media content range");
    }

    const paths = this.pathsFor(item);
    await mkdir(dirname(paths.partPath), { recursive: true });
    const expectedOffset = await fileSize(paths.partPath);
    if (expectedOffset !== start) throw new MediaOffsetMismatchError(expectedOffset);

    const expectedBytes = end - start + 1;
    const handle = await open(paths.partPath, start === 0 ? "w" : "r+");
    let receivedBytes = 0;
    try {
      for await (const chunk of stream) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (receivedBytes + buffer.length > expectedBytes) {
          throw new MediaSizeError("media chunk exceeds declared range");
        }
        await handle.write(buffer, 0, buffer.length, start + receivedBytes);
        receivedBytes += buffer.length;
      }
    } finally {
      await handle.close();
    }
    if (receivedBytes !== expectedBytes) {
      throw new MediaSizeError("media chunk is shorter than declared range");
    }

    const offset = end + 1;
    if (offset < total) return { complete: false, duplicate: false, offset };

    await rename(paths.partPath, paths.finalPath);
    const record = await this.appendCompleted(item, paths.relativePath);
    this.pending.delete(mediaId);
    return {
      complete: true,
      duplicate: false,
      offset: total,
      path: paths.finalPath,
      record,
    };
  }

  query({ limit = 50, offset = 0, deviceId = "", mediaType = "" } = {}) {
    const records = [...this.completed.values()]
      .filter((record) => (
        (!deviceId || record.deviceId === deviceId) &&
        (!mediaType || record.mediaType === mediaType)
      ))
      .sort((left, right) => right.takenAt - left.takenAt || right.mediaId.localeCompare(left.mediaId));
    return {
      items: records.slice(offset, offset + limit).map((record) => ({ ...record })),
      totalCount: records.length,
    };
  }

  openContent(mediaId, rangeHeader = null) {
    const record = this.completed.get(mediaId);
    if (!record) return null;
    const range = parseByteRange(rangeHeader, record.size);
    if (!range) return { record: { ...record }, range: null, stream: null };
    return {
      record: { ...record },
      range,
      stream: createReadStream(this.absoluteRecordPath(record), {
        start: range.start,
        end: range.end,
      }),
    };
  }

  pathsFor(item) {
    const relativePath = safeRelativePath(item);
    const finalPath = resolve(this.mediaDirectory, ...relativePath.split("/"));
    if (finalPath !== this.mediaDirectory && !finalPath.startsWith(`${this.mediaDirectory}${sep}`)) {
      throw new TypeError("unsafe media path");
    }
    return { relativePath, finalPath, partPath: `${finalPath}.part` };
  }

  absoluteRecordPath(record) {
    const filePath = resolve(this.mediaDirectory, ...record.storagePath.split("/"));
    if (!filePath.startsWith(`${this.mediaDirectory}${sep}`)) throw new TypeError("unsafe stored path");
    return filePath;
  }

  async finalizeExistingFile(item, relativePath) {
    const record = await this.appendCompleted(item, relativePath);
    this.pending.delete(item.mediaId);
    return record;
  }

  async appendCompleted(item, relativePath) {
    const existing = this.completed.get(item.mediaId);
    if (existing) return { ...existing };
    const record = {
      ...item,
      storagePath: relativePath,
      storedAt: new Date(this.clock()).toISOString(),
    };
    await this.events.append(record);
    this.completed.set(record.mediaId, record);
    return { ...record };
  }
}
