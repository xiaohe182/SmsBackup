import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createSmsServer } from "../server.js";

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
  const server = await createSmsServer(options);
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

test("rejects invalid JSON, invalid records, and mismatched idempotency keys", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "sms-server-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const app = await startServer({ dataFile: join(directory, "sms.txt") });
  t.after(app.close);

  const invalidJson = await fetch(`${app.baseUrl}/api/sms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not-json",
  });
  const invalidRecord = await postSms(app.baseUrl, { ...VALID_RECORD, sender: 10086 });
  const mismatchedKey = await postSms(app.baseUrl, VALID_RECORD, {
    "idempotency-key": "some-other-record",
  });

  assert.equal(invalidJson.status, 400);
  assert.equal(invalidRecord.status, 400);
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
