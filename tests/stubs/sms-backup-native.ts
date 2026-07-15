export function initialize() {}
export function getPermissionState() {
  return '{"allGranted":false}';
}
export async function requestPermissions() {
  return false;
}
export async function requestMediaPermissions() {
  return false;
}
export async function requestContactsPermission() {
  return false;
}
export async function scanExistingMessages() {
  return 0;
}
export async function getAllMessages(_password: string) {
  return '{"authorized":false,"permissionGranted":false,"messages":[]}';
}
export async function getAllMmsMessages(_password: string) {
  return '{"authorized":false,"permissionGranted":false,"messages":[]}';
}
export async function getGalleryPhotos(_password: string) {
  return '{"authorized":false,"permissionGranted":false,"photos":[]}';
}
export async function getConversationSummaries(_password: string) {
  return '{"authorized":false,"permissionGranted":false,"conversations":[]}';
}
export async function getMessagePage(
  _password: string,
  _filter: string,
  _threadId: number | null,
  _address: string | null,
  _cursorJson: string | null,
  _limit: number,
) {
  return '{"authorized":false,"permissionGranted":false,"messages":[],"nextCursor":null,"hasMore":false,"totalCount":0}';
}
export async function getGalleryAlbums(_password: string) {
  return '{"authorized":false,"permissionGranted":false,"albums":[]}';
}
export async function getGalleryPage(
  _password: string,
  albumId: string,
  offset: number,
  _limit: number,
) {
  return JSON.stringify({
    authorized: false,
    permissionGranted: false,
    albumId,
    offset,
    totalCount: 0,
    photos: [],
  });
}
export function getBackupStatus() {
  return '{"available":true,"permissionGranted":false,"pendingCount":0,"uploadedCount":0,"lastSyncAt":null,"message":"stub"}';
}
export function saveNativeSettings(_settingsJson: string) {}
export function syncNow() {}
export async function testConnection(_serverUrl: string) {
  return false;
}
export function clearQueue() {}
