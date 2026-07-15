# Unattended SMS Text Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After one explicit Android SMS permission grant, automatically archive both received and sent SMS to a directly runnable Node.js service backed only by TXT, and expose authenticated paged JSON and Markdown reads.

**Architecture:** Keep the existing manifest `SMS_RECEIVED` path as the immediate received-message path, then add unique immediate and 15-minute WorkManager reconciliation for received/sent history plus boot/package-replace recovery. Keep the phone's private SQLite reliability queue, but keep the Node service database-free by extending `TextSmsStore` with an in-memory read index rebuilt from `sms-records.txt`; all protected POST/GET routes use the same configurable Bearer token.

**Tech Stack:** uni-app Vue 3 + TypeScript, UTS/Kotlin Android plugin, AndroidX WorkManager 2.10.1, Node.js 18+ built-in modules, Vitest, Node test runner.

## Global Constraints

- Android only, minimum SDK 26.
- The device owner must grant `READ_SMS` and `RECEIVE_SMS` once; never bypass Android permission UI.
- Include both received (`inbox`) and sent (`sent`) records.
- Received SMS uses `SMS_RECEIVED` for immediate queuing; sent SMS is best-effort through startup/boot/15-minute reconciliation because a non-default SMS app has no equivalent sent broadcast.
- System “Force stop” remains an explicit unsupported state until the user opens the app again.
- Node remains zero third-party dependencies and uses no database.
- Node stores one JSON object per line in `server/data/sms-records.txt`; Markdown is generated, not stored as a second fact source.
- Default server URL is exactly `http://119.91.65.202:8787`.
- Default API token is exactly `88888888`, configurable in the app and by `SMS_BACKUP_TOKEN` on Node.
- Preserve all existing no-filter SMS behavior, viewer password, pagination, contact identity, MMS viewer, and local reliable queue behavior.
- Add concise Chinese comments around scheduling, migration, paging, token, and Markdown escaping logic.

---

### Task 1: Default Server and Backward-Compatible Token Settings

**Files:**
- Modify: `src/stores/settings.ts`
- Modify: `tests/stores/settings.test.ts`

**Interfaces:**
- Produces: `AppSettings.apiToken: string`
- Produces: `DEFAULT_SERVER_URL = "http://119.91.65.202:8787"`
- Produces: `DEFAULT_API_TOKEN = "88888888"`
- Consumed by: settings UI, bootstrap native settings JSON, `SmsUploadWorker.UploadSettings`

- [ ] **Step 1: Write failing settings tests**

Add tests that lock the public-IP default and migrate old settings without `apiToken`:

```ts
it("defaults to the configured public TXT server and compatibility token", () => {
  expect(DEFAULT_SETTINGS).toMatchObject({
    serverUrl: "http://119.91.65.202:8787",
    apiToken: "88888888",
    syncEnabled: true,
    allowInsecureHttp: true,
  });
});

it("migrates legacy settings without losing the configured device", () => {
  const settings = loadSettings(createStorage({
    "sms-backup:settings": {
      serverUrl: "",
      deviceName: "父亲手机",
      syncEnabled: true,
      allowInsecureHttp: false,
    },
  }));
  expect(settings).toEqual({
    ...DEFAULT_SETTINGS,
    deviceName: "父亲手机",
  });
});

it("normalizes an empty token to the compatibility token", () => {
  const saved = saveSettings(createStorage(), {
    ...DEFAULT_SETTINGS,
    apiToken: "   ",
  });
  expect(saved.apiToken).toBe("88888888");
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest --config vitest.config.mts tests/stores/settings.test.ts --run`

Expected: FAIL because `apiToken`, `DEFAULT_SERVER_URL`, and legacy migration do not exist.

- [ ] **Step 3: Implement defaults and migration**

In `src/stores/settings.ts`, add exact constants and field:

```ts
export const DEFAULT_SERVER_URL = "http://119.91.65.202:8787";
export const DEFAULT_API_TOKEN = "88888888";

export interface AppSettings {
  serverUrl: string;
  apiToken: string;
  deviceName: string;
  syncEnabled: boolean;
  allowInsecureHttp: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  serverUrl: DEFAULT_SERVER_URL,
  apiToken: DEFAULT_API_TOKEN,
  deviceName: "家人手机",
  syncEnabled: true,
  allowInsecureHttp: true,
};
```

