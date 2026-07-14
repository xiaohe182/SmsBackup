# Protected SMS Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a password-gated Android page that reads and displays every SMS record stored by the system provider.

**Architecture:** Keep password feedback and session locking in a small TypeScript domain module and the Vue page, while enforcing the same fixed password again at the Kotlin native boundary before any `ContentResolver` query. Extend the existing UTS service adapter with one JSON-returning method so the current backup/upload pipeline remains untouched.

**Tech Stack:** uni-app Vue 3, TypeScript, UTS, Kotlin, Android `Telephony.Sms`, Vitest.

## Global Constraints

- Android only; minimum Android API remains 26.
- Fixed viewer password is exactly `88888888`.
- Do not change upload filtering, background reception, queueing, or server payload behavior.
- Do not persist viewed SMS bodies outside the existing Android system SMS provider.
- Lock and clear the viewer whenever the page is hidden or unloaded.

---

### Task 1: Password and service contracts

**Files:**
- Create: `src/domain/sms-access.ts`
- Modify: `src/services/sms-backup.ts`
- Modify: `tests/stubs/sms-backup-native.ts`
- Test: `tests/domain/sms-access.test.ts`
- Test: `tests/services/android-sms-backup.test.ts`

**Interfaces:**
- Produces: `SMS_VIEWER_PASSWORD`, `isSmsViewerPasswordValid(value: string): boolean`.
- Produces: `SmsMessage`, `SmsMessageListResult`, and `SmsBackupService.listAllMessages(password)`.
- Consumes native `getAllMessages(password): Promise<string>` returning `{ authorized, permissionGranted, messages }`.

- [ ] **Step 1: Write failing tests** for exact password acceptance, whitespace rejection, native password forwarding, JSON parsing, and unauthorized responses.
- [ ] **Step 2: Run tests and verify RED** with missing module/method failures.
- [ ] **Step 3: Add the minimal domain function and service response parser.**
- [ ] **Step 4: Run focused tests and verify GREEN.**

### Task 2: Native password gate and complete SMS query

**Files:**
- Modify: `src/uni_modules/sms-backup-native/index.d.ts`
- Modify: `src/uni_modules/sms-backup-native/utssdk/interface.uts`
- Modify: `src/uni_modules/sms-backup-native/utssdk/app-android/index.uts`
- Modify: `src/uni_modules/sms-backup-native/utssdk/app-android/SmsBackupNative.kt`
- Modify: `src/uni_modules/sms-backup-native/utssdk/app-android/SmsRepository.kt`
- Test: `tests/native/native-contract.test.ts`

**Interfaces:**
- Produces UTS `getAllMessages(password: string): Promise<string>`.
- Produces Kotlin `SmsBackupNative.getAllMessagesJson(password: String): String`.
- Produces repository JSON with `sourceId`, `address`, `body`, `receivedAt`, `sentAt`, `direction`, `read`, `seen`, `status`, and `simSubscriptionId`.

- [ ] **Step 1: Add failing static contract tests** proving the password is checked before repository access and the query includes all SMS types ordered by descending date.
- [ ] **Step 2: Run the native contract test and verify RED.**
- [ ] **Step 3: Implement the UTS bridge, Kotlin password gate, permission result, and provider query.**
- [ ] **Step 4: Run native contract tests and verify GREEN.**

### Task 3: Locked viewer page and home entry

**Files:**
- Create: `src/pages/messages/messages.vue`
- Modify: `src/pages/index/index.vue`
- Modify: `src/pages.json`
- Test: `tests/pages/messages-contract.test.ts`

**Interfaces:**
- Consumes `isSmsViewerPasswordValid` and `smsBackupService.listAllMessages`.
- Produces route `/pages/messages/messages`.

- [ ] **Step 1: Add a failing page contract test** for the route, home navigation, password input, password validation, list API call, and page-hide locking.
- [ ] **Step 2: Run the page test and verify RED.**
- [ ] **Step 3: Implement the password overlay, permission handling, refresh action, metadata labels, complete body display, and page lifecycle clearing.**
- [ ] **Step 4: Run page and full tests and verify GREEN.**

### Task 4: Documentation and build verification

**Files:**
- Modify: `README.md`
- Modify: `docs/android-device-test-checklist.md`

- [ ] **Step 1: Document the viewer password behavior and its fixed-password security limitation.**
- [ ] **Step 2: Add device checks for wrong password, correct password, all SMS types, background re-lock, and denied permission.**
- [ ] **Step 3: Run `npm test -- --run`; expect all tests to pass.**
- [ ] **Step 4: Run `npm run type-check`; expect exit code 0.**
- [ ] **Step 5: Run `npm run build:app-plus`; expect `DONE Build complete.`**

