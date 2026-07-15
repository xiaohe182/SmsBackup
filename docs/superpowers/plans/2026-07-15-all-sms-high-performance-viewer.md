# All SMS High-Performance Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every SMS filter and build a contact-aware, paginated SMS/MMS viewer with a bounded virtual photo grid that remains responsive with very large message and image collections.

**Architecture:** Android Kotlin performs all Provider scans and page queries on the IO dispatcher, returning conversation summaries or bounded pages instead of full data dumps. TypeScript owns the ten-minute session, stable contact identity, message page merging, and media virtualization; Vue pages only orchestrate those focused modules and render the current window.

**Tech Stack:** uni-app Vue 3, TypeScript 4.9, UTS/Kotlin Android plugin, Android `Telephony`, `ContactsContract`, `MediaStore`, Vitest, Node.js.

## Global Constraints

- Android only, minimum API 26.
- Keep DCloud runtime packages aligned to compiler 4.87.
- No SMS content filtering remains; every unique SMS is queued and uploaded.
- Contact data is viewer-only memory data and is never persisted or uploaded.
- SMS page size defaults to 40 and is clamped to 1–100 natively.
- Gallery page size defaults to 60 and is clamped to 1–120 natively.
- The media grid renders no more than the viewport plus overscan and caches at most four pages.
- Use meaningful Chinese comments for security, cursor, cache, migration, and compatibility logic; do not narrate obvious statements.
- Run tests, type checking, and App resource build; do not submit DCloud cloud packaging or generate an APK.

---

### Task 1: Remove filtering and migrate previously filtered messages

**Files:**
- Modify: `src/pages/index/index.vue`
- Modify: `src/pages.json`
- Modify: `src/App.vue`
- Modify: `src/services/bootstrap.ts`
- Modify: `src/services/sms-backup.ts`
- Modify: `src/uni_modules/sms-backup-native/utssdk/app-android/SmsModels.kt`
- Modify: `src/uni_modules/sms-backup-native/utssdk/app-android/SmsQueueDatabase.kt`
- Modify: `src/uni_modules/sms-backup-native/utssdk/app-android/SmsRepository.kt`
- Modify: `src/uni_modules/sms-backup-native/utssdk/app-android/SmsBackupNative.kt`
- Modify: `src/uni_modules/sms-backup-native/utssdk/app-android/index.uts`
- Delete: `src/domain/blacklist.ts`
- Delete: `src/stores/blacklist.ts`
- Delete: `src/pages/blacklist/blacklist.vue`
- Delete: `src/uni_modules/sms-backup-native/utssdk/app-android/SmsFilter.kt`
- Delete: `tests/domain/blacklist.test.ts`
- Delete: `tests/stores/blacklist.test.ts`
- Test: `tests/native/native-contract.test.ts`
- Test: `tests/services/android-sms-backup.test.ts`
- Test: `tests/services/bootstrap.test.ts`

**Interfaces:**
- Removes: `saveRules`, `saveNativeRules`, blacklist routes, `filteredCount`, and active `filtered_records` behavior.
- Produces: `SmsRepository.queueRecord(record): Boolean` that only checks queue idempotency before enqueueing.

- [ ] **Step 1: Write the failing no-filter native contract test**

```ts
it("queues every unique SMS without blacklist filtering", () => {
  const repository = read("SmsRepository.kt");
  expect(repository).not.toContain("SmsFilter.match");
  expect(repository).not.toContain("recordFiltered");
  expect(repository).toContain("database.enqueue(record)");
  expect(repository.indexOf("containsRecord")).toBeLessThan(
    repository.indexOf("database.enqueue(record)"),
  );
});

it("lets legacy filtered messages enter the queue after migration", () => {
  const database = read("SmsQueueDatabase.kt");
  expect(database).toContain("DATABASE_VERSION = 3");
  expect(database).toContain("DROP TABLE IF EXISTS filtered_records");
  expect(database).not.toContain("SELECT 1 FROM filtered_records");
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm test -- --run tests/native/native-contract.test.ts tests/services/android-sms-backup.test.ts tests/services/bootstrap.test.ts`

