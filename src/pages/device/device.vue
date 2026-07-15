<template>
  <view class="page">
    <view class="header">
      <view>
        <text class="eyebrow">DEVICE CENTER</text>
        <text class="title">设备与轨迹</text>
        <text class="subtitle">敏感数据仅在本机显示，解锁有效期 10 分钟</text>
      </view>
      <button v-if="unlocked" class="lock-button" size="mini" @click="lockViewer">锁定</button>
    </view>

    <view v-if="!unlocked" class="lock-card">
      <text class="card-title">输入查看密码</text>
      <text class="card-desc">联系人、位置坐标和设备状态均受同一查看会话保护。</text>
      <input
        v-model="passwordInput"
        class="password-input"
        password
        maxlength="32"
        placeholder="查看密码"
        confirm-type="done"
        @confirm="unlockAndLoad"
      />
      <button class="primary-button" :loading="busy" @click="unlockAndLoad">解锁设备中心</button>
    </view>

    <template v-else>
      <view class="session-card">
        <view>
          <text class="session-title">安全查看会话已解锁</text>
          <text class="session-desc">剩余 {{ remainingSessionText }}，切到后台不会提前锁定</text>
        </view>
        <button class="mini-button" size="mini" :loading="busy" @click="loadCurrentTab">刷新</button>
      </view>

      <scroll-view class="tabs" scroll-x>
        <view class="tabs-inner">
          <view
            v-for="tab in tabs"
            :key="tab.key"
            :class="['tab', { active: activeTab === tab.key }]"
            @tap="selectTab(tab.key)"
          >
            <text>{{ tab.label }}</text>
          </view>
        </view>
      </scroll-view>

      <view v-if="errorText" class="error-card"><text>{{ errorText }}</text></view>

      <template v-if="activeTab === 'route'">
        <view class="status-card">
          <view class="status-head">
            <view>
              <text class="card-title">三分钟轨迹</text>
              <text class="card-desc">前台定位服务持续显示通知，并融合 GPS 与网络定位。</text>
            </view>
            <text :class="['status-pill', locationStatus.tracking ? 'running' : 'stopped']">
              {{ locationStatus.tracking ? '记录中' : '未启动' }}
            </text>
          </view>
          <view class="status-lines">
            <text>位置权限：{{ locationStatus.precisePermissionGranted ? '精确位置' : locationStatus.permissionGranted ? '大致位置' : '未授权' }}</text>
            <text>系统定位：{{ locationStatus.locationEnabled ? '已开启' : '未开启' }}</text>
            <text>已保存：{{ locationStatus.pointCount }} 个点</text>
          </view>
          <button
            v-if="!locationStatus.tracking"
            class="primary-button"
            :loading="busy"
            @click="startTracking"
          >
            授权并开始记录
          </button>
          <button v-else class="danger-button" :loading="busy" @click="stopTracking">停止记录</button>
          <view class="action-grid">
            <button class="secondary-button compact" @click="locationTrackingService.openBatterySettings()">电池白名单</button>
            <button class="secondary-button compact" @click="locationTrackingService.openAppSettings()">应用权限设置</button>
          </view>
          <text class="compatibility-note">关闭页面或划走任务后服务仍会请求继续运行；系统强行停止、重启或厂商深度冻结后必须重新打开应用。</text>
        </view>

        <view class="metrics-grid">
          <view class="metric-card">
            <text class="metric-value">{{ formatDistance(routeAnalysis.totalDistanceMeters) }}</text>
            <text class="metric-label">分析里程</text>
          </view>
          <view class="metric-card">
            <text class="metric-value">{{ routeAnalysis.sessions.length }}</text>
            <text class="metric-label">轨迹次数</text>
          </view>
          <view class="metric-card">
            <text class="metric-value">{{ routeAnalysis.acceptedPointCount }}</text>
            <text class="metric-label">有效点</text>
          </view>
        </view>

        <view class="route-card">
          <view class="card-heading">
            <view>
              <text class="card-title">路线预览</text>
              <text class="card-desc">自动过滤低精度点、异常跳点和不足 5 米的漂移。</text>
            </view>
            <button v-if="routeAnalysis.latestPoint" class="mini-button" size="mini" @click="openLatestLocation">地图查看</button>
          </view>
          <canvas canvas-id="routeCanvas" id="routeCanvas" class="route-canvas" />
          <view v-if="routeAnalysis.latestPoint" class="latest-point">
            <text>{{ routeAnalysis.latestPoint.latitude.toFixed(6) }}, {{ routeAnalysis.latestPoint.longitude.toFixed(6) }}</text>
            <text>{{ formatTime(routeAnalysis.latestPoint.capturedAt) }} · 精度约 {{ Math.round(routeAnalysis.latestPoint.accuracy) }} 米</text>
          </view>
          <view v-else class="empty-inline"><text>开始记录后，首个有效定位点会立即保存在本机。</text></view>
        </view>

        <view v-if="routeAnalysis.sessions.length" class="list-card">
          <text class="card-title">轨迹记录</text>
          <view v-for="session in routeAnalysis.sessions.slice(0, 20)" :key="session.sessionId" class="data-row">
            <view>
              <text class="row-title">{{ formatTime(session.startedAt) }}</text>
              <text class="row-desc">{{ session.points.length }} 点 · {{ formatDuration(session.durationMs) }}</text>
            </view>
            <text class="row-value">{{ formatDistance(session.totalDistanceMeters) }}</text>
          </view>
          <button class="text-button" :disabled="locationStatus.tracking" @click="clearRouteHistory">清空轨迹历史</button>
        </view>
      </template>

      <template v-else-if="activeTab === 'contacts'">
        <view v-if="!contactsPermissionGranted" class="permission-card">
          <text class="card-title">读取手机号联系人</text>
          <text class="card-desc">仅在你明确授权后读取联系人姓名、手机号和头像地址，不会自动上传。</text>
          <button class="primary-button" :loading="busy" @click="requestContactsPermission">授权读取联系人</button>
        </view>
        <template v-else>
          <view class="search-card">
            <input v-model="contactQuery" class="search-input" placeholder="搜索姓名或手机号" />
            <text class="search-count">{{ filteredContacts.length }} / {{ contacts.length }}</text>
          </view>
          <view class="contacts-card">
            <view v-for="contact in filteredContacts" :key="`${contact.contactId}:${contact.phoneNumber}`" class="contact-row">
              <image v-if="contact.photoUri" class="avatar-image" :src="contact.photoUri" mode="aspectFill" />
              <view v-else class="contact-avatar"><text>{{ contact.displayName.slice(0, 1) || '#' }}</text></view>
              <view class="contact-main">
                <text class="row-title">{{ contact.displayName }}</text>
                <text class="row-desc selectable">{{ contact.phoneNumber }}</text>
              </view>
            </view>
            <view v-if="!filteredContacts.length" class="empty-inline"><text>没有匹配的手机号联系人</text></view>
          </view>
        </template>
      </template>

      <template v-else>
        <view v-if="snapshot" class="device-hero">
          <text class="device-name">{{ snapshot.manufacturer }} {{ snapshot.model }}</text>
          <text class="device-version">Android {{ snapshot.androidVersion }} · API {{ snapshot.apiLevel }}</text>
          <view class="battery-bar"><view class="battery-fill" :style="{ width: `${batteryWidth}%` }" /></view>
          <text class="battery-text">{{ snapshot.batteryLevel }}% · {{ batteryStatusText }} · {{ snapshot.batteryHealth }}</text>
        </view>

        <view v-if="snapshot" class="diagnostics-grid">
          <view class="diagnostic-card">
            <text class="diagnostic-label">电池温度</text>
            <text class="diagnostic-value">{{ snapshot.batteryTemperatureCelsius === null ? '--' : `${snapshot.batteryTemperatureCelsius.toFixed(1)}℃` }}</text>
          </view>
          <view class="diagnostic-card">
            <text class="diagnostic-label">电池电压</text>
            <text class="diagnostic-value">{{ snapshot.batteryVoltageMillivolts === null ? '--' : `${snapshot.batteryVoltageMillivolts} mV` }}</text>
          </view>
          <view class="diagnostic-card">
            <text class="diagnostic-label">可用内存</text>
            <text class="diagnostic-value">{{ formatBytes(snapshot.memoryAvailableBytes) }}</text>
          </view>
          <view class="diagnostic-card">
            <text class="diagnostic-label">可用存储</text>
            <text class="diagnostic-value">{{ formatBytes(snapshot.storageAvailableBytes) }}</text>
          </view>
        </view>

        <view v-if="snapshot" class="list-card">
          <view class="data-row"><text class="row-title">内存总量</text><text class="row-value">{{ formatBytes(snapshot.memoryTotalBytes) }}</text></view>
          <view class="data-row"><text class="row-title">存储总量</text><text class="row-value">{{ formatBytes(snapshot.storageTotalBytes) }}</text></view>
          <view class="data-row"><text class="row-title">当前网络</text><text class="row-value">{{ snapshot.networkConnected ? snapshot.networkTransport : '未连接' }}</text></view>
          <view class="data-row"><text class="row-title">电池优化</text><text class="row-value">{{ snapshot.ignoringBatteryOptimizations ? '已允许后台运行' : '可能限制后台' }}</text></view>
          <view class="data-row"><text class="row-title">采集时间</text><text class="row-value">{{ formatTime(snapshot.capturedAt) }}</text></view>
        </view>
        <view class="action-grid device-actions">
          <button class="secondary-button compact" @click="locationTrackingService.openBatterySettings()">电池优化设置</button>
          <button class="secondary-button compact" @click="locationTrackingService.openAppSettings()">应用详情设置</button>
        </view>
      </template>
    </template>
  </view>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { onHide, onShow, onUnload } from "@dcloudio/uni-app";