Replace all-or-nothing stored-value validation with a parser that requires the four legacy fields, preserves a real stored URL, migrates an empty stored URL to `DEFAULT_SERVER_URL`, and fills a missing/blank token with `DEFAULT_API_TOKEN`. In `saveSettings`, use `settings.apiToken.trim() || DEFAULT_API_TOKEN`.

- [ ] **Step 4: Run focused settings tests and verify GREEN**

Run: `npx vitest --config vitest.config.mts tests/stores/settings.test.ts --run`

Expected: all settings tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/stores/settings.ts tests/stores/settings.test.ts
git commit -m "feat: configure default SMS text server"
```

---

### Task 2: Immediate, Periodic, and Boot Reconciliation for Inbox and Sent SMS

**Files:**
- Create: `src/uni_modules/sms-backup-native/utssdk/app-android/BootReceiver.kt`
- Modify: `src/uni_modules/sms-backup-native/utssdk/app-android/AndroidManifest.xml`
- Modify: `src/uni_modules/sms-backup-native/utssdk/app-android/WorkScheduler.kt`
- Modify: `src/pages/index/index.vue`
- Modify: `tests/native/background-contract.test.ts`
- Create: `tests/pages/index-contract.test.ts`

**Interfaces:**
- Produces: `WorkScheduler.enqueueReconciliation(context: Context)`
- Produces: manifest `BootReceiver` for `BOOT_COMPLETED` and `MY_PACKAGE_REPLACED`
- Consumes: existing `SmsReconcileWorker`, which already calls `scanExistingMessages()` for both inbox and sent SMS

- [ ] **Step 1: Write failing native and page contract tests**

Replace the old 24-hour expectation and add boot/immediate expectations:

```ts
it("reconciles inbox and sent SMS immediately and every fifteen minutes", () => {
  const scheduler = read("WorkScheduler.kt");
  const repository = read("SmsRepository.kt");
  expect(scheduler).toContain("enqueueReconciliation");
  expect(scheduler).toContain("15, TimeUnit.MINUTES");
  expect(scheduler).toContain('RECONCILE_NOW_WORK_NAME');
  expect(repository).toContain("Telephony.Sms.MESSAGE_TYPE_INBOX");
  expect(repository).toContain("Telephony.Sms.MESSAGE_TYPE_SENT");
});

it("restores background work after boot and app replacement", () => {
  const manifest = read("AndroidManifest.xml");
  const receiver = read("BootReceiver.kt");
  expect(manifest).toContain("android.permission.RECEIVE_BOOT_COMPLETED");
  expect(manifest).toContain("android.intent.action.BOOT_COMPLETED");
  expect(manifest).toContain("android.intent.action.MY_PACKAGE_REPLACED");
  expect(receiver).toContain("WorkScheduler.initialize");
});
```

Create `tests/pages/index-contract.test.ts`:

```ts
it("describes automatic collection and treats manual scanning as reconciliation", () => {
  const page = readFileSync(resolve("src/pages/index/index.vue"), "utf8");
  expect(page).toContain("授权一次后自动收集");
  expect(page).toContain("立即补扫");
  expect(page).toContain("await smsBackupService.syncNow()");
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npx vitest --config vitest.config.mts tests/native/background-contract.test.ts tests/pages/index-contract.test.ts --run`

Expected: FAIL on missing boot receiver, immediate reconciliation, 15-minute interval, and new copy.

- [ ] **Step 3: Implement scheduler and boot receiver**

Update `WorkScheduler.initialize`:

```kt
fun initialize(context: Context) {
    scheduleReconciliation(context)
    enqueueReconciliation(context)
    enqueueUpload(context)
}

fun enqueueReconciliation(context: Context) {
    val request = OneTimeWorkRequestBuilder<SmsReconcileWorker>().build()
    WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
        RECONCILE_NOW_WORK_NAME,
        ExistingWorkPolicy.KEEP,
        request
    )
}
```

Use `PeriodicWorkRequestBuilder<SmsReconcileWorker>(15, TimeUnit.MINUTES)` and separate constants `RECONCILE_NOW_WORK_NAME` and `RECONCILE_PERIODIC_WORK_NAME`.

Create `BootReceiver.kt`:

```kt
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (
            intent.action != Intent.ACTION_BOOT_COMPLETED &&
            intent.action != Intent.ACTION_MY_PACKAGE_REPLACED
        ) return
        // WorkManager 使用唯一任务，重复启动不会产生并发扫描。
        WorkScheduler.initialize(context.applicationContext)
    }
}
```

Add `RECEIVE_BOOT_COMPLETED` and the receiver with only the two system actions to the manifest.

- [ ] **Step 4: Update home behavior and copy**

Keep the explicit permission button. After `scanExistingMessages()` in `authorizeAndScan`, call `await smsBackupService.syncNow()`. Change the authorized button text to `立即补扫收发短信` and the subtitle/notice to state that authorization once enables automatic collection.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npx vitest --config vitest.config.mts tests/native/background-contract.test.ts tests/pages/index-contract.test.ts --run`