Expected: FAIL because `SmsFilter.match`, filter statistics, and rule APIs still exist.

- [ ] **Step 3: Remove filter behavior and migrate the queue database**

Implement database version 3 so new databases only create `sms_queue` and `metadata`; upgrades from versions 1–2 execute:

```kotlin
if (oldVersion < 3) {
    database.execSQL("DROP TABLE IF EXISTS filtered_records")
}
```

Change `containsRecord` to query only `sms_queue`, and make `queueRecord`:

```kotlin
fun queueRecord(record: SmsRecord): Boolean {
    if (database.containsRecord(record.recordId, record.contentKey)) return false
    return database.enqueue(record)
}
```

Remove the blacklist page, home entry, stored rule bootstrapping, native rule API, and filtered statistic from every shared type.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `npm test -- --run tests/native/native-contract.test.ts tests/services/android-sms-backup.test.ts tests/services/bootstrap.test.ts`

Expected: all focused tests pass and no test imports the removed blacklist modules.

- [ ] **Step 5: Commit the filter removal**

```powershell
git add -A
git commit -m "feat: collect every SMS without filtering"
```

### Task 2: Add bounded viewer models, message paging, and media virtualization

**Files:**
- Modify: `src/domain/sms-viewer-session.ts`
- Create: `src/domain/sms-viewer-pagination.ts`
- Create: `src/domain/virtual-media-grid.ts`
- Modify: `tests/domain/sms-viewer-session.test.ts`
- Create: `tests/domain/sms-viewer-pagination.test.ts`
- Create: `tests/domain/virtual-media-grid.test.ts`

**Interfaces:**
- Produces: `ViewerContact`, `ViewerConversation`, `ViewerMessage`, `MessageCursor`, `ViewerMessagePage`, `ViewerAlbum`, `ViewerPhotoPage`.
- Produces: `mergeMessagePage(existing, incoming, maxItems)` and `calculateVirtualMediaRange(input)`.
- Produces: `createMediaPageCache<T>(maxPages)` with a hard maximum of four pages.

- [ ] **Step 1: Write failing pagination and 10,000-image virtualization tests**

```ts
it("deduplicates cursor pages and keeps a bounded message window", () => {
  const existing = Array.from({ length: 200 }, (_, index) => message(`sms:${index}`, 1_000 - index));
  const incoming = [message("sms:199", 801), message("sms:200", 800)];
  const merged = mergeMessagePage(existing, incoming, 200);
  expect(merged).toHaveLength(200);
  expect(new Set(merged.map((item) => item.id)).size).toBe(200);
  expect(merged.at(-1)?.id).toBe("sms:200");
});

it("renders only nearby cells for ten thousand photos", () => {
  const range = calculateVirtualMediaRange({
    totalCount: 10_000,
    scrollTop: 64_000,
    viewportHeight: 800,
    columnCount: 3,
    rowHeight: 132,
    overscanRows: 2,
    pageSize: 60,
  });
  expect(range.endIndex - range.startIndex).toBeLessThanOrEqual(36);
  expect(range.totalHeight).toBeGreaterThan(400_000);
  expect(range.requiredPages.length).toBeLessThanOrEqual(2);
});

it("evicts the least-recently-used media page", () => {
  const cache = createMediaPageCache<string>(4);
  for (let page = 0; page < 5; page += 1) cache.set(page, [`page-${page}`]);
  expect(cache.has(0)).toBe(false);
  expect(cache.pageCount()).toBe(4);
});
```

- [ ] **Step 2: Run domain tests and verify RED**

Run: `npm test -- --run tests/domain/sms-viewer-session.test.ts tests/domain/sms-viewer-pagination.test.ts tests/domain/virtual-media-grid.test.ts`

Expected: FAIL because paging and virtual-grid modules do not exist.

- [ ] **Step 3: Implement the focused domain modules**

