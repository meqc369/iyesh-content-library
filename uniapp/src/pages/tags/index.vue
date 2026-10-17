<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { onLoad, onReachBottom, onShow } from '@dcloudio/uni-app'
import { posts } from '../../data/posts'
import { createSavedFilter, deleteSavedFilter, getSavedFilters, searchPosts } from '../../api/client'
import { getCurrentUser } from '../../api/auth'

type Group = 'platform' | 'project' | 'skill'
const groups: Record<Group, string[]> = {
  platform: ['全部', '小红书', '视频号', '公众号', '抖音', '微信', '闲鱼', 'YouTube', 'TikTok', 'X', 'Reddit', 'B站'],
  project: ['全部', '出海', '自媒体', '垂直小号', 'AI产品开发', '电商', 'AI自媒体', 'AI短剧', '虚拟产品', 'IP'],
  skill: ['全部', 'AI', 'AI视频', '生财认知', 'AI编程', 'AI工作流', 'Codex', 'AI写作', 'Claude Code', 'Gemini']
}
const selected = ref<Record<Group, string>>({ platform: '全部', project: '全部', skill: '全部' })
const tab = ref('hot')
const date = ref('all')
const sort = ref('latest')
const mode = ref('normal')
const keyword = ref('')
const loading = ref(false)
let pendingReload = false
const remoteTotal = ref<number | null>(null)
const nextCursor = ref<string | null>(null)
const items = ref([...posts])
const saved = ref<Array<{ id?: string; name: string; value: Record<string, string> }>>([])
const toast = ref('')
const apiError = ref('')
const currentUser = ref(getCurrentUser())
const dateValues = ['all', 'yesterday', '3d', '7d', 'month', 'last-month', '3month']
const sortValues = ['latest', 'oldest', 'favorites', 'comments', 'likes', 'anchors', 'anchor-latest']
const modeValues = ['normal', 'compact', 'streamline']

const visiblePosts = computed(() => {
  const needle = keyword.value.trim().toLowerCase()
  let list = items.value.filter(post => (selected.value.platform === '全部' || post.platform === selected.value.platform) && (selected.value.project === '全部' || post.project === selected.value.project) && (selected.value.skill === '全部' || post.skill === selected.value.skill) && (!needle || [post.title, post.excerpt, post.author, post.platform, post.project, post.skill].some(value => value.toLowerCase().includes(needle))))
  const range = getDateRange(date.value)
  if (range.dateStart) list = list.filter(post => { const timestamp = post.publishedAt ? new Date(post.publishedAt).getTime() : Number.NaN; return Number.isFinite(timestamp) && timestamp >= new Date(range.dateStart!).getTime() && timestamp <= new Date(range.dateEnd!).getTime() })
  if (tab.value === 'digest') list = list.filter(post => post.digest)
  if (sort.value === 'oldest') list = [...list].reverse()
  if (sort.value === 'likes') list = [...list].sort((a, b) => b.counts[1] - a.counts[1])
  if (sort.value === 'comments') list = [...list].sort((a, b) => b.counts[2] - a.counts[2])
  if (sort.value === 'favorites') list = [...list].sort((a, b) => b.counts[3] - a.counts[3])
  if (sort.value === 'anchors') list = [...list].sort((a, b) => b.counts[0] - a.counts[0])
  if (sort.value === 'anchor-latest') list = [...list].sort((a, b) => b.counts[0] - a.counts[0])
  return list
})

