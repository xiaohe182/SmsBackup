export type ViewerMessageDirection =
  | "inbox"
  | "sent"
  | "draft"
  | "outbox"
  | "failed"
  | "queued"
  | "unknown";

export type ViewerMessageFilter = "all" | "inbox" | "sent";

export interface ViewerContact {
  key: string;
  displayName: string | null;
  phoneNumber: string;
  phoneLabel: string | null;
  avatarUri: string | null;
  isResolved: boolean;
}

export interface ViewerAttachment {
  id: string;
  uri: string;
  mimeType: string;
}

export interface ViewerMessage {
  id: string;
  sourceId: string;
  threadId: number | null;
  address: string;
  body: string;
  timestamp: number;
  receivedAt: number;
  sentAt: number | null;
  direction: ViewerMessageDirection;
  kind: "sms" | "mms";
  attachments: ViewerAttachment[];
  read: boolean;
  seen: boolean;
  status: number | null;
  serviceCenter: string | null;
  simSubscriptionId: number | null;
}

export interface ViewerConversation {
  key: string;
  threadId: number | null;
  address: string;
  contact: ViewerContact;
  preview: string;
  latestAt: number;
  messageCount: number;
  unreadCount: number;
}

export interface MessageCursor {
  timestamp: number;
  kind: "sms" | "mms";
  sourceId: string;
}

export interface ViewerMessagePage {
  authorized: boolean;
  permissionGranted: boolean;
  messages: ViewerMessage[];
  nextCursor: MessageCursor | null;
  hasMore: boolean;
  totalCount: number;
}

export interface ViewerAlbum {
  id: string;
  name: string;
  photoCount: number;
  coverUri: string | null;
}

export interface ViewerPhoto {
  id: string;
  uri: string;
  albumId: string;
  albumName: string;
  displayName: string;
  takenAt: number;
  mimeType: string;
}

export interface ViewerPhotoPage {
  authorized: boolean;
  permissionGranted: boolean;
  albumId: string;
  offset: number;
  totalCount: number;
  photos: ViewerPhoto[];
}

export function cursorFromMessage(message: ViewerMessage): MessageCursor {
  return {
    timestamp: message.timestamp,
    kind: message.kind,
    sourceId: message.sourceId,
  };
}

/**
 * 合并连续游标页时保留稳定顺序并去重；超过窗口上限后淘汰最远离当前浏览位置的头部数据，
 * 避免用户不断向下翻页时把整部手机的短信全部留在 JS 内存中。
 */
export function mergeMessagePage(
  existing: ViewerMessage[],
  incoming: ViewerMessage[],
  maxItems: number,
): ViewerMessage[] {
  const limit = Math.max(1, Math.floor(maxItems));
  const byId = new Map<string, ViewerMessage>();

  for (const message of existing) byId.set(message.id, message);
  for (const message of incoming) byId.set(message.id, message);

  const ordered = [...byId.values()].sort((left, right) => {
    if (left.timestamp !== right.timestamp) return right.timestamp - left.timestamp;
    if (left.kind !== right.kind) return left.kind.localeCompare(right.kind);
    return right.sourceId.localeCompare(left.sourceId);
  });

  return ordered.length > limit ? ordered.slice(ordered.length - limit) : ordered;
}
