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

  it("reconciles the system provider every day", () => {
    const scheduler = read("WorkScheduler.kt");
    const worker = read("SmsReconcileWorker.kt");
    expect(scheduler).toContain("24, TimeUnit.HOURS");
    expect(worker).toContain("scanExistingMessages");
    expect(worker).toContain("enqueueUpload");
  });
});
