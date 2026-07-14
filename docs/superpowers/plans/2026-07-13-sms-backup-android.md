# SmsBackup Android Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Android-only uni-app that backs up existing and new SMS messages, filters configured advertising messages, and reliably queues uploads to a configurable server.

**Architecture:** Vue 3 and TypeScript provide the visible application UI and deterministic domain rules. A UTS plugin with mixed Kotlin implements Android SMS permissions, system-provider scans, a manifest receiver, SQLite persistence, and WorkManager uploads. Native state is the source of truth so process death does not depend on the uni-app JavaScript runtime.

**Tech Stack:** uni-app Vue 3/Vite/TypeScript, Vitest, UTS, Kotlin, Android SQLiteOpenHelper, AndroidX WorkManager.

## Global Constraints

- Project root is exactly `D:\myFile\SmsBackup`; do not add a nested `uniapp` directory.
- Android only; minimum SDK 26; no iOS, H5, or mini-program implementation.
- Do not initialize Git because the target was not an existing Git repository and the user did not request it.
- Do not hide the app, bypass force-stop, use root, or access SMS before explicit user authorization.
- Never print SMS bodies to ordinary logs.
- Server URL is user-configurable; queued messages remain local until the server acknowledges them.
- Use UTF-8 for all source and documentation files.

---

### Task 1: Scaffold and deterministic domain rules

**Files:**
- Create from official template: `package.json`, `src/manifest.json`, `src/pages.json`, `src/main.ts`, `src/App.vue`
- Create: `src/domain/blacklist.ts`
- Create: `src/domain/server-url.ts`
- Create: `src/domain/upload-record.ts`
- Create: `tests/domain/blacklist.test.ts`
- Create: `tests/domain/server-url.test.ts`
- Create: `tests/domain/upload-record.test.ts`

**Interfaces:**
- Produces: `matchesBlacklist(sender, body, rules): BlacklistMatch | null`
- Produces: `normalizeServerUrl(value): string`
- Produces: `createRecordId(deviceId, sourceId, direction): string`

- [ ] **Step 1: Scaffold the official TypeScript template**

Run the official `dcloudio/uni-preset-vue#vite-ts` template into a temporary directory, move its contents into the verified project root, remove only the empty temporary directory, and keep the existing `docs` directory.

- [ ] **Step 2: Write failing domain tests**

```ts
expect(matchesBlacklist('淘宝', '您的包裹已发出', rules)?.rule.value).toBe('淘宝')
expect(matchesBlacklist('10690000', '限时促销，回复TD退订', rules)?.rule.value).toBe('退订')
expect(matchesBlacklist('妈妈', '晚上回家吃饭', rules)).toBeNull()
expect(normalizeServerUrl(' https://example.com/ ')).toBe('https://example.com')
expect(() => normalizeServerUrl('ftp://example.com')).toThrow('仅支持 HTTP 或 HTTPS')
expect(createRecordId('device 1', '42', 'inbox')).toBe('device%201:42:inbox')
```

- [ ] **Step 3: Run tests and verify RED**

Run: `npm test -- --run tests/domain`

Expected: FAIL because the domain modules do not exist.

- [ ] **Step 4: Implement minimal domain rules**

Implement case-insensitive sender and body `contains` rules, URL trimming and scheme validation, and deterministic escaped record IDs.

- [ ] **Step 5: Run tests and verify GREEN**

Run: `npm test -- --run tests/domain`

Expected: all domain tests pass without warnings.

### Task 2: Build the visible uni-app pages

**Files:**
- Create: `src/pages/index/index.vue`
- Create: `src/pages/blacklist/blacklist.vue`
- Create: `src/pages/settings/settings.vue`
- Create: `src/services/sms-backup.ts`
- Create: `src/stores/settings.ts`
- Create: `src/stores/blacklist.ts`
- Modify: `src/pages.json`
- Modify: `src/manifest.json`
- Test: `tests/stores/settings.test.ts`
- Test: `tests/stores/blacklist.test.ts`

**Interfaces:**
- Consumes: domain functions from Task 1.
- Produces: `getSettings`, `saveSettings`, `getRules`, `saveRules`, and `smsBackupService` methods used by pages.

- [ ] **Step 1: Write failing store tests**

```ts
expect(loadSettings(emptyStorage).syncEnabled).toBe(true)
expect(loadRules(emptyStorage).some(rule => rule.value === '淘宝')).toBe(true)
expect(loadRules(emptyStorage).some(rule => rule.value === '拼多多')).toBe(true)
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- --run tests/stores`

Expected: FAIL because stores are missing.

- [ ] **Step 3: Implement stores and pages**

Create a compact three-page UI: dashboard/authorization, editable blacklist, and server/device settings. Show permission state, pending/uploaded/filtered counts, last sync time, and explicit Android force-stop limitations.

- [ ] **Step 4: Verify GREEN and compile the frontend**

Run: `npm test -- --run tests/stores`

Run: `npm run build:app-plus`

Expected: tests pass and app-plus resources compile.

### Task 3: Implement Android SMS access and reliable local queue

