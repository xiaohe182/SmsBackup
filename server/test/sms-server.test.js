import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createSmsServer } from "../server.js";

const TEST_TOKEN = "test-token";

const VALID_RECORD = {
  recordId: "device-1:42:inbox",
  deviceId: "device-1",
  deviceName: "家人手机",
  sourceId: "42",
  sender: "10086",
  body: "短信正文\n第二行",
  receivedAt: 1783900800000,
  direction: "inbox",
  simSubscriptionId: 1,
};

async function startServer(options = {}) {
  const server = await createSmsServer({
    accessToken: TEST_TOKEN,
    ...options,
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

async function postSms(baseUrl, record = VALID_RECORD, headers = {}) {
  return fetch(`${baseUrl}/api/sms`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": record.recordId,
      authorization: `Bearer ${TEST_TOKEN}`,
      ...headers,
    },
    body: JSON.stringify(record),
  });
}

test("health endpoint reports ready", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "sms-server-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const app = await startServer({ dataFile: join(directory, "sms.txt") });
  t.after(app.close);

  const response = await fetch(`${app.baseUrl}/api/health`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test("stores one JSON line and treats repeated recordId as success", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "sms-server-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const dataFile = join(directory, "sms-records.txt");
  const app = await startServer({ dataFile });
  t.after(app.close);

  const first = await postSms(app.baseUrl);
  const duplicate = await postSms(app.baseUrl);

  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { ok: true, duplicate: false });
  assert.equal(duplicate.status, 200);
  assert.deepEqual(await duplicate.json(), { ok: true, duplicate: true });

  const lines = (await readFile(dataFile, "utf8")).trimEnd().split("\n");
  assert.equal(lines.length, 1);
  const stored = JSON.parse(lines[0]);
  assert.equal(stored.body, VALID_RECORD.body);
  assert.equal(stored.recordId, VALID_RECORD.recordId);
  assert.match(stored.storedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("restores recordId index after restart", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "sms-server-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const dataFile = join(directory, "sms-records.txt");

  const firstApp = await startServer({ dataFile });
  assert.equal((await postSms(firstApp.baseUrl)).status, 200);
  await firstApp.close();

  const secondApp = await startServer({ dataFile });
  t.after(secondApp.close);
  const duplicate = await postSms(secondApp.baseUrl);

  assert.deepEqual(await duplicate.json(), { ok: true, duplicate: true });
  const lines = (await readFile(dataFile, "utf8")).trimEnd().split("\n");
  assert.equal(lines.length, 1);
});

test("deduplicates and ignores malformed historical TXT records", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "sms-server-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const dataFile = join(directory, "sms-records.txt");
  const stored = {
    ...VALID_RECORD,
    storedAt: "2026-07-15T00:00:00.000Z",
  };
  await writeFile(dataFile, [
    JSON.stringify(stored),
    JSON.stringify(stored),
    "{not-json",
    JSON.stringify({ recordId: "broken", receivedAt: Number.MAX_VALUE }),
    "",
  ].join("\n"), "utf8");

  const app = await startServer({ dataFile });
  t.after(app.close);
  const response = await fetch(`${app.baseUrl}/api/sms`, {
    headers: { authorization: `Bearer ${TEST_TOKEN}` },
  });
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.totalCount, 1);
  assert.equal(result.items[0].recordId, VALID_RECORD.recordId);
});

test("rejects invalid JSON, invalid records, and mismatched idempotency keys", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "sms-server-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const app = await startServer({ dataFile: join(directory, "sms.txt") });
  t.after(app.close);

  const invalidJson = await fetch(`${app.baseUrl}/api/sms`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TEST_TOKEN}`,
    },
    body: "{not-json",
  });
  const invalidRecord = await postSms(app.baseUrl, { ...VALID_RECORD, sender: 10086 });
  const invalidTimestamp = await postSms(app.baseUrl, {
    ...VALID_RECORD,
    recordId: "device-1:invalid-time:inbox",
    sourceId: "invalid-time",
    receivedAt: Number.MAX_VALUE,
  });
  const mismatchedKey = await postSms(app.baseUrl, VALID_RECORD, {
    "idempotency-key": "some-other-record",
  });

  assert.equal(invalidJson.status, 400);
  assert.equal(invalidRecord.status, 400);
  assert.equal(invalidTimestamp.status, 400);
  assert.equal(mismatchedKey.status, 400);
});

test("rejects request bodies above the configured limit", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "sms-server-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const app = await startServer({
    dataFile: join(directory, "sms.txt"),
    maxBodyBytes: 64,
  });
  t.after(app.close);

  const response = await postSms(app.baseUrl, {
    ...VALID_RECORD,
    body: "x".repeat(256),
  });

  assert.equal(response.status, 413);
});

test("rejects missing or incorrect Bearer tokens", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "sms-server-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const app = await startServer({ dataFile: join(directory, "sms.txt") });
  t.after(app.close);

  const missing = await postSms(app.baseUrl, VALID_RECORD, { authorization: "" });
  const wrong = await postSms(app.baseUrl, VALID_RECORD, {
    authorization: "Bearer wrong",
  });

  assert.equal(missing.status, 401);
  assert.deepEqual(await missing.json(), { ok: false, error: "unauthorized" });
  assert.equal(wrong.status, 401);
  assert.deepEqual(await wrong.json(), { ok: false, error: "unauthorized" });
});

test("returns newest-first paged TXT records with filters", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "sms-server-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const app = await startServer({ dataFile: join(directory, "sms.txt") });
  t.after(app.close);

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
    { headers: { authorization: `Bearer ${TEST_TOKEN}` } },
  );
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].recordId, "device-2:43:sent");
  assert.deepEqual(
    {
      offset: result.offset,
      limit: result.limit,
      totalCount: result.totalCount,
      hasMore: result.hasMore,
    },
    { offset: 0, limit: 1, totalCount: 1, hasMore: false },
  );
});

test("validates TXT paging and direction filters", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "sms-server-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const app = await startServer({ dataFile: join(directory, "sms.txt") });
  t.after(app.close);
  const headers = { authorization: `Bearer ${TEST_TOKEN}` };

  const zeroLimit = await fetch(`${app.baseUrl}/api/sms?limit=0`, { headers });
  const tooLarge = await fetch(`${app.baseUrl}/api/sms?limit=101`, { headers });
  const badOffset = await fetch(`${app.baseUrl}/api/sms?offset=-1`, { headers });
  const badDirection = await fetch(`${app.baseUrl}/api/sms?direction=draft`, { headers });

  assert.equal(zeroLimit.status, 400);
  assert.equal(tooLarge.status, 400);
  assert.equal(badOffset.status, 400);
  assert.equal(badDirection.status, 400);
});

test("exports escaped UTF-8 Markdown", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "sms-server-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const app = await startServer({ dataFile: join(directory, "sms.txt") });
  t.after(app.close);
  await postSms(app.baseUrl, {
    ...VALID_RECORD,
    body: "第一行\n<敏感>&内容",
  });

  const response = await fetch(`${app.baseUrl}/api/sms/export.md`, {
    headers: { authorization: `Bearer ${TEST_TOKEN}` },
  });
  const markdown = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/markdown/);
  assert.match(response.headers.get("content-disposition"), /sms-backup\.md/);
  assert.match(markdown, /第一行/);
  assert.doesNotMatch(markdown, /<敏感>/);
  assert.match(markdown, /&lt;敏感&gt;&amp;内容/);
});
