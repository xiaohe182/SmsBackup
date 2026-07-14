import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

export class TextSmsStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.recordIds = new Set();
    this.writeQueue = Promise.resolve();
  }

  async initialize() {
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, "", "utf8");

    const content = await readFile(this.filePath, "utf8");
    for (const line of content.split(/\r?\n/u)) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line);
        if (typeof record.recordId === "string" && record.recordId) {
          this.recordIds.add(record.recordId);
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
      return true;
    });

    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }
}