Expected: all focused tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/uni_modules/sms-backup-native/utssdk/app-android/BootReceiver.kt src/uni_modules/sms-backup-native/utssdk/app-android/AndroidManifest.xml src/uni_modules/sms-backup-native/utssdk/app-android/WorkScheduler.kt src/pages/index/index.vue tests/native/background-contract.test.ts tests/pages/index-contract.test.ts
git commit -m "feat: reconcile received and sent SMS automatically"
```

---

### Task 3: Bearer Token from App Settings to Node Upload

**Files:**
- Modify: `src/pages/settings/settings.vue`
- Modify: `src/uni_modules/sms-backup-native/utssdk/app-android/SmsUploadWorker.kt`
- Modify: `tests/native/background-contract.test.ts`
- Modify: `tests/pages/index-contract.test.ts`

**Interfaces:**
- Consumes: `AppSettings.apiToken`
- Produces: HTTP request header `Authorization: Bearer <apiToken>`
- Consumed by: protected Node POST and GET endpoints in Task 4

- [ ] **Step 1: Write failing token-flow tests**

Add these assertions:

```ts
it("sends the configured Bearer token without logging it", () => {
  const worker = read("SmsUploadWorker.kt");
  expect(worker).toContain('setRequestProperty("Authorization", "Bearer ${settings.apiToken}")');
  expect(worker).toContain('value.optString("apiToken", "88888888")');
  expect(worker).not.toContain("println(");
  expect(worker).not.toContain("Log.");
});
```

The settings-page contract must contain `v-model="form.apiToken"`, `type="password"`, and the public HTTP warning.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npx vitest --config vitest.config.mts tests/native/background-contract.test.ts tests/pages/index-contract.test.ts --run`

Expected: FAIL because the upload settings and UI do not have `apiToken`.

- [ ] **Step 3: Implement native token parsing and header**

Extend `UploadSettings`:

```kt
private data class UploadSettings(
    val serverUrl: String,
    val apiToken: String,
    val deviceName: String,
    val syncEnabled: Boolean,
    val allowInsecureHttp: Boolean
)
```

Parse `apiToken = value.optString("apiToken", "88888888").ifBlank { "88888888" }`, use the same fallback in the catch branch, and set:

```kt
connection.setRequestProperty("Authorization", "Bearer ${settings.apiToken}")
```

Never log the token or SMS body.

- [ ] **Step 4: Add token input and explicit public-HTTP warning**

In `settings.vue`, place this after the server address:

```vue
<text class="label spaced">访问令牌</text>
<input
  v-model="form.apiToken"
  class="input"
  type="password"
  placeholder="88888888"
/>
<text class="hint">必须与服务器 SMS_BACKUP_TOKEN 一致</text>
```

Change the HTTP warning to `公网 HTTP 会明文传输短信和令牌，建议后续配置 HTTPS`.

- [ ] **Step 5: Run focused tests and type-check**

Run:

```powershell
npx vitest --config vitest.config.mts tests/native/background-contract.test.ts tests/pages/index-contract.test.ts --run
npm run type-check
```

Expected: focused tests and type-check PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/pages/settings/settings.vue src/uni_modules/sms-backup-native/utssdk/app-android/SmsUploadWorker.kt tests/native/background-contract.test.ts tests/pages/index-contract.test.ts
git commit -m "feat: authenticate SMS text uploads"
```

---

### Task 4: Authenticated TXT Paging and Markdown Export

**Files:**
- Modify: `server/sms-store.js`
- Create: `server/markdown-export.js`
- Modify: `server/server.js`
- Modify: `server/test/sms-server.test.js`
- Modify: `server/README.md`

**Interfaces:**
- Produces: `TextSmsStore.query({ limit, offset, deviceId, direction })`
- Produces: `formatSmsMarkdown(records): string`
- Produces: protected `POST /api/sms`, `GET /api/sms`, `GET /api/sms/export.md`
- Consumes: `Authorization: Bearer <SMS_BACKUP_TOKEN>`

- [ ] **Step 1: Write failing Node endpoint tests**

Update `startServer` to pass its options through to `createSmsServer`; update `postSms` to send `authorization: "Bearer test-token"` by default. Add this concrete temp-server helper and the endpoint tests:

```js
async function startServerWithTempFile(t) {
  const directory = await mkdtemp(join(tmpdir(), "sms-server-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const app = await startServer({
    dataFile: join(directory, "sms-records.txt"),
    accessToken: "test-token",
  });
  t.after(app.close);
  return app;
}

