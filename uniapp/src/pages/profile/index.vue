<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { clearSession, getAccessToken, getCurrentUser } from '../../api/auth'
import { archivePost, getMember, getMyPosts, getNotifications, getOrders, getPointLedger, getPointsSummary, getProfile, markNotificationRead, updateProfile } from '../../api/client'

type Submission = { id: string; title: string; status?: string; createdAt?: string; submittedAt?: string; rejectionReason?: string | null }

const signedIn = ref(Boolean(getAccessToken()))
const profile = ref<any>(getCurrentUser() || { name: '', nickname: '', avatarUrl: '', bio: '', city: '', website: '' })
const membership = ref<any>(null)
const orders = ref<any[]>([])
const notifications = ref<any[]>([])
const unread = ref(0)
const submissions = ref<Submission[]>([])
const points = ref<any>({ balance: 0, unit: '积分' })
const pointLedger = ref<any[]>([])
const loading = ref(false)
const saving = ref(false)
const editing = ref(false)
const errorMessage = ref('')
const statusMessage = ref('')

const displayName = computed(() => profile.value.nickname || profile.value.name || '内容库用户')
const memberLabel = computed(() => membership.value?.planName || membership.value?.groupName || '普通用户')
const pointBalance = computed(() => Number(points.value?.balance || 0))
const pointUnit = computed(() => points.value?.unitName || points.value?.unit || '积分')
const pendingSubmissions = computed(() => submissions.value.filter(item => item.status === 'pending').length)

function readSubmissions() {
  const stored = uni.getStorageSync('mySubmissions')
  submissions.value = Array.isArray(stored) ? stored : []
}

function persistSubmissions(next: Submission[]) {
  submissions.value = next
  uni.setStorageSync('mySubmissions', next.slice(0, 30))
}

function formatDate(value: string | undefined) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('zh-CN')
}

function orderLabel(order: any) {
  return order.status === 'paid' ? '已支付' : order.status === 'cancelled' ? '已取消' : order.status === 'expired' ? '已过期' : order.status === 'refunded' ? '已退款' : '待支付'
}

async function load() {
  signedIn.value = Boolean(getAccessToken())
  readSubmissions()
  if (!signedIn.value) return
  loading.value = true
  errorMessage.value = ''
  const results = await Promise.allSettled([getProfile(), getMember(), getOrders(), getNotifications(), getMyPosts(), getPointsSummary(), getPointLedger()])
  const [profileResult, memberResult, orderResult, notificationResult, postsResult, pointsResult, ledgerResult] = results
  if (profileResult.status === 'fulfilled') profile.value = profileResult.value.profile || profileResult.value.user || profileResult.value
  if (memberResult.status === 'fulfilled') membership.value = memberResult.value.active || memberResult.value.membership || memberResult.value.member || null
  if (orderResult.status === 'fulfilled') orders.value = orderResult.value
  if (notificationResult.status === 'fulfilled') {
    notifications.value = notificationResult.value.items || []
    unread.value = Number(notificationResult.value.unread || notifications.value.filter(item => !item.readAt).length)
  }
  if (pointsResult.status === 'fulfilled') points.value = pointsResult.value
  if (ledgerResult.status === 'fulfilled') pointLedger.value = ledgerResult.value
  if (postsResult.status === 'fulfilled') {
    const remote = postsResult.value.map((item: any) => ({ id: item.id, title: item.title, status: item.status, submittedAt: item.submittedAt, rejectionReason: item.rejectionReason }))
    persistSubmissions(remote)
  }
  if (results.every(result => result.status === 'rejected')) errorMessage.value = '个人中心暂时无法加载，请稍后重试'
  loading.value = false
}

async function save() {
  const name = String(profile.value.nickname || profile.value.name || '').trim()
  if (!name) return uni.showToast({ title: '昵称不能为空', icon: 'none' })
  saving.value = true
  try {
    const result = await updateProfile({ name, nickname: name, bio: profile.value.bio, city: profile.value.city, website: profile.value.website, avatarUrl: profile.value.avatarUrl })
    profile.value = result.profile || profile.value
    uni.setStorageSync('currentUser', { ...getCurrentUser(), ...profile.value })
    editing.value = false
    statusMessage.value = '资料已保存'
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '保存失败', icon: 'none' })
  } finally { saving.value = false }
}

