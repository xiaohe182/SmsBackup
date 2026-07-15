<template>
  <view class="page">
    <view class="header">
      <view>
        <text class="eyebrow">PRIVATE MESSAGES</text>
        <text class="title">短信</text>
        <text class="subtitle">全部收发记录、联系人会话和彩信图片</text>
      </view>
      <button v-if="unlocked" class="quiet-button" size="mini" @tap="lockViewer">锁定</button>
    </view>

    <view v-if="!unlocked" class="surface lock-card">
      <text class="surface-title">输入查看密码</text>
      <text class="surface-desc">解锁后可浏览 10 分钟；返回或切到后台不会提前锁定。</text>
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
        @tap="unlockAndLoad"
      >
        解锁并读取
      </button>
    </view>

    <template v-else>
      <view class="session-card">
        <view>
          <text class="session-title">查看会话已解锁</text>
          <text class="session-desc">剩余 {{ remainingSessionText }}，不会因操作自动续期</text>
        </view>
        <button class="quiet-button" size="mini" :loading="busy" @tap="refreshViewer">刷新</button>
      </view>

      <scroll-view class="tabs" scroll-x :show-scrollbar="false">
        <view class="tab-track">
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

      <template v-if="activeTab === 'conversations'">
        <view v-if="!smsPermissionGranted" class="surface permission-card">
          <text class="surface-title">还没有短信读取权限</text>
          <text class="surface-desc">授权后可查看系统短信库中的全部接收、发送和彩信记录。</text>
          <button class="primary-button" :loading="busy" @tap="requestSmsPermissions">
            授权读取短信
          </button>
        </view>

        <view v-else-if="!contactsPermissionGranted" class="contact-hint">
          <view class="contact-hint-copy">
            <text class="contact-hint-title">显示联系人备注和系统头像</text>
            <text class="contact-hint-desc">联系人只在本次查看会话内使用，不会上传。</text>
          </view>
          <button class="hint-button" size="mini" @tap="requestContactsPermission">授权</button>
        </view>

        <scroll-view
          v-if="smsPermissionGranted && conversations.length"
          class="conversation-list"
          scroll-y
          :show-scrollbar="false"
          @scrolltolower="loadMoreConversations"
        >
          <view
            v-for="conversation in visibleConversations"
            :key="conversation.key"
            class="conversation-row"
            hover-class="conversation-row-pressed"
            @tap="openConversation(conversation.key)"
          >
            <image
              class="avatar-image"
              :src="conversation.contact.avatarUri || DEFAULT_CONTACT_AVATAR"
              mode="aspectFill"
              lazy-load="true"
            />
            <view class="conversation-main">
              <view class="conversation-top">
                <text class="conversation-name">
                  {{ conversation.contact.displayName || '未保存联系人' }}
                </text>
                <text class="conversation-time">{{ formatCompactTime(conversation.latestAt) }}</text>
              </view>
              <view class="contact-line">
                <text class="conversation-phone">{{ conversation.contact.phoneNumber }}</text>
                <text v-if="conversation.contact.phoneLabel" class="phone-label">
                  {{ conversation.contact.phoneLabel }}
                </text>
              </view>
              <view class="conversation-bottom">
                <text class="conversation-preview">{{ conversation.preview || '[图片消息]' }}</text>
                <text v-if="conversation.unreadCount" class="unread-count">
                  {{ conversation.unreadCount }}
                </text>
              </view>
            </view>
          </view>
          <view class="list-footer">
            <text>{{ visibleConversations.length < conversations.length ? '继续下滑加载会话' : `共 ${conversations.length} 个会话` }}</text>
          </view>
        </scroll-view>

        <view v-else-if="smsPermissionGranted" class="empty-card">
          <text class="empty-title">没有找到短信会话</text>
          <text class="empty-desc">系统短信库当前没有可显示的记录。</text>
        </view>
      </template>

      <template v-else-if="activeTab === 'media'">
        <view class="section-heading">
          <view>
            <text class="section-title">本机相册</text>
            <text class="section-desc">相册按需分页；不会一次解码全部图片</text>
          </view>
          <text v-if="activeAlbum" class="section-count">{{ mediaTotalCount }} 张</text>
        </view>

        <view v-if="!mediaPermissionGranted" class="surface permission-card warm-card">
          <text class="surface-title">授权后可浏览本机相册</text>
          <text class="surface-desc">照片只在当前 10 分钟查看会话中显示，不会加入短信上传。</text>
          <button class="secondary-button" :loading="busy" @tap="requestMediaPermissions">
            授权读取图片
          </button>
        </view>

        <template v-else>
          <scroll-view v-if="galleryAlbums.length" class="album-tabs" scroll-x :show-scrollbar="false">
            <view class="tab-track">
              <view
                v-for="album in galleryAlbums"
                :key="album.id"
                :class="['album-tab', { active: activeAlbumId === album.id }]"
                @tap="selectAlbum(album.id)"
              >
                <text>{{ album.name }} · {{ album.photoCount }}</text>
              </view>
            </view>
          </scroll-view>

          <scroll-view
            v-if="activeAlbum"
            class="media-viewport"
            scroll-y
            :scroll-top="mediaScrollTop"
            :style="{ height: `${mediaViewportHeight}px` }"
            :show-scrollbar="false"
            @scroll="onMediaScroll"
          >
            <view class="media-canvas" :style="mediaCanvasStyle">
              <view
                v-for="item in virtualMediaItems"
                :key="item.photo.id"
                class="media-tile"
                :style="item.style"
                @tap="previewMedia(item.photo)"
              >
                <image
                  class="media-image"
                  :src="item.photo.uri"
                  mode="aspectFill"
                  lazy-load="true"
                  fade-show="false"
                />
                <text class="media-source">{{ item.photo.displayName || item.photo.albumName }}</text>
              </view>
            </view>
          </scroll-view>

          <view v-if="!galleryAlbums.length && !mediaLoading" class="empty-card">
            <text class="empty-title">没有可显示的图片</text>
            <text class="empty-desc">系统相册当前没有图片。</text>
          </view>
          <view v-if="mediaLoading" class="loading-footer"><text>正在加载当前视口图片…</text></view>
        </template>
      </template>

      <template v-else>
        <view v-if="!smsPermissionGranted" class="surface permission-card">
          <text class="surface-title">还没有短信读取权限</text>
          <button class="primary-button" :loading="busy" @tap="requestSmsPermissions">
            授权读取短信
          </button>
        </view>

        <scroll-view
          v-else
          class="message-list"
          scroll-y
          :show-scrollbar="false"
          @scrolltolower="loadNextMessagePage"
        >
          <view v-for="message in messageItems" :key="message.id" class="message-card">
            <view class="message-top">
              <view class="message-address-block">
                <text class="message-address">{{ message.address || '未知号码' }}</text>
                <text class="message-kind">{{ message.kind === 'mms' ? '彩信' : '短信' }}</text>
              </view>
              <text :class="['direction-label', `direction-${message.direction}`]">
                {{ directionLabel(message.direction) }}
              </text>
            </view>
            <text class="message-time">{{ formatTime(message.timestamp) }}</text>
            <text class="message-body">{{ message.body || '[图片消息]' }}</text>
            <view class="message-meta-line">
              <text>{{ message.read ? '已读' : '未读' }}</text>
              <text>{{ message.seen ? '已查看' : '未查看' }}</text>
              <text v-if="message.simSubscriptionId !== null">SIM {{ message.simSubscriptionId }}</text>
              <text v-if="message.attachments.length">{{ message.attachments.length }} 张图片</text>
            </view>
          </view>

          <view v-if="!messageItems.length && !messageLoading" class="empty-card embedded-empty">
            <text class="empty-title">没有找到短信</text>
            <text class="empty-desc">当前分类没有可显示的记录。</text>
          </view>
          <view class="list-footer">
            <text v-if="messageLoading">正在加载…</text>
            <text v-else-if="messageHasMore">继续下滑加载更早记录</text>
            <text v-else>已显示当前分类 {{ messageTotalCount }} 条记录</text>
          </view>
        </scroll-view>
      </template>
    </template>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { onHide, onShow, onUnload } from "@dcloudio/uni-app";