import { analyzeRoute, type LocationPoint } from "@/domain/route-analysis";
import { isSmsViewerPasswordValid } from "@/domain/sms-access";
import { smsViewerSession } from "@/domain/sms-viewer-session";
import {
  deviceDataService,
  type DeviceContact,
  type DeviceSnapshot,
} from "@/services/device-data";
import {
  locationTrackingService,
  type LocationTrackingStatus,
} from "@/services/location-tracking";

type DeviceTab = "route" | "contacts" | "device";

const tabs: { key: DeviceTab; label: string }[] = [
  { key: "route", label: "位置轨迹" },
  { key: "contacts", label: "手机号联系人" },
  { key: "device", label: "设备状态" },
];

const emptyLocationStatus: LocationTrackingStatus = {
  available: true,
  permissionGranted: false,
  precisePermissionGranted: false,
  notificationPermissionGranted: false,
  locationEnabled: false,
  tracking: false,
  sampleIntervalMs: 180_000,
  pointCount: 0,
  currentSessionId: null,
  startedAt: null,
  lastPoint: null,
  message: "等待读取定位状态",
};

const unlocked = ref(false);
const passwordInput = ref("");
const remainingMs = ref(0);
const activeTab = ref<DeviceTab>("route");
const busy = ref(false);
const errorText = ref("");
const locationStatus = ref<LocationTrackingStatus>({ ...emptyLocationStatus });
const points = ref<LocationPoint[]>([]);
const contacts = ref<DeviceContact[]>([]);
const contactsPermissionGranted = ref(false);
const contactQuery = ref("");
const snapshot = ref<DeviceSnapshot | null>(null);
let countdownTimer: ReturnType<typeof setInterval> | null = null;