async function readNotification(item: any) {
  if (!item.readAt && item.id) {
    try { await markNotificationRead(item.id); item.readAt = new Date().toISOString(); unread.value = Math.max(0, unread.value - 1) } catch {}
  }
  if (item.targetType === 'post' && item.targetId) uni.navigateTo({ url: `/pages/post/detail?id=${encodeURIComponent(item.targetId)}` })
}

function openLogin() { uni.navigateTo({ url: '/pages/login/index' }) }
function openPublish() { uni.navigateTo({ url: '/pages/publish/index' }) }
function editSubmission(item: Submission) { uni.navigateTo({ url: `/pages/publish/index?id=${encodeURIComponent(item.id)}` }) }
function archiveSubmission(item: Submission) {
  uni.showModal({ title: '删除草稿', content: '删除后将无法恢复，确定继续吗？', confirmText: '删除', confirmColor: '#a44949', success: async result => {
    if (!result.confirm) return
    try { await archivePost(item.id); persistSubmissions(submissions.value.filter(candidate => candidate.id !== item.id)); uni.showToast({ title: '草稿已删除', icon: 'none' }) }
    catch (error) { uni.showToast({ title: error instanceof Error ? error.message : '删除失败', icon: 'none' }) }
  } })
}
function openMembership() { uni.switchTab({ url: '/pages/membership/index' }) }
function openPoints() { uni.showToast({ title: `当前余额 ${pointBalance.value} ${pointUnit.value}`, icon: 'none' }) }
function logout() {
  clearSession()
  signedIn.value = false
  membership.value = null
  orders.value = []
  notifications.value = []
  unread.value = 0
  uni.showToast({ title: '已退出登录', icon: 'none' })
}

onShow(load)
</script>

