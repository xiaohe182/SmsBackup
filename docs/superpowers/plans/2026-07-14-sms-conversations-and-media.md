# 短信会话与媒体浏览 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a ten-minute protected SMS session with conversation browsing, MMS attachments, and authorized device-gallery browsing.

**Architecture:** A TypeScript in-memory session owns the password and all sensitive viewer data. The page layer consumes that session for tabs and navigation, while the Android UTS/Kotlin layer validates the password for every Provider read and returns SMS, MMS, and media-library DTOs.

**Tech Stack:** Vue 3 + uni-app, TypeScript, Vitest, UTS, Kotlin/Android Telephony and MediaStore APIs.

## Global Constraints

- Android only; retain `minSdkVersion` 26.
- A successful unlock expires exactly ten minutes after first unlock and never extends.
- Never persist the viewer password, SMS bodies, MMS parts, image URIs, or gallery index.
- Keep the fixed native password check for every system-provider query.
- Do not request `READ_CONTACTS`; conversation labels use the message address.

---

### Task 1: In-memory protected viewer session

**Files:**
- Create: `src/domain/sms-viewer-session.ts`
- Test: `tests/domain/sms-viewer-session.test.ts`

**Interfaces:**
- Produces `createSmsViewerSession(clock)`, `unlock(password)`, `isActive()`, `remainingMs()`, `password()`, `lock()`, `replaceData(data)`, and conversation grouping helpers.
- Consumes `SmsMessage`, `MmsMessage`, and `GalleryPhoto` from `src/services/sms-backup.ts`.

- [ ] **Step 1: Write failing session tests**

```ts
it("expires exactly ten minutes after the first unlock without extension", () => {
  const clock = fakeClock(1_000);
  const session = createSmsViewerSession(clock);
  session.unlock("88888888");
  clock.advanceBy(9 * 60 * 1000);
  expect(session.isActive()).toBe(true);
  session.touch();
  clock.advanceBy(60 * 1000);
  expect(session.isActive()).toBe(false);
  expect(session.password()).toBeNull();
});
```

- [ ] **Step 2: Run the session test to verify RED**

Run: `npm test -- --run tests/domain/sms-viewer-session.test.ts`

Expected: FAIL because `sms-viewer-session` does not exist.

- [ ] **Step 3: Implement the minimal memory-only session**

```ts
const SESSION_DURATION_MS = 10 * 60 * 1000;

export function createSmsViewerSession(clock = () => Date.now()) {
  let unlockedAt: number | null = null;
  let sessionPassword: string | null = null;
  // Keep messages and media only in this closure; lock() clears every value.
  return { unlock, isActive, remainingMs, password, lock, replaceData, data };
}
```

- [ ] **Step 4: Run the session test to verify GREEN**

Run: `npm test -- --run tests/domain/sms-viewer-session.test.ts`

Expected: PASS with tests for expiry, manual lock, grouping and filters.

### Task 2: Expand the TypeScript service contract

**Files:**
- Modify: `src/services/sms-backup.ts`
- Modify: `src/uni_modules/sms-backup-native/index.d.ts`
- Test: `tests/services/sms-backup.test.ts`

**Interfaces:**
- Produces `MmsMessage`, `MmsAttachment`, `GalleryPhoto`, `listMmsMessages(password)`, `listGalleryPhotos(password)`, and `requestMediaPermissions()`.
- Consumes JSON returned by the UTS module.

- [ ] **Step 1: Write failing parser and unavailable-service tests**

```ts
expect(service.listMmsMessages("88888888")).resolves.toMatchObject({
  authorized: true,
  messages: [{ attachments: [{ uri: "content://mms/part/7", mimeType: "image/jpeg" }] }],
});
await expect(service.requestMediaPermissions()).resolves.toBe(false);
```

- [ ] **Step 2: Run the service test to verify RED**

Run: `npm test -- --run tests/services/sms-backup.test.ts`

Expected: FAIL because media methods and DTOs are absent.

- [ ] **Step 3: Implement strict JSON parsing and module adaptation**

```ts
export interface MmsAttachment { id: string; uri: string; mimeType: string; }
export interface GalleryPhoto { id: string; uri: string; albumId: string; albumName: string; }
export interface SmsBackupService {
  listMmsMessages(password: string): Promise<MmsMessageListResult>;
  listGalleryPhotos(password: string): Promise<GalleryPhotoListResult>;
  requestMediaPermissions(): Promise<boolean>;
}
```

- [ ] **Step 4: Run the service test to verify GREEN**

Run: `npm test -- --run tests/services/sms-backup.test.ts`

Expected: PASS with valid, invalid and unavailable response coverage.

### Task 3: Add Android MMS and gallery retrieval

