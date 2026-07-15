<template>
  <view class="page">
    <view v-if="contact" class="contact-header">
      <image
        class="contact-avatar"
        :src="contact.avatarUri || DEFAULT_CONTACT_AVATAR"
        mode="aspectFill"
        lazy-load="true"
      />
      <view class="contact-copy">
        <text class="contact-name">{{ contact.displayName || '未保存联系人' }}</text>
        <view class="contact-number-line">
          <text class="contact-number">{{ contact.phoneNumber }}</text>
          <text v-if="contact.phoneLabel" class="contact-label">{{ contact.phoneLabel }}</text>
        </view>
        <text class="session-text">
          {{ unlocked ? `查看剩余 ${remainingSessionText}` : '查看会话已到期' }}
        </text>
      </view>
      <button v-if="unlocked" class="lock-button" size="mini" @tap="lockViewer">锁定</button>
    </view>

    <view v-if="!unlocked" class="state-card">
      <text class="state-title">需要重新解锁</text>
      <text class="state-desc">查看会话已到期或已锁定，请返回短信页重新输入密码。</text>
      <button class="return-button" @tap="returnToMessages">返回短信页</button>
    </view>

    <view v-else-if="!conversation" class="state-card">
      <text class="state-title">没有找到此会话</text>
      <text class="state-desc">会话信息已清除或来源记录不存在。</text>
      <button class="return-button" @tap="returnToMessages">返回短信页</button>
    </view>

    <template v-else>
      <view class="summary-strip">
        <text>{{ conversation.messageCount }} 条记录</text>
        <text>{{ conversation.unreadCount }} 条未读</text>
        <text>含接收与发送</text>
      </view>

      <scroll-view
        class="message-scroll"
        scroll-y
        :scroll-into-view="scrollIntoView"
        :show-scrollbar="false"
        upper-threshold="80"
        @scrolltoupper="loadOlderMessages"
      >
        <view class="history-footer">
          <text v-if="loading">正在加载更早记录…</text>
          <text v-else-if="hasMore">上滑到顶部继续加载</text>
          <text v-else>已到最早记录</text>
        </view>

        <view v-if="errorText" class="error-card"><text>{{ errorText }}</text></view>

        <view
          v-for="(message, index) in conversationMessages"
          :id="messageDomId(message.id)"
          :key="message.id"
        >
          <view v-if="showDayDivider(message.timestamp, index)" class="day-divider">
            <text>{{ dayLabel(message.timestamp) }}</text>
          </view>

          <view :class="['bubble-row', { outgoing: isOutgoing(message.direction) }]">
            <view :class="['bubble', { outgoing: isOutgoing(message.direction) }]">
              <view class="bubble-heading">
                <text class="direction-text">{{ directionLabel(message.direction) }}</text>
                <text class="kind-text">{{ message.kind === 'mms' ? '彩信' : '短信' }}</text>
              </view>

              <text v-if="message.body" class="message-body">{{ message.body }}</text>
              <text v-else class="message-body muted-body">[无文本内容]</text>

              <view v-if="message.attachments.length" class="attachment-grid">
                <image
                  v-for="attachment in message.attachments"
                  :key="attachment.id"
                  class="attachment-image"
                  :src="attachment.uri"
                  mode="aspectFill"
                  lazy-load="true"
                  fade-show="false"
                  @tap="previewAttachment(attachment.uri)"
                />
              </view>

              <view class="message-details">
                <view class="detail-row">
                  <text class="detail-label">接收/记录时间</text>
                  <text class="detail-value">{{ preciseTime(message.receivedAt) }}</text>
                </view>
                <view class="detail-row">
                  <text class="detail-label">发送时间</text>
                  <text class="detail-value">{{ message.sentAt === null ? '未提供' : preciseTime(message.sentAt) }}</text>
                </view>
                <view class="detail-row">
                  <text class="detail-label">方向</text>
                  <text class="detail-value">{{ message.direction }}</text>
                </view>
                <view class="detail-row">
                  <text class="detail-label">类型 / 状态</text>
                  <text class="detail-value">{{ message.type }} / {{ statusLabel(message.status) }}</text>
                </view>
                <view class="detail-row">
                  <text class="detail-label">读取状态</text>
                  <text class="detail-value">{{ message.read ? '已读' : '未读' }} · {{ message.seen ? '已查看' : '未查看' }}</text>
                </view>
                <view class="detail-row">
                  <text class="detail-label">SIM</text>
                  <text class="detail-value">{{ message.simSubscriptionId === null ? '未提供' : message.simSubscriptionId }}</text>
                </view>
                <view class="detail-row">
                  <text class="detail-label">短信中心</text>
                  <text class="detail-value break-value">{{ message.serviceCenter || '未提供' }}</text>
                </view>
                <view class="detail-row">
                  <text class="detail-label">系统记录 ID</text>
                  <text class="detail-value">{{ message.kind }}:{{ message.sourceId }}</text>
                </view>
              </view>
              <text class="message-time">{{ timeLabel(message.timestamp) }}</text>
            </view>
          </view>
        </view>

        <view v-if="!conversationMessages.length && !loading" class="state-card embedded-state">
          <text class="state-title">没有找到短信内容</text>
        </view>
        <view id="conversation-bottom" class="bottom-anchor" />
      </scroll-view>
    </template>
  </view>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { onHide, onLoad, onShow, onUnload } from "@dcloudio/uni-app";

