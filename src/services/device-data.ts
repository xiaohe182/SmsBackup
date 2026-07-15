import * as nativeDeviceData from "@/uni_modules/sms-backup-native";

export interface DeviceContact {
  contactId: string;
  displayName: string;
  phoneNumber: string;
  normalizedNumber: string | null;
  photoUri: string | null;
}

export interface DeviceSnapshot {
  manufacturer: string;
  model: string;
  androidVersion: string;
  apiLevel: number;
  batteryLevel: number;
  charging: boolean;
  batteryStatus: string;
  batteryHealth: string;
  batteryTemperatureCelsius: number | null;
  batteryVoltageMillivolts: number | null;
  batteryTechnology: string | null;
  memoryTotalBytes: number;
  memoryAvailableBytes: number;
  storageTotalBytes: number;
  storageAvailableBytes: number;
  networkConnected: boolean;
  networkTransport: string;
  ignoringBatteryOptimizations: boolean;
  capturedAt: number;
}

export interface ContactListResult {
  authorized: boolean;
  permissionGranted: boolean;
  contacts: DeviceContact[];
}

export interface DeviceSnapshotResult {
  authorized: boolean;
  snapshot: DeviceSnapshot | null;
}

export interface NativeDeviceDataModule {
  requestContactsPermission(): Promise<boolean>;
  getContacts(password: string): Promise<string>;
  getDeviceSnapshot(password: string): string;
}

export interface DeviceDataService {
  requestContactsPermission(): Promise<boolean>;
  listContacts(password: string): Promise<ContactListResult>;
  getSnapshot(password: string): Promise<DeviceSnapshotResult>;
}

function parseContacts(raw: string): ContactListResult {
  try {
    const value = JSON.parse(raw) as Partial<ContactListResult>;
    return {
      authorized: value.authorized === true,
      permissionGranted: value.permissionGranted === true,
      contacts: Array.isArray(value.contacts) ? value.contacts : [],
    };
  } catch {
    return { authorized: false, permissionGranted: false, contacts: [] };
  }
}

function parseSnapshot(raw: string): DeviceSnapshotResult {
  try {
    const value = JSON.parse(raw) as Partial<DeviceSnapshotResult>;
    return {
      authorized: value.authorized === true,
      snapshot: value.snapshot && typeof value.snapshot === "object"
        ? value.snapshot as DeviceSnapshot
        : null,
    };
  } catch {
    return { authorized: false, snapshot: null };
  }
}

export function createDeviceDataService(native: NativeDeviceDataModule): DeviceDataService {
  return {
    requestContactsPermission: async () => native.requestContactsPermission(),
    listContacts: async (password) => parseContacts(await native.getContacts(password)),
    getSnapshot: async (password) => parseSnapshot(native.getDeviceSnapshot(password)),
  };
}

export const deviceDataService = createDeviceDataService(
  nativeDeviceData as NativeDeviceDataModule,
);
