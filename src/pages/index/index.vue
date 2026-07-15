<template>
  <view class="page">
    <view class="hero">
      <view>
        <text class="eyebrow">PRIVATE BACKUP</text>
        <text class="title">家庭备份</text>
        <text class="subtitle">收到短信、已发短信、图片和视频统一同步</text>
      </view>
      <view :class="['status-dot', status.permissionGranted ? 'online' : 'offline']" />
    </view>

    <view class="notice">
      <text class="notice-title">你控制授权，服务器控制范围</text>
      <text class="notice-text">只有主动授权后才会读取。相册时间范围由服务器动态控制，手机按指令分页处理，不会一次载入全部图片和视频。</text>
    </view>

    <view class="backup-grid">
      <view class="backup-card sms-card">
        <view class="card-heading">
          <text class="card-kicker">SMS</text>
          <text class="card-title">收发短信</text>
        </view>
        <view class="metric-row">
          <view class="metric">
            <text class="metric-value">{{ status.uploadedCount }}</text>
            <text class="metric-label">已备份</text>
          </view>
          <view class="metric">
            <text class="metric-value">{{ status.pendingCount }}</text>
            <text class="metric-label">待上传</text>
          </view>
        </view>
      </view>
      <view class="backup-card media-card">
        <text class="media-icon">IMG</text>
        <text class="media-title">图片</text>
        <text class="media-value">{{ status.uploadedImageCount }}</text>
        <text class="media-caption">已传 · {{ status.pendingImageCount }} 待传</text>
      </view>
      <view class="backup-card media-card video-card">
        <text class="media-icon">VID</text>
        <text class="media-title">视频</text>
        <text class="media-value">{{ status.uploadedVideoCount }}</text>
        <text class="media-caption">已传 · {{ status.pendingVideoCount }} 待传</text>
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
      <view class="row">
        <text class="row-label">媒体流量</text>
        <text class="row-value">{{ mediaBytesText }}</text>
      </view>
      <view class="row no-border">
        <text class="row-label">最近媒体同步</text>
        <text class="row-value">{{ lastMediaSyncText }}</text>
      </view>
    </view>

    <view v-if="status.lastMediaError" class="sync-warning">
      <text>{{ status.lastMediaError }}</text>
    </view>

    <button class="primary-button" :loading="busy" :disabled="busy" @click="syncAll">
      {{ status.permissionGranted ? '一键同步全部' : '授权并一键同步全部' }}
    </button>
    <text class="sync-hint">任务进入后台后可离开本页；大视频会分块续传。</text>

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

    <text class="footnote">Android 系统“强行停止”后会暂停后台任务，再次打开本应用即可恢复。</text>
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
  pendingImageCount: 0,
  uploadedImageCount: 0,
  pendingVideoCount: 0,
  uploadedVideoCount: 0,
  mediaBytesUploaded: 0,
  lastMediaSyncAt: null,
  lastMediaError: null,
  lastSyncAt: null,
  message: "正在检查 Android 服务",
};

const status = ref<SmsBackupStatus>({ ...emptyStatus });
const settings = ref(loadSettings(uniKeyValueStorage));
const busy = ref(false);

const lastMediaSyncText = computed(() =>
  status.value.lastMediaSyncAt
    ? new Date(status.value.lastMediaSyncAt).toLocaleString()
    : "尚未同步",
);

const mediaBytesText = computed(() => {
  const bytes = status.value.mediaBytesUploaded;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
});

async function refreshStatus() {
  settings.value = loadSettings(uniKeyValueStorage);
  status.value = await smsBackupService.getStatus();
}

async function syncAll() {
  busy.value = true;
  try {
    const smsGranted = status.value.permissionGranted
      ? true
      : await smsBackupService.requestPermissions();
    if (!smsGranted) {
      uni.showToast({ title: "需要短信权限才能备份", icon: "none" });
      return;
    }
    // 相册与联系人分别申请：拒绝其中一项不会阻断已经授权的短信备份。
    const mediaGranted = await smsBackupService.requestMediaPermissions();
    await smsBackupService.requestContactsPermission();
    // 原生后台任务会补扫全部收发短信；页面不做同步全表读取，避免大短信库卡住按钮。
    await smsBackupService.syncNow();
    uni.showToast({
      title: mediaGranted
        ? "短信、图片和视频同步已启动"
        : "短信同步已启动，相册未授权",
      icon: "none",
      duration: 2600,
    });
    await refreshStatus();
  } catch (error) {
    const message = error instanceof Error && error.message.trim()
      ? error.message
      : "同步启动失败，请稍后重试";
    uni.showToast({ title: message, icon: "none", duration: 3000 });
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
.backup-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16rpx; margin-top: 22rpx; }
.backup-card { overflow: hidden; border-radius: 24rpx; }
.sms-card { grid-column: 1 / -1; padding: 28rpx; color: #fff; background: linear-gradient(135deg, #173f2a, #286840); }
.card-heading { display: flex; align-items: center; gap: 14rpx; }
.card-kicker { padding: 6rpx 12rpx; border: 1rpx solid rgba(255, 255, 255, 0.24); border-radius: 999rpx; color: #c8e3d2; font-size: 19rpx; font-weight: 800; letter-spacing: 2rpx; }
.card-title { font-size: 29rpx; font-weight: 750; }
.metric-row { display: flex; margin-top: 25rpx; }
.metric { width: 50%; }
.metric + .metric { padding-left: 28rpx; border-left: 1rpx solid rgba(255, 255, 255, 0.17); }
.metric-value { display: block; font-size: 45rpx; font-weight: 800; }
.metric-label { display: block; margin-top: 3rpx; color: #bdd4c5; font-size: 22rpx; }
.media-card { position: relative; padding: 25rpx; background: #fff; box-shadow: 0 10rpx 30rpx rgba(34, 54, 42, 0.05); }
.media-icon { display: inline-block; padding: 5rpx 10rpx; border-radius: 9rpx; color: #28784a; background: #e4f5e9; font-size: 18rpx; font-weight: 800; letter-spacing: 1rpx; }
.video-card .media-icon { color: #80541d; background: #fff0d9; }
.media-title { display: block; margin-top: 20rpx; color: #536159; font-size: 23rpx; }
.media-value { display: block; margin-top: 3rpx; font-size: 40rpx; font-weight: 800; }
.media-caption { display: block; margin-top: 7rpx; color: #849087; font-size: 20rpx; }
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
.sync-warning { margin-top: 22rpx; padding: 20rpx 24rpx; border: 1rpx solid #f0d1a9; border-radius: 18rpx; color: #995919; background: #fff5e8; font-size: 23rpx; line-height: 1.5; }
.sync-hint { display: block; margin-top: 11rpx; color: #849087; font-size: 21rpx; text-align: center; }
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
