export const SMS_VIEWER_SESSION_DURATION_MS = 10 * 60 * 1000;

import type {
  ViewerContact,
  ViewerConversation,
  ViewerMessage,
  ViewerMessageDirection,
  ViewerMessageFilter,
  ViewerPhoto,
} from "@/domain/sms-viewer-pagination";

export type {
  ViewerAttachment,
  ViewerContact,
  ViewerConversation,
  ViewerMessage,
  ViewerMessageDirection,
  ViewerMessageFilter,
  ViewerPhoto,
} from "@/domain/sms-viewer-pagination";

export interface SmsViewerData {
  messages: ViewerMessage[];
  photos: ViewerPhoto[];
  smsPermissionGranted: boolean;
  mediaPermissionGranted: boolean;
}

export interface SmsViewerSession {
  unlock(password: string): void;
  isActive(): boolean;
  touch(): boolean;
  remainingMs(): number;
  password(): string | null;
  lock(): void;
  replaceData(data: SmsViewerData): boolean;
  data(): SmsViewerData;
}

function emptyViewerData(): SmsViewerData {
  return {
    messages: [],
    photos: [],
    smsPermissionGranted: false,
    mediaPermissionGranted: false,
  };
}

export function createSmsViewerSession(
  now: () => number = () => Date.now(),
): SmsViewerSession {
  let expiresAt: number | null = null;
  let sessionPassword: string | null = null;
  let viewerData = emptyViewerData();

  function lock(): void {
    expiresAt = null;
    sessionPassword = null;
    viewerData = emptyViewerData();
  }

  function isActive(): boolean {
    if (expiresAt === null || sessionPassword === null) return false;
    if (now() >= expiresAt) {
      lock();
      return false;
    }
    return true;
  }

  return {
    unlock(password) {
      sessionPassword = password;
      expiresAt = now() + SMS_VIEWER_SESSION_DURATION_MS;
      viewerData = emptyViewerData();
    },
    isActive,
    touch: isActive,
    remainingMs() {
      if (!isActive() || expiresAt === null) return 0;
      return Math.max(0, expiresAt - now());
    },
    password() {
      return isActive() ? sessionPassword : null;
    },
    lock,
    replaceData(data) {
      if (!isActive()) return false;
      viewerData = {
        messages: [...data.messages],
        photos: [...data.photos],
        smsPermissionGranted: data.smsPermissionGranted,
        mediaPermissionGranted: data.mediaPermissionGranted,
      };
      return true;
    },
    data() {
      if (!isActive()) return emptyViewerData();
      return viewerData;
    },
  };
}

export function conversationKey(message: Pick<ViewerMessage, "threadId" | "address">): string {
  if (message.threadId !== null) return `thread:${message.threadId}`;
  return `address:${message.address.trim() || "unknown"}`;
}

export function buildConversations(messages: ViewerMessage[]): ViewerConversation[] {
  const conversations = new Map<string, ViewerConversation>();

  for (const message of messages) {
    const key = conversationKey(message);
    const existing = conversations.get(key);
    const address = message.address.trim() || "未知号码";
    const contact: ViewerContact = {
      key: `number:${address}`,
      displayName: null,
      phoneNumber: address,
      phoneLabel: null,
      avatarUri: null,
      isResolved: false,
    };
    if (!existing) {
      conversations.set(key, {
        key,
        threadId: message.threadId,
        address,
        contact,
        preview: message.body || (message.attachments.length ? "[图片]" : ""),
        latestAt: message.timestamp,
        messageCount: 1,
        unreadCount: message.direction === "inbox" && !message.read ? 1 : 0,
      });
      continue;
    }

    existing.messageCount += 1;
    if (message.direction === "inbox" && !message.read) existing.unreadCount += 1;
    if (message.timestamp > existing.latestAt) {
      existing.latestAt = message.timestamp;
      existing.preview = message.body || (message.attachments.length ? "[图片]" : "");
      existing.address = address;
    }
  }

  return [...conversations.values()].sort((left, right) => right.latestAt - left.latestAt);
}

export function filterViewerMessages(
  messages: ViewerMessage[],
  filter: ViewerMessageFilter,
): ViewerMessage[] {
  if (filter === "all") return messages;
  return messages.filter((message) => message.direction === filter);
}

export function messagesForConversation(
  messages: ViewerMessage[],
  key: string,
): ViewerMessage[] {
  return messages
    .filter((message) => conversationKey(message) === key)
    .sort((left, right) => left.timestamp - right.timestamp);
}

export const smsViewerSession = createSmsViewerSession();
