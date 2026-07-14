<template>
  <view class="page">
    <view class="header">
      <view>
        <text class="eyebrow">PROTECTED VIEW</text>
        <text class="title">全部短信</text>
        <text class="subtitle">查看本机短信库中的完整记录</text>
      </view>
      <button
        v-if="unlocked"
        class="refresh-button"
        size="mini"
        :loading="busy"
        @click="refreshMessages"
      >
        刷新
      </button>
    </view>

    <view class="security-note">
      <text class="security-title">查看保护</text>
      <text class="security-text">退出或切到后台后会立即锁定，并从页面内存清空短信正文。</text>
    </view>

    <view v-if="!unlocked" class="lock-card">
      <text class="lock-title">输入查看密码</text>
      <text class="lock-desc">密码正确后才会调用 Android 系统短信接口。</text>
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
      <view v-if="!permissionGranted" class="permission-card">
        <text class="permission-title">还没有短信读取权限</text>
        <text class="permission-desc">授权后才能从 Android 系统短信库加载记录。</text>
        <button class="primary-button" :loading="busy" @click="authorizeAndLoad">
          授权读取短信
        </button>
      </view>

      <template v-else>
        <view class="summary-row">
          <text class="summary-count">共 {{ messages.length }} 条</text>
          <text class="summary-order">按时间从新到旧</text>
        </view>

        <view v-if="errorText" class="error-card">
          <text>{{ errorText }}</text>
        </view>

        <view v-else-if="!busy && messages.length === 0" class="empty-card">
          <text class="empty-title">没有找到短信</text>
          <text class="empty-desc">系统短信库当前没有可显示的记录。</text>
        </view>

        <view
          v-for="message in messages"
          :key="`${message.sourceId}-${message.type}`"
          class="message-card"
        >
          <view class="message-head">
            <view class="address-block">
              <text class="address">{{ message.address || '未知号码' }}</text>
              <text class="time">{{ formatTime(message.receivedAt) }}</text>
            </view>
            <text :class="['direction-pill', `direction-${message.direction}`]">
              {{ directionLabel(message.direction) }}
            </text>
          </view>

          <text class="body">{{ message.body }}</text>

          <view class="metadata">
            <text class="meta-item">{{ message.read ? '已读' : '未读' }}</text>
            <text class="meta-item">类型 {{ message.type }}</text>
            <text class="meta-item">ID {{ message.sourceId }}</text>
            <text v-if="message.threadId !== null" class="meta-item">
              会话 {{ message.threadId }}
            </text>
            <text v-if="message.sentAt !== null" class="meta-item">
              发送时间 {{ formatTime(message.sentAt) }}
            </text>
            <text v-if="message.status !== null" class="meta-item">
              状态 {{ message.status }}
            </text>
            <text v-if="message.simSubscriptionId !== null" class="meta-item">
              SIM {{ message.simSubscriptionId }}
            </text>
            <text v-if="message.serviceCenter" class="meta-item">
              短信中心 {{ message.serviceCenter }}
            </text>
            <text class="meta-item">{{ message.seen ? '系统已查看' : '系统未查看' }}</text>
          </view>
        </view>
      </template>
    </template>
  </view>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { onHide, onUnload } from "@dcloudio/uni-app";

import { isSmsViewerPasswordValid } from "@/domain/sms-access";
import {
  smsBackupService,
  type SmsDirection,
  type SmsMessage,
} from "@/services/sms-backup";

const unlocked = ref(false);
const permissionGranted = ref(false);
const passwordInput = ref("");
const sessionPassword = ref("");
const messages = ref<SmsMessage[]>([]);
const busy = ref(false);
const errorText = ref("");

const directionLabels: Record<SmsDirection, string> = {
  inbox: "收到",
  sent: "已发送",
  draft: "草稿",
  outbox: "发件箱",
  failed: "发送失败",
  queued: "等待发送",
  unknown: "其他",
};

function directionLabel(direction: SmsDirection): string {
  return directionLabels[direction] || directionLabels.unknown;
}

function formatTime(timestamp: number): string {
  if (!timestamp) return "时间未知";
  return new Date(timestamp).toLocaleString();
}

async function loadMessages(password: string): Promise<boolean> {
  const result = await smsBackupService.listAllMessages(password);
  if (!result.authorized) {
    clearSensitiveState();
    uni.showToast({ title: "密码错误", icon: "none" });
    return false;
  }

  unlocked.value = true;
  permissionGranted.value = result.permissionGranted;
  messages.value = result.messages;
  errorText.value = "";
  return true;
}

async function unlockAndLoad() {
  if (!isSmsViewerPasswordValid(passwordInput.value)) {
    uni.showToast({ title: "密码错误", icon: "none" });
    return;
  }

  const password = passwordInput.value;
  sessionPassword.value = password;
  busy.value = true;
  try {
    const loaded = await loadMessages(password);
    if (loaded) passwordInput.value = "";
  } catch {
    messages.value = [];
    errorText.value = "读取短信失败，请重试";
  } finally {
    busy.value = false;
  }
}