import { isSmsViewerPasswordValid } from "@/domain/sms-access";
import {
  mergeMessagePage,
  type MessageCursor,
  type ViewerAlbum,
  type ViewerConversation,
  type ViewerMessage,
  type ViewerMessageFilter,
  type ViewerPhoto,
} from "@/domain/sms-viewer-pagination";
import { smsViewerSession } from "@/domain/sms-viewer-session";
import {
  calculateVirtualMediaRange,
  createMediaPageCache,
  type VirtualMediaRange,
} from "@/domain/virtual-media-grid";
import { smsBackupService, type SmsDirection } from "@/services/sms-backup";

type ViewerTab = "conversations" | "all" | "inbox" | "sent" | "media";

interface VirtualPhotoItem {
  photo: ViewerPhoto;
  style: string;
}

const DEFAULT_CONTACT_AVATAR = "/static/default-contact.png";

const MESSAGE_PAGE_SIZE = 40;
const MESSAGE_WINDOW_SIZE = 200;
const MEDIA_PAGE_SIZE = 60;
const MEDIA_CACHE_PAGES = 4;
const MEDIA_COLUMNS = 3;
const CONVERSATION_BATCH_SIZE = 60;

const tabs: { key: ViewerTab; label: string }[] = [
  { key: "conversations", label: "会话" },
  { key: "all", label: "全部" },
  { key: "inbox", label: "收到" },
  { key: "sent", label: "已发送" },
  { key: "media", label: "图片" },
];

