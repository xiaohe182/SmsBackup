import type { AppSettings } from "@/stores/settings";
import * as nativeSmsBackup from "@/uni_modules/sms-backup-native";

export interface SmsBackupStatus {
  available: boolean;
  permissionGranted: boolean;
  pendingCount: number;
  uploadedCount: number;
  lastSyncAt: number | null;
  message: string;
}

export type SmsDirection =
  | "inbox"
  | "sent"
  | "draft"
  | "outbox"
  | "failed"
  | "queued"
  | "unknown";

export interface SmsMessage {
  sourceId: string;
  threadId: number | null;
  address: string;
  body: string;
  receivedAt: number;
  sentAt: number | null;
  type: number;
  direction: SmsDirection;
  read: boolean;
  seen: boolean;
  status: number | null;
  serviceCenter: string | null;
  simSubscriptionId: number | null;
}

export interface MmsAttachment {
  id: string;
  uri: string;
  mimeType: string;
}

export interface MmsMessage {
  sourceId: string;
  threadId: number | null;
  address: string;
  body: string;
  receivedAt: number;
  sentAt: number | null;
  type: number;
  direction: SmsDirection;
  read: boolean;
  seen: boolean;
  attachments: MmsAttachment[];
}

export interface GalleryPhoto {
  id: string;
  uri: string;
  albumId: string;
  albumName: string;
  displayName: string;
  takenAt: number;
  mimeType: string;
}

export interface SmsMessageListResult {
  authorized: boolean;
  permissionGranted: boolean;
  messages: SmsMessage[];
}

export interface MmsMessageListResult {
  authorized: boolean;
  permissionGranted: boolean;
  messages: MmsMessage[];
}

export interface GalleryPhotoListResult {
  authorized: boolean;
  permissionGranted: boolean;
  photos: GalleryPhoto[];
}

export interface SmsBackupService {
  initialize(): Promise<void>;
  getStatus(): Promise<SmsBackupStatus>;
  requestPermissions(): Promise<boolean>;
  requestMediaPermissions(): Promise<boolean>;
  scanExistingMessages(): Promise<number>;
  listAllMessages(password: string): Promise<SmsMessageListResult>;
  listMmsMessages(password: string): Promise<MmsMessageListResult>;
  listGalleryPhotos(password: string): Promise<GalleryPhotoListResult>;
  syncNow(): Promise<void>;
  testConnection(serverUrl: string): Promise<boolean>;
  saveSettings(settings: AppSettings): Promise<void>;
  clearQueue(): Promise<void>;
}

export interface NativeSmsModule {
  initialize(): void;
  getPermissionState(): string;
  requestPermissions(): Promise<boolean>;
  requestMediaPermissions(): Promise<boolean>;
  scanExistingMessages(): Promise<number>;
  getAllMessages(password: string): Promise<string>;
  getAllMmsMessages(password: string): Promise<string>;
  getGalleryPhotos(password: string): Promise<string>;
  getBackupStatus(): string;
  saveNativeSettings(settingsJson: string): void;
  syncNow(): void;
  testConnection(serverUrl: string): Promise<boolean>;
  clearQueue(): void;
}

const UNAVAILABLE_STATUS: SmsBackupStatus = {
  available: false,
  permissionGranted: false,
  pendingCount: 0,
  uploadedCount: 0,
  lastSyncAt: null,
  message: "仅支持 Android App",
};

export function createUnavailableSmsBackupService(): SmsBackupService {
  return {
    initialize: async () => undefined,
    getStatus: async () => ({ ...UNAVAILABLE_STATUS }),
    requestPermissions: async () => false,
    requestMediaPermissions: async () => false,
    scanExistingMessages: async () => 0,
    listAllMessages: async () => ({
      authorized: false,
      permissionGranted: false,
      messages: [],
    }),
    listMmsMessages: async () => ({
      authorized: false,
      permissionGranted: false,
      messages: [],
    }),
    listGalleryPhotos: async () => ({
      authorized: false,
      permissionGranted: false,
      photos: [],
    }),
    syncNow: async () => undefined,
    testConnection: async () => false,
    saveSettings: async () => undefined,
    clearQueue: async () => undefined,
  };
}

function parseMessageList(raw: string): SmsMessageListResult {
  try {
    const value = JSON.parse(raw) as Partial<SmsMessageListResult>;
    return {
      authorized: value.authorized === true,
      permissionGranted: value.permissionGranted === true,
      messages: Array.isArray(value.messages) ? value.messages : [],
    };
  } catch {
    return { authorized: false, permissionGranted: false, messages: [] };
  }
}

function parseMmsMessageList(raw: string): MmsMessageListResult {
  try {
    const value = JSON.parse(raw) as Partial<MmsMessageListResult>;
    return {
      authorized: value.authorized === true,
      permissionGranted: value.permissionGranted === true,
      messages: Array.isArray(value.messages) ? value.messages : [],
    };
  } catch {
    return { authorized: false, permissionGranted: false, messages: [] };
  }
}

function parseGalleryPhotoList(raw: string): GalleryPhotoListResult {
  try {
    const value = JSON.parse(raw) as Partial<GalleryPhotoListResult>;
    return {
      authorized: value.authorized === true,
      permissionGranted: value.permissionGranted === true,
      photos: Array.isArray(value.photos) ? value.photos : [],
    };
  } catch {
    return { authorized: false, permissionGranted: false, photos: [] };
  }
}

function parseStatus(raw: string): SmsBackupStatus {
  try {
    const value = JSON.parse(raw) as Partial<SmsBackupStatus>;
    if (
      typeof value.available !== "boolean" ||
      typeof value.permissionGranted !== "boolean" ||
      typeof value.pendingCount !== "number" ||
      typeof value.uploadedCount !== "number"
    ) {
      throw new Error("invalid native status");
    }
    return {
      available: value.available,
      permissionGranted: value.permissionGranted,
      pendingCount: value.pendingCount,
      uploadedCount: value.uploadedCount,
      lastSyncAt: typeof value.lastSyncAt === "number" ? value.lastSyncAt : null,
      message: typeof value.message === "string" ? value.message : "短信服务已就绪",
    };
  } catch {
    return {
      ...UNAVAILABLE_STATUS,
      available: true,
      message: "原生状态读取失败",
    };
  }
}

export function createAndroidSmsBackupService(
  native: NativeSmsModule,
): SmsBackupService {
  return {
    initialize: async () => native.initialize(),
    getStatus: async () => parseStatus(native.getBackupStatus()),
    requestPermissions: async () => native.requestPermissions(),
    requestMediaPermissions: async () => native.requestMediaPermissions(),
    scanExistingMessages: async () => native.scanExistingMessages(),
    listAllMessages: async (password) =>
      parseMessageList(await native.getAllMessages(password)),
    listMmsMessages: async (password) =>
      parseMmsMessageList(await native.getAllMmsMessages(password)),
    listGalleryPhotos: async (password) =>
      parseGalleryPhotoList(await native.getGalleryPhotos(password)),
    syncNow: async () => native.syncNow(),
    testConnection: async (serverUrl) => native.testConnection(serverUrl),
    saveSettings: async (settings) =>
      native.saveNativeSettings(JSON.stringify(settings)),
    clearQueue: async () => native.clearQueue(),
  };
}

export const smsBackupService: SmsBackupService = createAndroidSmsBackupService(
  nativeSmsBackup as NativeSmsModule,
);