const routeAnalysis = computed(() => analyzeRoute(points.value));
const filteredContacts = computed(() => {
  const query = contactQuery.value.trim().toLocaleLowerCase();
  if (!query) return contacts.value;
  return contacts.value.filter((contact) =>
    contact.displayName.toLocaleLowerCase().includes(query)
      || contact.phoneNumber.replace(/\s/g, "").includes(query.replace(/\s/g, "")),
  );
});
const remainingSessionText = computed(() => {
  const seconds = Math.ceil(remainingMs.value / 1_000);
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
});
const batteryWidth = computed(() => Math.max(0, Math.min(snapshot.value?.batteryLevel ?? 0, 100)));
const batteryStatusText = computed(() => snapshot.value?.charging ? "充电中" : "未充电");

function clearProtectedData() {
  points.value = [];
  contacts.value = [];
  snapshot.value = null;
  locationStatus.value = { ...emptyLocationStatus };
  contactsPermissionGranted.value = false;
  contactQuery.value = "";
}

function syncSessionState(): boolean {
  unlocked.value = smsViewerSession.touch();
  remainingMs.value = smsViewerSession.remainingMs();
  if (!unlocked.value) clearProtectedData();
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

function ensureActiveSession(): string | null {
  if (!syncSessionState()) {
    uni.showToast({ title: "查看会话已到期，请重新输入密码", icon: "none" });
    return null;
  }
  return smsViewerSession.password();
}

async function unlockAndLoad() {
  if (!isSmsViewerPasswordValid(passwordInput.value)) {
    uni.showToast({ title: "密码错误", icon: "none" });
    return;
  }
  smsViewerSession.unlock(passwordInput.value);
  passwordInput.value = "";
  startCountdown();
  await loadCurrentTab();
}

async function loadCurrentTab() {
  if (activeTab.value === "route") await loadRouteData();
  else if (activeTab.value === "contacts") await loadContacts();
  else await loadDeviceSnapshot();
}

async function loadRouteData() {
  const password = ensureActiveSession();
  if (!password) return;
  busy.value = true;
  errorText.value = "";
  try {
    const [status, locationPoints] = await Promise.all([
      locationTrackingService.getStatus(password),
      locationTrackingService.listPoints(password),
    ]);
    if (!smsViewerSession.isActive()) {
      syncSessionState();
      return;
    }
    locationStatus.value = status;
    points.value = locationPoints;
    await nextTick();
    drawRoute();
  } catch {
    errorText.value = "读取轨迹失败，请检查位置权限后重试";
  } finally {
    busy.value = false;
  }
}

async function loadContacts() {
  const password = ensureActiveSession();
  if (!password) return;
  busy.value = true;
  errorText.value = "";
  try {
    const result = await deviceDataService.listContacts(password);
    if (!result.authorized) return lockViewer();
    contactsPermissionGranted.value = result.permissionGranted;
    contacts.value = result.contacts;
  } catch {
    errorText.value = "读取联系人失败，请检查授权后重试";
  } finally {
    busy.value = false;
  }
}

async function loadDeviceSnapshot() {
  const password = ensureActiveSession();
  if (!password) return;
  busy.value = true;
  errorText.value = "";
  try {
    const result = await deviceDataService.getSnapshot(password);
    if (!result.authorized) return lockViewer();
    snapshot.value = result.snapshot;
  } catch {
    errorText.value = "读取设备状态失败";
  } finally {
    busy.value = false;
  }
}

async function selectTab(tab: DeviceTab) {
  if (!ensureActiveSession()) return;
  activeTab.value = tab;
  await loadCurrentTab();
}

async function startTracking() {
  const password = ensureActiveSession();
  if (!password) return;
  busy.value = true;
  try {
    if (!locationStatus.value.permissionGranted) {
      const granted = await locationTrackingService.requestLocationPermissions();
      if (!granted) {
        uni.showToast({ title: "需要位置权限才能记录轨迹", icon: "none" });
        return;
      }
    }
    await locationTrackingService.requestNotificationPermission();
    const started = await locationTrackingService.start(password);
    uni.showToast({
      title: started ? "轨迹记录已启动" : "启动失败，请检查系统设置",
      icon: "none",
    });
  } finally {
    busy.value = false;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 350));
  await loadRouteData();
}