const systemInfo = uni.getSystemInfoSync();
const mediaGap = Math.max(4, uni.upx2px(10));
const mediaContentWidth = Math.max(240, systemInfo.windowWidth - uni.upx2px(48));
const mediaTileWidth = (mediaContentWidth - mediaGap * (MEDIA_COLUMNS - 1)) / MEDIA_COLUMNS;
const mediaRowHeight = mediaTileWidth + mediaGap;
const mediaViewportHeight = Math.max(320, systemInfo.windowHeight - uni.upx2px(430));

const passwordInput = ref("");
const busy = ref(false);
const errorText = ref("");
const unlocked = ref(false);
const remainingMs = ref(0);
const activeTab = ref<ViewerTab>("conversations");
const smsPermissionGranted = ref(false);
const contactsPermissionGranted = ref(false);
const mediaPermissionGranted = ref(false);

const conversations = ref<ViewerConversation[]>([]);
const visibleConversationCount = ref(CONVERSATION_BATCH_SIZE);
const messageItems = ref<ViewerMessage[]>([]);
const messageCursor = ref<MessageCursor | null>(null);
const messageHasMore = ref(false);
const messageTotalCount = ref(0);
const messageLoading = ref(false);
let messageGeneration = 0;

const galleryAlbums = ref<ViewerAlbum[]>([]);
const activeAlbumId = ref("");
const mediaTotalCount = ref(0);
const mediaScrollTop = ref(0);
const mediaLoading = ref(false);
const mediaCacheVersion = ref(0);
const mediaPageCache = createMediaPageCache<ViewerPhoto>(MEDIA_CACHE_PAGES);
const loadingMediaPages = new Set<number>();
let mediaGeneration = 0;
let pendingMediaScrollTop = 0;
let mediaScrollTimer: ReturnType<typeof setTimeout> | null = null;
let countdownTimer: ReturnType<typeof setInterval> | null = null;

const virtualRange = ref<VirtualMediaRange>(calculateVirtualMediaRange({
  totalCount: 0,
  scrollTop: 0,
  viewportHeight: mediaViewportHeight,
  columnCount: MEDIA_COLUMNS,
  rowHeight: mediaRowHeight,
  overscanRows: 2,
  pageSize: MEDIA_PAGE_SIZE,
}));

const visibleConversations = computed(() =>
  conversations.value.slice(0, visibleConversationCount.value),
);

const activeAlbum = computed(() =>
  galleryAlbums.value.find((album) => album.id === activeAlbumId.value) ?? null,
);

