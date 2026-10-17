<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { getMember, getMemberPlans } from '../../api/client'
import { getAccessToken } from '../../api/auth'

const plans = ref<any[]>([])
const status = ref('正在加载…')
const message = ref('')
const pointUnitName = ref('积分')
function benefits(plan: any): string[] {
  const values: string[] = []
  const permissionLabels: Record<string, string> = { 'content.member.read': '查看会员内容', 'content.read': '查看会员内容', 'content.download': '下载资料', 'content.publish': '发布内容', 'content.tip': `${plan.pointUnitName || pointUnitName.value}打赏`, 'community.private': '私享社区', 'support.priority': '优先客服' }
  const permissions = plan.permissions || plan.entitlements || plan.features
  if (Array.isArray(permissions)) values.push(...permissions.map((item: any) => { const code = typeof item === 'string' ? item : item.name || item.label; return permissionLabels[code] || code }).filter(Boolean))
  if (Array.isArray(plan.benefits)) values.push(...plan.benefits.map((item: any) => typeof item === 'string' ? item : item.name || item.label).filter(Boolean))
  const gift = Number(plan.giftPoints ?? plan.initialPoints ?? plan.bonusPoints ?? 0)
  if (gift > 0) values.push(`赠送 ${gift} ${plan.pointUnitName || pointUnitName.value}`)
  return values.slice(0, 6)
}
async function load() {
  try { plans.value = await getMemberPlans() } catch (error) { message.value = error instanceof Error ? error.message : '会员等级暂不可用' }
  try {
    const member = await getMember()
    const current = member.active || member.membership || member.member || null
    pointUnitName.value = member.points?.unitName || member.points?.unit || member.unitName || '积分'
    const points = member.pointsBalance ?? member.points?.balance ?? member.wallet?.balance
    status.value = current?.planName || current?.groupName ? `当前：${current.planName || current.groupName}${points == null ? '' : ` · ${Number(points)} ${pointUnitName.value}`}` : `当前为普通用户${points == null ? '' : ` · ${Number(points)} ${pointUnitName.value}`}`
  } catch { status.value = getAccessToken() ? '当前为普通用户' : '请先登录查看会员状态' }
}
function requestActivation(plan: any) {
  if (!getAccessToken()) return uni.navigateTo({ url: '/pages/login/index' })
  uni.showModal({ title: '线下开通会员', content: `请联系管理员开通「${plan.name || plan.groupName || '会员等级'}」。管理员确认收款后会手动绑定会员组和赠送积分。`, confirmText: '知道了', showCancel: false })
}
onMounted(load)
</script>

<template>
  <view class="page"><view class="hero"><text class="eyebrow">MEMBERSHIP</text><text class="title">会员中心</text><text class="sub">{{ status }}</text></view><view class="offline card"><view class="offline-badge">线下开通</view><view class="offline-copy"><text class="offline-title">管理员人工开通</text><text class="offline-sub">会员等级、权限和赠送积分由管理员确认收款后统一配置。</text></view></view><view v-if="message" class="message">{{ message }}</view><view v-for="plan in plans" :key="plan.id || plan.planId" class="plan"><view class="plan-head"><text class="name">{{ plan.name || plan.groupName || '会员等级' }}</text><text class="days">{{ plan.durationDays || 30 }} 天</text></view><text class="desc">{{ plan.description || '解锁会员专享内容和社区权益。' }}</text><view v-if="benefits(plan).length" class="benefits"><text v-for="item in benefits(plan)" :key="item">{{ item }}</text></view><text class="price">线下收款</text><button :disabled="['inactive', 'disabled', 'archived'].includes(String(plan.status || ''))" @click="requestActivation(plan)">{{ ['inactive', 'disabled', 'archived'].includes(String(plan.status || '')) ? '暂不可申请' : '联系管理员开通' }}</button></view><view v-if="!plans.length && !message" class="empty">暂无可申请的会员等级</view></view>
</template>

<style scoped>
.page{padding:32rpx;background:#f7f8fa;min-height:100vh}.hero{margin-bottom:24rpx}.eyebrow{display:block;color:#2d6bff;font-size:20rpx;letter-spacing:3rpx}.title{display:block;font-size:50rpx;font-weight:700;margin:10rpx 0}.sub,.message,.empty{display:block;color:#7b8490;font-size:24rpx}.offline{display:flex;align-items:center;gap:18rpx;margin-bottom:18rpx;padding:20rpx}.card{background:#fff;border:1px solid #e9edf1;border-radius:16rpx}.offline-badge{display:flex;align-items:center;justify-content:center;width:128rpx;height:72rpx;border-radius:12rpx;background:#fff4d9;color:#8a5a00;font-size:22rpx;font-weight:700;flex:none}.offline-copy{display:flex;flex-direction:column;gap:6rpx}.offline-title{font-size:27rpx;font-weight:700}.offline-sub{color:#7b8490;font-size:21rpx;line-height:1.5}.message{background:#fff;padding:20rpx;border-radius:14rpx;margin-bottom:16rpx}.plan{background:#fff;border:1px solid #e9edf1;border-radius:16rpx;padding:26rpx;margin-bottom:16rpx}.plan-head{display:flex;justify-content:space-between;align-items:center}.name{font-size:32rpx;font-weight:700}.days{color:#7b8490;font-size:22rpx}.desc{display:block;color:#7b8490;font-size:23rpx;margin:14rpx 0}.benefits{display:flex;flex-wrap:wrap;gap:8rpx}.benefits text{padding:6rpx 10rpx;background:#f4f7fb;color:#596370;border-radius:7rpx;font-size:20rpx}.price{display:block;font-size:32rpx;font-weight:700;margin-top:18rpx}.plan button{margin-top:18rpx;background:#fff4d9;color:#8a5a00;border:1px solid #edd59a;border-radius:8rpx;font-size:24rpx}.plan button[disabled]{background:#f1f3f5;color:#9aa3ad;border-color:#e9edf1}.empty{text-align:center;padding:60rpx}
</style>
