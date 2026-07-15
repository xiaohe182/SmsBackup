const SAFE_DEVICE_ID = /^[A-Za-z0-9._-]{1,128}$/u;
const SAFE_MEDIA_ID = /^[a-f0-9]{64}$/u;

const MIME_EXTENSIONS = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
  ["image/heic", ".heic"],
  ["image/heif", ".heif"],
  ["image/bmp", ".bmp"],
  ["image/x-adobe-dng", ".dng"],
  ["video/mp4", ".mp4"],
  ["video/quicktime", ".mov"],
  ["video/3gpp", ".3gp"],
  ["video/webm", ".webm"],
  ["video/x-matroska", ".mkv"],
  ["video/x-msvideo", ".avi"],
]);

export function isSafeDeviceId(value) {
  return typeof value === "string" && SAFE_DEVICE_ID.test(value);
}

export function isSafeMediaId(value) {
  return typeof value === "string" && SAFE_MEDIA_ID.test(value);
}

export function extensionForMimeType(mimeType) {
  const normalized = String(mimeType).toLowerCase();
  if (MIME_EXTENSIONS.has(normalized)) return MIME_EXTENSIONS.get(normalized);
  if (normalized.startsWith("image/")) return ".img";
  if (normalized.startsWith("video/")) return ".video";
  return null;
}

export function isValidMediaManifestItem(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (!isSafeMediaId(value.mediaId) || !isSafeDeviceId(value.deviceId)) return false;
  if (value.mediaType !== "image" && value.mediaType !== "video") return false;
  for (const field of [
    "volumeName", "sourceId", "albumId", "albumName", "displayName", "mimeType",
  ]) {
    if (typeof value[field] !== "string") return false;
  }
  if (!value.volumeName || !value.sourceId || !value.mimeType) return false;
  if (!Number.isSafeInteger(value.takenAt) || value.takenAt < 0) return false;
  if (!Number.isSafeInteger(value.modifiedAt) || value.modifiedAt < 0) return false;
  if (!Number.isSafeInteger(value.size) || value.size < 1) return false;
  if (value.duration !== null && (!Number.isSafeInteger(value.duration) || value.duration < 0)) {
    return false;
  }
  if (value.mediaType === "image" && !value.mimeType.toLowerCase().startsWith("image/")) {
    return false;
  }
  if (value.mediaType === "video" && !value.mimeType.toLowerCase().startsWith("video/")) {
    return false;
  }
  return extensionForMimeType(value.mimeType) !== null;
}

export function isValidStoredMediaRecord(value) {
  return isValidMediaManifestItem(value) &&
    typeof value.commandId === "string" &&
    typeof value.storagePath === "string" &&
    value.storagePath.length > 0 &&
    !value.storagePath.includes("..") &&
    typeof value.storedAt === "string";
}
