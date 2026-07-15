<template>
  <view class="page">
    <view class="header">
      <view>
        <text class="eyebrow">PRIVATE MESSAGES</text>
        <text class="title">短信</text>
        <text class="subtitle">会话、完整内容、彩信图片和本机相册</text>
      </view>
      <button
        v-if="unlocked"
        class="lock-button"
        size="mini"
        @click="lockViewer"
      >
        锁定
      </button>
    </view>

    <view v-if="!unlocked" class="lock-card">
      <text class="lock-title">输入查看密码</text>
      <text class="lock-desc">解锁后可自由浏览 10 分钟；返回或切到后台不会提前锁定。</text>
      <input
        v-model="passwordInput"
        class="password-input"
        type="password"
        maxlength="8"
        placeholder="请输入 8 位密码"
        confirm-type="done"
        @confirm="unlockAndLoad"
      />
      <button
        class="primary-button"
        :disabled="passwordInput.length === 0"
        :loading="busy"
        @click="unlockAndLoad"
      >
        解锁并读取
      </button>
    </view>

    <template v-else>
      <view class="session-card">
        <view>
          <text class="session-title">查看会话已解锁</text>
          <text class="session-desc">剩余 {{ remainingSessionText }}，时间不会因操作续期</text>
        </view>
        <button class="refresh-button" size="mini" :loading="busy" @click="refreshViewer">
          刷新
        </button>
      </view>

      <view class="tabs" scroll-x>
        <view
          v-for="tab in tabs"
          :key="tab.key"
          :class="['tab', { active: activeTab === tab.key }]"
          @tap="selectTab(tab.key)"
        >
          <text>{{ tab.label }}</text>
        </view>
      </view>

      <view v-if="errorText" class="error-card"><text>{{ errorText }}</text></view>

      <template v-if="activeTab === 'conversations'">
        <view v-if="!viewerData.smsPermissionGranted" class="permission-card">
          <text class="permission-title">还没有短信读取权限</text>
          <text class="permission-desc">授权后可按联系人或号码查看已收到和已发送的完整短信。</text>
          <button class="primary-button" :loading="busy" @click="requestSmsPermissions">
            授权读取短信
          </button>
        </view>
        <view v-else-if="conversations.length === 0" class="empty-card">
          <text class="empty-title">没有找到短信会话</text>
          <text class="empty-desc">系统短信库当前没有可显示的会话。</text>
        </view>
        <view
          v-for="conversation in conversations"
          :key="conversation.key"
          class="conversation-row"
          hover-class="conversation-row-pressed"
          @tap="openConversation(conversation.key)"
        >
          <view class="avatar"><text>{{ conversation.address.slice(-1) || "?" }}</text></view>
          <view class="conversation-main">
            <view class="conversation-top">
              <text class="conversation-address">{{ conversation.address }}</text>
              <text class="conversation-time">{{ formatCompactTime(conversation.latestAt) }}</text>
            </view>
            <view class="conversation-bottom">
              <text class="conversation-preview">{{ conversation.preview || "图片消息" }}</text>
              <text v-if="conversation.unreadCount" class="unread-count">{{ conversation.unreadCount }}</text>
            </view>
          </view>
        </view>
      </template>

      <template v-else-if="activeTab === 'media'">
        <view class="media-heading">
          <view>
            <text class="section-title">图片</text>
            <text class="section-desc">包含彩信附件和你授权访问的本机相册</text>
          </view>
        </view>

        <view class="album-tabs" scroll-x>
          <view
            v-for="album in albums"
            :key="album.id"
            :class="['album-tab', { active: activeAlbum === album.id }]"
            @tap="activeAlbum = album.id"
          >
            <text>{{ album.name }}</text>
          </view>
        </view>

        <view v-if="!viewerData.mediaPermissionGranted" class="media-permission-card">
          <text class="permission-title">授权后可浏览本机相册</text>
          <text class="permission-desc">彩信图片不受此权限影响；相册照片只在当前 10 分钟会话内显示。</text>
          <button class="secondary-button" :loading="busy" @click="requestMediaPermissions">
            授权读取图片
          </button>
        </view>

        <view v-if="visibleMediaItems.length" class="media-grid">
          <view
            v-for="(item, index) in visibleMediaItems"
            :key="item.id"
            class="media-tile"
            @tap="previewMedia(index)"
          >
            <image class="media-image" :src="item.uri" mode="aspectFill" />
            <text class="media-source">{{ item.source === "mms" ? "短信图片" : item.albumName }}</text>
          </view>
        </view>
        <view v-else class="empty-card">
          <text class="empty-title">没有可显示的图片</text>
          <text class="empty-desc">彩信图片和授权相册中的照片会显示在这里。</text>
        </view>
      </template>

      <template v-else>
        <view v-if="!viewerData.smsPermissionGranted" class="permission-card">
          <text class="permission-title">还没有短信读取权限</text>
          <button class="primary-button" :loading="busy" @click="requestSmsPermissions">
            授权读取短信
          </button>
        </view>
        <view v-else-if="filteredMessages.length === 0" class="empty-card">
          <text class="empty-title">没有找到短信</text>
          <text class="empty-desc">切换到“会话”可查看与谁聊天的完整详情。</text>
        </view>
        <view v-for="message in filteredMessages" :key="message.id" class="message-card">
          <view class="message-top">
            <text class="message-address">{{ message.address || "未知号码" }}</text>
            <text :class="['direction-label', `direction-${message.direction}`]">
              {{ directionLabel(message.direction) }}
            </text>
          </view>
          <text class="message-time">{{ formatTime(message.timestamp) }}</text>
          <text class="message-body">{{ message.body || "[图片消息]" }}</text>
          <view v-if="message.attachments.length" class="inline-image-count">
            <text>{{ message.attachments.length }} 张图片</text>
          </view>
        </view>
      </template>
    </template>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { onHide, onShow, onUnload } from "@dcloudio/uni-app";