Define the contact identity once and reuse it everywhere:

```ts
export interface ViewerContact {
  key: string;
  displayName: string | null;
  phoneNumber: string;
  phoneLabel: string | null;
  avatarUri: string | null;
  isResolved: boolean;
}
```

`calculateVirtualMediaRange` must compute visible rows from `scrollTop`, add exactly the requested overscan, clamp indices to `totalCount`, and derive unique page numbers. `createMediaPageCache` must refresh recency on `get` and evict only the oldest page on overflow. Add Chinese comments above the range math and LRU eviction explaining why DOM and decoded bitmap counts must remain bounded.

- [ ] **Step 4: Run domain tests and verify GREEN**

Run: `npm test -- --run tests/domain/sms-viewer-session.test.ts tests/domain/sms-viewer-pagination.test.ts tests/domain/virtual-media-grid.test.ts`

Expected: all domain tests pass, including the 10,000-item case.

- [ ] **Step 5: Commit domain paging primitives**

```powershell
git add src/domain tests/domain
git commit -m "feat: add bounded SMS and media paging models"
```

### Task 3: Add Android contacts, conversation summaries, and bounded Provider pages

**Files:**
- Create: `src/uni_modules/sms-backup-native/utssdk/app-android/SmsContactResolver.kt`
- Modify: `src/uni_modules/sms-backup-native/utssdk/app-android/AndroidManifest.xml`
- Modify: `src/uni_modules/sms-backup-native/utssdk/app-android/SmsModels.kt`
- Modify: `src/uni_modules/sms-backup-native/utssdk/app-android/SmsRepository.kt`
- Modify: `src/uni_modules/sms-backup-native/utssdk/app-android/SmsBackupNative.kt`
- Modify: `src/uni_modules/sms-backup-native/utssdk/app-android/index.uts`
- Modify: `src/uni_modules/sms-backup-native/utssdk/interface.uts`
- Modify: `src/uni_modules/sms-backup-native/index.d.ts`
- Test: `tests/native/native-contract.test.ts`

**Interfaces:**
- Produces native functions: `requestContactsPermission`, `getConversationSummaries`, `getMessagePage`, `getGalleryAlbums`, `getGalleryPage`.
- `getMessagePage(password, filter, threadId, cursor, limit)` clamps `limit` to `1..100`.
- `getGalleryPage(password, albumId, offset, limit)` clamps `limit` to `1..120`.

- [ ] **Step 1: Write failing native API and permission contracts**

```ts
it("declares contacts and bounded paging APIs", () => {
  const manifest = read("AndroidManifest.xml");
  const uts = read("index.uts");
  const repository = read("SmsRepository.kt");
  expect(manifest).toContain("android.permission.READ_CONTACTS");
  for (const method of [
    "requestContactsPermission",
    "getConversationSummaries",
    "getMessagePage",
    "getGalleryAlbums",
    "getGalleryPage",
  ]) expect(uts).toContain(`function ${method}`);
  expect(repository).toContain("coerceIn(1, 100)");
  expect(repository).toContain("coerceIn(1, 120)");
  expect(repository).toContain("ContactsContract.CommonDataKinds.Phone");
  expect(repository).toContain("ContentResolver.QUERY_ARG_LIMIT");
  expect(repository).toContain("ContentResolver.QUERY_ARG_OFFSET");
});
```

- [ ] **Step 2: Run the native contract and verify RED**

Run: `npm test -- --run tests/native/native-contract.test.ts`

Expected: FAIL because contacts permission and page functions are absent.

- [ ] **Step 3: Implement contact resolution and bounded native responses**

`SmsContactResolver` queries `CommonDataKinds.Phone.CONTENT_URI` once per overview request using this projection:

```kotlin
arrayOf(
    Phone.NUMBER,
    Phone.NORMALIZED_NUMBER,
    Phone.DISPLAY_NAME,
    Phone.TYPE,
    Phone.LABEL,
    Phone.PHOTO_THUMBNAIL_URI
)
```

