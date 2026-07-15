import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

import { isValidSmsRecord } from "./sms-record.js";

export class TextSmsStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.recordIds = new Set();
    this.records = [];
    this.writeQueue = Promise.resolve();
  }

  async initialize() {
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, "", "utf8");

    this.recordIds.clear();
    this.records.length = 0;

    const content = await readFile(this.filePath, "utf8");
    for (const line of content.split(/\r?\n/u)) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line);
        if (isValidSmsRecord(record) && !this.recordIds.has(record.recordId)) {
          this.recordIds.add(record.recordId);
          this.records.push(record);
        }
      } catch {
        // Keep readable historical lines, but ignore malformed ones for indexing.
      }
    }
  }

  append(record) {
    const operation = this.writeQueue.then(async () => {
      if (this.recordIds.has(record.recordId)) {
        return false;
      }

      await appendFile(this.filePath, `${JSON.stringify(record)}\n`, "utf8");
      this.recordIds.add(record.recordId);
      this.records.push(record);
      return true;
    });

    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }

  query({ limit, offset, deviceId = "", direction = "" }) {
    const newestFirst = this.records
      .filter((record) => (
        (!deviceId || record.deviceId === deviceId) &&
        (!direction || record.direction === direction)
      ))
      .slice()
      .reverse();

    return {
      // 返回浅拷贝，避免路由层意外修改内存索引中的原始归档记录。
      items: newestFirst
        .slice(offset, offset + limit)
        .map((record) => ({ ...record })),
      totalCount: newestFirst.length,
    };
  }
}