function choose(group: Group, value: string) { selected.value[group] = value }
async function saveCurrent() {
  if (saved.value.length >= 7) return showToast('最多保存 7 组常用筛选')
  const values = Object.values(selected.value).filter(item => item !== '全部')
  const name = values.length ? values.join(' · ') : '全部内容'; const value = { ...selected.value, keyword: keyword.value, tab: tab.value, date: date.value, sort: sort.value, mode: mode.value }
  try { const remote = await createSavedFilter(name, value); saved.value.push({ id: remote.id, name: remote.name, value: remote.filter }) } catch (error) { if (String(error).includes('401')) return showToast('请先登录后保存常用筛选'); saved.value.push({ name, value }) }
  showToast('已保存为常用筛选')
}
function applySaved(item: { value: Record<string, string> }) {
  selected.value = { platform: item.value.platform || '全部', project: item.value.project || '全部', skill: item.value.skill || '全部' }
  keyword.value = item.value.keyword || ''
  tab.value = item.value.tab || 'hot'; date.value = item.value.date || 'all'; sort.value = item.value.sort || 'latest'; mode.value = item.value.mode || 'normal'
}
function clear() { selected.value = { platform: '全部', project: '全部', skill: '全部' }; tab.value = 'hot'; date.value = 'all'; sort.value = 'latest'; mode.value = 'normal'; keyword.value = '' }
function showToast(message: string) { toast.value = message; setTimeout(() => { toast.value = '' }, 1800) }
async function clearSaved() { const current = [...saved.value]; saved.value = []; await Promise.all(current.filter(item => item.id).map(item => deleteSavedFilter(item.id!))).catch(() => {}); showToast('常用筛选已清空') }
function openPost(id: string) { uni.navigateTo({ url: `/pages/post/detail?id=${id}` }) }
function openLogin() { uni.navigateTo({ url: '/pages/login/index' }) }
function openProfile() { uni.switchTab({ url: '/pages/profile/index' }) }
function openPublish() { uni.navigateTo({ url: '/pages/publish/index' }) }
function openAccount() { currentUser.value ? openProfile() : openLogin() }
function accessLabel(post: any) { return post.accessType === 'member' ? `会员 · ${post.requiredPlanName || '专享'}` : post.accessType === 'paid' ? `付费 · ${Number(post.pricePoints ?? post.priceCents ?? 0)} ${post.priceUnitName || '积分'}` : '免费' }
onLoad((options) => {
  const platform = ({ '387806': 'YouTube' } as Record<string, string>)[String(options?.platformId || '')] || String(options?.platform || '')
  if (platform) selected.value.platform = platform
  if (options?.project) selected.value.project = String(options.project)
  if (options?.skill) selected.value.skill = String(options.skill)
  if (['hot', 'digest', 'all'].includes(String(options?.tab || ''))) tab.value = String(options?.tab)
  if (options?.keyword) keyword.value = String(options.keyword)
  if (dateValues.includes(String(options?.date || ''))) date.value = String(options.date)
  if (sortValues.includes(String(options?.sort || ''))) sort.value = String(options.sort)
  if (modeValues.includes(String(options?.mode || ''))) mode.value = String(options.mode)
})
function getDateRange(value: string) {
  if (value === 'all') return {}
  const end = new Date(); end.setHours(23, 59, 59, 999)
  const start = new Date(end)
  if (value === 'yesterday') { start.setDate(start.getDate() - 1); start.setHours(0, 0, 0, 0); end.setDate(end.getDate() - 1); end.setHours(23, 59, 59, 999) }
  if (value === '3d') start.setDate(start.getDate() - 2)
  if (value === '7d') start.setDate(start.getDate() - 6)
  if (value === 'month') start.setMonth(start.getMonth() - 1)
  if (value === '3month') start.setMonth(start.getMonth() - 3)
  if (value === 'last-month') { const currentMonth = start.getMonth(); start.setMonth(currentMonth - 1, 1); start.setHours(0, 0, 0, 0); end.setDate(0); end.setHours(23, 59, 59, 999) }
  return { dateStart: start.toISOString(), dateEnd: end.toISOString() }
}
async function loadRemote(reset = true) {
  if (loading.value) { pendingReload = true; return }
  loading.value = true
  try {
    const response = await searchPosts({ keyword: keyword.value, platformId: selected.value.platform, projectId: selected.value.project, skillId: selected.value.skill, tab: tab.value, sort: sort.value, pageSize: 20, cursor: reset ? null : nextCursor.value, ...getDateRange(date.value) })
    items.value = reset ? response.items : [...items.value, ...response.items]
    remoteTotal.value = response.total
    nextCursor.value = response.nextCursor
    apiError.value = ''
  } catch {
    remoteTotal.value = null
    nextCursor.value = null
    apiError.value = '网络暂时不可用，当前显示本地示例内容。'
  } finally {
    loading.value = false
    if (pendingReload) { pendingReload = false; loadRemote(true) }
  }
}
onMounted(loadRemote)
onMounted(async () => { try { const remote = await getSavedFilters(); saved.value = remote.map(item => ({ id: item.id, name: item.name, value: item.filter })) } catch {} })
onShow(() => { currentUser.value = getCurrentUser() })
watch([selected, tab, sort, date, keyword], () => loadRemote(true), { deep: true })
onReachBottom(() => { if (nextCursor.value && !loading.value) loadRemote(false) })
</script>

