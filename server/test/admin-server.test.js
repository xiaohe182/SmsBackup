import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createSmsServer } from "../server.js";

const APP_TOKEN = "app-token";
const ADMIN_PASSWORD = "admin-password";
const NOW = 2_000_000_000_000;

async function startServer(t) {
  const directory = await mkdtemp(join(tmpdir(), "sms-admin-server-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const server = await createSmsServer({
    dataDirectory: directory,
    accessToken: APP_TOKEN,
    adminPassword: ADMIN_PASSWORD,
    maxMediaBytes: 1024,
    clock: () => NOW,
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    directory,
  };
}

async function login(baseUrl, password = ADMIN_PASSWORD) {
  const response = await fetch(`${baseUrl}/api/admin/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  return {
    response,
    cookie: response.headers.get("set-cookie")?.split(";", 1)[0] ?? "",
  };
}

function adminHeaders(cookie, extra = {}) {
  return { cookie, ...extra };
}

function appHeaders(extra = {}) {
  return { authorization: `Bearer ${APP_TOKEN}`, ...extra };
}

async function registerDevice(baseUrl, overrides = {}) {
  return fetch(
    `${baseUrl}/api/device/device-1/commands/next?deviceName=${encodeURIComponent("家人手机")}&appVersion=4.87`,
    { headers: appHeaders(), ...overrides },
  );
}

test("root opens a self-contained admin page and login uses an HttpOnly cookie", async (t) => {
  const app = await startServer(t);
  const root = await fetch(`${app.baseUrl}/`, { redirect: "manual" });
  const page = await fetch(`${app.baseUrl}/admin`);
  const css = await fetch(`${app.baseUrl}/admin.css`);
  const script = await fetch(`${app.baseUrl}/admin.js`);
  const wrong = await login(app.baseUrl, "wrong-password");
  const correct = await login(app.baseUrl);

  assert.equal(root.status, 302);
  assert.equal(root.headers.get("location"), "/admin");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /SmsBackup 服务器控制台/u);
  assert.match(await css.text(), /--primary/u);
  assert.match(await script.text(), /mediaLookbackHours/u);
  assert.equal(wrong.response.status, 401);
  assert.equal(correct.response.status, 200);
  assert.match(correct.response.headers.get("set-cookie"), /HttpOnly/u);
  assert.match(correct.response.headers.get("set-cookie"), /SameSite=Strict/u);
  assert.ok(correct.cookie.startsWith("sms_admin_session="));
});

test("admin changes dynamic hours and creates a manual command for a registered device", async (t) => {
  const app = await startServer(t);
  const { cookie } = await login(app.baseUrl);

  const disableAutomatic = await fetch(`${app.baseUrl}/api/admin/settings`, {
    method: "PUT",
    headers: adminHeaders(cookie, { "content-type": "application/json" }),
    body: JSON.stringify({ autoSyncEnabled: false }),
  });
  assert.equal(disableAutomatic.status, 200);
  assert.equal((await registerDevice(app.baseUrl)).status, 204);

  const changed = await fetch(`${app.baseUrl}/api/admin/settings`, {
    method: "PUT",
    headers: adminHeaders(cookie, { "content-type": "application/json" }),
    body: JSON.stringify({ mediaLookbackHours: 24, autoSyncEnabled: true }),
  });
  const created = await fetch(`${app.baseUrl}/api/admin/devices/device-1/sync`, {
    method: "POST",
    headers: adminHeaders(cookie),
  });
  const command = await created.json();

  assert.equal(changed.status, 200);
  assert.equal((await changed.json()).mediaLookbackHours, 24);
  assert.equal(created.status, 201);
  assert.equal(command.source, "manual");
  assert.equal(command.lookbackHours, 24);
  assert.equal(command.windowEnd, NOW);
  assert.equal(command.windowStart, NOW - 24 * 60 * 60 * 1000);

  const polled = await registerDevice(app.baseUrl);
  assert.equal(polled.status, 200);
  assert.equal((await polled.json()).id, command.id);
});

test("automatic command completion updates the device list", async (t) => {
  const app = await startServer(t);
  const { cookie } = await login(app.baseUrl);
  const commandResponse = await registerDevice(app.baseUrl);
  const command = await commandResponse.json();

  assert.equal(commandResponse.status, 200);
  assert.equal(command.source, "automatic");

  const completion = await fetch(
    `${app.baseUrl}/api/device/device-1/commands/${command.id}/complete`,
    {
      method: "POST",
      headers: appHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({
        status: "partial",
        smsQueued: 8,
        imageUploaded: 2,
        videoUploaded: 1,
        mediaBytesUploaded: 4096,
        error: "部分媒体权限",
      }),
    },
  );
  const devices = await fetch(`${app.baseUrl}/api/admin/devices`, {
    headers: adminHeaders(cookie),
  });
  const body = await devices.json();

  assert.equal(completion.status, 200);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].deviceName, "家人手机");
  assert.equal(body.items[0].lastResult.videoUploaded, 1);
});

test("media APIs compare manifests, resume Content-Range, and serve authenticated ranges", async (t) => {
  const app = await startServer(t);
  const { cookie } = await login(app.baseUrl);
  const command = await (await registerDevice(app.baseUrl)).json();
  const mediaId = "a".repeat(64);
  const item = {
    mediaId,
    deviceId: "device-1",
    mediaType: "video",
    volumeName: "external_primary",
    sourceId: "42",
    albumId: "camera",
    albumName: "相机",
    displayName: "视频.mp4",
    takenAt: command.windowEnd - 1000,
    modifiedAt: command.windowEnd - 500,
    duration: 9000,
    mimeType: "video/mp4",
    size: 6,
  };

  const manifest = await fetch(`${app.baseUrl}/api/media/manifest`, {
    method: "POST",
    headers: appHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ requestId: command.id, deviceId: "device-1", items: [item] }),
  });
  assert.equal(manifest.status, 200);
  assert.deepEqual((await manifest.json()).missing, [{ mediaId, offset: 0, size: 6 }]);

  const first = await fetch(`${app.baseUrl}/api/media/${mediaId}/content`, {
    method: "PUT",
    headers: appHeaders({
      "content-type": "application/octet-stream",
      "content-range": "bytes 0-2/6",
      "x-device-id": "device-1",
    }),
    body: Buffer.from("abc"),
  });
  const second = await fetch(`${app.baseUrl}/api/media/${mediaId}/content`, {
    method: "PUT",
    headers: appHeaders({
      "content-type": "application/octet-stream",
      "content-range": "bytes 3-5/6",
      "x-device-id": "device-1",
    }),
    body: Buffer.from("def"),
  });
  assert.equal(first.status, 202);
  assert.equal((await first.json()).offset, 3);
  assert.equal(second.status, 200);

  const listing = await fetch(`${app.baseUrl}/api/media?deviceId=device-1`, {
    headers: adminHeaders(cookie),
  });
  const ranged = await fetch(`${app.baseUrl}/api/media/${mediaId}/content`, {
    headers: adminHeaders(cookie, { range: "bytes=2-4" }),
  });
  assert.equal(listing.status, 200);
  assert.equal((await listing.json()).items[0].displayName, "视频.mp4");
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get("content-range"), "bytes 2-4/6");
  assert.equal(await ranged.text(), "cde");
});

test("admin and app routes reject missing credentials", async (t) => {
  const app = await startServer(t);
  const admin = await fetch(`${app.baseUrl}/api/admin/settings`);
  const appRoute = await fetch(`${app.baseUrl}/api/device/device-1/commands/next`);
  const media = await fetch(`${app.baseUrl}/api/media`);

  assert.equal(admin.status, 401);
  assert.equal(appRoute.status, 401);
  assert.equal(media.status, 401);
});