Normalize message addresses with `PhoneNumberUtils.normalizeNumber`; resolve `Phone.getTypeLabel` for standard and custom labels. Conversation summaries scan only required SMS/MMS columns on the IO dispatcher and return one summary per stable thread/address key. Message pages use the tuple `timestamp`, `kind`, `sourceId` as the stable descending cursor and merge bounded SMS/MMS results without duplicates.

Gallery paging uses API 26 structured query arguments. Inspect `Cursor.extras[ContentResolver.EXTRA_HONORED_ARGS]`; if a vendor ignores limit or offset, manually skip and stop while building only one JSON page. A separate count cursor may calculate `totalCount`, but no bitmap may be opened during metadata queries.

- [ ] **Step 4: Run the native contract and verify GREEN**

Run: `npm test -- --run tests/native/native-contract.test.ts`

Expected: every native contract passes and no Provider query is called from the UTS main dispatcher.

- [ ] **Step 5: Commit native pagination and contact support**

```powershell
git add src/uni_modules tests/native/native-contract.test.ts
git commit -m "feat: page Android SMS contacts and gallery data"
```

### Task 4: Adapt the TypeScript service to bounded native pages

**Files:**
- Modify: `src/services/sms-backup.ts`
- Modify: `tests/services/sms-backup.test.ts`
- Modify: `tests/services/android-sms-backup.test.ts`
- Modify: `tests/stubs/sms-backup-native.ts`

**Interfaces:**
- Consumes native JSON strings from Task 3.
- Produces typed service methods with the same names and argument order as the native functions.
- Invalid JSON returns authorized/permission flags as false and empty bounded arrays.

- [ ] **Step 1: Write failing service parsing tests**

```ts
it("parses contact-aware conversation and bounded gallery pages", async () => {
  const summaries = await service.listConversationSummaries("88888888");
  expect(summaries.conversations[0]).toMatchObject({
    key: "thread:7",
    contact: { displayName: "家人备注", phoneNumber: "13800138000" },
  });
  const page = await service.listGalleryPage("88888888", "camera", 0, 60);
  expect(page.totalCount).toBe(10_000);
  expect(page.photos.length).toBeLessThanOrEqual(60);
});
```

- [ ] **Step 2: Run service tests and verify RED**

Run: `npm test -- --run tests/services/sms-backup.test.ts tests/services/android-sms-backup.test.ts`

Expected: FAIL because the typed bounded service methods are absent.

- [ ] **Step 3: Implement strict parsers and Android/unavailable adapters**

Add parser functions for conversation summaries, message pages, album summaries, and gallery pages. Clamp or discard arrays larger than the documented maximum before returning them to the page. Keep the unavailable service deterministic with empty arrays and `authorized: false`.

- [ ] **Step 4: Run service tests and verify GREEN**

Run: `npm test -- --run tests/services/sms-backup.test.ts tests/services/android-sms-backup.test.ts`

Expected: all service tests pass and native mocks expose every new method.

- [ ] **Step 5: Commit the service adapter**

```powershell
git add src/services tests/services tests/stubs
git commit -m "feat: expose bounded SMS viewer services"
```

### Task 5: Build the polished contact-aware viewer and virtual gallery

**Files:**
- Create: `src/static/default-contact.png`
- Modify: `src/pages/messages/messages.vue`
- Modify: `src/pages/conversation/conversation.vue`
- Modify: `tests/pages/messages-contract.test.ts`
- Modify: `tests/pages/conversation-contract.test.ts`

**Interfaces:**
- Consumes `SmsBackupService`, `smsViewerSession`, message pagination helpers, and virtual media grid.
- Produces a contact-consistent conversation list, bounded message lists, paged conversation details, and a virtual photo grid.

- [ ] **Step 1: Write failing page contracts for complete identity and bounded rendering**

