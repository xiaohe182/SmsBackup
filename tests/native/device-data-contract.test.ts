import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const androidRoot = resolve("src/uni_modules/sms-backup-native/utssdk/app-android");

function read(relativePath: string): string {
  try {
    return readFileSync(resolve(androidRoot, relativePath), "utf8");
  } catch {
    return "";
  }
}

describe("Android resilient location and device-data contract", () => {
  it("declares modern foreground location, notification, and contact permissions", () => {
    const pluginManifest = read("AndroidManifest.xml");
    const appManifest = readFileSync(resolve("src/manifest.json"), "utf8");
    for (const permission of [
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.FOREGROUND_SERVICE",
      "android.permission.FOREGROUND_SERVICE_LOCATION",
      "android.permission.POST_NOTIFICATIONS",
      "android.permission.READ_CONTACTS",
    ]) {
      expect(pluginManifest).toContain(permission);
      expect(appManifest).toContain(permission);
    }
    expect(pluginManifest).toContain('android:foregroundServiceType="location"');
    expect(pluginManifest).toContain('android:stopWithTask="false"');
  });

  it("runs a sticky foreground service with a visible stop action and dual providers", () => {
    const service = read("LocationTrackingService.kt");
    expect(service).toContain("START_STICKY");
    expect(service).toContain("startForeground");
    expect(service).toContain("NotificationChannel");
    expect(service).toContain("ACTION_STOP");
    expect(service).toContain("LocationManager.GPS_PROVIDER");
    expect(service).toContain("LocationManager.NETWORK_PROVIDER");
    expect(service).toContain("SAMPLE_INTERVAL_MS = 180_000L");
    expect(service).not.toContain("Log.");
    expect(service).not.toContain("println(");
  });

  it("persists indexed sessions and complete three-minute location points", () => {
    const database = read("LocationDatabase.kt");
    expect(database).toContain("CREATE TABLE route_sessions");
    expect(database).toContain("CREATE TABLE location_points");
    expect(database).toContain("session_id");
    expect(database).toContain("latitude REAL NOT NULL");
    expect(database).toContain("longitude REAL NOT NULL");
    expect(database).toContain("accuracy REAL NOT NULL");
    expect(database).toContain("CREATE INDEX");
    expect(database).toContain("captured_at");
  });

  it("reads contacts only after permission and exposes device health diagnostics", () => {
    const native = read("SmsBackupNative.kt");
    const repository = read("DeviceDataRepository.kt");
    expect(native).toContain("Manifest.permission.READ_CONTACTS");
    expect(native).toContain("fun getContactsJson(password: String)");
    expect(native.indexOf("password != VIEW_PASSWORD")).toBeLessThan(
      native.indexOf("repository.getContacts()"),
    );
    expect(repository).toContain("ContactsContract.CommonDataKinds.Phone.CONTENT_URI");
    expect(repository).toContain("BatteryManager");
    expect(repository).toContain("ActivityManager.MemoryInfo");
    expect(repository).toContain("StatFs");
    expect(repository).toContain("ConnectivityManager");
  });

  it("exposes all location, contact, and diagnostics bridge methods", () => {
    const uts = read("index.uts");
    for (const method of [
      "getLocationStatus",
      "requestLocationPermissions",
      "requestNotificationPermission",
      "startLocationTracking",
      "stopLocationTracking",
      "getLocationPoints",
      "clearLocationHistory",
      "openBatteryOptimizationSettings",
      "openAppSettings",
      "requestContactsPermission",
      "getContacts",
      "getDeviceSnapshot",
    ]) {
      expect(uts).toContain(`function ${method}`);
    }
  });
});
