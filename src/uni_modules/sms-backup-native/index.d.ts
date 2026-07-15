export function initialize(): void;
export function getPermissionState(): string;
export function requestPermissions(): Promise<boolean>;
export function requestMediaPermissions(): Promise<boolean>;
export function requestContactsPermission(): Promise<boolean>;
export function scanExistingMessages(): Promise<number>;
export function getAllMessages(password: string): Promise<string>;
export function getAllMmsMessages(password: string): Promise<string>;
export function getGalleryPhotos(password: string): Promise<string>;
export function getConversationSummaries(password: string): Promise<string>;
export function getMessagePage(
  password: string,
  filter: string,
  threadId: number | null,
  address: string | null,
  cursorJson: string | null,
  limit: number,
): Promise<string>;
export function getGalleryAlbums(password: string): Promise<string>;
export function getGalleryPage(
  password: string,
  albumId: string,
  offset: number,
  limit: number,
): Promise<string>;
export function getBackupStatus(): string;
export function saveNativeSettings(settingsJson: string): void;
export function syncNow(): void;
export function testConnection(serverUrl: string): Promise<boolean>;
export function clearQueue(): void;