import type {
  MessageCursor,
  ViewerConversation,
  ViewerMessage,
  ViewerMessageDirection,
} from "@/domain/sms-viewer-pagination";
import { smsViewerSession } from "@/domain/sms-viewer-session";
import { smsBackupService } from "@/services/sms-backup";

const DEFAULT_CONTACT_AVATAR = "/static/default-contact.png";
const MESSAGE_PAGE_SIZE = 40;
const MESSAGE_WINDOW_SIZE = 200;

const conversationKey = ref("");
const conversation = ref<ViewerConversation | null>(null);
const conversationMessages = ref<ViewerMessage[]>([]);
const cursor = ref<MessageCursor | null>(null);
const hasMore = ref(false);
const loading = ref(false);
const errorText = ref("");
const unlocked = ref(false);
const remainingMs = ref(0);
const scrollIntoView = ref("");
let requestGeneration = 0;
let countdownTimer: ReturnType<typeof setInterval> | null = null;

const contact = computed(() => conversation.value?.contact ?? null);
const remainingSessionText = computed(() => {
  const seconds = Math.ceil(remainingMs.value / 1_000);
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
});

function syncSessionState(): boolean {
  unlocked.value = smsViewerSession.touch();
  remainingMs.value = smsViewerSession.remainingMs();
  conversation.value = unlocked.value
    ? smsViewerSession.conversation(conversationKey.value)
    : null;
  if (!unlocked.value) {
    requestGeneration += 1;
    conversationMessages.value = [];
    cursor.value = null;
    hasMore.value = false;
  }
  return unlocked.value;
}

function startCountdown() {
  stopCountdown();
  syncSessionState();
  countdownTimer = setInterval(() => {
    if (!syncSessionState()) stopCountdown();
  }, 1_000);
}

function stopCountdown() {
  if (countdownTimer !== null) clearInterval(countdownTimer);
  countdownTimer = null;
}

