import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";

import { TextSmsStore } from "./sms-store.js";

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
const REQUIRED_STRING_FIELDS = [
  "recordId",
  "deviceId",
  "deviceName",
  "sourceId",
  "sender",
  "body",
];

class BodyTooLargeError extends Error {}

function sendJson(response, statusCode, value) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

function readRequestBody(request, maxBodyBytes) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let tooLarge = false;

    request.on("data", (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBodyBytes) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    request.on("end", () => {
      if (tooLarge) {
        reject(new BodyTooLargeError("request body is too large"));
      } else {
        resolveBody(Buffer.concat(chunks).toString("utf8"));
      }
    });
    request.on("aborted", () => reject(new Error("request aborted")));
    request.on("error", reject);
  });
}

function isValidSmsRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (!REQUIRED_STRING_FIELDS.every((field) => typeof value[field] === "string")) {
    return false;
  }
  if (!value.recordId || !Number.isFinite(value.receivedAt)) return false;
  if (value.direction !== "inbox" && value.direction !== "sent") return false;
  return value.simSubscriptionId === null || Number.isInteger(value.simSubscriptionId);
}

export async function createSmsServer({
  dataFile = join(dirname(fileURLToPath(import.meta.url)), "data", "sms-records.txt"),
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
} = {}) {
  if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 1) {
    throw new TypeError("maxBodyBytes must be a positive integer");
  }

  const store = new TextSmsStore(resolve(dataFile));
  await store.initialize();

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");

      if (request.method === "GET" && url.pathname === "/api/health") {
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method !== "POST" || url.pathname !== "/api/sms") {
        sendJson(response, 404, { ok: false, error: "not_found" });
        return;
      }

      const contentType = request.headers["content-type"] ?? "";
      if (!contentType.toLowerCase().startsWith("application/json")) {
        sendJson(response, 400, { ok: false, error: "content_type_must_be_json" });
        return;
      }

      const rawBody = await readRequestBody(request, maxBodyBytes);
      let record;
      try {
        record = JSON.parse(rawBody);
      } catch {
        sendJson(response, 400, { ok: false, error: "invalid_json" });
        return;
      }

      if (!isValidSmsRecord(record)) {
        sendJson(response, 400, { ok: false, error: "invalid_sms_record" });
        return;
      }

      const idempotencyKey = request.headers["idempotency-key"];
      if (typeof idempotencyKey === "string" && idempotencyKey !== record.recordId) {
        sendJson(response, 400, { ok: false, error: "idempotency_key_mismatch" });
        return;
      }

      const written = await store.append({
        ...record,
        storedAt: new Date().toISOString(),
      });
      sendJson(response, 200, { ok: true, duplicate: !written });
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        sendJson(response, 413, { ok: false, error: "request_body_too_large" });
        return;
      }
      sendJson(response, 500, { ok: false, error: "internal_server_error" });
    }
  });
}

async function startFromCommandLine() {
  const host = process.env.HOST || "0.0.0.0";
  const port = Number.parseInt(process.env.PORT || "8787", 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("PORT must be an integer between 0 and 65535");
  }

  const dataFile = process.env.SMS_DATA_FILE || undefined;
  const server = await createSmsServer({ dataFile });
  server.listen(port, host, () => {
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : port;
    console.log(`SmsBackup server listening on http://${host}:${actualPort}`);
    console.log(`SMS records file: ${resolve(dataFile || join(dirname(fileURLToPath(import.meta.url)), "data", "sms-records.txt"))}`);
  });
}

const entryFile = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (entryFile === import.meta.url) {
  startFromCommandLine().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