```ts
it("shows a consistent contact photo, remark, phone, and complete message details", () => {
  const messages = read("src/pages/messages/messages.vue");
  const conversation = read("src/pages/conversation/conversation.vue");
  for (const value of ["contact.avatarUri", "contact.displayName", "contact.phoneNumber"]) {
    expect(messages).toContain(value);
    expect(conversation).toContain(value);
  }
  for (const value of ["message.body", "message.direction", "message.status", "message.simSubscriptionId"]) {
    expect(conversation).toContain(value);
  }
});

it("uses paged scroll and virtual media range instead of rendering all photos", () => {
  const messages = read("src/pages/messages/messages.vue");
  expect(messages).toContain("calculateVirtualMediaRange");
  expect(messages).toContain("createMediaPageCache");
  expect(messages).toContain("@scrolltolower");
  expect(messages).toContain('lazy-load="true"');
  expect(messages).not.toContain("viewerData.value.photos.map");
});
```

- [ ] **Step 2: Run page contracts and verify RED**

Run: `npm test -- --run tests/pages/messages-contract.test.ts tests/pages/conversation-contract.test.ts`

Expected: FAIL because the current pages still render full in-memory message/photo arrays and character avatars.

- [ ] **Step 3: Add the real default avatar asset**

Generate a neutral, transparent-background contact silhouette PNG sized for a 96×96 pixel slot, save it as `src/static/default-contact.png`, and use it only when Android provides no contact thumbnail URI. Do not use text, Emoji, CSS drawings, or inline SVG as an avatar fallback.

- [ ] **Step 4: Implement the refined pages with Chinese performance comments**

The conversation row must use one contact object for avatar, remark, phone, label, preview, time, count, and unread state. The conversation page reuses the same contact from `smsViewerSession` and loads 40 messages per request. Both pages display a stable loading footer and preserve scroll position while appending/prepending pages.

The photo area is a fixed-height `scroll-view` with one tall virtual canvas. Position only `range.startIndex..range.endIndex` items using pixel `top`/`left` values calculated from the device window width. On scroll, update at most once per animation frame or 16 ms timer and request only `range.requiredPages`. Use a four-page LRU cache and discard responses whose request generation no longer matches the selected album.

- [ ] **Step 5: Run page and domain tests and verify GREEN**

Run: `npm test -- --run tests/pages tests/domain/sms-viewer-session.test.ts tests/domain/sms-viewer-pagination.test.ts tests/domain/virtual-media-grid.test.ts`

Expected: all page and performance-domain tests pass.

- [ ] **Step 6: Commit the finished viewer**

```powershell
git add src/pages src/static tests/pages
git commit -m "feat: polish contact-aware SMS and media viewer"
```

### Task 6: Documentation and complete verification without APK packaging

**Files:**
- Modify: `README.md`
- Modify: `docs/protected-sms-viewer.md`
- Modify: `docs/android-device-test-checklist.md`

**Interfaces:**
- Documents contacts permission, all-SMS upload behavior, page sizes, media virtualization, and device checks.

- [ ] **Step 1: Update user and device documentation**

Document that blacklists no longer exist, all SMS content is queued, contacts remain local to the viewer, gallery loading is paged, and cloud APK packaging is intentionally not run in this task.

- [ ] **Step 2: Run the entire automated suite**

Run: `npm test -- --run`

Expected: every test file passes with zero failures.

- [ ] **Step 3: Run static type verification**

Run: `npm run type-check`

Expected: exit code 0 with no TypeScript errors.

- [ ] **Step 4: Build App resources with compiler 4.87**

Run: `npm run build:app-plus`

Expected: output contains `Compiler version: 4.87（vue3）` and `DONE Build complete.` This is resource compilation only; do not invoke HBuilderX `pack`.

- [ ] **Step 5: Verify repository and generated-artifact boundaries**

Run:

```powershell
git status --short
git check-ignore dist unpackage node_modules server/data
```

Expected: generated directories remain ignored and no APK is staged.

- [ ] **Step 6: Commit documentation and verification changes**

```powershell
git add README.md docs
git commit -m "docs: explain full SMS viewer performance behavior"
```