async function refreshMessages() {
  if (!unlocked.value || !sessionPassword.value) return;
  busy.value = true;
  try {
    await loadMessages(sessionPassword.value);
  } catch {
    messages.value = [];
    errorText.value = "读取短信失败，请重试";
  } finally {
    busy.value = false;
  }
}

async function authorizeAndLoad() {
  const password = sessionPassword.value;
  busy.value = true;
  try {
    const granted = await smsBackupService.requestPermissions();
    if (!granted) {
      uni.showToast({ title: "需要短信读取权限", icon: "none" });
      return;
    }
    sessionPassword.value = password;
    await loadMessages(password);
  } finally {
    busy.value = false;
  }
}

function clearSensitiveState() {
  unlocked.value = false;
  permissionGranted.value = false;
  passwordInput.value = "";
  sessionPassword.value = "";
  messages.value = [];
  errorText.value = "";
}

onHide(clearSensitiveState);
onUnload(clearSensitiveState);
</script>

<style>
page { background: #f3f5f2; color: #14231a; }
.page { padding: 36rpx 28rpx 60rpx; }
.header { display: flex; justify-content: space-between; align-items: flex-start; gap: 20rpx; }
.eyebrow { display: block; color: #548365; font-size: 21rpx; font-weight: 700; letter-spacing: 3rpx; }
.title { display: block; margin-top: 8rpx; font-size: 48rpx; font-weight: 800; }
.subtitle { display: block; margin-top: 9rpx; color: #6d7a71; font-size: 25rpx; }
.refresh-button { flex: none; margin: 12rpx 0 0; border: 1rpx solid #b9c9bc; color: #23683d; background: #fff; }
.security-note { margin-top: 24rpx; padding: 24rpx; border: 1rpx solid #dce5dc; border-radius: 22rpx; background: #f9fbf8; }
.security-title { display: block; font-size: 26rpx; font-weight: 700; }
.security-text { display: block; margin-top: 7rpx; color: #69766d; font-size: 23rpx; line-height: 1.55; }
.lock-card, .permission-card { margin-top: 24rpx; padding: 32rpx 26rpx; border-radius: 24rpx; background: #fff; box-shadow: 0 12rpx 38rpx rgba(34, 54, 42, 0.07); }
.lock-title, .permission-title { display: block; font-size: 31rpx; font-weight: 800; }
.lock-desc, .permission-desc { display: block; margin-top: 10rpx; color: #718077; font-size: 24rpx; line-height: 1.5; }
.password-input { height: 88rpx; margin-top: 24rpx; padding: 0 22rpx; border: 1rpx solid #ced9d0; border-radius: 18rpx; background: #f7f9f7; font-size: 30rpx; letter-spacing: 6rpx; }
.primary-button { margin-top: 22rpx; border: 0; border-radius: 20rpx; color: #fff; background: #2a8b50; font-size: 28rpx; font-weight: 700; }
.primary-button::after { border: 0; }
.summary-row { display: flex; justify-content: space-between; align-items: center; margin: 28rpx 6rpx 16rpx; }
.summary-count { font-size: 28rpx; font-weight: 750; }
.summary-order { color: #7b887f; font-size: 22rpx; }
.message-card { margin-bottom: 18rpx; padding: 26rpx; border-radius: 22rpx; background: #fff; box-shadow: 0 8rpx 30rpx rgba(34, 54, 42, 0.06); }
.message-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 20rpx; }
.address-block { min-width: 0; flex: 1; }
.address { display: block; overflow: hidden; font-size: 29rpx; font-weight: 750; text-overflow: ellipsis; white-space: nowrap; }
.time { display: block; margin-top: 6rpx; color: #89938c; font-size: 21rpx; }
.direction-pill { flex: none; padding: 7rpx 14rpx; border-radius: 999rpx; color: #235d38; background: #e4f3e8; font-size: 21rpx; }
.direction-sent, .direction-outbox, .direction-queued { color: #315f86; background: #e7f0f8; }
.direction-failed { color: #a34237; background: #fbe8e5; }
.direction-draft, .direction-unknown { color: #765e2c; background: #f5eedb; }
.body { display: block; margin-top: 22rpx; color: #27362c; font-size: 28rpx; line-height: 1.65; word-break: break-all; white-space: pre-wrap; }
.metadata { display: flex; flex-wrap: wrap; gap: 10rpx 16rpx; margin-top: 22rpx; padding-top: 18rpx; border-top: 1rpx solid #edf0ed; }
.meta-item { color: #7b887f; font-size: 20rpx; word-break: break-all; }
.empty-card, .error-card { padding: 48rpx 28rpx; border-radius: 22rpx; background: #fff; text-align: center; }
.empty-title { display: block; font-size: 28rpx; font-weight: 700; }
.empty-desc { display: block; margin-top: 8rpx; color: #7b887f; font-size: 23rpx; }
.error-card { color: #a34237; background: #fff1ef; font-size: 24rpx; }
</style>