<template>
  <view class="page">
    <view class="hero"><view><text class="eyebrow">DISCOVER TOPICS</text><text class="title">内容检索</text><text class="sub">按平台、项目和技能，找到真正有用的经验。</text></view><view class="stat"><text class="stat-number">{{ remoteTotal ?? visiblePosts.length }}</text><text class="stat-label">篇相关内容</text><view class="hero-actions"><button class="login-link" @click="openAccount">{{ currentUser ? '我的' : '登录' }}</button><button class="publish-link" @click="openPublish">发布</button></view></view></view>
    <input v-model="keyword" class="search-input" placeholder="搜索标题、作者、标签" confirm-type="search" />
    <view class="filter-card"><view class="filter-head"><text class="section-title">筛选条件</text><view><button class="save" @click="saveCurrent">＋ 存为常用</button><button class="reset" @click="clear">清除筛选</button></view></view>
      <view v-for="(values, group) in groups" :key="group" class="filter-row"><text class="label">{{ group === 'platform' ? '平台' : group === 'project' ? '项目' : '技能' }}</text><scroll-view scroll-x class="chips"><button v-for="value in values" :key="value" class="chip" :class="{ selected: selected[group as Group] === value }" @click="choose(group as Group, value)">{{ value }}</button></scroll-view></view>
      <view class="summary">共 {{ remoteTotal ?? visiblePosts.length }} 篇相关内容</view>
    </view>
    <view class="toolbar"><view class="tabs"><button :class="{ active: tab === 'hot' }" @click="tab = 'hot'">热门</button><button :class="{ active: tab === 'digest' }" @click="tab = 'digest'">精华</button><button :class="{ active: tab === 'all' }" @click="tab = 'all'">全部</button></view><view class="selects"><picker :value="dateValues.indexOf(date)" :range="['不限','昨天','近3天','近7天','近一月','上月','近三月']" @change="date = dateValues[$event.detail.value]"><text>{{ date === 'all' ? '日期' : '日期已选' }}</text></picker><picker :value="sortValues.indexOf(sort)" :range="['最新发布','最早发布','最多收藏','最多评论','最多点赞','最多锚点','最新投锚']" @change="sort = sortValues[$event.detail.value]"><text>排序</text></picker><picker :value="modeValues.indexOf(mode)" :range="['常规','简洁','精简']" @change="mode = modeValues[$event.detail.value]"><text>阅读</text></picker></view></view>
    <view v-if="apiError" class="error-state"><text>{{ apiError }}</text><button @click="loadRemote(true)">重试</button></view>
    <view v-if="loading" class="loading">正在同步最新内容…</view>
    <view v-for="post in visiblePosts" :key="post.id" class="post-card" :class="mode" @click="openPost(post.id)"><view class="post-top"><text class="tag">{{ post.platform }}</text><text>{{ post.author }}</text><text>·</text><text>{{ post.date }}</text><text v-if="post.digest" class="digest">精华</text><text class="access" :class="post.accessType || 'free'">{{ accessLabel(post) }}</text></view><text class="post-title">{{ post.title }}</text><text v-if="mode !== 'streamline'" class="excerpt">{{ post.excerpt }}</text><view class="metrics"><text>⚓ {{ post.counts[0] }}</text><text>♡ {{ post.counts[1] }}</text><text>◌ {{ post.counts[2] }}</text><text>☆ {{ post.counts[3] }}</text></view></view>
    <view class="saved-card"><view class="saved-head"><text>我的常用 {{ saved.length }}/7</text><button @click="clearSaved">清空</button></view><view v-if="saved.length" class="saved-list"><button v-for="item in saved" :key="item.id || item.name" @click="applySaved(item)">{{ item.name }}</button></view><text v-else class="empty">暂无常用筛选哦～</text></view>
    <view v-if="toast" class="toast">{{ toast }}</view>
  </view>
</template>