async function loadMessageHistory(reset: boolean): Promise<void> {
  const password = smsViewerSession.password();
  const selectedConversation = conversation.value;
  if (
    !password ||
    !selectedConversation ||
    (!reset && (loading.value || !hasMore.value))
  ) {
    return;
  }

  const generation = reset ? ++requestGeneration : requestGeneration;
  const anchorId = reset || !conversationMessages.value.length
    ? ""
    : messageDomId(conversationMessages.value[0].id);
  if (reset) {
    conversationMessages.value = [];
    cursor.value = null;
    hasMore.value = true;
  }
  loading.value = true;
  errorText.value = "";
  try {
    const result = await smsBackupService.listMessagePage(
      password,
      "all",
      selectedConversation.threadId,
      selectedConversation.address,
      reset ? null : cursor.value,
      MESSAGE_PAGE_SIZE,
    );
    if (generation !== requestGeneration || !smsViewerSession.isActive()) return;
    if (!result.authorized) {
      lockViewer();
      return;
    }
    if (!result.permissionGranted) {
      errorText.value = "短信读取权限已关闭，请返回短信页重新授权";
      return;
    }

    const byId = new Map<string, ViewerMessage>();
    [...result.messages, ...conversationMessages.value].forEach((message) => {
      byId.set(message.id, message);
    });
    const ordered = [...byId.values()].sort((left, right) => left.timestamp - right.timestamp);
    // 向上翻页时保留最靠近当前历史位置的 200 条，避免长会话无限占用 JS 内存。
    conversationMessages.value = ordered.length > MESSAGE_WINDOW_SIZE
      ? ordered.slice(0, MESSAGE_WINDOW_SIZE)
      : ordered;
    cursor.value = result.nextCursor;
    hasMore.value = result.hasMore;

    await nextTick();
    scrollIntoView.value = reset
      ? "conversation-bottom"
      : anchorId;
  } catch {
    if (generation === requestGeneration) errorText.value = "短信详情加载失败，请稍后重试";
  } finally {
    if (generation === requestGeneration) loading.value = false;
  }
}

async function loadOlderMessages() {
  if (!smsViewerSession.touch()) {
    syncSessionState();
    return;
  }
  await loadMessageHistory(false);
}

function lockViewer() {
  smsViewerSession.lock();
  stopCountdown();
  syncSessionState();
  returnToMessages();
}

function returnToMessages() {
  uni.navigateBack({ delta: 1 });
}

function isOutgoing(direction: ViewerMessageDirection): boolean {
  return direction === "sent" || direction === "outbox" || direction === "queued";
}

function directionLabel(direction: ViewerMessageDirection): string {
  const labels: Record<ViewerMessageDirection, string> = {
    inbox: "收到",
    sent: "已发送",
    draft: "草稿",
    outbox: "发件箱",
    failed: "发送失败",
    queued: "等待发送",
    unknown: "其他",
  };
  return labels[direction];
}

function statusLabel(status: number | null): string {
  if (status === null) return "未提供";
  const labels: Record<number, string> = {
    [-1]: "无状态",
    0: "发送完成",
    32: "等待发送",
    64: "发送失败",
  };
  return labels[status] ?? String(status);
}

function dayLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString();
}

function timeLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function preciseTime(timestamp: number): string {
  return timestamp > 0 ? new Date(timestamp).toLocaleString() : "未提供";
}

function showDayDivider(timestamp: number, index: number): boolean {
  return index === 0 || dayLabel(timestamp) !== dayLabel(conversationMessages.value[index - 1].timestamp);
}

