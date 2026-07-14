export const SMS_VIEWER_PASSWORD = "88888888";

export function isSmsViewerPasswordValid(value: string): boolean {
  return value === SMS_VIEWER_PASSWORD;
}
