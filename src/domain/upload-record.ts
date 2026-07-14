export type SmsDirection = "inbox" | "sent";

export interface SmsUploadRecord {
  recordId: string;
  deviceId: string;
  deviceName: string;
  sourceId: string;
  sender: string;
  body: string;
  receivedAt: number;
  direction: SmsDirection;
  simSubscriptionId: number | null;
}

export function createRecordId(
  deviceId: string,
  sourceId: string,
  direction: SmsDirection,
): string {
  return `${encodeURIComponent(deviceId)}:${encodeURIComponent(sourceId)}:${direction}`;
}

export function isUploadRecord(value: unknown): value is SmsUploadRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  const stringFields = [
    "recordId",
    "deviceId",
    "deviceName",
    "sourceId",
    "sender",
    "body",
  ];

  return (
    stringFields.every((field) => typeof record[field] === "string") &&
    typeof record.receivedAt === "number" &&
    Number.isFinite(record.receivedAt) &&
    (record.direction === "inbox" || record.direction === "sent") &&
    (record.simSubscriptionId === null ||
      (typeof record.simSubscriptionId === "number" &&
        Number.isInteger(record.simSubscriptionId)))
  );
}
