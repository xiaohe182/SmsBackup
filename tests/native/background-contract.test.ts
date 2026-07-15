import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const androidRoot = resolve(
  "src/uni_modules/sms-backup-native/utssdk/app-android",
);

function read(relativePath: string): string {
  return readFileSync(resolve(androidRoot, relativePath), "utf8");
}

describe("Android killed-process backup contract", () => {
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
