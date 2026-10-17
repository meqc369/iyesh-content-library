<script setup lang="ts">
import { ref } from 'vue'
import { getCurrentUser, wechatLogin } from '../../api/auth'

const user = ref(getCurrentUser())
const message = ref('')
async function login() {
  message.value = ''
  try { user.value = await wechatLogin(); message.value = '登录成功'; setTimeout(() => uni.navigateBack(), 500) } catch (error) { message.value = error instanceof Error ? error.message : '登录失败，请稍后重试' }
}
</script>

<template>
  <view class="page"><view class="card"><text class="eyebrow">WELCOME BACK</text><text class="title">登录内容库</text><text class="sub">登录后可以保存筛选、发表评论和管理互动。</text><button v-if="!user" class="login" @click="login">微信登录</button><view v-else class="logged"><text>已登录：{{ user.name }}</text><button class="login" @click="login">重新登录</button></view><text v-if="message" class="message">{{ message }}</text></view></view>
</template>

<style scoped>
.page{min-height:100vh;background:#f7f8fa;padding:40rpx}.card{background:#fff;border:1px solid #e9edf1;border-radius:20rpx;padding:38rpx}.eyebrow{display:block;color:#2d6bff;font-size:20rpx;letter-spacing:3rpx}.title{display:block;font-size:46rpx;font-weight:700;margin:18rpx 0}.sub{display:block;color:#7b8490;font-size:24rpx;line-height:1.7}.login{margin:40rpx 0 0;background:#2d6bff;color:#fff;border-radius:10rpx;font-size:28rpx}.logged{display:flex;flex-direction:column;gap:20rpx;margin-top:32rpx;font-size:26rpx}.message{display:block;color:#7b8490;font-size:22rpx;margin-top:20rpx;text-align:center}
</style>