**Files:**
- Modify: `src/uni_modules/sms-backup-native/utssdk/app-android/AndroidManifest.xml`
- Modify: `src/uni_modules/sms-backup-native/utssdk/interface.uts`
- Modify: `src/uni_modules/sms-backup-native/utssdk/app-android/index.uts`
- Modify: `src/uni_modules/sms-backup-native/utssdk/app-android/SmsBackupNative.kt`
- Modify: `src/uni_modules/sms-backup-native/utssdk/app-android/SmsRepository.kt`
- Test: `tests/native/native-contract.test.ts`

**Interfaces:**
- Produces `getAllMmsMessagesJson(password)`, `getGalleryPhotosJson(password)`, and version-aware `requestMediaPermissions()`.
- Consumes the fixed native password and Android SMS/media permissions.

- [ ] **Step 1: Write failing native contract tests**

```ts
expect(manifest).toContain("android.permission.READ_MEDIA_IMAGES");
expect(manifest).toContain("android.permission.READ_EXTERNAL_STORAGE");
expect(uts).toContain("function getAllMmsMessages");
expect(repository).toContain("Telephony.Mms.CONTENT_URI");
expect(repository).toContain("MediaStore.Images.Media.EXTERNAL_CONTENT_URI");
```

- [ ] **Step 2: Run native-contract tests to verify RED**

Run: `npm test -- --run tests/native/native-contract.test.ts`

Expected: FAIL because the permissions and Provider methods are absent.

- [ ] **Step 3: Implement native permission and Provider methods**

```kotlin
fun getAllMmsMessagesJson(password: String): String = guardedViewerResponse(password) {
    SmsRepository(requireContext()).getAllMmsMessages()
}

fun getGalleryPhotosJson(password: String): String = guardedMediaResponse(password) {
    SmsRepository(requireContext()).getGalleryPhotos()
}
```

Use `Telephony.Mms` and its `part` rows for text/image parts; convert MMS timestamps from seconds to milliseconds. Use `MediaStore.Images.Media` and return only `content://` URIs and non-sensitive metadata. Request `READ_MEDIA_IMAGES` on API 33+ and `READ_EXTERNAL_STORAGE` on API 26–32.

- [ ] **Step 4: Run native-contract tests to verify GREEN**

Run: `npm test -- --run tests/native/native-contract.test.ts`

Expected: PASS; password guards precede each Provider query.

### Task 4: Build the protected tabs and conversation page

**Files:**
- Modify: `src/pages.json`
- Modify: `src/pages/messages/messages.vue`
- Create: `src/pages/conversation/conversation.vue`
- Modify: `tests/pages/messages-contract.test.ts`
- Create: `tests/pages/conversation-contract.test.ts`

**Interfaces:**
- Consumes the singleton `smsViewerSession` and extended `smsBackupService`.
- Produces `/pages/conversation/conversation?key=<encoded-key>` without message content in the route.

- [ ] **Step 1: Write failing page contracts**

```ts
expect(page).toContain("remainingMs");
expect(page).toContain("lockViewer");
expect(page).toContain('"会话"');
expect(page).toContain('"已发送"');
expect(page).toContain('"图片"');
expect(conversation).toContain("uni.previewImage");
expect(pages).toContain('"path": "pages/conversation/conversation"');
```

- [ ] **Step 2: Run page-contract tests to verify RED**

Run: `npm test -- --run tests/pages/messages-contract.test.ts tests/pages/conversation-contract.test.ts`

Expected: FAIL because session tabs and the conversation page are absent.

- [ ] **Step 3: Implement pages with Android-style visual hierarchy**

```ts
function openConversation(conversationKey: string) {
  uni.navigateTo({
    url: `/pages/conversation/conversation?key=${encodeURIComponent(conversationKey)}`,
  });
}

function lockViewer() {
  smsViewerSession.lock();
  activeTab.value = "conversations";
}
```

Use `system-ui, sans-serif` font families, neutral Android-inspired surfaces, inbound/outbound bubble colors, date dividers, full `white-space: pre-wrap` bodies, image grids and `uni.previewImage`. Do not clear session state in `onHide` or `onUnload`; validate the session on every `onShow` and action.

- [ ] **Step 4: Run page-contract tests to verify GREEN**

Run: `npm test -- --run tests/pages/messages-contract.test.ts tests/pages/conversation-contract.test.ts`

Expected: PASS.

### Task 5: Validate the integration

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document required photo permission and session behavior**

Add a concise viewer section explaining the fixed ten-minute in-memory session, manual lock, SMS permission, image permission and Android-only Provider support.

- [ ] **Step 2: Run focused automated tests**

Run: `npm test -- --run tests/domain/sms-viewer-session.test.ts tests/services/sms-backup.test.ts tests/native/native-contract.test.ts tests/pages/messages-contract.test.ts tests/pages/conversation-contract.test.ts`

Expected: PASS.

- [ ] **Step 3: Run full verification**

Run: `npm test -- --run && npm run type-check && npm run build:app-plus`

Expected: each command exits 0.
