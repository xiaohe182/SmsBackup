<template>
  <view class="page">
    <view class="hero">
      <view>
        <text class="eyebrow">SMS BACKUP</text>
        <text class="title">短信备份</text>
        <text class="subtitle">授权一次后自动收集全部收发短信</text>
      </view>
      <view :class="['status-dot', status.permissionGranted ? 'online' : 'offline']" />
    </view>

    <view class="notice">
      <text class="notice-title">隐私说明</text>
      <text class="notice-text">只有你主动授权后才读取短信。授权一次后，收到短信会立即入队，已发送短信会由启动和周期任务自动补扫。</text>
    </view>

    <view class="stats-grid">
      <view class="stat-card">
        <text class="stat-value">{{ status.pendingCount }}</text>
        <text class="stat-label">等待上传</text>
      </view>
      <view class="stat-card">
        <text class="stat-value">{{ status.uploadedCount }}</text>
        <text class="stat-label">已备份</text>
      </view>
    </view>

    <view class="panel">
      <view class="row">
        <text class="row-label">短信权限</text>
        <text :class="['pill', status.permissionGranted ? 'pill-ok' : 'pill-warn']">
          {{ status.permissionGranted ? '已授权' : '未授权' }}
        </text>
      </view>
      <view class="row">
        <text class="row-label">服务器</text>
        <text class="row-value">{{ settings.serverUrl || '尚未配置' }}</text>
      </view>
      <view class="row no-border">
        <text class="row-label">最近同步</text>
        <text class="row-value">{{ lastSyncText }}</text>
      </view>
    </view>

    <button
      v-if="!status.permissionGranted"
      class="primary-button"
      :loading="busy"
      @click="authorizeAndScan"
    >
      同意并授权读取短信
    </button>
    <button v-else class="primary-button" :loading="busy" @click="scanAndSync">
      立即补扫收发短信
    </button>

    <view class="link-grid">
      <view
        class="link-card viewer-card"
        hover-class="viewer-card-pressed"
        @tap="openMessages"
      >
        <text class="link-title viewer-title">查看全部短信</text>
        <text class="link-desc viewer-desc">输入查看密码后读取本机完整短信</text>
      </view>
      <view class="link-card" @click="openSettings">
        <text class="link-title">服务器设置</text>
        <text class="link-desc">地址、设备名、同步开关</text>
      </view>
    </view>

    <text class="footnote">系统“强行停止”后无法自动接收短信，再次打开本应用即可恢复。</text>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { onShow } from "@dcloudio/uni-app";

import { smsBackupService, type SmsBackupStatus } from "@/services/sms-backup";
import { loadSettings, uniKeyValueStorage } from "@/stores/settings";

const emptyStatus: SmsBackupStatus = {
  available: false,
  permissionGranted: false,
  pendingCount: 0,
  uploadedCount: 0,
  lastSyncAt: null,
  message: "正在检查 Android 服务",
};

const status = ref<SmsBackupStatus>({ ...emptyStatus });
const settings = ref(loadSettings(uniKeyValueStorage));
const busy = ref(false);

const lastSyncText = computed(() =>
  status.value.lastSyncAt
    ? new Date(status.value.lastSyncAt).toLocaleString()
    : "尚未同步",
);

async function refreshStatus() {
  settings.value = loadSettings(uniKeyValueStorage);
  status.value = await smsBackupService.getStatus();
}

async function authorizeAndScan() {
  busy.value = true;
  try {
    const granted = await smsBackupService.requestPermissions();
    if (!granted) {
      uni.showToast({ title: "需要短信权限才能备份", icon: "none" });
      return;
    }
    const count = await smsBackupService.scanExistingMessages();
    await smsBackupService.syncNow();
    uni.showToast({ title: `已处理 ${count} 条短信`, icon: "none" });
    await refreshStatus();
  } finally {
    busy.value = false;
  }
}

