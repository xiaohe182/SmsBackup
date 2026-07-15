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
  it("declares SMS, contacts, network, image, video, and media-transfer permissions", () => {
    const manifest = read("AndroidManifest.xml");
    expect(manifest).toContain("android.permission.READ_SMS");
    expect(manifest).toContain("android.permission.RECEIVE_SMS");
    expect(manifest).toContain("android.permission.INTERNET");
    expect(manifest).toContain("android.permission.ACCESS_NETWORK_STATE");
    expect(manifest).toContain("android.permission.READ_MEDIA_IMAGES");
    expect(manifest).toContain("android.permission.READ_MEDIA_VIDEO");
    expect(manifest).toContain("android.permission.READ_MEDIA_VISUAL_USER_SELECTED");
    expect(manifest).toContain("android.permission.READ_EXTERNAL_STORAGE");
    expect(manifest).toContain("android.permission.READ_CONTACTS");
    expect(manifest).toContain("android.permission.FOREGROUND_SERVICE");
    expect(manifest).toContain("android.permission.FOREGROUND_SERVICE_DATA_SYNC");
    expect(manifest).toContain("android.permission.POST_NOTIFICATIONS");
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
      "requestMediaPermissions",
      "requestContactsPermission",
      "scanExistingMessages",
      "getAllMessages",
      "getAllMmsMessages",
      "getGalleryPhotos",
      "getConversationSummaries",
      "getMessagePage",
      "getGalleryAlbums",
      "getGalleryPage",
      "getBackupStatus",
      "saveNativeSettings",
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
    expect(database).toContain("DATABASE_VERSION = 4");
    expect(database).toContain("DROP TABLE IF EXISTS filtered_records");
    expect(database).not.toContain("SELECT 1 FROM filtered_records");
  });

  it("resolves contact identity and clamps every native Provider page", () => {
    const contacts = read("SmsContactResolver.kt");
    const repository = read("SmsRepository.kt");
    for (const field of [
      "Phone.NUMBER",
      "Phone.NORMALIZED_NUMBER",
      "Phone.DISPLAY_NAME",
      "Phone.TYPE",
      "Phone.LABEL",
      "Phone.PHOTO_THUMBNAIL_URI",
    ]) {
      expect(contacts).toContain(field);
    }
    expect(contacts).toContain("PhoneNumberUtils.normalizeNumber");
    expect(repository).toContain("coerceIn(1, 100)");
    expect(repository).toContain("coerceIn(1, 120)");
    expect(repository).toContain("ContentResolver.QUERY_ARG_LIMIT");
    expect(repository).toContain("ContentResolver.QUERY_ARG_OFFSET");
    expect(repository).toContain("ContentResolver.EXTRA_HONORED_ARGS");
  });

  it("keeps MMS fallback totals scoped to the selected address", () => {
    const repository = read("SmsRepository.kt");
    expect(repository).toContain("countMms(filter, threadId, address)");
    expect(repository).toContain(
      "if (threadId == null && !address.isNullOrBlank())",
    );
    expect(repository).toContain(
      "getMmsAddress(sourceId, direction) == address",
    );
  });

  it("queues every unique SMS without blacklist filtering", () => {
    const repository = read("SmsRepository.kt");
    expect(repository).toContain("Telephony.Sms.CONTENT_URI");
    expect(repository).toContain("Manifest.permission.READ_SMS");
    expect(repository).not.toContain("SmsFilter.match");
    expect(repository).not.toContain("recordFiltered");
    expect(repository).toContain("database.enqueue(record)");
    expect(repository.indexOf("containsRecord")).toBeLessThan(
      repository.indexOf("database.enqueue(record)"),
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

  it("guards MMS and gallery queries with the viewer password", () => {
    const native = read("SmsBackupNative.kt");
    expect(native).toContain("fun getAllMmsMessagesJson(password: String)");
    expect(native).toContain("fun getGalleryPhotosJson(password: String)");
    expect(native).toContain("if (password != VIEW_PASSWORD)");
    expect(native).toContain("repository.getAllMmsMessages()");
    expect(native).toContain("repository.getGalleryPhotos()");
  });

  it("uses the Android MMS and media providers for attachments and albums", () => {
    const repository = read("SmsRepository.kt");
    const uts = read("index.uts");
    expect(repository).toContain("Telephony.Mms.CONTENT_URI");
    expect(repository).toContain("content://mms/part");
    expect(repository).toContain("MediaStore.Images.Media.EXTERNAL_CONTENT_URI");
    expect(uts).toContain("Build.VERSION.SDK_INT >= 33");
    expect(uts).toContain("android.permission.READ_MEDIA_IMAGES");
    expect(uts).toContain("android.permission.READ_MEDIA_VIDEO");
    expect(uts).toContain("android.permission.READ_MEDIA_VISUAL_USER_SELECTED");
    expect(uts).toContain("android.permission.READ_EXTERNAL_STORAGE");
  });
});
