import type { LocationPoint } from "@/domain/route-analysis";
import * as nativeLocation from "@/uni_modules/sms-backup-native";

export interface LocationTrackingStatus {
  available: boolean;
  permissionGranted: boolean;
  precisePermissionGranted: boolean;
  notificationPermissionGranted: boolean;
  locationEnabled: boolean;
  tracking: boolean;
  sampleIntervalMs: number;
  pointCount: number;
  currentSessionId: string | null;
  startedAt: number | null;
  lastPoint: LocationPoint | null;
  message: string;
}

export interface NativeLocationModule {
  getLocationStatus(password: string): string;
  requestLocationPermissions(): Promise<boolean>;
  requestNotificationPermission(): Promise<boolean>;
  startLocationTracking(password: string): boolean;
  stopLocationTracking(): void;
  getLocationPoints(password: string, limit: number): Promise<string>;
  clearLocationHistory(): boolean;
  openBatteryOptimizationSettings(): void;
  openAppSettings(): void;
}

export interface LocationTrackingService {
  getStatus(password: string): Promise<LocationTrackingStatus>;
  requestLocationPermissions(): Promise<boolean>;
  requestNotificationPermission(): Promise<boolean>;
  start(password: string): Promise<boolean>;
  stop(): Promise<void>;
  listPoints(password: string, limit?: number): Promise<LocationPoint[]>;
  clearHistory(): Promise<boolean>;
  openBatterySettings(): Promise<void>;
  openAppSettings(): Promise<void>;
}

const DEFAULT_STATUS: LocationTrackingStatus = {
  available: false,
  permissionGranted: false,
  precisePermissionGranted: false,
  notificationPermissionGranted: false,
  locationEnabled: false,
  tracking: false,
  sampleIntervalMs: 180_000,
  pointCount: 0,
  currentSessionId: null,
  startedAt: null,
  lastPoint: null,
  message: "仅支持 Android App",
};

function parseStatus(raw: string): LocationTrackingStatus {
  try {
    const value = JSON.parse(raw) as Partial<LocationTrackingStatus>;
    if (typeof value.available !== "boolean") throw new Error("invalid status");
    return {
      available: value.available,
      permissionGranted: value.permissionGranted === true,
      precisePermissionGranted: value.precisePermissionGranted === true,
      notificationPermissionGranted: value.notificationPermissionGranted === true,
      locationEnabled: value.locationEnabled === true,
      tracking: value.tracking === true,
      sampleIntervalMs: typeof value.sampleIntervalMs === "number"
        ? value.sampleIntervalMs
        : 180_000,
      pointCount: typeof value.pointCount === "number" ? value.pointCount : 0,
      currentSessionId: typeof value.currentSessionId === "string"
        ? value.currentSessionId
        : null,
      startedAt: typeof value.startedAt === "number" ? value.startedAt : null,
      lastPoint: value.lastPoint && typeof value.lastPoint === "object"
        ? value.lastPoint as LocationPoint
        : null,
      message: typeof value.message === "string" ? value.message : "定位状态未知",
    };
  } catch {
    return {
      ...DEFAULT_STATUS,
      available: true,
      message: "定位状态读取失败",
    };
  }
}

function parsePoints(raw: string): LocationPoint[] {
  try {
    const value = JSON.parse(raw) as { points?: unknown };
    return Array.isArray(value.points) ? value.points as LocationPoint[] : [];
  } catch {
    return [];
  }
}

export function createLocationTrackingService(
  native: NativeLocationModule,
): LocationTrackingService {
  return {
    getStatus: async (password) => parseStatus(native.getLocationStatus(password)),
    requestLocationPermissions: async () => native.requestLocationPermissions(),
    requestNotificationPermission: async () => native.requestNotificationPermission(),
    start: async (password) => native.startLocationTracking(password),
    stop: async () => native.stopLocationTracking(),
    listPoints: async (password, limit = 5_000) => parsePoints(
      await native.getLocationPoints(password, Math.max(1, Math.min(limit, 20_000))),
    ),
    clearHistory: async () => native.clearLocationHistory(),
    openBatterySettings: async () => native.openBatteryOptimizationSettings(),
    openAppSettings: async () => native.openAppSettings(),
  };
}

export const locationTrackingService = createLocationTrackingService(
  nativeLocation as NativeLocationModule,
);