<style scoped>
.page{padding:32rpx;background:#f7f8fa;min-height:100vh;color:#20252b}.hero{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:28rpx}.eyebrow{display:block;color:#2d6bff;font-size:20rpx;letter-spacing:3rpx}.title{display:block;font-size:56rpx;font-weight:700;margin:10rpx 0}.sub{display:block;color:#7b8490;font-size:24rpx}.stat{text-align:right}.stat-number{display:block;font-size:44rpx;font-weight:700}.stat-label{color:#7b8490;font-size:20rpx}.hero-actions{display:flex;justify-content:flex-end;gap:14rpx}.login-link,.publish-link{background:none;color:#2d6bff;font-size:22rpx;padding:8rpx 0 0;margin:0}.publish-link{color:#596370}.search-input{background:#fff;border:1px solid #e9edf1;border-radius:40rpx;padding:18rpx 24rpx;margin-bottom:22rpx;font-size:24rpx}.filter-card,.post-card,.saved-card{background:#fff;border:1px solid #e9edf1;border-radius:16rpx}.filter-card{padding:22rpx;margin-bottom:24rpx}.filter-head,.saved-head,.toolbar{display:flex;justify-content:space-between;align-items:center}.section-title{font-weight:700}.save,.reset,.saved-head button{background:none;color:#2d6bff;font-size:22rpx;padding:0 10rpx}.reset,.saved-head button{color:#7b8490}.filter-row{display:flex;align-items:flex-start;border-top:1px solid #f1f3f5;padding:18rpx 0}.label{width:90rpx;color:#7b8490;padding-top:10rpx}.chips{white-space:nowrap;flex:1}.chip{display:inline-block;background:none;color:#596370;font-size:22rpx;border-radius:10rpx;padding:8rpx 18rpx;margin:0 8rpx 8rpx 0}.chip.selected{background:#eef3ff;color:#2d6bff;font-weight:600}.summary{border-top:1px solid #f1f3f5;padding-top:18rpx;color:#7b8490;font-size:22rpx}.toolbar{margin-bottom:20rpx}.tabs button{background:none;color:#7b8490;padding:12rpx 20rpx;font-size:26rpx}.tabs button.active{color:#20252b;font-weight:700;border-bottom:4rpx solid #2d6bff}.selects{display:flex;gap:10rpx}.selects picker{background:#fff;border:1px solid #e9edf1;border-radius:8rpx;padding:10rpx 14rpx;color:#7b8490;font-size:20rpx}.post-card{padding:24rpx;margin-bottom:18rpx}.post-top,.metrics{display:flex;align-items:center;gap:14rpx;color:#7b8490;font-size:20rpx}.tag{color:#2d6bff;background:#eef3ff;padding:5rpx 10rpx;border-radius:6rpx}.digest{color:#f08a34;background:#fff1df;padding:5rpx 10rpx;border-radius:6rpx}.access{padding:5rpx 10rpx;border-radius:6rpx;font-size:18rpx}.access.free{color:#378b5b;background:#eaf8ef}.access.member{color:#8a5a00;background:#fff4d9}.access.paid{color:#9b4a75;background:#fbeaf4}.post-title{display:block;font-size:30rpx;font-weight:600;margin:16rpx 0 10rpx}.excerpt{display:block;color:#737c88;font-size:23rpx;margin-bottom:16rpx}.metrics{color:#a0a7b0}.streamline .post-title{font-size:26rpx;margin:10rpx 0}.saved-card{padding:24rpx;margin-top:24rpx}.saved-head{font-weight:600;margin-bottom:16rpx}.saved-list button{display:inline-block;background:#fafbfc;border:1px solid #e9edf1;border-radius:8rpx;color:#67717d;font-size:20rpx;padding:10rpx;margin:0 10rpx 10rpx 0}.empty,.loading{color:#a0a7b0;font-size:22rpx}.loading{display:block;text-align:center;padding:20rpx}.error-state{display:flex;justify-content:space-between;align-items:center;background:#fff7e7;color:#8a5a00;border-radius:10rpx;padding:14rpx 18rpx;margin:-4rpx 0 18rpx;font-size:21rpx}.error-state button{background:none;color:#2d6bff;font-size:21rpx;padding:0}.toast{position:fixed;left:50%;bottom:50rpx;transform:translateX(-50%);background:#20252b;color:#fff;border-radius:10rpx;padding:18rpx 26rpx;font-size:22rpx}
</style>