**Files:**
- Create: `src/uni_modules/sms-backup-native/package.json`
- Create: `src/uni_modules/sms-backup-native/utssdk/interface.uts`
- Create: `src/uni_modules/sms-backup-native/utssdk/app-android/index.uts`
- Create: `src/uni_modules/sms-backup-native/utssdk/app-android/config.json`
- Create: `src/uni_modules/sms-backup-native/utssdk/app-android/AndroidManifest.xml`
- Create: `src/uni_modules/sms-backup-native/utssdk/app-android/SmsModels.kt`
- Create: `src/uni_modules/sms-backup-native/utssdk/app-android/SmsFilter.kt`
- Create: `src/uni_modules/sms-backup-native/utssdk/app-android/SmsQueueDatabase.kt`
- Create: `src/uni_modules/sms-backup-native/utssdk/app-android/SmsRepository.kt`
- Create: `src/uni_modules/sms-backup-native/utssdk/app-android/SmsBackupNative.kt`
- Test: `tests/native/native-contract.test.ts`

**Interfaces:**
- Produces UTS APIs: `getPermissionState`, `requestPermissions`, `scanExistingMessages`, `getBackupStatus`, `saveNativeSettings`, `saveNativeRules`, `clearQueue`.

- [ ] **Step 1: Write a failing native contract test**

The test reads plugin sources and asserts that the manifest contains `READ_SMS`, `RECEIVE_SMS`, and `INTERNET`, the config sets `minSdkVersion` to 26, the database declares a unique record ID, and the UTS interface exposes every required method.

- [ ] **Step 2: Verify RED**

Run: `npm test -- --run tests/native/native-contract.test.ts`

Expected: FAIL because the plugin files are absent.

- [ ] **Step 3: Implement permission and historical scan path**

Use Android runtime permission APIs and `content://sms` through `ContentResolver`. Normalize inbox/sent direction, sender, body, timestamp, source ID, and subscription ID. Run provider scans on an IO dispatcher and return counts rather than message bodies to the UI.

- [ ] **Step 4: Implement SQLite queue and filtering**

Persist settings and rules in SharedPreferences. Filter before queue insertion. Use `record_id TEXT UNIQUE` with insert-ignore semantics so repeated full scans do not duplicate messages.

- [ ] **Step 5: Verify native contract GREEN**

Run: `npm test -- --run tests/native/native-contract.test.ts`

Expected: native contract test passes.

### Task 4: Implement killed-process receipt, retry upload, and reconciliation

**Files:**
- Create: `src/uni_modules/sms-backup-native/utssdk/app-android/SmsReceiver.kt`
- Create: `src/uni_modules/sms-backup-native/utssdk/app-android/SmsUploadWorker.kt`
- Create: `src/uni_modules/sms-backup-native/utssdk/app-android/SmsReconcileWorker.kt`
- Create: `src/uni_modules/sms-backup-native/utssdk/app-android/WorkScheduler.kt`
- Modify: `src/uni_modules/sms-backup-native/utssdk/app-android/AndroidManifest.xml`
- Modify: `src/uni_modules/sms-backup-native/utssdk/app-android/config.json`
- Test: `tests/native/background-contract.test.ts`

**Interfaces:**
- Consumes: repository and queue from Task 3.
- Produces: manifest receiver for `SMS_RECEIVED`, unique upload work, and daily reconciliation work.

- [ ] **Step 1: Write failing background contract tests**

Assert the manifest receiver is exported for the protected system broadcast, WorkManager is declared as a dependency, uploads require a connected network, retries use backoff, and reconciliation uses unique periodic work.

- [ ] **Step 2: Verify RED**

Run: `npm test -- --run tests/native/background-contract.test.ts`

Expected: FAIL because receiver and workers do not exist.

- [ ] **Step 3: Implement receiver and workers**

`SmsReceiver` parses PDUs and performs only fast queue writes. `SmsUploadWorker` sends queued JSON to `{serverUrl}/api/sms` via `HttpURLConnection`, marks only HTTP 2xx records uploaded, and retries network/5xx failures. `SmsReconcileWorker` rescans provider messages once per day. `WorkScheduler` registers unique work when the app initializes and after settings change.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- --run tests/native/background-contract.test.ts`

Expected: background contract tests pass.

### Task 5: Integrate, document, and verify

**Files:**
- Modify: `src/services/sms-backup.ts`
- Modify: `src/pages/index/index.vue`
- Modify: `src/pages/blacklist/blacklist.vue`
- Modify: `src/pages/settings/settings.vue`
- Create: `README.md`
- Create: `docs/android-device-test-checklist.md`

**Interfaces:**
- Consumes all public UTS methods.
- Produces a buildable project and explicit HBuilderX/device setup instructions.

- [ ] **Step 1: Add integration tests for native-unavailable fallback**

Ensure desktop test execution returns a clear `仅支持 Android App` result instead of crashing when the UTS module is unavailable.

- [ ] **Step 2: Connect pages to the UTS plugin**

Initialize native work on application startup, copy settings and rules into native storage after every edit, trigger the first scan only from the visible authorization action, and refresh dashboard counts without exposing SMS bodies.

- [ ] **Step 3: Run complete automated verification**

Run: `npm test -- --run`

Run: `npm run type-check`

Run: `npm run build:app-plus`

Expected: all available checks pass. If Android native compilation cannot run because HBuilderX/JDK is not installed, report that exact environmental limitation and do not claim an APK was verified.

- [ ] **Step 4: Self-review against the design**

Verify no TODO/TBD placeholders, no SMS body logging, no iOS/H5 implementation, all user-visible permissions are explicit, and all files stay under `D:\myFile\SmsBackup`.