import { isSmsViewerPasswordValid } from "@/domain/sms-access";
import {
  buildConversations,
  filterViewerMessages,
  smsViewerSession,
  type SmsViewerData,
  type ViewerConversation,
  type ViewerMessage,
} from "@/domain/sms-viewer-session";
import {
  smsBackupService,
  type MmsMessage,
  type SmsDirection,
  type SmsMessage,
} from "@/services/sms-backup";

type ViewerTab = "conversations" | "all" | "inbox" | "sent" | "media";

interface ViewerImage {
  id: string;
  uri: string;
  albumId: string;
  albumName: string;
  source: "mms" | "gallery";
}

const tabs: { key: ViewerTab; label: string }[] = [
  { key: "conversations", label: "会话" },
  { key: "all", label: "全部" },
  { key: "inbox", label: "收到" },
  { key: "sent", label: "已发送" },
  { key: "media", label: "图片" },
];

const passwordInput = ref("");
const busy = ref(false);
const errorText = ref("");
const unlocked = ref(false);
const remainingMs = ref(0);
const activeTab = ref<ViewerTab>("conversations");
const activeAlbum = ref("all");
const viewerData = ref<SmsViewerData>(smsViewerSession.data());
let countdownTimer: ReturnType<typeof setInterval> | null = null;