<template>
  <view class="page">
    <view v-if="!signedIn" class="guest card">
      <text class="eyebrow">YOUR SPACE</text>
      <text class="title">登录后管理你的内容</text>
      <text class="sub">发布投稿、查看审核状态、接收评论和订单通知。</text>
      <button class="primary" @click="openLogin">微信登录</button>
    </view>

    <template v-else>
      <view class="profile-card card">
        <view class="profile-head">
          <view class="avatar">{{ displayName.slice(0, 1) }}</view>
          <view class="identity"><text class="name">{{ displayName }}</text><text class="member">{{ memberLabel }}</text></view>
          <button class="edit" @click="editing = !editing">{{ editing ? '取消' : '编辑' }}</button>
        </view>
        <view v-if="!editing" class="bio"><text>{{ profile.bio || '还没有填写个人简介。' }}</text><text v-if="profile.city || profile.website">{{ [profile.city, profile.website].filter(Boolean).join(' · ') }}</text></view>
        <view v-else class="form">
          <input v-model="profile.nickname" placeholder="昵称" maxlength="40" />
          <input v-model="profile.city" placeholder="所在城市（可选）" maxlength="40" />
          <input v-model="profile.website" placeholder="个人主页（可选）" maxlength="120" />
          <textarea v-model="profile.bio" placeholder="介绍一下自己（可选）" maxlength="500" />
          <button class="primary" :loading="saving" @click="save">保存资料</button>
        </view>
      </view>

      <view class="quick-grid">
        <view class="quick card" @click="openPublish"><text class="quick-number">＋</text><text>发布内容</text></view>
        <view class="quick card" @click="openMembership"><text class="quick-number">{{ memberLabel }}</text><text>会员权益</text></view>
        <view class="quick card" @click="openPoints"><text class="quick-number">{{ pointBalance }}</text><text>{{ pointUnit }}余额</text></view><view class="quick card"><text class="quick-number">{{ pendingSubmissions }}</text><text>待审核投稿</text></view>
        <view class="quick card"><text class="quick-number">{{ unread }}</text><text>未读通知</text></view>
      </view>

      <view v-if="errorMessage" class="notice error"><text>{{ errorMessage }}</text><button @click="load">重试</button></view>
      <view v-if="loading" class="loading">正在加载个人数据…</view>

      <view class="section card">
        <view class="section-head"><text class="section-title">通知</text><text class="count">{{ unread }} 条未读</text></view>
        <view v-if="notifications.length" v-for="item in notifications.slice(0, 6)" :key="item.id" class="notification" :class="{ unread: !item.readAt }" @click="readNotification(item)">
          <view class="dot" /><view class="notification-body"><text class="notification-title">{{ item.title }}</text><text class="notification-text">{{ item.body }}</text><text class="muted">{{ formatDate(item.createdAt) }}</text></view>
        </view>
        <text v-else class="empty">暂无通知，评论、订单和举报处理结果会显示在这里。</text>
      </view>

      <view class="section card points-section">
        <view class="section-head"><text class="section-title">{{ pointUnit }}账户</text><text class="count">管理员线下充值</text></view>
        <view class="points-balance"><text>{{ pointBalance }}</text><text>{{ pointUnit }}</text></view>
        <view v-if="pointLedger.length" v-for="item in pointLedger.slice(0, 6)" :key="item.id || item.createdAt" class="point-row"><view><text class="point-reason">{{ item.reason || item.type || `${pointUnit}变动` }}</text><text class="muted">{{ formatDate(item.createdAt) }}</text></view><text :class="['point-delta', { negative: Number(item.delta ?? item.amountPoints ?? item.points ?? 0) < 0 }]">{{ Number(item.delta ?? item.amountPoints ?? item.points ?? 0) > 0 ? '+' : '' }}{{ Number(item.delta ?? item.amountPoints ?? item.points ?? 0) }} {{ pointUnit }}</text></view>
        <text v-else class="empty">暂无积分流水，管理员充值后会显示记录。</text>
      </view>

      <view class="section card">
        <view class="section-head"><text class="section-title">我的投稿</text><button class="link" @click="openPublish">发布新内容</button></view>
        <view v-if="submissions.length" v-for="item in submissions.slice(0, 5)" :key="item.id" class="submission"><view><text class="submission-title">{{ item.title }}</text><text class="muted">{{ formatDate(item.submittedAt || item.createdAt) }}</text><text v-if="item.rejectionReason" class="rejection">{{ item.rejectionReason }}</text></view><view class="submission-side"><text class="status" :class="item.status">{{ item.status === 'published' ? '已发布' : item.status === 'rejected' ? '需修改' : item.status === 'draft' ? '草稿' : '审核中' }}</text><view v-if="item.status !== 'published' && item.status !== 'archived'" class="submission-actions"><button @click="editSubmission(item)">编辑</button><button @click="archiveSubmission(item)">删除</button></view></view></view>
        <text v-else class="empty">还没有投稿，分享一篇经验开始建立你的主页。</text>
      </view>

      <view class="section card">
        <view class="section-head"><text class="section-title">最近订单</text><text class="count">{{ orders.length }} 笔</text></view>
        <view v-if="orders.length" v-for="order in orders.slice(0, 5)" :key="order.id" class="order"><view><text class="order-title">{{ order.title || (order.kind === 'membership' ? '会员套餐' : order.kind === 'tip' ? `${pointUnit}打赏` : '内容购买') }}</text><text class="muted">{{ formatDate(order.createdAt) }}</text></view><view class="order-side"><text class="amount">{{ order.amountPoints != null ? `${Number(order.amountPoints || order.points || 0)} ${pointUnit}` : '线下登记' }}</text><text class="order-status">{{ orderLabel(order) }}</text></view></view>
        <text v-else class="empty">暂无订单</text>
      </view>

      <button class="logout" @click="logout">退出登录</button>
    </template>
  </view>
</template>

