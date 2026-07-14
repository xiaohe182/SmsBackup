# Node Text SMS Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dependency-free Node.js HTTP service that accepts SmsBackup payloads and stores each unique message in a Notepad-readable text file.

**Architecture:** `server.js` owns HTTP routing and request limits, while `sms-store.js` owns file initialization and serialized idempotent appends. Tests start the real server on an ephemeral port and verify both HTTP responses and file contents.

**Tech Stack:** Node.js 18+ built-in `http`, `fs/promises`, `node:test`, and `fetch`.

## Global Constraints

- No third-party runtime or test dependencies.
- Endpoints must remain `GET /api/health` and `POST /api/sms`.
- Default output is `server/data/sms-records.txt` using JSON Lines text.
- Duplicate `recordId` values return success without a second line.
- Maximum request body is exactly 1 MiB.

---

### Task 1: HTTP and storage behavior tests

**Files:**
- Create: `server/test/sms-server.test.js`

**Interfaces:**
- Consumes `createSmsServer({ dataFile, maxBodyBytes })` from `server/server.js`.
- Verifies health, successful append, duplicate handling, validation, and restart recovery.

- [ ] **Step 1: Create a real-server failing test.**

```js
const server = await createSmsServer({ dataFile });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const response = await fetch(`${baseUrl}/api/sms`, {
  method: "POST",
  headers: { "content-type": "application/json", "idempotency-key": payload.recordId },
  body: JSON.stringify(payload),
});
assert.equal(response.status, 200);
assert.equal((await response.json()).duplicate, false);
```

- [ ] **Step 2: Run `node --test`; expect failure because `server.js` does not exist.**

### Task 2: Serialized text store

**Files:**
- Create: `server/sms-store.js`

**Interfaces:**
- Produces `TextSmsStore.initialize(): Promise<void>`.
- Produces `TextSmsStore.append(record): Promise<boolean>`, where `true` means written and `false` means duplicate.

- [ ] **Step 1: Load existing JSON lines and collect valid `recordId` strings.**
- [ ] **Step 2: Serialize append operations through a Promise chain.**

```js
this.writeQueue = this.writeQueue.then(async () => {
  if (this.recordIds.has(record.recordId)) return false;
  await appendFile(this.filePath, `${JSON.stringify(record)}\n`, "utf8");
  this.recordIds.add(record.recordId);
  return true;
});
```

### Task 3: Node HTTP server

**Files:**
- Create: `server/server.js`
- Create: `server/package.json`
- Create: `server/.gitignore`

**Interfaces:**
- Produces `createSmsServer(options): Promise<http.Server>`.
- CLI reads `HOST`, `PORT`, and `SMS_DATA_FILE` and starts the same server.

- [ ] **Step 1: Implement JSON responses, the 1 MiB reader, payload validation, and both routes.**
- [ ] **Step 2: Validate `Idempotency-Key` against `recordId` when both are present.**
- [ ] **Step 3: Add `npm start` and `npm test` scripts without dependencies.**
- [ ] **Step 4: Run `npm test`; expect all server tests to pass.**

### Task 4: Deployment documentation and live verification

**Files:**
- Create: `server/README.md`
- Modify: `README.md`

- [ ] **Step 1: Document local, LAN, and environment-variable startup commands.**
- [ ] **Step 2: Start on an ephemeral port and send a real health request and SMS request.**
- [ ] **Step 3: Verify the produced text file has one JSON line and the repeated request does not add another.**