const conversations = computed(() => buildConversations(viewerData.value.messages));
const filteredMessages = computed(() => {
  const filter = activeTab.value === "inbox" || activeTab.value === "sent"
    ? activeTab.value
    : "all";
  return filterViewerMessages(viewerData.value.messages, filter);
});
const mmsImages = computed<ViewerImage[]>(() =>
  viewerData.value.messages.flatMap((message) =>
    message.attachments.map((attachment) => ({
      id: `mms:${message.id}:${attachment.id}`,
      uri: attachment.uri,
      albumId: "mms",
      albumName: "短信图片",
      source: "mms" as const,
    })),
  ),
);
const galleryImages = computed<ViewerImage[]>(() =>
  viewerData.value.photos.map((photo) => ({
    id: `gallery:${photo.id}`,
    uri: photo.uri,
    albumId: photo.albumId || "unknown",
    albumName: photo.albumName || "未知相册",
    source: "gallery" as const,
  })),
);
const allMediaItems = computed(() => [...mmsImages.value, ...galleryImages.value]);
const albums = computed(() => {
  const values = new Map<string, string>([["all", "全部图片"]]);
  for (const image of allMediaItems.value) values.set(image.albumId, image.albumName);
  return [...values].map(([id, name]) => ({ id, name }));
});
const visibleMediaItems = computed(() =>
  activeAlbum.value === "all"
    ? allMediaItems.value
    : allMediaItems.value.filter((item) => item.albumId === activeAlbum.value),
);
const remainingSessionText = computed(() => {
  const seconds = Math.ceil(remainingMs.value / 1_000);
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
});

function syncSessionState(): boolean {
  unlocked.value = smsViewerSession.touch();
  remainingMs.value = smsViewerSession.remainingMs();
  viewerData.value = smsViewerSession.data();
  return unlocked.value;
}

function startCountdown() {
  stopCountdown();
  syncSessionState();
  countdownTimer = setInterval(() => {
    const active = syncSessionState();
    if (!active) stopCountdown();
  }, 1_000);
}

function stopCountdown() {
  if (countdownTimer !== null) clearInterval(countdownTimer);
  countdownTimer = null;
}

function ensureActiveSession(): boolean {
  if (syncSessionState()) return true;
  uni.showToast({ title: "查看会话已到期，请重新输入密码", icon: "none" });
  return false;
}

function toViewerSmsMessages(messages: SmsMessage[]): ViewerMessage[] {
  return messages.map((message) => ({
    id: `sms:${message.sourceId}`,
    sourceId: message.sourceId,
    threadId: message.threadId,
    address: message.address,
    body: message.body,
    timestamp: message.sentAt ?? message.receivedAt,
    receivedAt: message.receivedAt,
    sentAt: message.sentAt,
    direction: message.direction,
    kind: "sms",
    attachments: [],
    read: message.read,
    seen: message.seen,
    status: message.status,
    serviceCenter: message.serviceCenter,
    simSubscriptionId: message.simSubscriptionId,
  }));
}

function toViewerMmsMessages(messages: MmsMessage[]): ViewerMessage[] {
  return messages.map((message) => ({
    id: `mms:${message.sourceId}`,
    sourceId: message.sourceId,
    threadId: message.threadId,
    address: message.address,
    body: message.body,
    timestamp: message.sentAt ?? message.receivedAt,
    receivedAt: message.receivedAt,
    sentAt: message.sentAt,
    direction: message.direction,
    kind: "mms",
    attachments: message.attachments,
    read: message.read,
    seen: message.seen,
    status: null,
    serviceCenter: null,
    simSubscriptionId: null,
  }));
}

async function loadViewer(): Promise<void> {
  const password = smsViewerSession.password();
  if (!password) {
    syncSessionState();
    return;
  }

  busy.value = true;
  errorText.value = "";
  try {
    const [smsResult, mmsResult, photoResult] = await Promise.all([
      smsBackupService.listAllMessages(password),
      smsBackupService.listMmsMessages(password),
      smsBackupService.listGalleryPhotos(password),
    ]);
    if (!smsViewerSession.isActive()) {
      syncSessionState();
      return;
    }
    if (!smsResult.authorized || !mmsResult.authorized || !photoResult.authorized) {
      smsViewerSession.lock();
      syncSessionState();
      uni.showToast({ title: "查看会话已失效，请重新输入密码", icon: "none" });
      return;
    }

    smsViewerSession.replaceData({
      messages: [...toViewerSmsMessages(smsResult.messages), ...toViewerMmsMessages(mmsResult.messages)]
        .sort((left, right) => right.timestamp - left.timestamp),
      photos: photoResult.photos,
      smsPermissionGranted: smsResult.permissionGranted && mmsResult.permissionGranted,
      mediaPermissionGranted: photoResult.permissionGranted,
    });
    syncSessionState();
  } catch {
    errorText.value = "读取数据失败，请检查授权后重试";
  } finally {
    busy.value = false;
  }
}

