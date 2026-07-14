import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const androidRoot = resolve(
  "src/uni_modules/sms-backup-native/utssdk/app-android",
);

function read(relativePath: string): string {
  return readFileSync(resolve(androidRoot, relativePath), "utf8");
}

describe("Android native SMS plugin contract", () => {
  it("declares only the required SMS and network permissions", () => {
    const manifest = read("AndroidManifest.xml");
    expect(manifest).toContain("android.permission.READ_SMS");
    expect(manifest).toContain("android.permission.RECEIVE_SMS");
    expect(manifest).toContain("android.permission.INTERNET");
    expect(manifest).toContain("android.permission.ACCESS_NETWORK_STATE");
  });

  it("supports Android 8 and declares compatible AndroidX dependencies", () => {
    const config = JSON.parse(read("config.json"));
    expect(config.minSdkVersion).toBe(26);
    expect(config.dependencies).toContain("androidx.core:core-ktx:1.15.0");
  });

  it("exposes the complete UTS API used by the uni-app pages", () => {
    const uts = read("index.uts");
    for (const method of [
      "initialize",
      "getPermissionState",
      "requestPermissions",
      "scanExistingMessages",
      "getAllMessages",
      "getBackupStatus",
      "saveNativeSettings",
      "saveNativeRules",
      "syncNow",
      "testConnection",
      "clearQueue",
    ]) {
      expect(uts).toContain(`function ${method}`);
    }
  });

  it("uses an app-private SQLite queue with a unique idempotency key", () => {
    const database = read("SmsQueueDatabase.kt");
    expect(database).toContain("record_id TEXT NOT NULL UNIQUE");
    expect(database).toContain("content_key TEXT NOT NULL UNIQUE");
    expect(database).toContain("CONFLICT_IGNORE");
    expect(database).toContain("pending");
    expect(database).toContain("uploaded");
    expect(database).toContain("filtered_records");
  });

  it("reads the system provider and filters before queue insertion", () => {
    const repository = read("SmsRepository.kt");
    expect(repository).toContain("Telephony.Sms.CONTENT_URI");
    expect(repository).toContain("Manifest.permission.READ_SMS");
    expect(repository.indexOf("SmsFilter.match")).toBeLessThan(
      repository.indexOf("database.enqueue"),
    );
  });

  it("checks the hard-coded viewer password before reading system messages", () => {
    const native = read("SmsBackupNative.kt");
    expect(native).toContain('VIEW_PASSWORD = "88888888"');
    expect(native).toContain("fun getAllMessagesJson(password: String)");
    expect(native.indexOf("password != VIEW_PASSWORD")).toBeLessThan(
      native.indexOf("repository.getAllMessages()"),
    );
    expect(native).toContain('put("authorized", authorized)');
    expect(native).toContain('put("permissionGranted", permissionGranted)');
  });

  it("returns every SMS type and its complete viewer fields newest first", () => {
    const repository = read("SmsRepository.kt");
    expect(repository).toContain("fun getAllMessages(): JSONArray");
    expect(repository).toContain('"${Telephony.Sms.DATE} DESC"');
    for (const direction of [
      "inbox",
      "sent",
      "draft",
      "outbox",
      "failed",
      "queued",
      "unknown",
    ]) {
      expect(repository).toContain(`"${direction}"`);
    }
    for (const field of [
      "sourceId",
      "threadId",
      "address",
      "body",
      "receivedAt",
      "sentAt",
      "type",
      "direction",
      "read",
      "seen",
      "status",
      "serviceCenter",
      "simSubscriptionId",
    ]) {
      expect(repository).toMatch(new RegExp(`put\\(\\s*"${field}"`));
    }
  });
});
