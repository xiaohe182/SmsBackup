import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * 最小化的 JSON Lines 事件存储。写入严格串行，启动回放时跳过损坏行，
 * 从而保证单个异常行不会导致整个短信/媒体服务无法启动。
 */
export class JsonlEventStore {
  constructor(filePath, validateEvent = () => true) {
    this.filePath = filePath;
    this.validateEvent = validateEvent;
    this.replayedEvents = [];
    this.writeQueue = Promise.resolve();
  }

  async initialize() {
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, "", "utf8");
    this.replayedEvents.length = 0;

    const content = await readFile(this.filePath, "utf8");
    for (const line of content.split(/\r?\n/u)) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (this.validateEvent(event)) this.replayedEvents.push(event);
      } catch {
        // TXT 是事实源；损坏行留在原文件中供人工排查，但不进入内存索引。
      }
    }
  }

  append(event) {
    if (!this.validateEvent(event)) {
      return Promise.reject(new TypeError("invalid JSONL event"));
    }
    const operation = this.writeQueue.then(async () => {
      await appendFile(this.filePath, `${JSON.stringify(event)}\n`, "utf8");
      this.replayedEvents.push(event);
      return event;
    });
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }

  events() {
    return this.replayedEvents.map((event) => ({ ...event }));
  }
}