const mediaCanvasStyle = computed(() => `height:${virtualRange.value.totalHeight}px;`);

const virtualMediaItems = computed<VirtualPhotoItem[]>(() => {
  // 让非响应式 LRU 缓存更新后重新计算当前视口；DOM 数量始终只等于可见区加预加载行。
  void mediaCacheVersion.value;
  const items: VirtualPhotoItem[] = [];
  for (let index = virtualRange.value.startIndex; index < virtualRange.value.endIndex; index += 1) {
    const page = Math.floor(index / MEDIA_PAGE_SIZE);
    const photo = mediaPageCache.get(page)?.[index % MEDIA_PAGE_SIZE];
    if (!photo) continue;
    const column = index % MEDIA_COLUMNS;
    const row = Math.floor(index / MEDIA_COLUMNS);
    items.push({
      photo,
      style: [
        `width:${mediaTileWidth}px`,
        `height:${mediaTileWidth}px`,
        `left:${column * (mediaTileWidth + mediaGap)}px`,
        `top:${row * mediaRowHeight}px`,
      ].join(";"),
    });
  }
  return items;
});

const remainingSessionText = computed(() => {
  const seconds = Math.ceil(remainingMs.value / 1_000);
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
});

function syncSessionState(): boolean {
  unlocked.value = smsViewerSession.touch();
  remainingMs.value = smsViewerSession.remainingMs();
  if (!unlocked.value) clearLocalViewerState();
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

function ensureActiveSession(): boolean {
  if (syncSessionState()) return true;
  uni.showToast({ title: "查看会话已到期，请重新输入密码", icon: "none" });
  return false;
}

function viewerPassword(): string | null {
  return smsViewerSession.password();
}

function nativeErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
}

async function loadConversations(): Promise<void> {
  const password = viewerPassword();
  if (!password) return;
  const result = await smsBackupService.listConversationSummaries(password);
  if (!result.authorized) {
    lockViewer();
    return;
  }
  smsPermissionGranted.value = result.permissionGranted;
  conversations.value = result.conversations;
  visibleConversationCount.value = CONVERSATION_BATCH_SIZE;
  smsViewerSession.replaceConversations(result.conversations);
}

function currentMessageFilter(): ViewerMessageFilter {
  return activeTab.value === "inbox" || activeTab.value === "sent"
    ? activeTab.value
    : "all";
}

async function loadMessagePage(reset: boolean): Promise<void> {
  const password = viewerPassword();
  if (!password || (!reset && (messageLoading.value || !messageHasMore.value))) return;

  const generation = reset ? ++messageGeneration : messageGeneration;
  if (reset) {
    messageItems.value = [];
    messageCursor.value = null;
    messageHasMore.value = true;
    messageTotalCount.value = 0;
  }
  messageLoading.value = true;
  try {
    const result = await smsBackupService.listMessagePage(
      password,
      currentMessageFilter(),
      null,
      null,
      reset ? null : messageCursor.value,
      MESSAGE_PAGE_SIZE,
    );
    if (generation !== messageGeneration || !smsViewerSession.isActive()) return;
    if (!result.authorized) {
      lockViewer();
      return;
    }
    smsPermissionGranted.value = result.permissionGranted;
    messageItems.value = reset
      ? result.messages
      : mergeMessagePage(messageItems.value, result.messages, MESSAGE_WINDOW_SIZE);
    messageCursor.value = result.nextCursor;
    messageHasMore.value = result.hasMore;
    messageTotalCount.value = result.totalCount;
  } finally {
    if (generation === messageGeneration) messageLoading.value = false;
  }
}

async function loadAlbums(): Promise<void> {
  const password = viewerPassword();
  if (!password) return;
  const result = await smsBackupService.listGalleryAlbums(password);
  if (!result.authorized) {
    lockViewer();
    return;
  }
  mediaPermissionGranted.value = result.permissionGranted;
  galleryAlbums.value = result.albums;
  if (!result.permissionGranted || result.albums.length === 0) {
    resetMediaWindow();
    return;
  }
  const requestedAlbum = result.albums.some((album) => album.id === activeAlbumId.value)
    ? activeAlbumId.value
    : result.albums[0].id;
  activeAlbumId.value = "";
  selectAlbum(requestedAlbum);
}