async function scanAndSync() {
  busy.value = true;
  try {
    const count = await smsBackupService.scanExistingMessages();
    await smsBackupService.syncNow();
    uni.showToast({ title: `已处理 ${count} 条短信`, icon: "none" });
    await refreshStatus();
  } finally {
    busy.value = false;
  }
}

function openMessages() {
  const url = "/pages/messages/messages";
  uni.navigateTo({
    url,
    fail: () => {
      uni.redirectTo({
        url,
        fail: () => {
          uni.showToast({ title: "无法打开短信页面，请重启应用", icon: "none" });
        },
      });
    },
  });
}

function openSettings() {
  uni.navigateTo({ url: "/pages/settings/settings" });
}

onShow(refreshStatus);
</script>

<style>
page { background: #f3f5f2; color: #14231a; }
.page { padding: 44rpx 30rpx 60rpx; }
.hero { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 28rpx; }
.eyebrow { display: block; color: #548365; font-size: 22rpx; font-weight: 700; letter-spacing: 4rpx; }
.title { display: block; margin-top: 10rpx; font-size: 56rpx; line-height: 1.15; font-weight: 800; }
.subtitle { display: block; margin-top: 12rpx; color: #68766d; font-size: 27rpx; }
.status-dot { width: 24rpx; height: 24rpx; margin-top: 18rpx; border-radius: 50%; box-shadow: 0 0 0 10rpx rgba(154, 165, 157, 0.18); }
.status-dot.online { background: #35a660; box-shadow: 0 0 0 10rpx rgba(53, 166, 96, 0.16); }
.status-dot.offline { background: #d98b35; }
.notice { padding: 26rpx; border: 1rpx solid #dce5dc; border-radius: 24rpx; background: #f9fbf8; }
.notice-title { display: block; font-size: 27rpx; font-weight: 700; }
.notice-text { display: block; margin-top: 8rpx; color: #66736a; font-size: 25rpx; line-height: 1.6; }
.stats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16rpx; margin-top: 22rpx; }
.stat-card { padding: 28rpx 16rpx; border-radius: 22rpx; background: #173f2a; text-align: center; }
.stat-value { display: block; color: #fff; font-size: 44rpx; font-weight: 800; }
.stat-label { display: block; margin-top: 6rpx; color: #bdd4c5; font-size: 23rpx; }
.panel { margin-top: 22rpx; padding: 4rpx 26rpx; border-radius: 24rpx; background: #fff; box-shadow: 0 12rpx 38rpx rgba(34, 54, 42, 0.07); }
.row { display: flex; justify-content: space-between; align-items: center; min-height: 94rpx; border-bottom: 1rpx solid #edf0ed; }
.row.no-border { border-bottom: 0; }
.row-label { font-size: 27rpx; font-weight: 650; }
.row-value { max-width: 430rpx; color: #718077; font-size: 25rpx; text-align: right; word-break: break-all; }
.pill { padding: 9rpx 18rpx; border-radius: 999rpx; font-size: 23rpx; }
.pill-ok { color: #19743d; background: #e4f6e9; }
.pill-warn { color: #a65c0f; background: #fff1dc; }
.primary-button { margin-top: 26rpx; border: 0; border-radius: 22rpx; color: #fff; background: #2a8b50; font-size: 29rpx; font-weight: 700; }
.primary-button::after { border: 0; }
.link-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16rpx; margin-top: 22rpx; }
.link-card { padding: 26rpx; border-radius: 22rpx; background: #fff; }
.viewer-card { grid-column: 1 / -1; background: #173f2a; }
.viewer-card-pressed { opacity: 0.78; transform: scale(0.99); }
.viewer-title { color: #fff; }
.viewer-desc { color: #bdd4c5 !important; }
.link-title { display: block; font-size: 28rpx; font-weight: 700; }
.link-desc { display: block; margin-top: 9rpx; color: #718077; font-size: 23rpx; line-height: 1.5; }
.footnote { display: block; margin: 26rpx 12rpx 0; color: #879289; font-size: 22rpx; line-height: 1.6; text-align: center; }
</style>