async function unlockAndLoad() {
  if (!isSmsViewerPasswordValid(passwordInput.value)) {
    uni.showToast({ title: "密码错误", icon: "none" });
    return;
  }
  smsViewerSession.unlock(passwordInput.value);
  passwordInput.value = "";
  startCountdown();
  await loadViewer();
}

async function refreshViewer() {
  if (!ensureActiveSession()) return;
  await loadViewer();
}

async function requestSmsPermissions() {
  if (!ensureActiveSession()) return;
  busy.value = true;
  try {
    const granted = await smsBackupService.requestPermissions();
    if (!granted) {
      uni.showToast({ title: "需要短信读取权限", icon: "none" });
      return;
    }
  } finally {
    busy.value = false;
  }
  await refreshViewer();
}

async function requestMediaPermissions() {
  if (!ensureActiveSession()) return;
  busy.value = true;
  try {
    const granted = await smsBackupService.requestMediaPermissions();
    if (!granted) {
      uni.showToast({ title: "需要图片读取权限", icon: "none" });
      return;
    }
  } finally {
    busy.value = false;
  }
  await refreshViewer();
}

function selectTab(tab: ViewerTab) {
  if (!ensureActiveSession()) return;
  activeTab.value = tab;
}

function openConversation(key: string) {
  if (!ensureActiveSession()) return;
  uni.navigateTo({
    url: `/pages/conversation/conversation?key=${encodeURIComponent(key)}`,
  });
}

function previewMedia(index: number) {
  if (!ensureActiveSession()) return;
  const items = visibleMediaItems.value;
  if (!items[index]) return;
  uni.previewImage({
    current: items[index].uri,
    urls: items.map((item) => item.uri),
  });
}

function lockViewer() {
  smsViewerSession.lock();
  errorText.value = "";
  activeTab.value = "conversations";
  activeAlbum.value = "all";
  stopCountdown();
  syncSessionState();
}

