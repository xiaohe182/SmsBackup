# Server-Controlled SMS and Media Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the self-contained Node server dynamically request all received/sent SMS plus authorized gallery images and videos from a phone for a server-defined time window, with resumable streaming uploads and a password-protected admin page.

**Architecture:** The Node server stores configuration, device state, sync-request events, SMS, and media metadata as UTF-8 JSON Lines under `server/data`; original media stays under `server/data/media`. Android WorkManager polls for server commands, reconciles all SMS, pages through MediaStore for the command's absolute time window, submits manifests, and uploads only missing media with resumable `Content-Range` chunks.

**Tech Stack:** Node.js 18 core modules only, Node test runner, uni-app Vue 3 + TypeScript, Android Kotlin, AndroidX WorkManager, MediaStore/ContentResolver.

## Global Constraints

- The server remains dependency-free and runs with `node server.js` on Node.js 18+.
- Every server runtime file, static asset, configuration, test, and document stays under `server`; copying `server` is sufficient for deployment.
- No server database; persistent indexes rebuild from TXT/JSON Lines and `.part` files.
- Default server URL is `http://119.91.65.202:8787`; default App/Node token and admin password are `88888888`.
- SMS synchronization always covers all received and sent SMS and remains idempotent.
- Media includes authorized `image/*` and `video/*` across all accessible MediaStore albums and volumes.
- `mediaLookbackHours` is supplied by the server, defaults to `168`, and accepts integers from `1` through `87600`; Android contains no fixed seven-day filter.
- Android 13+ requests `READ_MEDIA_IMAGES` and `READ_MEDIA_VIDEO`; Android 14+ handles partial visual-media access.
- Media I/O is streamed; upload concurrency is at most two; large transfers use a foreground WorkManager task and resume from a confirmed byte offset.
- Do not create an APK in this plan; verify with the 4.87 app-plus resource build.

---

## File Structure

### Server

- `server/lib/jsonl-store.js`: serialized JSON Lines append and tolerant replay.
- `server/lib/settings-store.js`: global/default and per-device synchronization configuration.
- `server/lib/device-store.js`: last-seen and last-sync device projections.
- `server/lib/sync-request-store.js`: pending/claimed/completed request event projection and automatic due-request generation.
- `server/lib/media-record.js`: media manifest validation, MIME-to-extension mapping, safe identifiers.
- `server/lib/media-store.js`: manifest comparison, resumable chunk persistence, final media index, ranged reads.
- `server/public/admin.html`, `admin.css`, `admin.js`: build-free protected administration UI.
- `server/server.js`: route composition only; reuse current SMS endpoints.
- `server/test/sync-control.test.js`, `media-store.test.js`, `admin-server.test.js`: focused Node tests.

### Android and uni-app

- `src/uni_modules/sms-backup-native/utssdk/app-android/MediaSyncModels.kt`: command, settings, manifest, and status data classes.
- `src/uni_modules/sms-backup-native/utssdk/app-android/MediaSyncRepository.kt`: multi-volume MediaStore paging and stable media identities.
- `src/uni_modules/sms-backup-native/utssdk/app-android/MediaSyncClient.kt`: authenticated command, manifest, chunk, and completion HTTP client.
- `src/uni_modules/sms-backup-native/utssdk/app-android/MediaSyncWorker.kt`: orchestration, foreground notification, two-file concurrency, retry.
- Existing native manifest/scheduler/settings/status files: permission, scheduling, entrypoint, and status integration only.
- `src/services/sms-backup.ts` and `src/pages/index/index.vue`: parse/display media sync status and trigger one-click full sync.

---

### Task 1: JSONL settings, devices, and sync request state

**Files:**
- Create: `server/lib/jsonl-store.js`
- Create: `server/lib/settings-store.js`
- Create: `server/lib/device-store.js`
- Create: `server/lib/sync-request-store.js`
- Create: `server/test/sync-control.test.js`

**Interfaces:**
- Produces: `new JsonlEventStore(filePath, validateEvent)`, `initialize()`, `append(event)`, `events()`.
- Produces: `new SettingsStore(filePath)`, `initialize()`, `get(deviceId?)`, `update(patch, deviceId?)`.
- Produces: `new DeviceStore(filePath)`, `initialize()`, `touch(device)`, `recordCompletion(deviceId, result)`, `list()`.
- Produces: `new SyncRequestStore(filePath, { clock })`, `initialize()`, `create(deviceId, settings, source)`, `next(deviceId, settings)`, `complete(deviceId, requestId, result)`, `list(deviceId?)`.

