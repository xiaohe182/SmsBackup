<template>
  <view class="page">
    <view class="header">
      <view>
        <text class="title">{{ conversationTitle }}</text>
        <text class="subtitle">{{ unlocked ? `剩余 ${remainingSessionText}` : "查看会话已到期" }}</text>
      </view>
      <button v-if="unlocked" class="lock-button" size="mini" @click="lockViewer">锁定</button>
    </view>

    <view v-if="!unlocked" class="expired-card">
      <text class="expired-title">需要重新解锁</text>
      <text class="expired-desc">查看会话已到期或已被锁定，请返回短信页重新输入密码。</text>
      <button class="return-button" @click="returnToMessages">返回短信页</button>
    </view>

    <template v-else>
      <view v-if="conversationMessages.length === 0" class="expired-card">
        <text class="expired-title">没有找到此会话</text>
      </view>
      <view v-for="(message, index) in conversationMessages" :key="message.id">
        <view v-if="showDayDivider(message.timestamp, index)" class="day-divider">
          <text>{{ dayLabel(message.timestamp) }}</text>
        </view>
        <view :class="['bubble-row', { outgoing: isOutgoing(message.direction) }]">
          <view :class="['bubble', { outgoing: isOutgoing(message.direction) }]">
            <text v-if="message.body" class="message-body">{{ message.body }}</text>
            <view v-if="message.attachments.length" class="attachment-grid">
              <image
                v-for="attachment in message.attachments"
                :key="attachment.id"
                class="attachment-image"
                :src="attachment.uri"
                mode="aspectFill"
                @tap="previewAttachment(attachment.uri)"
              />
            </view>
            <text class="message-time">{{ timeLabel(message.timestamp) }}</text>
          </view>
        </view>
      </view>
    </template>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { onHide, onLoad, onShow, onUnload } from "@dcloudio/uni-app";

import {
  messagesForConversation,
  smsViewerSession,
  type ViewerMessage,
  type ViewerMessageDirection,
} from "@/domain/sms-viewer-session";

const conversationKey = ref("");
const conversationMessages = ref<ViewerMessage[]>([]);
const unlocked = ref(false);
const remainingMs = ref(0);
let countdownTimer: ReturnType<typeof setInterval> | null = null;

const conversationTitle = computed(() =>
  conversationMessages.value[0]?.address || "短信详情",
);
const remainingSessionText = computed(() => {
  const seconds = Math.ceil(remainingMs.value / 1_000);
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
});

function syncSessionState(): boolean {
  unlocked.value = smsViewerSession.touch();
  remainingMs.value = smsViewerSession.remainingMs();
  conversationMessages.value = unlocked.value
    ? messagesForConversation(smsViewerSession.data().messages, conversationKey.value)
    : [];
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

function dayLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString();
}

function timeLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function showDayDivider(timestamp: number, index: number): boolean {
  return index === 0 || dayLabel(timestamp) !== dayLabel(conversationMessages.value[index - 1].timestamp);
}

function previewAttachment(uri: string) {
  if (!smsViewerSession.touch()) {
    syncSessionState();
    return;
  }
  const urls = conversationMessages.value.flatMap((message) =>
    message.attachments.map((attachment) => attachment.uri),
  );
  uni.previewImage({ current: uri, urls });
}

onLoad((options) => {
  conversationKey.value = options?.key ? decodeURIComponent(options.key) : "";
  syncSessionState();
});

onShow(startCountdown);
onHide(stopCountdown);
onUnload(stopCountdown);
</script>

<style>
page { background: #f5f5f7; color: #1d1b20; font-family: system-ui, sans-serif; }
.page { min-height: 100vh; padding: 28rpx 24rpx 56rpx; }
.header { display: flex; justify-content: space-between; align-items: flex-start; gap: 20rpx; }
.title { display: block; max-width: 500rpx; overflow: hidden; font-size: 44rpx; font-weight: 750; text-overflow: ellipsis; white-space: nowrap; }
.subtitle { display: block; margin-top: 8rpx; color: #625b71; font-size: 23rpx; }
.lock-button, .return-button { border: 0; border-radius: 999rpx; color: #4f378b; background: #e8def8; font-size: 23rpx; }
.lock-button::after, .return-button::after { border: 0; }
.expired-card { margin-top: 28rpx; padding: 36rpx 28rpx; border-radius: 28rpx; background: #fff; text-align: center; }
.expired-title { display: block; font-size: 30rpx; font-weight: 700; }
.expired-desc { display: block; margin-top: 10rpx; color: #625b71; font-size: 24rpx; line-height: 1.55; }
.return-button { margin-top: 22rpx; }
.day-divider { display: flex; justify-content: center; margin: 26rpx 0 14rpx; }
.day-divider text { padding: 7rpx 16rpx; border-radius: 999rpx; color: #625b71; background: #e7e0ec; font-size: 20rpx; }
.bubble-row { display: flex; margin: 10rpx 0; }
.bubble-row.outgoing { justify-content: flex-end; }
.bubble { max-width: 78%; padding: 18rpx 20rpx 12rpx; border-radius: 22rpx 22rpx 22rpx 6rpx; background: #fff; box-shadow: 0 3rpx 10rpx rgba(29, 27, 32, 0.04); }
.bubble.outgoing { border-radius: 22rpx 22rpx 6rpx 22rpx; background: #d7f8d0; }
.message-body { display: block; color: #2b2930; font-size: 28rpx; line-height: 1.58; word-break: break-all; white-space: pre-wrap; }
.attachment-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8rpx; margin-top: 12rpx; }
.attachment-image { width: 250rpx; height: 250rpx; border-radius: 12rpx; background: #e7e0ec; }
.message-time { display: block; margin-top: 8rpx; color: #79747e; font-size: 19rpx; text-align: right; }
</style>