function messageDomId(id: string): string {
  return `message-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function previewAttachment(uri: string) {
  if (!smsViewerSession.touch()) {
    syncSessionState();
    return;
  }
  const urls = conversationMessages.value
    .flatMap((message) => message.attachments.map((attachment) => attachment.uri))
    .slice(0, MESSAGE_WINDOW_SIZE);
  uni.previewImage({ current: uri, urls: urls.includes(uri) ? urls : [uri, ...urls] });
}

onLoad((options) => {
  conversationKey.value = options?.key ? decodeURIComponent(options.key) : "";
  if (syncSessionState() && conversation.value) void loadMessageHistory(true);
});

onShow(() => {
  startCountdown();
  if (unlocked.value && conversation.value && !loading.value && !conversationMessages.value.length) {
    void loadMessageHistory(true);
  }
});
onHide(stopCountdown);
onUnload(() => {
  requestGeneration += 1;
  stopCountdown();
});
</script>

<style>
page { background: #f5f5f7; color: #1d1b20; font-family: system-ui, sans-serif; }
.page { min-height: 100vh; padding: 24rpx 22rpx 36rpx; }
.contact-header { display: flex; align-items: center; gap: 18rpx; padding: 18rpx 20rpx; border-radius: 26rpx; background: #fff; box-shadow: 0 7rpx 22rpx rgba(29, 27, 32, 0.05); }
.contact-avatar { flex: none; width: 92rpx; height: 92rpx; border-radius: 50%; background: #e8def8; }
.contact-copy { min-width: 0; flex: 1; }
.contact-name { display: block; overflow: hidden; font-size: 32rpx; font-weight: 740; text-overflow: ellipsis; white-space: nowrap; }
.contact-number-line { display: flex; align-items: center; gap: 9rpx; margin-top: 4rpx; }
.contact-number { overflow: hidden; color: #625b71; font-size: 22rpx; text-overflow: ellipsis; white-space: nowrap; }
.contact-label { flex: none; padding: 2rpx 8rpx; border-radius: 999rpx; color: #4f378b; background: #f3edf7; font-size: 18rpx; }
.session-text { display: block; margin-top: 6rpx; color: #79747e; font-size: 20rpx; }
.lock-button, .return-button { flex: none; border: 0; border-radius: 999rpx; color: #4f378b; background: #e8def8; font-size: 21rpx; }
.lock-button::after, .return-button::after { border: 0; }
.summary-strip { display: flex; justify-content: space-around; gap: 10rpx; margin-top: 14rpx; padding: 14rpx 12rpx; border-radius: 18rpx; color: #625b71; background: #f3edf7; font-size: 20rpx; }
.message-scroll { height: calc(100vh - 290rpx); margin-top: 8rpx; }
.history-footer { padding: 22rpx 12rpx 10rpx; color: #79747e; font-size: 20rpx; text-align: center; }
.day-divider { display: flex; justify-content: center; margin: 22rpx 0 12rpx; }
.day-divider text { padding: 7rpx 16rpx; border-radius: 999rpx; color: #625b71; background: #e7e0ec; font-size: 20rpx; }
.bubble-row { display: flex; margin: 10rpx 0; }
.bubble-row.outgoing { justify-content: flex-end; }
.bubble { width: 82%; max-width: 610rpx; padding: 17rpx 18rpx 12rpx; border: 1rpx solid #ece7ef; border-radius: 22rpx 22rpx 22rpx 6rpx; background: #fff; box-shadow: 0 3rpx 10rpx rgba(29, 27, 32, 0.035); }
.bubble.outgoing { border-color: #b9deb8; border-radius: 22rpx 22rpx 6rpx 22rpx; background: #d7f8d0; }
.bubble-heading { display: flex; align-items: center; justify-content: space-between; gap: 12rpx; }
.direction-text { color: #4f378b; font-size: 20rpx; font-weight: 700; }
.bubble.outgoing .direction-text { color: #245a35; }
.kind-text { color: #79747e; font-size: 18rpx; }
.message-body { display: block; margin-top: 10rpx; color: #2b2930; font-size: 27rpx; line-height: 1.58; word-break: break-all; white-space: pre-wrap; }
.muted-body { color: #79747e; }
.attachment-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8rpx; margin-top: 12rpx; }
.attachment-image { width: 100%; height: 240rpx; border-radius: 12rpx; background: #e7e0ec; }
.message-details { margin-top: 14rpx; padding-top: 10rpx; border-top: 1rpx solid rgba(121, 116, 126, 0.2); }
.detail-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 16rpx; padding: 4rpx 0; }
.detail-label { flex: none; color: #79747e; font-size: 18rpx; }
.detail-value { min-width: 0; color: #625b71; font-size: 18rpx; text-align: right; }
.break-value { word-break: break-all; }
.message-time { display: block; margin-top: 8rpx; color: #79747e; font-size: 19rpx; text-align: right; }
.state-card, .error-card { margin-top: 24rpx; padding: 34rpx 26rpx; border-radius: 26rpx; background: #fff; text-align: center; }
.embedded-state { margin: 30rpx 2rpx; }
.state-title { display: block; font-size: 29rpx; font-weight: 700; }
.state-desc { display: block; margin-top: 9rpx; color: #625b71; font-size: 23rpx; line-height: 1.5; }
.return-button { margin-top: 20rpx; }
.error-card { color: #b3261e; background: #f9dedc; font-size: 22rpx; }
.bottom-anchor { height: 30rpx; }
</style>
