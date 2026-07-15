import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import {
  MediaStore,
  MediaOffsetMismatchError,
  parseByteRange,
} from "../lib/media-store.js";

const WINDOW_END = 2_000_000_000_000;
const COMMAND = {
  id: "request-1",
  deviceId: "device-1",
  windowStart: WINDOW_END - 24 * 60 * 60 * 1000,
  windowEnd: WINDOW_END,
};

function media(overrides = {}) {
  return {
    mediaId: "a".repeat(64),
    deviceId: "device-1",
    mediaType: "image",
    volumeName: "external_primary",
    sourceId: "42",
    albumId: "camera",
    albumName: "相机 📷",
    displayName: "照片 你好.jpg",
    takenAt: WINDOW_END - 60_000,
    modifiedAt: WINDOW_END - 30_000,
    duration: null,
    mimeType: "image/jpeg",
    size: 6,
    ...overrides,
  };
}

async function createStore(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "sms-media-store-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new MediaStore({
    recordsFile: join(directory, "media-records.txt"),
    mediaDirectory: join(directory, "media"),
    maxMediaBytes: 1024,
    clock: () => WINDOW_END + 1,
    ...options,
  });
  await store.initialize();
  return { directory, store };
}

test("manifest returns missing images and videos while rejecting out-of-window media", async (t) => {
  const { store } = await createStore(t);
  const image = media();
  const video = media({
    mediaId: "b".repeat(64),
    mediaType: "video",
    sourceId: "43",
    displayName: "视频.mp4",
    mimeType: "video/mp4",
    duration: 15_000,
  });
  const outside = media({
    mediaId: "c".repeat(64),
    takenAt: COMMAND.windowStart - 1,
  });

  const result = await store.registerManifest({
    command: COMMAND,
    deviceId: "device-1",
    items: [image, video, outside],
  });

  assert.deepEqual(
    result.missing.map((item) => ({ mediaId: item.mediaId, offset: item.offset })),
    [
      { mediaId: image.mediaId, offset: 0 },
      { mediaId: video.mediaId, offset: 0 },
    ],
  );
  assert.deepEqual(result.rejected, [
    { mediaId: outside.mediaId, error: "outside_time_window" },
  ]);
});

test("a partial upload resumes and finalizes without buffering the whole video", async (t) => {
  const { store } = await createStore(t);
  const video = media({
    mediaId: "b".repeat(64),
    mediaType: "video",
    displayName: "长视频.mp4",
    mimeType: "video/mp4",
    duration: 60_000,
  });
  await store.registerManifest({ command: COMMAND, deviceId: "device-1", items: [video] });

  const partial = await store.writeChunk({
    deviceId: "device-1",
    mediaId: video.mediaId,
    start: 0,
    end: 2,
    total: 6,
    stream: Readable.from([Buffer.from("abc")]),
  });
  assert.deepEqual(
    { complete: partial.complete, offset: partial.offset },
    { complete: false, offset: 3 },
  );

  const manifest = await store.registerManifest({
    command: COMMAND,
    deviceId: "device-1",
    items: [video],
  });
  assert.equal(manifest.missing[0].offset, 3);

  const completed = await store.writeChunk({
    deviceId: "device-1",
    mediaId: video.mediaId,
    start: 3,
    end: 5,
    total: 6,
    stream: Readable.from([Buffer.from("def")]),
  });
  assert.equal(completed.complete, true);
  assert.equal(await readFile(completed.path, "utf8"), "abcdef");
  await assert.rejects(stat(`${completed.path}.part`), /ENOENT/u);
});

test("completed records deduplicate and rebuild from TXT after restart", async (t) => {
  const { directory, store } = await createStore(t);
  const image = media();
  await store.registerManifest({ command: COMMAND, deviceId: "device-1", items: [image] });
  const completed = await store.writeChunk({
    deviceId: "device-1",
    mediaId: image.mediaId,
    start: 0,
    end: 5,
    total: 6,
    stream: Readable.from([Buffer.from("abcdef")]),
  });
  const duplicate = await store.writeChunk({
    deviceId: "device-1",
    mediaId: image.mediaId,
    start: 0,
    end: 5,
    total: 6,
    stream: Readable.from([Buffer.from("xxxxxx")]),
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(await readFile(completed.path, "utf8"), "abcdef");

  const recordsFile = join(directory, "media-records.txt");
  await writeFile(recordsFile, `${await readFile(recordsFile, "utf8")}{broken\n`, "utf8");
  const restarted = new MediaStore({
    recordsFile,
    mediaDirectory: join(directory, "media"),
    maxMediaBytes: 1024,
  });
  await restarted.initialize();
  const result = restarted.query({ limit: 10, offset: 0, deviceId: "device-1" });
  assert.equal(result.totalCount, 1);
  assert.equal(result.items[0].mediaId, image.mediaId);
});

test("store rejects unsafe identities, invalid MIME, oversized files, and wrong offsets", async (t) => {
  const { store } = await createStore(t, { maxMediaBytes: 5 });

  const unsafe = await store.registerManifest({
    command: COMMAND,
    deviceId: "../device",
    items: [media({ deviceId: "../device" })],
  });
  const wrongMime = await store.registerManifest({
    command: COMMAND,
    deviceId: "device-1",
    items: [media({ mediaId: "d".repeat(64), mimeType: "text/html" })],
  });
  const oversized = await store.registerManifest({
    command: COMMAND,
    deviceId: "device-1",
    items: [media({ mediaId: "e".repeat(64), size: 6 })],
  });

  assert.equal(unsafe.rejected[0].error, "invalid_media_record");
  assert.equal(wrongMime.rejected[0].error, "invalid_media_record");
  assert.equal(oversized.rejected[0].error, "media_too_large");

  const valid = media({ mediaId: "f".repeat(64), size: 5 });
  await store.registerManifest({ command: COMMAND, deviceId: "device-1", items: [valid] });
  await assert.rejects(
    store.writeChunk({
      deviceId: "device-1",
      mediaId: valid.mediaId,
      start: 2,
      end: 4,
      total: 5,
      stream: Readable.from([Buffer.from("abc")]),
    }),
    (error) => error instanceof MediaOffsetMismatchError && error.expectedOffset === 0,
  );
});

test("byte range parsing clamps suffix and open-ended requests", () => {
  assert.deepEqual(parseByteRange(null, 10), { start: 0, end: 9, partial: false });
  assert.deepEqual(parseByteRange("bytes=2-4", 10), { start: 2, end: 4, partial: true });
  assert.deepEqual(parseByteRange("bytes=7-", 10), { start: 7, end: 9, partial: true });
  assert.deepEqual(parseByteRange("bytes=-3", 10), { start: 7, end: 9, partial: true });
  assert.equal(parseByteRange("bytes=20-30", 10), null);
  assert.equal(parseByteRange("items=0-1", 10), null);
});