test("rejects missing or incorrect Bearer tokens", async (t) => {
  const app = await startServerWithTempFile(t);
  const missing = await postSms(app.baseUrl, VALID_RECORD, { authorization: "" });
  const wrong = await postSms(app.baseUrl, VALID_RECORD, {
    authorization: "Bearer wrong",
  });
  assert.equal(missing.status, 401);
  assert.equal(wrong.status, 401);
});

test("returns newest-first paged TXT records with filters", async (t) => {
  const app = await startServerWithTempFile(t);
  await postSms(app.baseUrl, VALID_RECORD);
  await postSms(app.baseUrl, {
    ...VALID_RECORD,
    recordId: "device-2:43:sent",
    deviceId: "device-2",
    sourceId: "43",
    direction: "sent",
    receivedAt: VALID_RECORD.receivedAt + 1,
  });
  const response = await fetch(
    `${app.baseUrl}/api/sms?limit=1&offset=0&direction=sent`,
    { headers: { authorization: "Bearer test-token" } },
  );
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].recordId, "device-2:43:sent");
  assert.deepEqual({
    offset: 0,
    limit: 1,
    totalCount: 1,
    hasMore: false,
  }, {
    offset: result.offset,
    limit: result.limit,
    totalCount: result.totalCount,
    hasMore: result.hasMore,
  });
});

test("exports escaped UTF-8 Markdown", async (t) => {
  const app = await startServerWithTempFile(t);
  await postSms(app.baseUrl, { ...VALID_RECORD, body: "第一行\n<敏感>" });
  const response = await fetch(`${app.baseUrl}/api/sms/export.md`, {
    headers: { authorization: "Bearer test-token" },
  });
  assert.match(response.headers.get("content-type"), /text\/markdown/);
  const markdown = await response.text();
  assert.match(markdown, /第一行/);
  assert.doesNotMatch(markdown, /<敏感>/);
  assert.match(markdown, /&lt;敏感&gt;/);
});
```

- [ ] **Step 2: Run Node tests and verify RED**

Run: `npm test` from `D:\myFile\SmsBackup\server`

Expected: FAIL because auth, `GET /api/sms`, and Markdown export do not exist.

- [ ] **Step 3: Extend the TXT store read index**

In `TextSmsStore`, add `this.records = []`; during `initialize`, push every valid parsed object with a non-empty `recordId`; during `append`, push the just-written record. Add:

```js
query({ limit, offset, deviceId = "", direction = "" }) {
  const filtered = this.records.filter((record) =>
    (!deviceId || record.deviceId === deviceId) &&
    (!direction || record.direction === direction),
  );
  const newestFirst = filtered.slice().reverse();
  return {
    items: newestFirst.slice(offset, offset + limit),
    totalCount: newestFirst.length,
  };
}
```

Return copies from the query response so route code cannot mutate the store index.

- [ ] **Step 4: Implement Markdown formatting**

Create `server/markdown-export.js` with `escapeHtml` replacing `&`, `<`, `>`, `"`, and `'`. `formatSmsMarkdown(records)` must return a heading plus one section per record and wrap the escaped body in `<pre>...</pre>` so arbitrary newlines and Markdown syntax cannot break record boundaries.

- [ ] **Step 5: Implement token and read routes**

In `createSmsServer`, accept `accessToken = process.env.SMS_BACKUP_TOKEN || "88888888"`, reject blank tokens at startup, and use:

```js
function hasValidBearerToken(request, accessToken) {
  return request.headers.authorization === `Bearer ${accessToken}`;
}
```

Keep `/api/health` public. Require auth before POST/GET protected routes. Parse `limit` and `offset` with strict integer validation; return `400 { ok: false, error: "invalid_pagination" }` outside `limit=1..100` or `offset>=0`. Validate direction as blank, `inbox`, or `sent`.

Use `sendJson` for paged JSON. For Markdown, set `content-type: text/markdown; charset=utf-8`, `content-disposition: attachment; filename="sms-backup.md"`, `cache-control: no-store`, and the exact UTF-8 byte length.

- [ ] **Step 6: Run Node tests and verify GREEN**