function resetMediaWindow() {
  mediaGeneration += 1;
  mediaPageCache.clear();
  loadingMediaPages.clear();
  mediaCacheVersion.value += 1;
  activeAlbumId.value = "";
  mediaTotalCount.value = 0;
  mediaLoading.value = false;
  mediaScrollTop.value = 0;
  virtualRange.value = calculateVirtualMediaRange({
    totalCount: 0,
    scrollTop: 0,
    viewportHeight: mediaViewportHeight,
    columnCount: MEDIA_COLUMNS,
    rowHeight: mediaRowHeight,
    overscanRows: 2,
    pageSize: MEDIA_PAGE_SIZE,
  });
}

function selectAlbum(albumId: string) {
  if (
    !ensureActiveSession() ||
    (activeAlbumId.value === albumId && mediaPageCache.pageCount() > 0)
  ) return;
  mediaGeneration += 1;
  mediaPageCache.clear();
  loadingMediaPages.clear();
  mediaCacheVersion.value += 1;
  activeAlbumId.value = albumId;
  mediaTotalCount.value = galleryAlbums.value.find((album) => album.id === albumId)?.photoCount ?? 0;
  mediaScrollTop.value = 0;
  updateMediaRange(0);
}

function updateMediaRange(scrollTop: number) {
  virtualRange.value = calculateVirtualMediaRange({
    totalCount: mediaTotalCount.value,
    scrollTop,
    viewportHeight: mediaViewportHeight,
    columnCount: MEDIA_COLUMNS,
    rowHeight: mediaRowHeight,
    overscanRows: 2,
    pageSize: MEDIA_PAGE_SIZE,
  });
  void ensureMediaPages(virtualRange.value.requiredPages);
}

async function ensureMediaPages(pages: number[]): Promise<void> {
  const password = viewerPassword();
  const albumId = activeAlbumId.value;
  if (!password || !albumId) return;
  const generation = mediaGeneration;
  const pendingPages = pages.filter((page) =>
    !mediaPageCache.has(page) && !loadingMediaPages.has(page),
  );
  if (!pendingPages.length) return;

  pendingPages.forEach((page) => loadingMediaPages.add(page));
  mediaLoading.value = true;
  try {
    await Promise.all(pendingPages.map(async (page) => {
      const result = await smsBackupService.listGalleryPage(
        password,
        albumId,
        page * MEDIA_PAGE_SIZE,
        MEDIA_PAGE_SIZE,
      );
      if (generation !== mediaGeneration || albumId !== activeAlbumId.value) return;
      if (!result.authorized) {
        lockViewer();
        return;
      }
      mediaPermissionGranted.value = result.permissionGranted;
      mediaTotalCount.value = result.totalCount;
      mediaPageCache.set(page, result.photos);
      mediaCacheVersion.value += 1;
    }));
  } catch (error) {
    if (generation === mediaGeneration) {
      errorText.value = nativeErrorMessage(error, "当前图片页加载失败，请稍后重试");
    }
  } finally {
    pendingPages.forEach((page) => loadingMediaPages.delete(page));
    if (generation === mediaGeneration) mediaLoading.value = loadingMediaPages.size > 0;
  }
}

function onMediaScroll(event: { detail: { scrollTop: number } }) {
  pendingMediaScrollTop = Math.max(0, event.detail.scrollTop);
  if (mediaScrollTimer !== null) return;
  // 16ms 合并高频滚动事件，避免快速滑动时重复计算布局和触发 Provider 请求。
  mediaScrollTimer = setTimeout(() => {
    mediaScrollTimer = null;
    updateMediaRange(pendingMediaScrollTop);
  }, 16);
}

