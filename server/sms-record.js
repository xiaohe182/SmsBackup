const REQUIRED_STRING_FIELDS = [
  "recordId",
  "deviceId",
  "deviceName",
  "sourceId",
  "sender",
  "body",
];

export function isValidSmsRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (!REQUIRED_STRING_FIELDS.every((field) => typeof value[field] === "string")) {
    return false;
  }
  if (
    !value.recordId ||
    !Number.isSafeInteger(value.receivedAt) ||
    value.receivedAt < 0
  ) return false;
  if (value.direction !== "inbox" && value.direction !== "sent") return false;
  return value.simSubscriptionId === null || Number.isInteger(value.simSubscriptionId);
}