async function stopTracking() {
  if (!ensureActiveSession()) return;
  busy.value = true;
  try {
    await locationTrackingService.stop();
    uni.showToast({ title: "轨迹记录已停止", icon: "none" });
  } finally {
    busy.value = false;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 200));
  await loadRouteData();
}

async function requestContactsPermission() {
  if (!ensureActiveSession()) return;
  busy.value = true;
  try {
    const granted = await deviceDataService.requestContactsPermission();
    if (!granted) {
      uni.showToast({ title: "未获得联系人读取权限", icon: "none" });
      return;
    }
  } finally {
    busy.value = false;
  }
  await loadContacts();
}

function clearRouteHistory() {
  if (!ensureActiveSession() || locationStatus.value.tracking) return;
  uni.showModal({
    title: "清空轨迹历史",
    content: "此操作只删除本机轨迹点，且无法恢复。",
    success: async (result) => {
      if (!result.confirm) return;
      const cleared = await locationTrackingService.clearHistory();
      uni.showToast({ title: cleared ? "已清空轨迹" : "请先停止记录", icon: "none" });
      await loadRouteData();
    },
  });
}

function openLatestLocation() {
  if (!ensureActiveSession()) return;
  const latest = routeAnalysis.value.latestPoint;
  if (!latest) return;
  uni.openLocation({
    latitude: latest.latitude,
    longitude: latest.longitude,
    name: "最近轨迹点",
    address: `精度约 ${Math.round(latest.accuracy)} 米 · ${formatTime(latest.capturedAt)}`,
    scale: 16,
  });
}

