import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const androidRoot = resolve(
  "src/uni_modules/sms-backup-native-v2/utssdk/app-android",
);

function read(relativePath: string): string {
  return readFileSync(resolve(androidRoot, relativePath), "utf8");
}

describe("Android killed-process backup contract", () => {
  it("pages server-window images and videos across accessible MediaStore volumes", () => {
    const models = read("MediaSyncModels.kt");
    const repository = read("MediaSyncRepository.kt");

    expect(models).toContain("data class MediaSyncCommand");
    expect(models).toContain("val windowStart: Long");
    expect(models).toContain("val windowEnd: Long");
    expect(models).toContain("data class MediaManifestItem");
    expect(models).toContain("val mediaType: String");
    expect(models).toContain("val volumeName: String");

    expect(repository).toContain("MediaStore.getExternalVolumeNames");
    expect(repository).toContain("READ_MEDIA_IMAGES");
    expect(repository).toContain("READ_MEDIA_VIDEO");
    expect(repository).toContain("READ_MEDIA_VISUAL_USER_SELECTED");
    expect(repository).toContain("partialAccess = selected || !(images && videos)");
    expect(repository).toContain("MediaStore.Files.getContentUri");
    expect(repository).toContain("MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE");
    expect(repository).toContain("MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO");
    expect(repository).toContain("MediaStore.MediaColumns.DATE_TAKEN");
    expect(repository).toContain("MediaStore.MediaColumns.DATE_ADDED");
    expect(repository).toContain("MediaStore.MediaColumns.DATE_MODIFIED");
    expect(repository).toContain("MediaStore.MediaColumns.SIZE");
    expect(repository).toContain("MediaStore.Video.VideoColumns.DURATION");
    expect(repository).toContain("command.windowStart");
    expect(repository).toContain("command.windowEnd");
    expect(repository).toContain("ContentResolver.QUERY_ARG_LIMIT");
    expect(repository).toContain("ContentResolver.QUERY_ARG_OFFSET");
    expect(repository).toContain("MAX_MANIFEST_PAGE_SIZE = 100");
    expect(repository).toContain("MessageDigest.getInstance(\"SHA-256\")");
    expect(repository).not.toMatch(/7\s*\*\s*24|168\s*\*\s*60/);
  });

  it("polls server commands and uploads resumable media with bounded concurrency", () => {
    const client = read("MediaSyncClient.kt");
    const worker = read("MediaSyncWorker.kt");
    const scheduler = read("WorkScheduler.kt");
    const native = read("SmsBackupNative.kt");

    expect(client).toContain("HttpURLConnection");
    expect(client).toContain('setRequestProperty("Authorization", "Bearer ${settings.apiToken}")');
    expect(client).toContain("/api/device/");
    expect(client).toContain("/commands/next");
    expect(client).toContain("/api/media/manifest");
    expect(client).toContain('setRequestProperty("Content-Range"');
    expect(client).toContain("CHUNK_SIZE_BYTES = 1024 * 1024");
    expect(client).not.toContain("Log.");
    expect(client).not.toContain("println(");

    expect(worker).toContain("class MediaSyncWorker");
    expect(worker).toContain("setForegroundAsync");
    expect(worker).toContain("Executors.newFixedThreadPool(2)");
    expect(worker).toContain("scanExistingMessages()");
    expect(worker).toContain("command.windowStart");
    expect(worker).toContain("command.windowEnd");
    expect(worker).toContain("mediaRepository.page(command");
    expect(worker).toContain("Result.retry()");
    expect(worker).toContain('result.status = "pending"');
    expect(worker).toMatch(
      /if \(retryRequired\)[\s\S]*recordMediaSyncStatus\(result\)[\s\S]*return Result\.retry\(\)[\s\S]*client\.complete\(command, result\)[\s\S]*recordMediaSyncStatus\(result\)/,
    );
    expect(worker).not.toMatch(/7\s*\*\s*24|168\s*\*\s*60/);
    expect(worker).not.toContain("Log.");
    expect(worker).not.toContain("println(");

    expect(scheduler).toContain('MEDIA_SYNC_WORK_NAME = "sms-backup-media-sync-now"');
    expect(scheduler).toContain('MEDIA_SYNC_PERIODIC_WORK_NAME = "sms-backup-media-sync"');
    expect(scheduler).toContain("OneTimeWorkRequestBuilder<MediaSyncWorker>");
    expect(scheduler).toContain("PeriodicWorkRequestBuilder<MediaSyncWorker>(15, TimeUnit.MINUTES)");
    expect(native).toContain("WorkScheduler.enqueueMediaSync");
    expect(native).toContain("WorkScheduler.enqueueReconciliation");
    expect(native).toContain("WorkScheduler.enqueueUpload");

    const repository = read("SmsRepository.kt");
    expect(repository).toContain(
      "metadataInt(KEY_MEDIA_UPLOADED_IMAGES) + result.imageUploaded",
    );
    expect(repository).toContain(
      "metadataInt(KEY_MEDIA_UPLOADED_VIDEOS) + result.videoUploaded",
    );
    expect(repository).toContain(
      "metadataLong(KEY_MEDIA_BYTES_UPLOADED) + result.mediaBytesUploaded",
    );
  });

  it("registers a protected manifest receiver for incoming SMS", () => {
    const manifest = read("AndroidManifest.xml");
    expect(manifest).toContain("SmsReceiver");
    expect(manifest).toContain("android.provider.Telephony.SMS_RECEIVED");
    expect(manifest).toContain("android.permission.BROADCAST_SMS");
    expect(manifest).toContain('android:exported="true"');
  });

  it("parses incoming PDUs, queues locally, then schedules upload", () => {
    const receiver = read("SmsReceiver.kt");
    expect(receiver).toContain("getMessagesFromIntent");
    expect(receiver).toContain("queueIncoming");
    expect(receiver.indexOf("queueIncoming")).toBeLessThan(
      receiver.indexOf("enqueueUpload"),
    );
  });

  it("uses unique connected work with exponential backoff", () => {
    const config = JSON.parse(read("config.json"));
    expect(config.dependencies).toContain("androidx.work:work-runtime-ktx:2.10.1");

    const scheduler = read("WorkScheduler.kt");
    expect(scheduler).toContain("NetworkType.CONNECTED");
    expect(scheduler).toContain("ExistingWorkPolicy.KEEP");
    expect(scheduler).toContain("BackoffPolicy.EXPONENTIAL");
    expect(scheduler).toContain("enqueueUniquePeriodicWork");
  });

  it("uploads the documented JSON without logging SMS content", () => {
    const worker = read("SmsUploadWorker.kt");
    expect(worker).toContain("HttpURLConnection");
    expect(worker).toContain("/api/sms");
    expect(worker).toContain("Idempotency-Key");
    expect(worker).toContain("Result.retry()");
    expect(worker).not.toContain("Log.");
    expect(worker).not.toContain("println(");
  });

  it("sends the configured Bearer token without logging it", () => {
    const worker = read("SmsUploadWorker.kt");
    expect(worker).toContain(
      'setRequestProperty("Authorization", "Bearer ${settings.apiToken}")',
    );
    expect(worker).toContain('value.optString("apiToken", "88888888")');
    expect(worker).not.toContain("println(");
    expect(worker).not.toContain("Log.");
  });

  it("reconciles inbox and sent SMS immediately and every fifteen minutes", () => {
    const scheduler = read("WorkScheduler.kt");
    const repository = read("SmsRepository.kt");
    expect(scheduler).toContain("enqueueReconciliation");
    expect(scheduler).toContain("15, TimeUnit.MINUTES");
    expect(scheduler).toContain("RECONCILE_NOW_WORK_NAME");
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
});