Run: `npm test` from `D:\myFile\SmsBackup\server`

Expected: all Node tests PASS, including restart idempotency, auth, paging, filters, validation, and Markdown.

- [ ] **Step 7: Document direct deployment**

Update `server/README.md` with:

```powershell
$env:SMS_BACKUP_TOKEN="88888888"
$env:HOST="0.0.0.0"
$env:PORT="8787"
npm start
```

Document firewall port 8787, the public-IP URL, GET examples with `Authorization`, the TXT path, and the public-HTTP plaintext warning. Do not document any database step.

- [ ] **Step 8: Commit**

```powershell
git add server/sms-store.js server/markdown-export.js server/server.js server/test/sms-server.test.js server/README.md
git commit -m "feat: expose authenticated TXT SMS archive"
```

---

### Task 5: User Documentation and Device Acceptance Coverage

**Files:**
- Modify: `README.md`
- Modify: `docs/android-device-test-checklist.md`
- Modify: `docs/protected-sms-viewer.md`

**Interfaces:**
- Documents: one-time permission, automatic inbox capture, sent reconciliation, TXT/Markdown APIs, public-IP configuration, force-stop and sent-delete timing boundaries

- [ ] **Step 1: Update documentation with exact behavior**

Add these facts without claiming stronger Android guarantees:

- Default server `http://119.91.65.202:8787` and default token `88888888`.
- Node stores `server/data/sms-records.txt`; there is no server database.
- New inbox SMS queues immediately after one-time permission.
- Both inbox and sent are scanned at authorization, app start, boot recovery, and periodic reconciliation.
- Periodic sent reconciliation is inexact; sent-and-immediately-deleted records can be missed unless the app becomes the default SMS handler.
- Force stop pauses every automatic path until the app is opened again.
- Public HTTP exposes SMS and token to network observers; HTTPS reverse proxy is the required hardening step for real Internet use.
- `GET /api/sms` and `GET /api/sms/export.md` require the Bearer token.

- [ ] **Step 2: Extend the device checklist**

Add explicit cases for received/sent, background swipe, reboot, network recovery, duplicate prevention, wrong token, query pagination, Markdown output, immediate sent deletion limitation, and force-stop recovery.

- [ ] **Step 3: Run documentation checks**

Run:

```powershell
rg -n "119\.91\.65\.202|sms-records\.txt|GET /api/sms|SMS_BACKUP_TOKEN|已发送|强行停止" README.md docs server/README.md
git diff --check
```

Expected: every boundary is present and `git diff --check` exits 0.

- [ ] **Step 4: Commit**

```powershell
git add README.md docs/android-device-test-checklist.md docs/protected-sms-viewer.md
git commit -m "docs: explain unattended TXT SMS collection"
```

---

### Task 6: Full Verification and Handoff

**Files:**
- Verify only; modify tests or implementation only if a check exposes a defect

**Interfaces:**
- Verifies all application, native, server, type, and App resource build contracts

- [ ] **Step 1: Run all application tests**

Run: `npm test -- --run` from `D:\myFile\SmsBackup`

Expected: every Vitest file and test PASS with zero failures.

- [ ] **Step 2: Run all Node tests**

Run: `npm test` from `D:\myFile\SmsBackup\server`

Expected: every Node test PASS with zero failures.

- [ ] **Step 3: Run type-check and App resource build**

Run:

```powershell
npm run type-check
npm run build:app-plus
```

Expected: `vue-tsc --noEmit` exits 0; uni-app compiler 4.87 prints `DONE Build complete.`

- [ ] **Step 4: Run security and scope scans**

Run:

```powershell
rg -n "Authorization|apiToken|SMS_BACKUP_TOKEN" src server tests
rg -n "Log\.|println\(" src/uni_modules/sms-backup-native/utssdk/app-android/SmsUploadWorker.kt
git diff --check
git status --short
```

Expected: token wiring exists, upload worker has no content/token logging, diff check exits 0, and the worktree is clean after commits.

- [ ] **Step 5: Confirm no unintended APK was generated**

Run:

```powershell
$apk = @(rg --files -g '*.apk' -g '!node_modules' 2>$null)
if ($apk.Count) { $apk; exit 1 } else { Write-Output 'NO_APK' }
```

Expected: `NO_APK`.

- [ ] **Step 6: Preserve the feature branch**

Keep `dev-sms-viewer-performance` unmerged and unpushed unless the user explicitly asks otherwise. Report commits, automated evidence, the Node start command, and the remaining real-device checklist.