function drawRoute() {
  const context = uni.createCanvasContext("routeCanvas");
  const session = routeAnalysis.value.sessions[0];
  context.setFillStyle("#edf4ef");
  context.fillRect(0, 0, 320, 170);
  if (!session || session.points.length < 2) {
    context.setFillStyle("#718077");
    context.setFontSize(13);
    context.fillText("至少需要两个有效轨迹点", 82, 88);
    context.draw();
    return;
  }
  const latitudeRange = Math.max(session.bounds.maxLatitude - session.bounds.minLatitude, 0.00001);
  const longitudeRange = Math.max(session.bounds.maxLongitude - session.bounds.minLongitude, 0.00001);
  const project = (point: LocationPoint) => ({
    x: 16 + (point.longitude - session.bounds.minLongitude) / longitudeRange * 288,
    y: 154 - (point.latitude - session.bounds.minLatitude) / latitudeRange * 138,
  });
  context.beginPath();
  context.setStrokeStyle("#247a4a");
  context.setLineWidth(4);
  context.setLineCap("round");
  context.setLineJoin("round");
  session.points.forEach((point, index) => {
    const projected = project(point);
    if (index === 0) context.moveTo(projected.x, projected.y);
    else context.lineTo(projected.x, projected.y);
  });
  context.stroke();
  const start = project(session.points[0]);
  const end = project(session.points[session.points.length - 1]);
  context.setFillStyle("#ffffff");
  context.setStrokeStyle("#247a4a");
  context.setLineWidth(3);
  context.beginPath();
  context.arc(start.x, start.y, 6, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.setFillStyle("#d84a3a");
  context.beginPath();
  context.arc(end.x, end.y, 7, 0, Math.PI * 2);
  context.fill();
  context.draw();
}

function lockViewer() {
  smsViewerSession.lock();
  stopCountdown();
  clearProtectedData();
  errorText.value = "";
  activeTab.value = "route";
  unlocked.value = false;
  remainingMs.value = 0;
}

function formatDistance(meters: number): string {
  return meters >= 1_000 ? `${(meters / 1_000).toFixed(2)} km` : `${Math.round(meters)} m`;
}

function formatDuration(milliseconds: number): string {
  const minutes = Math.round(milliseconds / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分` : `${minutes} 分钟`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "--";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** unitIndex).toFixed(unitIndex > 2 ? 1 : 0)} ${units[unitIndex]}`;
}

function formatTime(timestamp: number): string {
  return timestamp ? new Date(timestamp).toLocaleString() : "时间未知";
}

onShow(async () => {
  startCountdown();
  if (unlocked.value) await loadCurrentTab();
});
onHide(stopCountdown);
onUnload(stopCountdown);
</script>

<style>
page { background: #eef3ef; color: #14231a; font-family: system-ui, sans-serif; }
.page { min-height: 100vh; padding: 32rpx 24rpx 64rpx; }
.header, .status-head, .card-heading, .session-card, .search-card, .data-row { display: flex; align-items: center; justify-content: space-between; gap: 18rpx; }
.header { align-items: flex-start; }
.eyebrow { display: block; color: #247a4a; font-size: 20rpx; font-weight: 800; letter-spacing: 3rpx; }
.title { display: block; margin-top: 8rpx; font-size: 50rpx; font-weight: 800; }
.subtitle { display: block; margin-top: 8rpx; color: #627168; font-size: 23rpx; line-height: 1.5; }
.lock-button, .mini-button { margin: 4rpx 0 0; border: 0; border-radius: 999rpx; color: #17683b; background: #d9efdf; font-size: 22rpx; }
.lock-button::after, .mini-button::after, .primary-button::after, .secondary-button::after, .danger-button::after, .text-button::after { border: 0; }
.lock-card, .session-card, .status-card, .route-card, .list-card, .permission-card, .search-card, .contacts-card, .device-hero { margin-top: 24rpx; padding: 28rpx; border-radius: 26rpx; background: #fff; box-shadow: 0 10rpx 30rpx rgba(20, 35, 26, 0.06); }
.card-title, .session-title { display: block; font-size: 30rpx; font-weight: 750; }
.card-desc, .session-desc { display: block; margin-top: 8rpx; color: #68766d; font-size: 23rpx; line-height: 1.55; }
.password-input { height: 88rpx; margin-top: 22rpx; padding: 0 22rpx; border: 2rpx solid #839087; border-radius: 14rpx; font-size: 30rpx; letter-spacing: 5rpx; }
.primary-button, .secondary-button, .danger-button, .text-button { margin-top: 20rpx; border: 0; border-radius: 999rpx; font-size: 26rpx; font-weight: 700; }
.primary-button { color: #fff; background: #247a4a; }
.secondary-button { color: #17683b; background: #dff1e4; }
.danger-button { color: #9b2d20; background: #f9dfda; }
.text-button { color: #9b2d20; background: transparent; }
.text-button[disabled] { color: #9ba49e; }
.session-card { background: #e2f2e6; box-shadow: none; }
.tabs { margin-top: 24rpx; white-space: nowrap; }
.tabs-inner { display: flex; gap: 12rpx; }
.tab { flex: none; padding: 16rpx 24rpx; border-radius: 999rpx; color: #5b6960; background: #dfe7e1; font-size: 25rpx; }
.tab.active { color: #fff; background: #247a4a; font-weight: 700; }
.status-head, .card-heading { align-items: flex-start; }
.status-pill { flex: none; padding: 8rpx 16rpx; border-radius: 999rpx; font-size: 22rpx; }
.status-pill.running { color: #fff; background: #247a4a; }
.status-pill.stopped { color: #8f541c; background: #ffe6c9; }
.status-lines { display: flex; flex-wrap: wrap; gap: 12rpx 20rpx; margin-top: 22rpx; color: #526158; font-size: 23rpx; }
.action-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14rpx; }
.compact { padding-right: 8rpx; padding-left: 8rpx; font-size: 23rpx; }
.compatibility-note { display: block; margin-top: 20rpx; color: #7b857e; font-size: 21rpx; line-height: 1.55; }
.metrics-grid, .diagnostics-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12rpx; margin-top: 20rpx; }
.metric-card { padding: 24rpx 10rpx; border-radius: 20rpx; color: #fff; background: #173f2a; text-align: center; }
.metric-value, .metric-label { display: block; }
.metric-value { font-size: 30rpx; font-weight: 800; }
.metric-label { margin-top: 5rpx; color: #bdd4c5; font-size: 20rpx; }
.route-canvas { width: 100%; height: 340rpx; margin-top: 22rpx; border-radius: 18rpx; background: #edf4ef; }
.latest-point { display: flex; flex-direction: column; gap: 6rpx; margin-top: 16rpx; color: #56655c; font-size: 22rpx; }
.empty-inline { padding: 38rpx 16rpx; color: #7b857e; font-size: 23rpx; text-align: center; }
.data-row { min-height: 90rpx; border-bottom: 1rpx solid #edf0ed; }
.data-row:last-of-type { border-bottom: 0; }
.row-title, .row-desc, .row-value { display: block; }
.row-title { font-size: 27rpx; font-weight: 700; }
.row-desc { margin-top: 6rpx; color: #728078; font-size: 22rpx; }
.row-value { color: #247a4a; font-size: 24rpx; font-weight: 700; text-align: right; }
.search-input { min-width: 0; flex: 1; height: 62rpx; font-size: 27rpx; }
.search-count { color: #718077; font-size: 22rpx; }
.contacts-card { padding-top: 6rpx; padding-bottom: 6rpx; }
.contact-row { display: flex; align-items: center; gap: 18rpx; min-height: 108rpx; border-bottom: 1rpx solid #edf0ed; }
.contact-row:last-child { border-bottom: 0; }
.contact-avatar, .avatar-image { width: 72rpx; height: 72rpx; border-radius: 50%; }
.contact-avatar { display: flex; align-items: center; justify-content: center; color: #fff; background: #247a4a; font-size: 28rpx; font-weight: 700; }
.contact-main { min-width: 0; flex: 1; }
.selectable { user-select: text; }
.device-hero { color: #fff; background: linear-gradient(135deg, #173f2a, #2f7e51); }
.device-name { display: block; font-size: 38rpx; font-weight: 800; }
.device-version { display: block; margin-top: 8rpx; color: #d3e6d8; font-size: 23rpx; }
.battery-bar { height: 18rpx; margin-top: 28rpx; overflow: hidden; border-radius: 999rpx; background: rgba(255, 255, 255, 0.2); }
.battery-fill { height: 100%; border-radius: inherit; background: #8be7a8; }
.battery-text { display: block; margin-top: 12rpx; color: #eef9f1; font-size: 24rpx; }
.diagnostics-grid { grid-template-columns: 1fr 1fr; }
.diagnostic-card { padding: 24rpx; border-radius: 20rpx; background: #fff; }
.diagnostic-label, .diagnostic-value { display: block; }
.diagnostic-label { color: #718077; font-size: 22rpx; }
.diagnostic-value { margin-top: 8rpx; font-size: 29rpx; font-weight: 750; }
.device-actions { margin-top: 6rpx; }
.error-card { margin-top: 20rpx; padding: 22rpx; border-radius: 18rpx; color: #a33529; background: #f9dfda; font-size: 23rpx; }
</style>
