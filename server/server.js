import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";

import { AdminSessionManager } from "./lib/admin-session.js";
import { DeviceStore } from "./lib/device-store.js";
import {
  MediaOffsetMismatchError,
  MediaSizeError,
  MediaStore,
} from "./lib/media-store.js";
import { isSafeDeviceId, isSafeMediaId } from "./lib/media-record.js";
import { SettingsStore } from "./lib/settings-store.js";
import { SyncRequestStore } from "./lib/sync-request-store.js";
import { formatSmsMarkdown } from "./markdown-export.js";
import { isValidSmsRecord } from "./sms-record.js";
import { TextSmsStore } from "./sms-store.js";

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_MAX_MEDIA_BYTES = 10 * 1024 * 1024 * 1024;
const DEFAULT_ACCESS_TOKEN = "88888888";

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

function sendText(response, statusCode, body, contentType) {
  response.writeHead(statusCode, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

function sendMarkdown(response, markdown) {
  response.writeHead(200, {
    "content-type": "text/markdown; charset=utf-8",
    "content-disposition": 'attachment; filename="sms-backup.md"',
    "content-length": Buffer.byteLength(markdown),
    "cache-control": "no-store",
  });
  response.end(markdown);
}

function hasValidBearerToken(request, accessToken) {
  return request.headers.authorization === `Bearer ${accessToken}`;
}

function parseUnsignedInteger(value, fallback) {
  if (value === null) return fallback;
  if (!/^\d+$/u.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseContentRange(header) {
  if (typeof header !== "string") return null;
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/u.exec(header);
  if (!match) return null;
  const [start, end, total] = match.slice(1).map((value) => Number.parseInt(value, 10));
  if (![start, end, total].every(Number.isSafeInteger) || start < 0 || end < start || end >= total) {
    return null;
  }
  return { start, end, total };
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
      } else if (!tooLarge) {
        chunks.push(chunk);
      }
    });
    request.on("end", () => {
      if (tooLarge) reject(new BodyTooLargeError("request body is too large"));
      else resolveBody(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("aborted", () => reject(new Error("request aborted")));
    request.on("error", reject);
  });
}

async function readJson(request, maxBodyBytes) {
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    const error = new TypeError("content_type_must_be_json");
    error.code = "content_type_must_be_json";
    throw error;
  }
  try {
    return JSON.parse(await readRequestBody(request, maxBodyBytes));
  } catch (error) {
    if (error instanceof BodyTooLargeError) throw error;
    const invalid = new TypeError("invalid_json");
    invalid.code = "invalid_json";
    throw invalid;
  }
}

function routeIdentifier(pathname, pattern) {
  const match = pattern.exec(pathname);
  if (!match) return null;
  try {
    return match.slice(1).map(decodeURIComponent);
  } catch {
    return null;
  }
}

async function serveStatic(response, fileName, contentType) {
  try {
    const body = await readFile(join(MODULE_DIRECTORY, "public", fileName));
    response.writeHead(200, {
      "content-type": contentType,
      "content-length": body.length,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    response.end(body);
  } catch {
    sendJson(response, 404, { ok: false, error: "not_found" });
  }
}

function sendUnauthorized(response, scheme = "Bearer") {
  response.setHeader("www-authenticate", scheme);
  sendJson(response, 401, { ok: false, error: "unauthorized" });
}

export async function createSmsServer({
  dataFile,
  dataDirectory,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
  maxMediaBytes = Number.parseInt(process.env.SMS_MEDIA_MAX_BYTES || String(DEFAULT_MAX_MEDIA_BYTES), 10),
  accessToken = process.env.SMS_BACKUP_TOKEN || DEFAULT_ACCESS_TOKEN,
  adminPassword = process.env.SMS_ADMIN_PASSWORD || accessToken,
  clock = Date.now,
} = {}) {
  if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 1) {
    throw new TypeError("maxBodyBytes must be a positive integer");
  }
  if (!Number.isSafeInteger(maxMediaBytes) || maxMediaBytes < 1) {
    throw new TypeError("maxMediaBytes must be a positive safe integer");
  }
  if (typeof accessToken !== "string" || !accessToken) {
    throw new TypeError("accessToken must be a non-empty string");
  }

  const resolvedDataFile = resolve(dataFile ?? join(dataDirectory ?? join(MODULE_DIRECTORY, "data"), "sms-records.txt"));
  const resolvedDataDirectory = resolve(dataDirectory ?? dirname(resolvedDataFile));
  const smsStore = new TextSmsStore(resolvedDataFile);
  const settingsStore = new SettingsStore(join(resolvedDataDirectory, "settings.txt"), { clock });
  const deviceStore = new DeviceStore(join(resolvedDataDirectory, "devices.txt"), { clock });
  const requestStore = new SyncRequestStore(join(resolvedDataDirectory, "sync-requests.txt"), { clock });
  const mediaStore = new MediaStore({
    recordsFile: join(resolvedDataDirectory, "media-records.txt"),
    mediaDirectory: join(resolvedDataDirectory, "media"),
    maxMediaBytes,
    clock,
  });
  const sessions = new AdminSessionManager(adminPassword, { clock });

  await Promise.all([
    smsStore.initialize(),
    settingsStore.initialize(),
    deviceStore.initialize(),
    requestStore.initialize(),
    mediaStore.initialize(),
  ]);

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const pathname = url.pathname;
      const bearerAuthorized = hasValidBearerToken(request, accessToken);
      const adminAuthorized = sessions.authorize(request);

      if (request.method === "GET" && pathname === "/") {
        response.writeHead(302, { location: "/admin", "cache-control": "no-store" });
        response.end();
        return;
      }
      if (request.method === "GET" && pathname === "/admin") {
        await serveStatic(response, "admin.html", "text/html; charset=utf-8");
        return;
      }
      if (request.method === "GET" && pathname === "/admin.css") {
        await serveStatic(response, "admin.css", "text/css; charset=utf-8");
        return;
      }
      if (request.method === "GET" && pathname === "/admin.js") {
        await serveStatic(response, "admin.js", "text/javascript; charset=utf-8");
        return;
      }
      if (request.method === "GET" && pathname === "/api/health") {
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === "POST" && pathname === "/api/admin/session") {
        const body = await readJson(request, maxBodyBytes);
        const session = sessions.create(body.password);
        if (!session) {
          sendUnauthorized(response, "Session");
          return;
        }
        response.setHeader("set-cookie", sessions.cookie(session.token));
        sendJson(response, 200, { ok: true, expiresAt: session.expiresAt });
        return;
      }
      if (request.method === "DELETE" && pathname === "/api/admin/session") {
        sessions.delete(request);
        response.setHeader("set-cookie", sessions.expiredCookie());
        sendJson(response, 200, { ok: true });
        return;
      }

      if (pathname.startsWith("/api/admin/")) {
        if (!adminAuthorized) {
          sendUnauthorized(response, "Session");
          return;
        }
        if (request.method === "GET" && pathname === "/api/admin/settings") {
          const deviceId = url.searchParams.get("deviceId") || null;
          sendJson(response, 200, settingsStore.get(deviceId));
          return;
        }
        if (request.method === "PUT" && pathname === "/api/admin/settings") {
          const body = await readJson(request, maxBodyBytes);
          const { deviceId = null, ...patch } = body;
          sendJson(response, 200, await settingsStore.update(patch, deviceId));
          return;
        }
        if (request.method === "GET" && pathname === "/api/admin/devices") {
          sendJson(response, 200, { items: deviceStore.list() });
          return;
        }
        const manualRoute = routeIdentifier(
          pathname,
          /^\/api\/admin\/devices\/([^/]+)\/sync$/u,
        );
        if (request.method === "POST" && manualRoute) {
          const [deviceId] = manualRoute;
          if (!isSafeDeviceId(deviceId)) {
            sendJson(response, 400, { ok: false, error: "invalid_device_id" });
            return;
          }
          const created = await requestStore.create(
            deviceId,
            settingsStore.get(deviceId),
            "manual",
          );
          sendJson(response, 201, created);
          return;
        }
        sendJson(response, 404, { ok: false, error: "not_found" });
        return;
      }

      const nextRoute = routeIdentifier(
        pathname,
        /^\/api\/device\/([^/]+)\/commands\/next$/u,
      );
      if (request.method === "GET" && nextRoute) {
        if (!bearerAuthorized) {
          sendUnauthorized(response);
          return;
        }
        const [deviceId] = nextRoute;
        if (!isSafeDeviceId(deviceId)) {
          sendJson(response, 400, { ok: false, error: "invalid_device_id" });
          return;
        }
        await deviceStore.touch({
          deviceId,
          deviceName: url.searchParams.get("deviceName") ?? "",
          appVersion: url.searchParams.get("appVersion") ?? "",
        });
        const command = await requestStore.next(deviceId, settingsStore.get(deviceId));
        if (!command) {
          response.writeHead(204, { "cache-control": "no-store" });
          response.end();
        } else {
          sendJson(response, 200, command);
        }
        return;
      }

      const completionRoute = routeIdentifier(
        pathname,
        /^\/api\/device\/([^/]+)\/commands\/([^/]+)\/complete$/u,
      );
      if (request.method === "POST" && completionRoute) {
        if (!bearerAuthorized) {
          sendUnauthorized(response);
          return;
        }
        const [deviceId, requestId] = completionRoute;
        if (!isSafeDeviceId(deviceId)) {
          sendJson(response, 400, { ok: false, error: "invalid_device_id" });
          return;
        }
        const result = await readJson(request, maxBodyBytes);
        const completed = await requestStore.complete(deviceId, requestId, result);
        await deviceStore.recordCompletion(deviceId, { requestId, ...result });
        sendJson(response, 200, completed);
        return;
      }

      if (request.method === "POST" && pathname === "/api/media/manifest") {
        if (!bearerAuthorized) {
          sendUnauthorized(response);
          return;
        }
        const body = await readJson(request, maxBodyBytes);
        const command = requestStore.get(body.requestId);
        if (!command || command.deviceId !== body.deviceId || command.completedAt !== null) {
          sendJson(response, 404, { ok: false, error: "sync_request_not_found" });
          return;
        }
        sendJson(response, 200, await mediaStore.registerManifest({
          command,
          deviceId: body.deviceId,
          items: body.items,
        }));
        return;
      }

      const mediaContentRoute = routeIdentifier(
        pathname,
        /^\/api\/media\/([^/]+)\/content$/u,
      );
      if (request.method === "PUT" && mediaContentRoute) {
        if (!bearerAuthorized) {
          sendUnauthorized(response);
          return;
        }
        const [mediaId] = mediaContentRoute;
        const deviceId = request.headers["x-device-id"];
        const range = parseContentRange(request.headers["content-range"]);
        if (!isSafeMediaId(mediaId) || typeof deviceId !== "string" || !range) {
          sendJson(response, 400, { ok: false, error: "invalid_media_upload" });
          return;
        }
        const result = await mediaStore.writeChunk({
          deviceId,
          mediaId,
          ...range,
          stream: request,
        });
        sendJson(response, result.complete ? 200 : 202, {
          ok: true,
          complete: result.complete,
          duplicate: result.duplicate,
          offset: result.offset,
        });
        return;
      }

      if (request.method === "GET" && pathname === "/api/media") {
        if (!bearerAuthorized && !adminAuthorized) {
          sendUnauthorized(response);
          return;
        }
        const limit = parseUnsignedInteger(url.searchParams.get("limit"), 50);
        const offset = parseUnsignedInteger(url.searchParams.get("offset"), 0);
        const mediaType = url.searchParams.get("mediaType") ?? "";
        if (limit === null || limit < 1 || limit > 100 || offset === null ||
          (mediaType && mediaType !== "image" && mediaType !== "video")) {
          sendJson(response, 400, { ok: false, error: "invalid_media_query" });
          return;
        }
        const result = mediaStore.query({
          limit,
          offset,
          deviceId: url.searchParams.get("deviceId") ?? "",
          mediaType,
        });
        sendJson(response, 200, {
          ...result,
          limit,
          offset,
          hasMore: offset + result.items.length < result.totalCount,
        });
        return;
      }

      if (request.method === "GET" && mediaContentRoute) {
        if (!bearerAuthorized && !adminAuthorized) {
          sendUnauthorized(response);
          return;
        }
        const [mediaId] = mediaContentRoute;
        const content = mediaStore.openContent(mediaId, request.headers.range ?? null);
        if (!content) {
          sendJson(response, 404, { ok: false, error: "media_not_found" });
          return;
        }
        if (!content.range) {
          response.writeHead(416, { "content-range": `bytes */${content.record.size}` });
          response.end();
          return;
        }
        const { record, range, stream } = content;
        const length = range.end - range.start + 1;
        const headers = {
          "content-type": record.mimeType,
          "content-length": length,
          "accept-ranges": "bytes",
          "cache-control": "private, no-store",
          "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(record.displayName)}`,
        };
        if (range.partial) headers["content-range"] = `bytes ${range.start}-${range.end}/${record.size}`;
        response.writeHead(range.partial ? 206 : 200, headers);
        stream.on("error", () => response.destroy());
        stream.pipe(response);
        return;
      }

      const isSmsPost = request.method === "POST" && pathname === "/api/sms";
      const isSmsList = request.method === "GET" && pathname === "/api/sms";
      const isMarkdownExport = request.method === "GET" && pathname === "/api/sms/export.md";
      if (isSmsPost || isSmsList || isMarkdownExport) {
        if ((!bearerAuthorized && isSmsPost) ||
          (!bearerAuthorized && !adminAuthorized && !isSmsPost)) {
          sendUnauthorized(response);
          return;
        }
        if (isSmsList) {
          const limit = parseUnsignedInteger(url.searchParams.get("limit"), 50);
          const offset = parseUnsignedInteger(url.searchParams.get("offset"), 0);
          const direction = url.searchParams.get("direction") ?? "";
          if (limit === null || limit < 1 || limit > 100 || offset === null ||
            (direction && direction !== "inbox" && direction !== "sent")) {
            sendJson(response, 400, { ok: false, error: "invalid_sms_query" });
            return;
          }
          const result = smsStore.query({
            limit,
            offset,
            deviceId: url.searchParams.get("deviceId") ?? "",
            direction,
          });
          sendJson(response, 200, {
            items: result.items,
            offset,
            limit,
            totalCount: result.totalCount,
            hasMore: offset + result.items.length < result.totalCount,
          });
          return;
        }
        if (isMarkdownExport) {
          const archive = smsStore.query({ limit: Number.MAX_SAFE_INTEGER, offset: 0 });
          sendMarkdown(response, formatSmsMarkdown(archive.items));
          return;
        }

        const record = await readJson(request, maxBodyBytes);
        if (!isValidSmsRecord(record)) {
          sendJson(response, 400, { ok: false, error: "invalid_sms_record" });
          return;
        }
        const idempotencyKey = request.headers["idempotency-key"];
        if (typeof idempotencyKey === "string" && idempotencyKey !== record.recordId) {
          sendJson(response, 400, { ok: false, error: "idempotency_key_mismatch" });
          return;
        }
        const written = await smsStore.append({
          ...record,
          storedAt: new Date(clock()).toISOString(),
        });
        sendJson(response, 200, { ok: true, duplicate: !written });
        return;
      }

      sendJson(response, 404, { ok: false, error: "not_found" });
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        sendJson(response, 413, { ok: false, error: "request_body_too_large" });
        return;
      }
      if (error instanceof MediaOffsetMismatchError) {
        sendJson(response, 409, {
          ok: false,
          error: "media_offset_mismatch",
          expectedOffset: error.expectedOffset,
        });
        return;
      }
      if (error instanceof MediaSizeError) {
        sendJson(response, 400, { ok: false, error: "invalid_media_chunk" });
        return;
      }
      if (error instanceof TypeError || error instanceof RangeError) {
        sendJson(response, 400, {
          ok: false,
          error: error.code || "invalid_request",
          message: error.message,
        });
        return;
      }
      if (error?.message === "sync request not found") {
        sendJson(response, 404, { ok: false, error: "sync_request_not_found" });
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
    console.log(`Admin console: http://${host}:${actualPort}/admin`);
    console.log(`SMS records file: ${resolve(dataFile || join(MODULE_DIRECTORY, "data", "sms-records.txt"))}`);
  });
}

const entryFile = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (entryFile === import.meta.url) {
  startFromCommandLine().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
