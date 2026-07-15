import { describe, expect, it } from "vitest";

import {
  SMS_VIEWER_SESSION_DURATION_MS,
  buildConversations,
  createSmsViewerSession,
  filterViewerMessages,
} from "@/domain/sms-viewer-session";

function createClock(start = 1_000) {
  let now = start;
  return {
    now: () => now,
    advanceBy: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

describe("protected SMS viewer session", () => {
  it("expires exactly ten minutes after unlock without extending on activity", () => {
    const clock = createClock();
    const session = createSmsViewerSession(clock.now);

    session.unlock("88888888");
    clock.advanceBy(SMS_VIEWER_SESSION_DURATION_MS - 1);
    expect(session.touch()).toBe(true);
    expect(session.remainingMs()).toBe(1);

    clock.advanceBy(1);
    expect(session.isActive()).toBe(false);
    expect(session.password()).toBeNull();
  });

  it("clears the password and sensitive viewer data when manually locked", () => {
    const session = createSmsViewerSession();
    session.unlock("88888888");
    session.replaceData({
      messages: [
        {
          id: "sms-1",
          threadId: 7,
          address: "10086",
          body: "敏感短信内容",
          timestamp: 10,
          direction: "inbox",
          kind: "sms",
          attachments: [],
        },
      ],
      photos: [{ id: "photo-1", uri: "content://media/1", albumId: "a", albumName: "相机" }],
      smsPermissionGranted: true,
      mediaPermissionGranted: true,
    });

    session.lock();

    expect(session.password()).toBeNull();
    expect(session.data()).toEqual({
      messages: [],
      photos: [],
      smsPermissionGranted: false,
      mediaPermissionGranted: false,
    });
  });

  it("groups messages into a conversation and filters received and sent tabs", () => {
    const messages = [
      {
        id: "sms-1",
        threadId: 7,
        address: "10086",
        body: "收到内容",
        timestamp: 20,
        direction: "inbox" as const,
        kind: "sms" as const,
        attachments: [],
      },
      {
        id: "mms-1",
        threadId: 7,
        address: "10086",
        body: "已发内容",
        timestamp: 30,
        direction: "sent" as const,
        kind: "mms" as const,
        attachments: [{ id: "part-1", uri: "content://mms/part/1", mimeType: "image/jpeg" }],
      },
      {
        id: "sms-2",
        threadId: null,
        address: "95588",
        body: "另一会话",
        timestamp: 10,
        direction: "inbox" as const,
        kind: "sms" as const,
        attachments: [],
      },
    ];

    expect(buildConversations(messages)).toEqual([
      expect.objectContaining({ key: "thread:7", address: "10086", messageCount: 2, latestAt: 30 }),
      expect.objectContaining({ key: "address:95588", address: "95588", messageCount: 1, latestAt: 10 }),
    ]);
    expect(filterViewerMessages(messages, "inbox")).toHaveLength(2);
    expect(filterViewerMessages(messages, "sent")).toEqual([messages[1]]);
  });

  it("keeps contact-aware conversation identity only inside the unlocked session", () => {
    const session = createSmsViewerSession();
    session.unlock("88888888");
    session.replaceConversations([
      {
        key: "thread:7",
        threadId: 7,
        address: "13800138000",
        contact: {
          key: "contact:13800138000",
          displayName: "家人备注",
          phoneNumber: "13800138000",
          phoneLabel: "手机",
          avatarUri: "content://contacts/1/photo",
          isResolved: true,
        },
        preview: "晚饭见",
        latestAt: 100,
        messageCount: 2,
        unreadCount: 0,
      },
    ]);

    expect(session.conversation("thread:7")?.contact.displayName).toBe("家人备注");
    session.lock();
    expect(session.conversation("thread:7")).toBeNull();
  });
});