- [ ] **Step 1: Write failing state-store tests**

```js
test("server settings dynamically define an absolute media window", async () => {
  const settings = new SettingsStore(join(directory, "settings.txt"));
  await settings.initialize();
  await settings.update({ mediaLookbackHours: 24 });
  const requests = new SyncRequestStore(join(directory, "requests.txt"), {
    clock: () => 2_000_000_000_000,
  });
  await requests.initialize();
  const request = await requests.create("device-1", settings.get("device-1"), "manual");
  assert.equal(request.windowEnd, 2_000_000_000_000);
  assert.equal(request.windowStart, 2_000_000_000_000 - 24 * 60 * 60 * 1000);
  assert.equal(request.lookbackHours, 24);
});

test("malformed historical events are ignored and valid state survives restart", async () => {
  await writeFile(file, `${JSON.stringify(validEvent)}\n{broken\n`, "utf8");
  const restarted = new SettingsStore(file);
  await restarted.initialize();
  assert.equal(restarted.get().mediaLookbackHours, 72);
});
```

- [ ] **Step 2: Run the focused test and verify red**

Run: `node --test test/sync-control.test.js` from `server`.

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `lib/settings-store.js`.

- [ ] **Step 3: Implement serialized JSONL replay and validated settings**

```js
export const DEFAULT_SYNC_SETTINGS = Object.freeze({
  mediaLookbackHours: 168,
  autoSyncEnabled: true,
  autoSyncIntervalMinutes: 15,
  wifiOnly: false,
});

export function validateSettingsPatch(value) {
  if (value.mediaLookbackHours !== undefined &&
      (!Number.isInteger(value.mediaLookbackHours) || value.mediaLookbackHours < 1 || value.mediaLookbackHours > 87600)) {
    throw new RangeError("mediaLookbackHours must be an integer between 1 and 87600");
  }
}
```

`JsonlEventStore.append()` must chain writes through a promise queue. Replay must ignore blank, malformed, and validator-rejected lines without rewriting the source file.

- [ ] **Step 4: Implement idempotent command events and device projections**

`SyncRequestStore.create()` snapshots `windowStart`, `windowEnd`, and `lookbackHours`; `next()` returns an existing pending request first, otherwise creates an `automatic` request only when `autoSyncEnabled` and the latest request age is at least `autoSyncIntervalMinutes`.

- [ ] **Step 5: Run and commit**

Run: `node --test test/sync-control.test.js`

Expected: all sync-control tests PASS.

Commit: `feat: persist server sync control in text files`

---

### Task 2: Resumable media manifest and binary store

**Files:**
- Create: `server/lib/media-record.js`
- Create: `server/lib/media-store.js`
- Create: `server/test/media-store.test.js`

**Interfaces:**
- Consumes: command `{ id, deviceId, windowStart, windowEnd }` from `SyncRequestStore`.
- Produces: `new MediaStore({ recordsFile, mediaDirectory, maxMediaBytes })`.
- Produces: `initialize()`, `registerManifest({ command, deviceId, items })`, `writeChunk({ deviceId, mediaId, start, end, total, stream })`, `query(filters)`, `openContent(mediaId, rangeHeader)`.

- [ ] **Step 1: Write failing media tests**

```js
test("manifest returns only missing items and rejects media outside the command window", async () => {
  const result = await store.registerManifest({ command, deviceId: "device-1", items: [inside, outside] });
  assert.deepEqual(result.missing.map((item) => item.mediaId), [inside.mediaId]);
  assert.deepEqual(result.rejected, [{ mediaId: outside.mediaId, error: "outside_time_window" }]);
});

test("a partial upload resumes and finalizes without buffering the whole video", async () => {
  await store.writeChunk({ ...identity, start: 0, end: 2, total: 6, stream: Readable.from("abc") });
  const manifest = await store.registerManifest({ command, deviceId: "device-1", items: [video] });
  assert.equal(manifest.missing[0].offset, 3);
  const completed = await store.writeChunk({ ...identity, start: 3, end: 5, total: 6, stream: Readable.from("def") });
  assert.equal(completed.complete, true);
  assert.equal(await readFile(completed.path, "utf8"), "abcdef");
});
```

- [ ] **Step 2: Run and verify red**

Run: `node --test test/media-store.test.js`

Expected: FAIL with missing `MediaStore`.

- [ ] **Step 3: Implement strict manifest validation**

Required fields are `mediaId`, `deviceId`, `mediaType`, `volumeName`, `sourceId`, `albumId`, `albumName`, `displayName`, `takenAt`, `modifiedAt`, `mimeType`, and `size`. `mediaType` is `image` or `video`; MIME must match; timestamps and sizes are nonnegative safe integers; `takenAt` must fall inside the command window.

- [ ] **Step 4: Implement streamed `.part` writes and ranged reads**

Use `open(partPath, start === 0 ? "w" : "r+")`; require the current size to equal `start`; write each incoming chunk at an explicit position; keep valid partial bytes on abort; atomically rename after `end + 1 === total`; append one final JSON line; serialize writes per media ID.

- [ ] **Step 5: Run and commit**

Run: `node --test test/media-store.test.js`

Expected: all media-store tests PASS, including traversal, oversized file, duplicate, restart, and HTTP-range parsing cases.

Commit: `feat: store resumable gallery media without a database`

---

### Task 3: Protected server APIs and self-contained admin page

**Files:**
- Create: `server/public/admin.html`
- Create: `server/public/admin.css`
- Create: `server/public/admin.js`
- Create: `server/test/admin-server.test.js`
- Modify: `server/server.js`

**Interfaces:**
- Consumes: stores from Tasks 1 and 2.
- Produces all routes listed in `server/MEDIA_SYNC_DESIGN.md`.
- `createSmsServer()` additionally accepts `dataDirectory`, `clock`, `maxMediaBytes`, and `adminPassword` test overrides while preserving `dataFile` compatibility.

- [ ] **Step 1: Write failing HTTP tests**

```js
test("admin can change lookback hours and create a command with the new window", async () => {
  const session = await login(app.baseUrl, "admin-password");
  const changed = await fetch(`${app.baseUrl}/api/admin/settings`, {
    method: "PUT",
    headers: sessionHeaders(session),
    body: JSON.stringify({ mediaLookbackHours: 24 }),
  });
  assert.equal(changed.status, 200);
  const created = await adminPost(app.baseUrl, session, "/api/admin/devices/device-1/sync");
  assert.equal(created.lookbackHours, 24);
});

test("media content accepts Content-Range and serves byte ranges", async () => {
  const upload = await putChunk(baseUrl, metadata, "bytes 0-2/6", "abc");
  assert.equal(upload.status, 202);
  const finish = await putChunk(baseUrl, metadata, "bytes 3-5/6", "def");
  assert.equal(finish.status, 200);
  const ranged = await fetch(contentUrl, { headers: { ...bearer, range: "bytes=2-4" } });
  assert.equal(ranged.status, 206);
  assert.equal(await ranged.text(), "cde");
});
```

- [ ] **Step 2: Run and verify red**

Run: `node --test test/admin-server.test.js`

Expected: current server returns 404 for `/admin` and new APIs.

- [ ] **Step 3: Split route helpers and compose stores**

Add helpers for JSON parsing, Bearer/session authorization, static UTF-8 assets, `Content-Range`, and response errors. Preserve all existing `/api/sms` behavior and tests.

- [ ] **Step 4: Implement the admin page**

The page must contain a password form, dynamic hours input, automatic-sync controls, device table, “立即获取” action, progress labels, paged media list, `<img loading="lazy">`, and `<video preload="metadata" controls>`. Use no CDN and escape all data through `textContent`/DOM properties rather than `innerHTML`.

- [ ] **Step 5: Run server tests and commit**

Run: `npm test` from `server`.

Expected: existing SMS tests and all new tests PASS.

Commit: `feat: add protected server media control panel`

---

### Task 4: Android permissions and media-sync contracts

**Files:**
- Modify: `tests/native/native-contract.test.ts`
- Modify: `tests/native/background-contract.test.ts`
- Modify: `src/uni_modules/sms-backup-native/utssdk/app-android/AndroidManifest.xml`
- Modify: `src/uni_modules/sms-backup-native/utssdk/app-android/index.uts`
- Modify: `src/uni_modules/sms-backup-native/utssdk/interface.uts`

**Interfaces:**
- Produces media permission requests for images and videos.
- Produces native status fields `pendingImageCount`, `uploadedImageCount`, `pendingVideoCount`, `uploadedVideoCount`, `mediaBytesUploaded`, `lastMediaSyncAt`, and `lastMediaError`.

- [ ] **Step 1: Add failing native-contract assertions**

```ts
expect(manifest).toContain("android.permission.READ_MEDIA_VIDEO");
expect(manifest).toContain("android.permission.READ_MEDIA_VISUAL_USER_SELECTED");
expect(manifest).toContain("android.permission.FOREGROUND_SERVICE_DATA_SYNC");
expect(uts).toContain("android.permission.READ_MEDIA_IMAGES");
expect(uts).toContain("android.permission.READ_MEDIA_VIDEO");
```

- [ ] **Step 2: Run and verify red**

Run: `npm test -- --run tests/native/native-contract.test.ts tests/native/background-contract.test.ts`

Expected: missing video/partial-media/foreground permissions and worker.

- [ ] **Step 3: Add version-aware permissions and interfaces**

Android 13+ requests both image and video permissions. Android 14+ includes selected-media access. Manifest adds `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_DATA_SYNC`, and `POST_NOTIFICATIONS` while retaining the Android 8–12 storage permission cap.

- [ ] **Step 4: Run contracts and commit**

Expected: all focused permission contract assertions PASS. Worker-specific assertions are introduced in Tasks 5–6, not committed early.

Commit: `feat: declare gallery image and video sync permissions`

---

### Task 5: Multi-volume MediaStore scanner and stable media manifests

**Files:**
- Create: `src/uni_modules/sms-backup-native/utssdk/app-android/MediaSyncModels.kt`
- Create: `src/uni_modules/sms-backup-native/utssdk/app-android/MediaSyncRepository.kt`
- Modify: `tests/native/background-contract.test.ts`

**Interfaces:**
- Produces `MediaSyncCommand(id, deviceId, windowStart, windowEnd, lookbackHours, wifiOnly)`.
- Produces `MediaManifestItem(mediaId, mediaType, volumeName, sourceId, contentUri, albumId, albumName, displayName, takenAt, modifiedAt, duration, mimeType, size)`.
- Produces `MediaSyncRepository.page(command, cursor, limit): MediaManifestPage` with at most 100 items.

- [ ] **Step 1: Add failing scanner contract tests**

Assert the scanner uses `MediaStore.getExternalVolumeNames`, `MediaStore.Files.getContentUri`, image and video media types, `DATE_TAKEN`, `DATE_ADDED`, `DATE_MODIFIED`, `SIZE`, `DURATION`, command `windowStart/windowEnd`, `ContentResolver`, page limit 100, and SHA-256 stable IDs.

- [ ] **Step 2: Run and verify red**

Run: `npm test -- --run tests/native/background-contract.test.ts`

Expected: missing models/repository.

- [ ] **Step 3: Implement bounded multi-volume scanning**

For API 29+ enumerate external volumes; otherwise use the legacy external volume. Query files where media type is image/video and effective taken time is inside the command window. Build at most 100 manifests at a time. Never request `_data`; always open `content://` through `ContentResolver`.

- [ ] **Step 4: Run and commit**

Expected: scanner contract tests PASS.

Commit: `feat: page server-window gallery media on Android`

---

### Task 6: Android command polling, resumable upload, and completion

**Files:**
- Create: `src/uni_modules/sms-backup-native/utssdk/app-android/MediaSyncClient.kt`
- Create: `src/uni_modules/sms-backup-native/utssdk/app-android/MediaSyncWorker.kt`
- Modify: `src/uni_modules/sms-backup-native/utssdk/app-android/WorkScheduler.kt`
- Modify: `src/uni_modules/sms-backup-native/utssdk/app-android/SmsBackupNative.kt`
- Modify: `src/uni_modules/sms-backup-native/utssdk/app-android/SmsRepository.kt`
- Modify: `tests/native/background-contract.test.ts`

**Interfaces:**
- Consumes App settings JSON fields `serverUrl`, `apiToken`, `deviceId`, `deviceName`, `syncEnabled`, `allowInsecureHttp`.
- Produces unique immediate and 15-minute `MediaSyncWorker` requests.
- `SmsBackupNative.syncNow()` enqueues SMS reconciliation, SMS upload, and media command polling.

- [ ] **Step 1: Add failing worker tests**

Assert Bearer authorization, command polling, `scanExistingMessages()`, manifest batches, `Content-Range`, fixed two-thread executor, foreground notification, completion report, exponential retry, and no SMS/media body logging.

- [ ] **Step 2: Run and verify red**

Run: `npm test -- --run tests/native/background-contract.test.ts`

Expected: missing `MediaSyncClient.kt` and `MediaSyncWorker.kt`.

- [ ] **Step 3: Implement HTTP client and orchestration**

Use `HttpURLConnection`; reject non-HTTPS when `allowInsecureHttp` is false; percent-encode device/media/request IDs; parse 204 as no command; use one-MiB chunks and exact `Content-Range`; skip the confirmed offset in the `ContentResolver` stream; report partial permission and per-item failures without including private message/media content in logs.

- [ ] **Step 4: Schedule and expose one-click sync**

Use unique names `sms-backup-media-sync` and `sms-backup-media-sync-now`, `ExistingPeriodicWorkPolicy.UPDATE`, `ExistingWorkPolicy.KEEP`, connected-network constraint, and exponential backoff. `initialize()` schedules both existing SMS work and new media polling.

- [ ] **Step 5: Run contracts and commit**

Expected: all native/background contract tests PASS.

Commit: `feat: execute server-controlled Android media sync`

---

### Task 7: App status and one-click full synchronization

**Files:**
- Modify: `tests/services/android-sms-backup.test.ts`
- Modify: `tests/pages/index-contract.test.ts`
- Modify: `src/services/sms-backup.ts`
- Modify: `src/pages/index/index.vue`

**Interfaces:**
- Extends `BackupStatus` with media counts/bytes/error while preserving old fallback parsing.
- Home action calls existing scan plus native `syncNow()` and labels the action “一键同步全部”.

- [ ] **Step 1: Write failing service/page tests**

```ts
expect(status).toMatchObject({
  pendingImageCount: 2,
  uploadedVideoCount: 3,
  mediaBytesUploaded: 4096,
});
expect(page).toContain("一键同步全部");
expect(page).toContain("图片");
expect(page).toContain("视频");
```

- [ ] **Step 2: Run and verify red**

Run: `npm test -- --run tests/services/android-sms-backup.test.ts tests/pages/index-contract.test.ts`

- [ ] **Step 3: Implement backward-compatible parsing and UI**

Missing new fields from an older native runtime parse as zero/null. Display separate SMS, image, and video metrics; show server-controlled window wording; keep existing permission and error guidance.

- [ ] **Step 4: Run and commit**

Expected: focused tests PASS.

Commit: `feat: show one-click SMS and gallery sync status`

---

### Task 8: Self-contained deployment docs and full verification

**Files:**
- Modify: `server/README.md`
- Modify: `README.md`
- Modify: `docs/android-device-test-checklist.md`
- Modify: `server/MEDIA_SYNC_DESIGN.md` only if implementation reveals a factual mismatch.

- [ ] **Step 1: Document direct deployment**

Include Windows and Linux launch commands, `SMS_BACKUP_TOKEN`, `SMS_ADMIN_PASSWORD`, `SMS_MEDIA_MAX_BYTES`, data paths, `/admin`, HTTPS warning, firewall 8787, dynamic hours, image/video permission behavior, force-stop limitation, and copying only `server`.

- [ ] **Step 2: Run the complete Node suite**

Run: `npm test` from `server`.

Expected: zero failures.

- [ ] **Step 3: Run the complete app suite and type check**

Run from repository root:

```powershell
npm test -- --run
npm run type-check
```

Expected: all test files pass and `vue-tsc` exits 0.

- [ ] **Step 4: Build 4.87 app-plus resources**

Run: `npm run build:app-plus`

Expected: output contains `Compiler version: 4.87（vue3）` and `DONE Build complete.`

- [ ] **Step 5: Audit generated native resources and deployment isolation**

```powershell
rg -n "READ_MEDIA_VIDEO|MediaSyncWorker|Content-Range|windowStart|windowEnd" dist\build\app\uni_modules\sms-backup-native
rg -n "SMS_BACKUP_TOKEN|SMS_ADMIN_PASSWORD|mediaLookbackHours|/admin" server
git diff --check
git status --short
```

Copy `server` to a temporary directory, run its Node tests there, and verify no import resolves outside the copied directory.

- [ ] **Step 6: Commit documentation and final fixes**

Commit: `docs: explain dynamic SMS and media server sync`