function directionLabel(direction: SmsDirection): string {
  const labels: Record<SmsDirection, string> = {
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

function formatTime(timestamp: number): string {
  return timestamp ? new Date(timestamp).toLocaleString() : "时间未知";
}

function formatCompactTime(timestamp: number): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : `${date.getMonth() + 1}/${date.getDate()}`;
}

onShow(() => {
  startCountdown();
});

onHide(stopCountdown);
onUnload(stopCountdown);
</script>

<style>
page { background: #f5f5f7; color: #1d1b20; font-family: system-ui, sans-serif; }
.page { min-height: 100vh; padding: 28rpx 24rpx 56rpx; }
.header { display: flex; align-items: flex-start; justify-content: space-between; gap: 18rpx; }
.eyebrow { display: block; color: #6750a4; font-size: 20rpx; font-weight: 700; letter-spacing: 3rpx; }
.title { display: block; margin-top: 6rpx; font-size: 52rpx; font-weight: 750; letter-spacing: -1rpx; }
.subtitle { display: block; margin-top: 8rpx; color: #625b71; font-size: 24rpx; line-height: 1.45; }
.lock-button, .refresh-button { margin: 8rpx 0 0; border: 0; border-radius: 999rpx; color: #4f378b; background: #e8def8; font-size: 22rpx; }
.lock-button::after, .refresh-button::after, .primary-button::after, .secondary-button::after { border: 0; }
.lock-card, .permission-card, .session-card, .media-permission-card { margin-top: 24rpx; padding: 28rpx; border-radius: 28rpx; background: #fff; box-shadow: 0 8rpx 24rpx rgba(29, 27, 32, 0.06); }
.lock-title, .permission-title, .session-title, .section-title { display: block; font-size: 31rpx; font-weight: 700; }
.lock-desc, .permission-desc, .session-desc, .section-desc { display: block; margin-top: 8rpx; color: #625b71; font-size: 23rpx; line-height: 1.55; }
.password-input { height: 88rpx; margin-top: 24rpx; padding: 0 22rpx; border: 2rpx solid #79747e; border-radius: 12rpx; background: #fff; font-size: 30rpx; letter-spacing: 5rpx; }
.primary-button, .secondary-button { margin-top: 20rpx; border: 0; border-radius: 999rpx; font-size: 27rpx; font-weight: 700; }
.primary-button { color: #fff; background: #6750a4; }
.secondary-button { color: #4f378b; background: #e8def8; }
.session-card { display: flex; align-items: center; justify-content: space-between; gap: 18rpx; background: #f3edf7; box-shadow: none; }
.tabs, .album-tabs { display: flex; gap: 12rpx; margin-top: 24rpx; overflow: hidden; white-space: nowrap; }
.tab, .album-tab { flex: none; padding: 16rpx 22rpx; border-radius: 999rpx; color: #625b71; background: #e7e0ec; font-size: 25rpx; }
.tab.active, .album-tab.active { color: #fff; background: #6750a4; font-weight: 700; }
.conversation-row { display: flex; align-items: center; gap: 20rpx; margin-top: 14rpx; padding: 22rpx 16rpx; border-radius: 22rpx; background: #fff; }
.conversation-row-pressed { background: #f3edf7; }
.avatar { display: flex; width: 82rpx; height: 82rpx; align-items: center; justify-content: center; border-radius: 50%; color: #fff; background: #6750a4; font-size: 31rpx; font-weight: 700; }
.conversation-main { min-width: 0; flex: 1; }
.conversation-top, .conversation-bottom, .message-top { display: flex; align-items: center; justify-content: space-between; gap: 14rpx; }
.conversation-address, .message-address { overflow: hidden; font-size: 29rpx; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.conversation-time, .message-time { flex: none; color: #79747e; font-size: 21rpx; }
.conversation-bottom { margin-top: 8rpx; }
.conversation-preview { overflow: hidden; color: #625b71; font-size: 24rpx; text-overflow: ellipsis; white-space: nowrap; }
.unread-count { min-width: 34rpx; padding: 2rpx 8rpx; border-radius: 999rpx; color: #fff; background: #6750a4; font-size: 20rpx; text-align: center; }
.message-card { margin-top: 16rpx; padding: 24rpx; border-radius: 22rpx; background: #fff; }
.message-time { display: block; margin-top: 7rpx; }
.direction-label { flex: none; padding: 6rpx 12rpx; border-radius: 999rpx; color: #6750a4; background: #e8def8; font-size: 20rpx; }
.direction-sent, .direction-outbox { color: #245a35; background: #c8f2d3; }
.message-body { display: block; margin-top: 16rpx; color: #2b2930; font-size: 27rpx; line-height: 1.6; word-break: break-all; white-space: pre-wrap; }
.inline-image-count { margin-top: 16rpx; color: #6750a4; font-size: 22rpx; }
.media-heading { margin-top: 22rpx; }
.media-permission-card { background: #fff8e1; box-shadow: none; }
.media-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10rpx; margin-top: 20rpx; }
.media-tile { position: relative; height: 214rpx; overflow: hidden; border-radius: 16rpx; background: #e7e0ec; }
.media-image { width: 100%; height: 100%; }
.media-source { position: absolute; right: 0; bottom: 0; left: 0; padding: 7rpx 9rpx; overflow: hidden; color: #fff; background: rgba(0, 0, 0, 0.48); font-size: 18rpx; text-overflow: ellipsis; white-space: nowrap; }
.empty-card, .error-card { margin-top: 24rpx; padding: 48rpx 28rpx; border-radius: 24rpx; background: #fff; text-align: center; }
.empty-title { display: block; font-size: 28rpx; font-weight: 700; }
.empty-desc { display: block; margin-top: 8rpx; color: #79747e; font-size: 23rpx; line-height: 1.5; }
.error-card { color: #b3261e; background: #f9dedc; font-size: 24rpx; }
</style>
