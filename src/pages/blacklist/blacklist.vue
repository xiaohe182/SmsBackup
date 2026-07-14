<template>
  <view class="page">
    <view class="intro">
      <text class="title">短信黑名单</text>
      <text class="desc">命中任意启用规则的短信不会上传。发件人规则匹配号码或签名，内容规则匹配正文关键词。</text>
    </view>

    <view class="add-card">
      <picker :range="kindLabels" :value="kindIndex" @change="changeKind">
        <view class="picker-value">{{ kindLabels[kindIndex] }}</view>
      </picker>
      <input v-model="newValue" class="rule-input" placeholder="输入发件人或关键词" />
      <button class="add-button" @click="handleAdd">添加</button>
    </view>

    <view class="rules">
      <view v-for="rule in rules" :key="rule.id" class="rule-card">
        <view class="rule-main">
          <view>
            <text class="rule-value">{{ rule.value }}</text>
            <text class="rule-kind">{{ rule.kind === 'sender' ? '发件人' : '内容关键词' }}</text>
          </view>
          <switch color="#2a8b50" :checked="rule.enabled" @change="handleToggle(rule.id)" />
        </view>
        <view class="rule-footer">
          <text>{{ rule.builtIn ? '默认规则' : '自定义规则' }}</text>
          <text class="delete" @click="handleRemove(rule.id)">删除</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from "vue";

import type { BlacklistRuleKind } from "@/domain/blacklist";
import { smsBackupService } from "@/services/sms-backup";
import { addRule, loadRules, removeRule, saveRules, toggleRule } from "@/stores/blacklist";
import { uniKeyValueStorage } from "@/stores/settings";

const kindLabels = ["发件人", "内容关键词"];
const kindIndex = ref(0);
const newValue = ref("");
const rules = ref(loadRules(uniKeyValueStorage));

function persist(nextRules = rules.value) {
  rules.value = saveRules(uniKeyValueStorage, nextRules);
  smsBackupService.saveRules(rules.value);
}

function changeKind(event: { detail: { value: string } }) {
  kindIndex.value = Number(event.detail.value);
}

function handleAdd() {
  const kind: BlacklistRuleKind = kindIndex.value === 0 ? "sender" : "body";
  try {
    persist(addRule(rules.value, kind, newValue.value));
    newValue.value = "";
  } catch (error) {
    uni.showToast({ title: (error as Error).message, icon: "none" });
  }
}

function handleToggle(id: string) {
  persist(toggleRule(rules.value, id));
}

function handleRemove(id: string) {
  persist(removeRule(rules.value, id));
}
</script>

<style>
page { background: #f3f5f2; color: #14231a; }
.page { padding: 34rpx 30rpx 60rpx; }
.intro { padding: 8rpx 4rpx 24rpx; }
.title { display: block; font-size: 44rpx; font-weight: 800; }
.desc { display: block; margin-top: 12rpx; color: #6e7c73; font-size: 25rpx; line-height: 1.6; }
.add-card { display: grid; grid-template-columns: 180rpx 1fr 120rpx; gap: 12rpx; padding: 18rpx; border-radius: 22rpx; background: #fff; }
.picker-value, .rule-input { height: 72rpx; padding: 0 18rpx; border-radius: 14rpx; background: #f1f4f1; font-size: 25rpx; line-height: 72rpx; }
.add-button { height: 72rpx; padding: 0; border: 0; border-radius: 14rpx; color: #fff; background: #2a8b50; font-size: 25rpx; line-height: 72rpx; }
.add-button::after { border: 0; }
.rules { margin-top: 20rpx; }
.rule-card { margin-bottom: 14rpx; padding: 24rpx; border-radius: 20rpx; background: #fff; }
.rule-main { display: flex; justify-content: space-between; align-items: center; }
.rule-value { display: block; font-size: 29rpx; font-weight: 700; }
.rule-kind { display: block; margin-top: 5rpx; color: #7c8980; font-size: 22rpx; }
.rule-footer { display: flex; justify-content: space-between; margin-top: 20rpx; padding-top: 16rpx; border-top: 1rpx solid #edf0ed; color: #99a39c; font-size: 22rpx; }
.delete { color: #bc4c45; }
</style>
