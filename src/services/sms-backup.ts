import type { AppSettings } from "@/stores/settings";
import * as nativeSmsBackup from "@/uni_modules/sms-backup-native";
import type {
  MessageCursor,
  ViewerAlbum,
  ViewerContact,
  ViewerConversation,
  ViewerMessage,
  ViewerMessageFilter,
  ViewerMessagePage,
  ViewerPhoto,
  ViewerPhotoPage,
} from "@/domain/sms-viewer-pagination";

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

export interface ConversationSummaryResult {
  authorized: boolean;
  permissionGranted: boolean;
  conversations: ViewerConversation[];
}

export interface GalleryAlbumListResult {
  authorized: boolean;
  permissionGranted: boolean;
  albums: ViewerAlbum[];
}

export interface SmsBackupService {
  initialize(): Promise<void>;
  getStatus(): Promise<SmsBackupStatus>;
  requestPermissions(): Promise<boolean>;
  requestMediaPermissions(): Promise<boolean>;
  requestContactsPermission(): Promise<boolean>;
  scanExistingMessages(): Promise<number>;
  listAllMessages(password: string): Promise<SmsMessageListResult>;
  listMmsMessages(password: string): Promise<MmsMessageListResult>;
  listGalleryPhotos(password: string): Promise<GalleryPhotoListResult>;
  listConversationSummaries(password: string): Promise<ConversationSummaryResult>;
  listMessagePage(
    password: string,
    filter: ViewerMessageFilter,
    threadId: number | null,
    address: string | null,
    cursor: MessageCursor | null,
    limit?: number,
  ): Promise<ViewerMessagePage>;
  listGalleryAlbums(password: string): Promise<GalleryAlbumListResult>;
  listGalleryPage(
    password: string,
    albumId: string,
    offset: number,
    limit?: number,
  ): Promise<ViewerPhotoPage>;
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
  requestContactsPermission(): Promise<boolean>;
  scanExistingMessages(): Promise<number>;
  getAllMessages(password: string): Promise<string>;
  getAllMmsMessages(password: string): Promise<string>;
  getGalleryPhotos(password: string): Promise<string>;
  getConversationSummaries(password: string): Promise<string>;
  getMessagePage(
    password: string,
    filter: string,
    threadId: number | null,
    address: string | null,
    cursorJson: string | null,
    limit: number,
  ): Promise<string>;
  getGalleryAlbums(password: string): Promise<string>;
  getGalleryPage(
    password: string,
    albumId: string,
    offset: number,
    limit: number,
  ): Promise<string>;
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
    requestContactsPermission: async () => false,
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
    listConversationSummaries: async () => ({
      authorized: false,
      permissionGranted: false,
      conversations: [],
    }),
    listMessagePage: async () => ({
      authorized: false,
      permissionGranted: false,
      messages: [],
      nextCursor: null,
      hasMore: false,
      totalCount: 0,
    }),
    listGalleryAlbums: async () => ({
      authorized: false,
      permissionGranted: false,
      albums: [],
    }),
    listGalleryPage: async (_password, albumId, offset) => ({
      authorized: false,
      permissionGranted: false,
      albumId,
      offset: Math.max(0, Math.floor(offset)),
      totalCount: 0,
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

const MAX_CONVERSATION_SUMMARIES = 10_000;
const MAX_MESSAGE_PAGE_SIZE = 100;
const MAX_GALLERY_PAGE_SIZE = 120;
const MESSAGE_DIRECTIONS = new Set<SmsDirection>([
  "inbox",
  "sent",
  "draft",
  "outbox",
  "failed",
  "queued",
  "unknown",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : value === null ? null : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseViewerContact(value: unknown): ViewerContact | null {
  const contact = asRecord(value);
  if (
    contact === null ||
    typeof contact.key !== "string" ||
    typeof contact.phoneNumber !== "string" ||
    typeof contact.isResolved !== "boolean"
  ) {
    return null;
  }
  return {
    key: contact.key,
    displayName: stringOrNull(contact.displayName),
    phoneNumber: contact.phoneNumber,
    phoneLabel: stringOrNull(contact.phoneLabel),
    avatarUri: stringOrNull(contact.avatarUri),
    isResolved: contact.isResolved,
  };
}

function parseConversation(value: unknown): ViewerConversation | null {
  const conversation = asRecord(value);
  const contact = parseViewerContact(conversation?.contact);
  const latestAt = finiteNumber(conversation?.latestAt);
  const messageCount = finiteNumber(conversation?.messageCount);
  const unreadCount = finiteNumber(conversation?.unreadCount);
  if (
    conversation === null ||
    contact === null ||
    typeof conversation.key !== "string" ||
    typeof conversation.address !== "string" ||
    typeof conversation.preview !== "string" ||
    latestAt === null ||
    messageCount === null ||
    unreadCount === null
  ) {
    return null;
  }
  return {
    key: conversation.key,
    threadId: finiteNumber(conversation.threadId),
    address: conversation.address,
    contact,
    preview: conversation.preview,
    latestAt,
    messageCount: Math.max(0, Math.floor(messageCount)),
    unreadCount: Math.max(0, Math.floor(unreadCount)),
  };
}

function parseConversationSummaries(raw: string): ConversationSummaryResult {
  try {
    const value = asRecord(JSON.parse(raw));
    const rawItems = value?.conversations;
    const items = Array.isArray(rawItems) ? rawItems : [];
    return {
      authorized: value?.authorized === true,
      permissionGranted: value?.permissionGranted === true,
      conversations: items
        .slice(0, MAX_CONVERSATION_SUMMARIES)
        .map(parseConversation)
        .filter((item): item is ViewerConversation => item !== null),
    };
  } catch {
    return { authorized: false, permissionGranted: false, conversations: [] };
  }
}

function parseAttachment(value: unknown): MmsAttachment | null {
  const attachment = asRecord(value);
  if (
    attachment === null ||
    typeof attachment.id !== "string" ||
    typeof attachment.uri !== "string" ||
    typeof attachment.mimeType !== "string"
  ) {
    return null;
  }
  return {
    id: attachment.id,
    uri: attachment.uri,
    mimeType: attachment.mimeType,
  };
}

function parseViewerMessage(value: unknown): ViewerMessage | null {
  const message = asRecord(value);
  const timestamp = finiteNumber(message?.timestamp);
  const receivedAt = finiteNumber(message?.receivedAt);
  const type = finiteNumber(message?.type);
  const direction = typeof message?.direction === "string"
    ? (message.direction as SmsDirection)
    : null;
  if (
    message === null ||
    timestamp === null ||
    receivedAt === null ||
    type === null ||
    direction === null ||
    !MESSAGE_DIRECTIONS.has(direction) ||
    typeof message.id !== "string" ||
    typeof message.sourceId !== "string" ||
    typeof message.address !== "string" ||
    typeof message.body !== "string" ||
    (message.kind !== "sms" && message.kind !== "mms") ||
    typeof message.read !== "boolean" ||
    typeof message.seen !== "boolean"
  ) {
    return null;
  }
  const attachments = Array.isArray(message.attachments)
    ? message.attachments
        .map(parseAttachment)
        .filter((item): item is MmsAttachment => item !== null)
    : [];
  return {
    id: message.id,
    sourceId: message.sourceId,
    threadId: finiteNumber(message.threadId),
    address: message.address,
    body: message.body,
    timestamp,
    receivedAt,
    sentAt: finiteNumber(message.sentAt),
    type,
    direction,
    kind: message.kind,
    attachments,
    read: message.read,
    seen: message.seen,
    status: finiteNumber(message.status),
    serviceCenter: stringOrNull(message.serviceCenter),
    simSubscriptionId: finiteNumber(message.simSubscriptionId),
  };
}

function parseMessageCursor(value: unknown): MessageCursor | null {
  const cursor = asRecord(value);
  const timestamp = finiteNumber(cursor?.timestamp);
  if (
    cursor === null ||
    timestamp === null ||
    (cursor.kind !== "sms" && cursor.kind !== "mms") ||
    typeof cursor.sourceId !== "string"
  ) {
    return null;
  }
  return { timestamp, kind: cursor.kind, sourceId: cursor.sourceId };
}

function parseViewerMessagePage(raw: string, limit: number): ViewerMessagePage {
  try {
    const value = asRecord(JSON.parse(raw));
    const rawItems = value?.messages;
    const items = Array.isArray(rawItems) ? rawItems : [];
    const totalCount = finiteNumber(value?.totalCount);
    return {
      authorized: value?.authorized === true,
      permissionGranted: value?.permissionGranted === true,
      messages: items
        .slice(0, limit)
        .map(parseViewerMessage)
        .filter((item): item is ViewerMessage => item !== null),
      nextCursor: parseMessageCursor(value?.nextCursor),
      hasMore: value?.hasMore === true,
      totalCount: Math.max(0, Math.floor(totalCount ?? 0)),
    };
  } catch {
    return {
      authorized: false,
      permissionGranted: false,
      messages: [],
      nextCursor: null,
      hasMore: false,
      totalCount: 0,
    };
  }
}

function parseViewerAlbum(value: unknown): ViewerAlbum | null {
  const album = asRecord(value);
  const photoCount = finiteNumber(album?.photoCount);
  if (
    album === null ||
    photoCount === null ||
    typeof album.id !== "string" ||
    typeof album.name !== "string"
  ) {
    return null;
  }
  return {
    id: album.id,
    name: album.name,
    photoCount: Math.max(0, Math.floor(photoCount)),
    coverUri: stringOrNull(album.coverUri),
  };
}

function parseGalleryAlbums(raw: string): GalleryAlbumListResult {
  try {
    const value = asRecord(JSON.parse(raw));
    const rawItems = value?.albums;
    const items = Array.isArray(rawItems) ? rawItems : [];
    return {
      authorized: value?.authorized === true,
      permissionGranted: value?.permissionGranted === true,
      albums: items
        .map(parseViewerAlbum)
        .filter((item): item is ViewerAlbum => item !== null),
    };
  } catch {
    return { authorized: false, permissionGranted: false, albums: [] };
  }
}

function parseViewerPhoto(value: unknown): ViewerPhoto | null {
  const photo = asRecord(value);
  const takenAt = finiteNumber(photo?.takenAt);
  if (
    photo === null ||
    takenAt === null ||
    typeof photo.id !== "string" ||
    typeof photo.uri !== "string" ||
    typeof photo.albumId !== "string" ||
    typeof photo.albumName !== "string" ||
    typeof photo.displayName !== "string" ||
    typeof photo.mimeType !== "string"
  ) {
    return null;
  }
  return {
    id: photo.id,
    uri: photo.uri,
    albumId: photo.albumId,
    albumName: photo.albumName,
    displayName: photo.displayName,
    takenAt,
    mimeType: photo.mimeType,
  };
}

function parseViewerPhotoPage(
  raw: string,
  fallbackAlbumId: string,
  fallbackOffset: number,
  limit: number,
): ViewerPhotoPage {
  try {
    const value = asRecord(JSON.parse(raw));
    const rawItems = value?.photos;
    const items = Array.isArray(rawItems) ? rawItems : [];
    const totalCount = finiteNumber(value?.totalCount);
    const offset = finiteNumber(value?.offset);
    const responseAlbumId = value?.albumId;
    return {
      authorized: value?.authorized === true,
      permissionGranted: value?.permissionGranted === true,
      albumId: typeof responseAlbumId === "string" ? responseAlbumId : fallbackAlbumId,
      offset: Math.max(0, Math.floor(offset ?? fallbackOffset)),
      totalCount: Math.max(0, Math.floor(totalCount ?? 0)),
      photos: items
        .slice(0, limit)
        .map(parseViewerPhoto)
        .filter((item): item is ViewerPhoto => item !== null),
    };
  } catch {
    return {
      authorized: false,
      permissionGranted: false,
      albumId: fallbackAlbumId,
      offset: fallbackOffset,
      totalCount: 0,
      photos: [],
    };
  }
}

function clampPageSize(limit: number | undefined, fallback: number, maximum: number): number {
  if (limit === undefined || !Number.isFinite(limit)) return fallback;
  return Math.min(maximum, Math.max(1, Math.floor(limit)));
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
    requestContactsPermission: async () => native.requestContactsPermission(),
    scanExistingMessages: async () => native.scanExistingMessages(),
    listAllMessages: async (password) =>
      parseMessageList(await native.getAllMessages(password)),
    listMmsMessages: async (password) =>
      parseMmsMessageList(await native.getAllMmsMessages(password)),
    listGalleryPhotos: async (password) =>
      parseGalleryPhotoList(await native.getGalleryPhotos(password)),
    listConversationSummaries: async (password) =>
      parseConversationSummaries(await native.getConversationSummaries(password)),
    listMessagePage: async (
      password,
      filter,
      threadId,
      address,
      cursor,
      requestedLimit,
    ) => {
      const limit = clampPageSize(requestedLimit, 40, MAX_MESSAGE_PAGE_SIZE);
      return parseViewerMessagePage(
        await native.getMessagePage(
          password,
          filter,
          threadId,
          address,
          cursor === null ? null : JSON.stringify(cursor),
          limit,
        ),
        limit,
      );
    },
    listGalleryAlbums: async (password) =>
      parseGalleryAlbums(await native.getGalleryAlbums(password)),
    listGalleryPage: async (password, albumId, requestedOffset, requestedLimit) => {
      const offset = Number.isFinite(requestedOffset)
        ? Math.max(0, Math.floor(requestedOffset))
        : 0;
      const limit = clampPageSize(requestedLimit, 60, MAX_GALLERY_PAGE_SIZE);
      return parseViewerPhotoPage(
        await native.getGalleryPage(password, albumId, offset, limit),
        albumId,
        offset,
        limit,
      );
    },
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