async function unlockAndLoad() {
  if (!isSmsViewerPasswordValid(passwordInput.value)) {
    uni.showToast({ title: "密码错误", icon: "none" });
    return;
  }
  smsViewerSession.unlock(passwordInput.value);
  passwordInput.value = "";
  startCountdown();
  busy.value = true;
  errorText.value = "";
  try {
    // 联系人授权拒绝时仍继续展示完整号码和真实默认头像，不影响短信读取。
    contactsPermissionGranted.value = await smsBackupService
      .requestContactsPermission()
      .catch(() => false);
    await Promise.all([loadConversations(), loadMessagePage(true)]);
  } catch (error) {
    errorText.value = nativeErrorMessage(error, "读取短信失败，请检查权限后重试");
  } finally {
    busy.value = false;
  }
}

async function refreshViewer() {
  if (!ensureActiveSession()) return;
  busy.value = true;
  errorText.value = "";
  try {
    if (activeTab.value === "media") await loadAlbums();
    else await Promise.all([loadConversations(), loadMessagePage(true)]);
  } catch (error) {
    errorText.value = nativeErrorMessage(error, "刷新失败，请稍后重试");
  } finally {
    busy.value = false;
  }
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
    await Promise.all([loadConversations(), loadMessagePage(true)]);
  } catch (error) {
    errorText.value = nativeErrorMessage(error, "短信授权或读取失败，请稍后重试");
  } finally {
    busy.value = false;
  }
}

async function requestContactsPermission() {
  if (!ensureActiveSession()) return;
  contactsPermissionGranted.value = await smsBackupService.requestContactsPermission();
  if (contactsPermissionGranted.value) await loadConversations();
  else uni.showToast({ title: "已保留号码显示，可稍后授权联系人", icon: "none" });
}

async function requestMediaPermissions() {
  if (!ensureActiveSession()) return;
  busy.value = true;
  try {
    mediaPermissionGranted.value = await smsBackupService.requestMediaPermissions();
    if (!mediaPermissionGranted.value) {
      uni.showToast({ title: "需要图片读取权限", icon: "none" });
      return;
    }
    await loadAlbums();
  } catch (error) {
    errorText.value = nativeErrorMessage(error, "相册授权或读取失败，请稍后重试");
  } finally {
    busy.value = false;
  }
}

async function selectTab(tab: ViewerTab) {
  if (!ensureActiveSession() || activeTab.value === tab) return;
  activeTab.value = tab;
  errorText.value = "";
  if (tab === "media") {
    if (!galleryAlbums.value.length) await loadAlbums();
    return;
  }
  if (tab !== "conversations") await loadMessagePage(true);
}

function loadMoreConversations() {
  visibleConversationCount.value = Math.min(
    conversations.value.length,
    visibleConversationCount.value + CONVERSATION_BATCH_SIZE,
  );
}

async function loadNextMessagePage() {
  if (!ensureActiveSession()) return;
  await loadMessagePage(false);
}

function openConversation(key: string) {
  if (!ensureActiveSession()) return;
  uni.navigateTo({
    url: `/pages/conversation/conversation?key=${encodeURIComponent(key)}`,
  });
}

function previewMedia(photo: ViewerPhoto) {
  if (!ensureActiveSession()) return;
  const nearbyPages = new Set<number>();
  virtualRange.value.requiredPages.forEach((page) => {
    for (const candidate of [page - 1, page, page + 1]) {
      if (candidate >= 0) nearbyPages.add(candidate);
    }
  });
  // 预览只传当前附近已缓存图片，避免把一万条 content URI 一次交给系统预览器。
  const urls = [...nearbyPages]
    .sort((left, right) => left - right)
    .flatMap((page) => mediaPageCache.get(page) ?? [])
    .map((item) => item.uri)
    .slice(0, MEDIA_PAGE_SIZE * MEDIA_CACHE_PAGES);
  if (!urls.includes(photo.uri)) urls.unshift(photo.uri);
  uni.previewImage({ current: photo.uri, urls });
}

function clearLocalViewerState() {
  messageGeneration += 1;
  mediaGeneration += 1;
  conversations.value = [];
  messageItems.value = [];
  messageCursor.value = null;
  messageHasMore.value = false;
  messageLoading.value = false;
  galleryAlbums.value = [];
  mediaPageCache.clear();
  loadingMediaPages.clear();
  mediaCacheVersion.value += 1;
  smsPermissionGranted.value = false;
  contactsPermissionGranted.value = false;
  mediaPermissionGranted.value = false;
  mediaLoading.value = false;
  activeAlbumId.value = "";
  mediaTotalCount.value = 0;
}

