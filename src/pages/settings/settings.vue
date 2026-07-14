<template>
  <view class="page">
    <text class="title">服务器设置</text>
    <text class="desc">Node 服务准备好后填写地址。未配置或连接失败时，短信只保存在本机队列。</text>

    <view class="form-card">
      <text class="label">服务器地址</text>
      <input v-model="form.serverUrl" class="input" placeholder="https://example.com" />
      <text class="hint">局域网示例：http://192.168.1.8:3000</text>

      <text class="label spaced">设备名称</text>
      <input v-model="form.deviceName" class="input" placeholder="家人手机" />

      <view class="switch-row spaced">
        <view>
          <text class="switch-title">启用自动同步</text>
          <text class="hint">关闭后仍保留本地队列</text>
        </view>
        <switch
          :checked="form.syncEnabled"
          color="#2a8b50"
          @change="changeSyncEnabled"
        />
      </view>

      <view class="switch-row">
        <view>
          <text class="switch-title">允许 HTTP</text>
          <text class="hint warning">仅用于可信局域网，公网请使用 HTTPS</text>
        </view>
        <switch
          :checked="form.allowInsecureHttp"
          color="#d98b35"
          @change="changeAllowInsecureHttp"
        />
      </view>
    </view>

    <button class="secondary-button" :loading="testing" @click="testConnection">测试连接</button>
    <button class="primary-button" @click="save">保存设置</button>
  </view>
</template>

<script setup lang="ts">
import { reactive, ref } from "vue";

import { normalizeServerUrl } from "@/domain/server-url";
import { smsBackupService } from "@/services/sms-backup";
import { loadSettings, saveSettings, uniKeyValueStorage } from "@/stores/settings";

const form = reactive(loadSettings(uniKeyValueStorage));
const testing = ref(false);

function switchValue(event: Event): boolean {
  return (event as unknown as { detail: { value: boolean } }).detail.value;
}

function changeSyncEnabled(event: Event) {
  form.syncEnabled = switchValue(event);
}

function changeAllowInsecureHttp(event: Event) {
  form.allowInsecureHttp = switchValue(event);
}

function validateTransport(serverUrl: string) {
  if (serverUrl.startsWith("http://") && !form.allowInsecureHttp) {
    throw new Error("使用 HTTP 前请开启“允许 HTTP”");
  }
}

async function testConnection() {
  testing.value = true;
  try {
    const serverUrl = normalizeServerUrl(form.serverUrl);
    if (!serverUrl) {
      throw new Error("请先填写服务器地址");
    }
    validateTransport(serverUrl);
    const ok = await smsBackupService.testConnection(serverUrl);
    uni.showToast({ title: ok ? "连接成功" : "连接失败", icon: "none" });
  } catch (error) {
    uni.showToast({ title: (error as Error).message, icon: "none" });
  } finally {
    testing.value = false;
  }
}

async function save() {
  try {
    const serverUrl = normalizeServerUrl(form.serverUrl);
    validateTransport(serverUrl);
    const saved = saveSettings(uniKeyValueStorage, { ...form, serverUrl });
    Object.assign(form, saved);
    await smsBackupService.saveSettings(saved);
    uni.showToast({ title: "设置已保存", icon: "success" });
  } catch (error) {
    uni.showToast({ title: (error as Error).message, icon: "none" });
  }
}
</script>

<style>
page { background: #f3f5f2; color: #14231a; }
.page { padding: 36rpx 30rpx 60rpx; }
.title { display: block; font-size: 44rpx; font-weight: 800; }
.desc { display: block; margin-top: 12rpx; color: #6e7c73; font-size: 25rpx; line-height: 1.6; }
.form-card { margin-top: 24rpx; padding: 26rpx; border-radius: 22rpx; background: #fff; }
.label, .switch-title { display: block; font-size: 27rpx; font-weight: 700; }
.spaced { margin-top: 28rpx; }
.input { height: 82rpx; margin-top: 12rpx; padding: 0 20rpx; border-radius: 15rpx; background: #f1f4f1; font-size: 26rpx; }
.hint { display: block; margin-top: 8rpx; color: #8a968e; font-size: 21rpx; }
.warning { color: #b26d1d; }
.switch-row { display: flex; justify-content: space-between; align-items: center; margin-top: 24rpx; padding-top: 24rpx; border-top: 1rpx solid #edf0ed; }
.secondary-button, .primary-button { margin-top: 22rpx; border: 0; border-radius: 20rpx; font-size: 28rpx; font-weight: 700; }
.secondary-button { color: #1f7041; background: #dff0e4; }
.primary-button { color: #fff; background: #2a8b50; }
.secondary-button::after, .primary-button::after { border: 0; }
</style>
