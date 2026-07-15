import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DeviceStore } from "../lib/device-store.js";
import { SettingsStore } from "../lib/settings-store.js";
import { SyncRequestStore } from "../lib/sync-request-store.js";

async function createTempDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), "sms-sync-control-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("settings use safe defaults and accept dynamic server-controlled hours", async (t) => {
  const directory = await createTempDirectory(t);
  const store = new SettingsStore(join(directory, "settings.txt"));
  await store.initialize();

  assert.deepEqual(store.get(), {
    mediaLookbackHours: 168,
    autoSyncEnabled: true,
    autoSyncIntervalMinutes: 15,
    wifiOnly: false,
  });

  const updated = await store.update({
    mediaLookbackHours: 24,
    autoSyncIntervalMinutes: 30,
    wifiOnly: true,
  });

  assert.deepEqual(updated, {
    mediaLookbackHours: 24,
    autoSyncEnabled: true,
    autoSyncIntervalMinutes: 30,
    wifiOnly: true,
  });
  assert.equal(store.get().mediaLookbackHours, 24);
});

test("settings reject invalid values and support per-device overrides", async (t) => {
  const directory = await createTempDirectory(t);
  const store = new SettingsStore(join(directory, "settings.txt"));
  await store.initialize();

  await assert.rejects(
    store.update({ mediaLookbackHours: 0 }),
    /mediaLookbackHours/u,
  );
  await assert.rejects(
    store.update({ autoSyncIntervalMinutes: 14 }),
    /autoSyncIntervalMinutes/u,
  );
  await assert.rejects(
    store.update({ wifiOnly: "yes" }),
    /wifiOnly/u,
  );

  await store.update({ mediaLookbackHours: 72 });
  await store.update({ mediaLookbackHours: 6, autoSyncEnabled: false }, "device-1");

  assert.equal(store.get("device-1").mediaLookbackHours, 6);
  assert.equal(store.get("device-1").autoSyncEnabled, false);
  assert.equal(store.get("device-2").mediaLookbackHours, 72);
});

test("settings replay valid JSONL events and ignore malformed history", async (t) => {
  const directory = await createTempDirectory(t);
  const file = join(directory, "settings.txt");
  await writeFile(file, [
    JSON.stringify({ type: "settings", deviceId: null, patch: { mediaLookbackHours: 48 }, at: 1 }),
    "{broken-json",
    JSON.stringify({ type: "settings", deviceId: null, patch: { mediaLookbackHours: -1 }, at: 2 }),
    JSON.stringify({ type: "settings", deviceId: "device-1", patch: { wifiOnly: true }, at: 3 }),
    "",
  ].join("\n"), "utf8");

  const store = new SettingsStore(file);
  await store.initialize();

  assert.equal(store.get().mediaLookbackHours, 48);
  assert.equal(store.get("device-1").wifiOnly, true);
});

test("sync requests snapshot the server clock and remain idempotent while pending", async (t) => {
  const directory = await createTempDirectory(t);
  let now = 2_000_000_000_000;
  const store = new SyncRequestStore(join(directory, "requests.txt"), {
    clock: () => now,
  });
  await store.initialize();
  const settings = {
    mediaLookbackHours: 24,
    autoSyncEnabled: true,
    autoSyncIntervalMinutes: 15,
    wifiOnly: false,
  };

  const created = await store.create("device-1", settings, "manual");
  const duplicate = await store.create("device-1", settings, "manual");

  assert.equal(duplicate.id, created.id);
  assert.equal(created.windowEnd, now);
  assert.equal(created.windowStart, now - 24 * 60 * 60 * 1000);
  assert.equal(created.lookbackHours, 24);
  assert.equal(created.source, "manual");
  assert.equal((await store.next("device-1", settings)).id, created.id);

  now += 10_000;
  const completed = await store.complete("device-1", created.id, {
    status: "completed",
    smsQueued: 12,
    mediaUploaded: 3,
  });
  assert.equal(completed.status, "completed");
  assert.equal(await store.next("device-1", { ...settings, autoSyncEnabled: false }), null);
});

test("automatic requests become due from server settings and survive restart", async (t) => {
  const directory = await createTempDirectory(t);
  const file = join(directory, "requests.txt");
  let now = 2_100_000_000_000;
  const settings = {
    mediaLookbackHours: 2,
    autoSyncEnabled: true,
    autoSyncIntervalMinutes: 15,
    wifiOnly: true,
  };
  const store = new SyncRequestStore(file, { clock: () => now });
  await store.initialize();

  const first = await store.next("device-1", settings);
  assert.equal(first.source, "automatic");
  await store.complete("device-1", first.id, { status: "completed" });

  now += 14 * 60 * 1000;
  assert.equal(await store.next("device-1", settings), null);
  now += 60 * 1000;
  const due = await store.next("device-1", settings);
  assert.equal(due.source, "automatic");
  assert.equal(due.wifiOnly, true);

  await writeFile(file, `${await readFile(file, "utf8")}{bad\n`, "utf8");
  const restarted = new SyncRequestStore(file, { clock: () => now });
  await restarted.initialize();
  assert.equal((await restarted.next("device-1", settings)).id, due.id);
});

test("device projections retain heartbeat and completion data", async (t) => {
  const directory = await createTempDirectory(t);
  const file = join(directory, "devices.txt");
  const store = new DeviceStore(file, { clock: () => 1234 });
  await store.initialize();
  await store.touch({ deviceId: "device-1", deviceName: "家人手机", appVersion: "4.87" });
  await store.recordCompletion("device-1", {
    requestId: "request-1",
    status: "partial",
    smsQueued: 8,
    imageUploaded: 2,
    videoUploaded: 1,
    mediaBytesUploaded: 4096,
    error: "部分媒体权限",
  });

  const restarted = new DeviceStore(file, { clock: () => 9999 });
  await restarted.initialize();
  const [device] = restarted.list();

  assert.equal(device.deviceName, "家人手机");
  assert.equal(device.lastSeenAt, 1234);
  assert.equal(device.lastResult.status, "partial");
  assert.equal(device.lastResult.videoUploaded, 1);
});
