const byId = (id) => document.getElementById(id);
const state = { mediaOffset: 0, mediaHasMore: false };

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers ?? {}),
    },
  });
  if (response.status === 204) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `HTTP ${response.status}`);
  return body;
}

function setAuthenticated(authenticated) {
  byId("loginPanel").classList.toggle("hidden", authenticated);
  byId("dashboard").classList.toggle("hidden", !authenticated);
  byId("logoutButton").classList.toggle("hidden", !authenticated);
}

function text(tag, value, className = "") {
  const node = document.createElement(tag);
  node.textContent = value ?? "";
  if (className) node.className = className;
  return node;
}

function formatTime(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0
    ? new Date(Number(value)).toLocaleString("zh-CN")
    : "暂无";
}

async function loadSettings() {
  const settings = await api("/api/admin/settings");
  byId("mediaLookbackHours").value = settings.mediaLookbackHours;
  byId("autoSyncIntervalMinutes").value = settings.autoSyncIntervalMinutes;
  byId("autoSyncEnabled").checked = settings.autoSyncEnabled;
  byId("wifiOnly").checked = settings.wifiOnly;
}

async function loadDevices() {
  const result = await api("/api/admin/devices");
  const list = byId("deviceList");
  list.replaceChildren();
  byId("deviceEmpty").classList.toggle("hidden", result.items.length > 0);
  for (const device of result.items) {
    const card = text("article", "", "device-card");
    const copy = document.createElement("div");
    copy.append(
      text("h3", device.deviceName || device.deviceId),
      text("p", `设备 ID：${device.deviceId}`, "muted"),
    );
    const meta = text("div", "", "device-meta");
    meta.append(
      text("span", `最后在线：${formatTime(device.lastSeenAt)}`),
      text("span", `App：${device.appVersion || "未知"}`),
      text("span", `结果：${device.lastResult?.status || "尚未同步"}`),
      text("span", `短信：${device.lastResult?.smsQueued ?? 0}`),
      text("span", `图片：${device.lastResult?.imageUploaded ?? 0}`),
      text("span", `视频：${device.lastResult?.videoUploaded ?? 0}`),
    );
    copy.append(meta);
    if (device.lastResult?.error) copy.append(text("p", device.lastResult.error, "error"));
    const button = text("button", "立即获取", "button primary");
    button.type = "button";
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await api(`/api/admin/devices/${encodeURIComponent(device.deviceId)}/sync`, { method: "POST" });
        button.textContent = "已下发，等待手机";
      } catch (error) {
        button.textContent = error.message;
      } finally {
        setTimeout(() => { button.disabled = false; button.textContent = "立即获取"; }, 1600);
      }
    });
    card.append(copy, button);
    list.append(card);
  }
}

async function loadMedia(reset = true) {
  if (reset) {
    state.mediaOffset = 0;
    byId("mediaGrid").replaceChildren();
  }
  const type = byId("mediaType").value;
  const result = await api(`/api/media?limit=24&offset=${state.mediaOffset}&mediaType=${encodeURIComponent(type)}`);
  for (const item of result.items) {
    const card = text("article", "", "media-card");
    const media = document.createElement(item.mediaType === "video" ? "video" : "img");
    media.src = `/api/media/${encodeURIComponent(item.mediaId)}/content`;
    if (item.mediaType === "video") {
      media.controls = true;
      media.preload = "metadata";
    } else {
      media.loading = "lazy";
      media.alt = item.displayName || item.albumName;
    }
    const copy = text("div", "", "media-copy");
    copy.append(
      text("p", item.displayName || "未命名媒体", "media-name"),
      text("small", `${item.albumName || "未知相册"} · ${formatTime(item.takenAt)}`),
    );
    card.append(media, copy);
    byId("mediaGrid").append(card);
  }
  state.mediaOffset += result.items.length;
  state.mediaHasMore = result.hasMore;
  byId("moreMediaButton").classList.toggle("hidden", !result.hasMore);
  byId("mediaEmpty").classList.toggle("hidden", state.mediaOffset > 0);
}

async function loadSms() {
  const result = await api("/api/sms?limit=50&offset=0");
  const list = byId("smsList");
  list.replaceChildren();
  for (const item of result.items) {
    const row = text("article", "", "sms");
    const head = text("div", "", "sms-head");
    head.append(
      text("span", `${item.direction === "sent" ? "已发送" : "已接收"} · ${item.sender}`),
      text("time", formatTime(item.receivedAt)),
    );
    row.append(head, text("p", item.body, "sms-body"));
    list.append(row);
  }
}

async function loadDashboard() {
  await Promise.all([loadSettings(), loadDevices(), loadMedia(true), loadSms()]);
}

byId("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  byId("loginError").textContent = "";
  try {
    await api("/api/admin/session", {
      method: "POST",
      body: JSON.stringify({ password: byId("password").value }),
    });
    setAuthenticated(true);
    await loadDashboard();
  } catch (error) {
    byId("loginError").textContent = `登录失败：${error.message}`;
  }
});

byId("settingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  byId("settingsSaved").textContent = "";
  try {
    await api("/api/admin/settings", {
      method: "PUT",
      body: JSON.stringify({
        mediaLookbackHours: Number(byId("mediaLookbackHours").value),
        autoSyncIntervalMinutes: Number(byId("autoSyncIntervalMinutes").value),
        autoSyncEnabled: byId("autoSyncEnabled").checked,
        wifiOnly: byId("wifiOnly").checked,
      }),
    });
    byId("settingsSaved").textContent = "已保存，新请求立即使用";
  } catch (error) {
    byId("settingsSaved").textContent = `保存失败：${error.message}`;
  }
});

byId("logoutButton").addEventListener("click", async () => {
  await api("/api/admin/session", { method: "DELETE" }).catch(() => null);
  setAuthenticated(false);
});
byId("refreshButton").addEventListener("click", loadDevices);
byId("loadMediaButton").addEventListener("click", () => loadMedia(true));
byId("moreMediaButton").addEventListener("click", () => loadMedia(false));
byId("mediaType").addEventListener("change", () => loadMedia(true));
byId("loadSmsButton").addEventListener("click", loadSms);