<style scoped>
.page{min-height:100vh;background:#f7f8fa;padding:30rpx 28rpx 60rpx;color:#20252b}.card{background:#fff;border:1px solid #e9edf1;border-radius:18rpx}.guest{padding:40rpx 30rpx}.eyebrow{display:block;color:#2d6bff;font-size:20rpx;letter-spacing:3rpx}.title{display:block;font-size:42rpx;font-weight:700;line-height:1.35;margin:16rpx 0}.sub{display:block;color:#7b8490;font-size:24rpx;line-height:1.7}.primary{background:#2d6bff;color:#fff;border-radius:10rpx;font-size:25rpx;margin-top:28rpx}.profile-card{padding:26rpx;margin-bottom:18rpx}.profile-head{display:flex;align-items:center}.avatar{width:86rpx;height:86rpx;line-height:86rpx;text-align:center;border-radius:50%;background:#e7efff;color:#2d6bff;font-size:38rpx;font-weight:700}.identity{display:flex;flex-direction:column;gap:8rpx;margin-left:18rpx;flex:1}.name{font-size:32rpx;font-weight:700}.member{align-self:flex-start;color:#8a5a00;background:#fff4d9;padding:5rpx 12rpx;border-radius:8rpx;font-size:20rpx}.edit,.link{background:none;color:#2d6bff;font-size:23rpx;padding:8rpx}.bio{display:flex;flex-direction:column;gap:8rpx;color:#687482;font-size:23rpx;line-height:1.6;margin-top:22rpx}.form{display:flex;flex-direction:column;gap:14rpx;margin-top:22rpx}.form input,.form textarea{box-sizing:border-box;width:100%;border:1px solid #e9edf1;border-radius:10rpx;padding:18rpx 20rpx;font-size:24rpx;background:#fafbfc}.form textarea{height:150rpx}.quick-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12rpx;margin-bottom:18rpx}.quick{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:126rpx;padding:12rpx 6rpx;box-sizing:border-box;color:#687482;font-size:20rpx}.quick-number{color:#20252b;font-size:25rpx;font-weight:700;margin-bottom:8rpx;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.section{padding:24rpx;margin-bottom:18rpx}.section-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:14rpx}.section-title{font-size:28rpx;font-weight:700}.count,.muted{color:#9aa3ad;font-size:20rpx}.notification,.submission,.order{display:flex;align-items:flex-start;border-top:1px solid #f1f3f5;padding:16rpx 0}.notification{cursor:pointer}.notification.unread .notification-title{font-weight:700}.dot{width:12rpx;height:12rpx;border-radius:50%;background:transparent;margin:9rpx 14rpx 0 0;flex:none}.unread .dot{background:#2d6bff}.notification-body{display:flex;flex-direction:column;gap:6rpx;min-width:0;flex:1}.notification-title,.submission-title,.order-title{font-size:24rpx;font-weight:600}.notification-text{color:#687482;font-size:22rpx;line-height:1.5}.submission{justify-content:space-between;align-items:center}.submission>view,.order>view{display:flex;flex-direction:column;gap:6rpx;min-width:0}.submission-title,.order-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:440rpx}.rejection{display:block;color:#a44949;font-size:20rpx;line-height:1.4;max-width:440rpx}.submission-side{align-items:flex-end;display:flex;flex-direction:column;gap:8rpx;flex:none}.submission-actions{display:flex;gap:12rpx}.submission-actions button{background:none;color:#2d6bff;font-size:20rpx;padding:0}.submission-actions button:last-child{color:#a44949}.status{padding:6rpx 12rpx;border-radius:8rpx;font-size:20rpx}.status.pending{color:#8a5a00;background:#fff4d9}.status.draft{color:#687482;background:#f1f3f5}.status.published{color:#378b5b;background:#eaf8ef}.status.rejected{color:#a44949;background:#fff0f0}.order{justify-content:space-between}.order-side{align-items:flex-end}.amount{font-size:24rpx;font-weight:600}.order-status{color:#7b8490;font-size:20rpx}.empty,.loading{display:block;color:#9aa3ad;font-size:22rpx;line-height:1.6}.notice{display:flex;justify-content:space-between;align-items:center;padding:16rpx 20rpx;border-radius:10rpx;margin-bottom:18rpx;font-size:22rpx}.notice.error{background:#fff0f0;color:#a44949}.notice button{background:none;color:#2d6bff;font-size:22rpx}.points-section{padding-bottom:18rpx}.points-balance{display:flex;align-items:baseline;gap:10rpx;margin:4rpx 0 12rpx}.points-balance text:first-child{font-size:44rpx;font-weight:700}.points-balance text:last-child{color:#7b8490;font-size:22rpx}.point-row{display:flex;justify-content:space-between;align-items:center;border-top:1px solid #f1f3f5;padding:14rpx 0}.point-row>view{display:flex;flex-direction:column;gap:6rpx}.point-reason{font-size:23rpx}.point-delta{font-size:23rpx;color:#2d6bff}.point-delta.negative{color:#a44949}.logout{background:#fff;color:#a44949;border:1px solid #f1d7d7;border-radius:10rpx;font-size:24rpx;margin-top:8rpx}.toast{position:fixed;left:50%;bottom:50rpx;transform:translateX(-50%);background:#20252b;color:#fff;border-radius:10rpx;padding:18rpx 26rpx;font-size:22rpx}
@media (max-width: 390px){.quick-grid{grid-template-columns:repeat(2,1fr)}.submission-title,.order-title{max-width:330rpx}}
</style>
