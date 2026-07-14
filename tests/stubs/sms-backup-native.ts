export function initialize() {}
export function getPermissionState() {
  return '{"allGranted":false}';
}
export async function requestPermissions() {
  return false;
}
export async function scanExistingMessages() {
  return 0;
}
export async function getAllMessages(_password: string) {
  return '{"authorized":false,"permissionGranted":false,"messages":[]}';
}
export function getBackupStatus() {
  return '{"available":true,"permissionGranted":false,"pendingCount":0,"uploadedCount":0,"filteredCount":0,"lastSyncAt":null,"message":"stub"}';
}
export function saveNativeSettings(_settingsJson: string) {}
export function saveNativeRules(_rulesJson: string) {}
export function syncNow() {}
export async function testConnection(_serverUrl: string) {
  return false;
}
export function clearQueue() {}