function lockViewer() {
  smsViewerSession.lock();
  activeTab.value = "conversations";
  errorText.value = "";
  stopCountdown();
  clearLocalViewerState();
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

onShow(startCountdown);
onHide(stopCountdown);
onUnload(() => {
  stopCountdown();
  if (mediaScrollTimer !== null) clearTimeout(mediaScrollTimer);
});
</script>

<style>
page { background: #f5f5f7; color: #1d1b20; font-family: system-ui, sans-serif; }
.page { min-height: 100vh; padding: 28rpx 24rpx 48rpx; }
.header { display: flex; align-items: flex-start; justify-content: space-between; gap: 18rpx; }
.eyebrow { display: block; color: #6750a4; font-size: 20rpx; font-weight: 700; letter-spacing: 3rpx; }
.title { display: block; margin-top: 6rpx; font-size: 52rpx; font-weight: 760; letter-spacing: -1rpx; }
.subtitle { display: block; margin-top: 8rpx; color: #625b71; font-size: 24rpx; line-height: 1.45; }
.surface { padding: 28rpx; border-radius: 28rpx; background: #fff; box-shadow: 0 8rpx 24rpx rgba(29, 27, 32, 0.06); }
.lock-card, .permission-card { margin-top: 24rpx; }
.surface-title, .session-title, .section-title { display: block; font-size: 30rpx; font-weight: 720; }
.surface-desc, .session-desc, .section-desc { display: block; margin-top: 8rpx; color: #625b71; font-size: 23rpx; line-height: 1.55; }
.password-input { height: 88rpx; margin-top: 24rpx; padding: 0 22rpx; border: 2rpx solid #79747e; border-radius: 14rpx; background: #fff; font-size: 30rpx; letter-spacing: 5rpx; }
.primary-button, .secondary-button { margin-top: 20rpx; border: 0; border-radius: 999rpx; font-size: 27rpx; font-weight: 700; }
.primary-button { color: #fff; background: #6750a4; }
.secondary-button { color: #4f378b; background: #e8def8; }
.primary-button::after, .secondary-button::after, .quiet-button::after, .hint-button::after { border: 0; }
.quiet-button { flex: none; margin: 6rpx 0 0; border: 0; border-radius: 999rpx; color: #4f378b; background: #e8def8; font-size: 22rpx; }
.session-card { display: flex; align-items: center; justify-content: space-between; gap: 18rpx; margin-top: 22rpx; padding: 22rpx 24rpx; border-radius: 24rpx; background: #f3edf7; }
.tabs, .album-tabs { margin-top: 20rpx; white-space: nowrap; }
.tab-track { display: inline-flex; gap: 12rpx; padding-right: 18rpx; }
.tab, .album-tab { flex: none; padding: 15rpx 22rpx; border-radius: 999rpx; color: #625b71; background: #e7e0ec; font-size: 24rpx; }
.tab.active, .album-tab.active { color: #fff; background: #6750a4; font-weight: 700; }
.contact-hint { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; margin-top: 18rpx; padding: 20rpx 22rpx; border: 1rpx solid #e8def8; border-radius: 20rpx; background: #fffbfe; }
.contact-hint-copy { min-width: 0; flex: 1; }
.contact-hint-title { display: block; font-size: 25rpx; font-weight: 700; }
.contact-hint-desc { display: block; margin-top: 5rpx; color: #625b71; font-size: 21rpx; line-height: 1.4; }
.hint-button { flex: none; margin: 0; border: 0; border-radius: 999rpx; color: #fff; background: #6750a4; font-size: 21rpx; }
.conversation-list, .message-list { height: calc(100vh - 400rpx); margin-top: 14rpx; }
.conversation-row { display: flex; align-items: center; gap: 18rpx; margin-top: 12rpx; padding: 20rpx 16rpx; border-radius: 22rpx; background: #fff; box-shadow: 0 3rpx 12rpx rgba(29, 27, 32, 0.035); }
.conversation-row-pressed { background: #f3edf7; }
.avatar-image { flex: none; width: 86rpx; height: 86rpx; border-radius: 50%; background: #e8def8; }
.conversation-main { min-width: 0; flex: 1; }
.conversation-top, .conversation-bottom, .message-top { display: flex; align-items: center; justify-content: space-between; gap: 14rpx; }
.conversation-name { overflow: hidden; font-size: 29rpx; font-weight: 720; text-overflow: ellipsis; white-space: nowrap; }
.conversation-time, .message-time { flex: none; color: #79747e; font-size: 21rpx; }
.contact-line { display: flex; align-items: center; gap: 10rpx; margin-top: 5rpx; }
.conversation-phone { overflow: hidden; color: #625b71; font-size: 22rpx; text-overflow: ellipsis; white-space: nowrap; }
.phone-label { flex: none; padding: 2rpx 8rpx; border-radius: 999rpx; color: #4f378b; background: #f3edf7; font-size: 18rpx; }
.conversation-bottom { margin-top: 7rpx; }
.conversation-preview { overflow: hidden; color: #625b71; font-size: 23rpx; text-overflow: ellipsis; white-space: nowrap; }
.unread-count { min-width: 34rpx; padding: 2rpx 8rpx; border-radius: 999rpx; color: #fff; background: #6750a4; font-size: 20rpx; text-align: center; }
.message-card { margin-top: 14rpx; padding: 22rpx; border: 1rpx solid #ece7ef; border-radius: 22rpx; background: #fff; }
.message-address-block { min-width: 0; }
.message-address { display: block; overflow: hidden; font-size: 28rpx; font-weight: 720; text-overflow: ellipsis; white-space: nowrap; }
.message-kind { display: block; margin-top: 3rpx; color: #79747e; font-size: 19rpx; }
.direction-label { flex: none; padding: 6rpx 12rpx; border-radius: 999rpx; color: #6750a4; background: #e8def8; font-size: 20rpx; }
.direction-sent, .direction-outbox { color: #245a35; background: #c8f2d3; }
.direction-failed { color: #b3261e; background: #f9dedc; }
.message-time { display: block; margin-top: 7rpx; }
.message-body { display: block; margin-top: 14rpx; color: #2b2930; font-size: 26rpx; line-height: 1.58; word-break: break-all; white-space: pre-wrap; }
.message-meta-line { display: flex; flex-wrap: wrap; gap: 10rpx 16rpx; margin-top: 14rpx; color: #79747e; font-size: 20rpx; }
.section-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 16rpx; margin-top: 22rpx; }
.section-count { color: #6750a4; font-size: 22rpx; font-weight: 700; }
.warm-card { background: #fff8e1; box-shadow: none; }
.media-viewport { margin-top: 16rpx; border-radius: 20rpx; background: #eeebf0; }
.media-canvas { position: relative; width: 100%; }
.media-tile { position: absolute; overflow: hidden; border-radius: 16rpx; background: #e7e0ec; }
.media-image { width: 100%; height: 100%; }
.media-source { position: absolute; right: 0; bottom: 0; left: 0; padding: 7rpx 9rpx; overflow: hidden; color: #fff; background: rgba(0, 0, 0, 0.46); font-size: 18rpx; text-overflow: ellipsis; white-space: nowrap; }
.empty-card, .error-card { margin-top: 22rpx; padding: 44rpx 28rpx; border-radius: 24rpx; background: #fff; text-align: center; }
.embedded-empty { margin-right: 2rpx; margin-left: 2rpx; }
.empty-title { display: block; font-size: 28rpx; font-weight: 700; }
.empty-desc { display: block; margin-top: 8rpx; color: #79747e; font-size: 23rpx; line-height: 1.5; }
.error-card { color: #b3261e; background: #f9dedc; font-size: 24rpx; }
.list-footer, .loading-footer { padding: 24rpx 12rpx 28rpx; color: #79747e; font-size: 21rpx; text-align: center; }
</style>
