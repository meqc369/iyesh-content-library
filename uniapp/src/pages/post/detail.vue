<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { posts, type Post } from '../../data/posts'
import { createComment, createReply, createPointTip, getPointsSummary, getPost, mediaUrl, purchasePostWithPoints, reportComment, reportPost, toPost, toggleInteraction } from '../../api/client'
import { getAccessToken } from '../../api/auth'

type CommentItem = { id?: string; parentId?: string | null; author: string; content: string }
const post = ref<Post>(posts[0])
const comment = ref('')
const comments = ref<CommentItem[]>([{ author: '示例用户', content: '这套流程很适合拿来做第一次验证。' }])
const replyTarget = ref<string | null>(null)
const replyText = ref('')
const activeInteractions = ref<Record<string, boolean>>({})
const notFound = ref(false)
const title = computed(() => post.value.title)

onLoad(async (options) => {
  const id = String(options?.id || 'post_1')
  const found = posts.find(item => item.id === id)
  if (found) post.value = found
  try {
    const remote = await getPost(id)
    post.value = toPost(remote)
    if (Array.isArray(remote.comments)) comments.value = remote.comments.map((item: any) => ({ id: item.id, parentId: item.parentId, author: item.user?.name || '用户', content: item.content }))
  } catch (error) { if (String(error).includes('404')) notFound.value = true }
})

async function submitComment() {
  const content = comment.value.trim()
  if (!content) return
  try {
    const item = await createComment(post.value.id, content)
    comments.value.push({ id: item.id, parentId: item.parentId, author: item.user?.name || '当前用户', content: item.content })
  } catch (error) {
    if (String(error).includes('401')) { uni.showToast({ title: '请先登录后发表评论', icon: 'none' }); return }
    uni.showToast({ title: '评论发布失败，请稍后重试', icon: 'none' }); return
  }
  comment.value = ''
  uni.showToast({ title: '评论已发布', icon: 'none' })
}

function startReply(item: CommentItem) {
  replyTarget.value = item.id || null
  replyText.value = ''
}

async function submitReply() {
  const content = replyText.value.trim()
  if (!replyTarget.value || !content) return
  try {
    const item = await createReply(replyTarget.value, content)
    comments.value.push({ id: item.id, parentId: item.parentId, author: item.user?.name || '当前用户', content: item.content })
    replyTarget.value = null
    replyText.value = ''
    uni.showToast({ title: '回复已发布', icon: 'none' })
  } catch (error) {
    uni.showToast({ title: String(error).includes('401') ? '请先登录后回复' : '回复失败', icon: 'none' })
  }
}

async function interact(type: 'like' | 'favorite' | 'anchor') {
  const active = !activeInteractions.value[type]
  try {
    const result = await toggleInteraction(post.value.id, type, active)
    post.value.counts = [result.counts.anchors, result.counts.likes, result.counts.comments, result.counts.favorites]
    activeInteractions.value[type] = active
  } catch (error) { if (String(error).includes('401')) uni.showToast({ title: '请先登录后操作', icon: 'none' }) }
}

function accessType() { return post.value.accessType || 'free' }
function pricePoints() { return Number(post.value.pricePoints ?? post.value.priceCents ?? 0) }
function pointUnit() { return post.value.priceUnitName || '积分' }
function accessLabel() { return accessType() === 'member' ? `会员 · ${post.value.requiredPlanName || '专享'}` : accessType() === 'paid' ? `付费 · ${pricePoints()} ${pointUnit()}` : '免费' }
function openMembership() { uni.navigateTo({ url: '/pages/membership/index' }) }
async function buyPost() {
  if (!getAccessToken()) return uni.navigateTo({ url: '/pages/login/index' })
  try { await purchasePostWithPoints(post.value.id); uni.showToast({ title: '积分购买成功', icon: 'none' }); const remote = await getPost(post.value.id); post.value = toPost(remote) } catch (error) { uni.showToast({ title: error instanceof Error ? error.message : '积分购买失败', icon: 'none' }) }
}
function tipAuthor() {
  if (!getAccessToken()) return uni.navigateTo({ url: '/pages/login/index' })
  getPointsSummary().then(summary => {
    const unit = summary.unitName || summary.unit || '积分'
    uni.showModal({ title: `${unit}打赏`, editable: true, placeholderText: `输入${unit}（余额 ${summary.balance}）`, content: '10', success: async result => {
      if (!result.confirm) return
      const amountPoints = Number(result.content || 10)
      if (!Number.isInteger(amountPoints) || amountPoints <= 0) return uni.showToast({ title: `${unit}数量无效`, icon: 'none' })
      if (amountPoints > summary.balance) return uni.showToast({ title: `${unit}不足，当前余额 ${summary.balance}`, icon: 'none' })
      try {
        await createPointTip({ postId: post.value.id, amountPoints })
        uni.showToast({ title: `已用 ${amountPoints} ${unit}支持作者`, icon: 'none' })
      } catch (error) { uni.showToast({ title: error instanceof Error ? error.message : '积分打赏失败', icon: 'none' }) }
    }})
  }).catch(error => uni.showToast({ title: error instanceof Error ? error.message : '积分账户暂不可用', icon: 'none' }))
}
function reportCurrentPost() {
  if (!getAccessToken()) return uni.navigateTo({ url: '/pages/login/index' })
  uni.showModal({ title: '举报内容', editable: true, placeholderText: '请说明举报原因', content: '', success: async result => {
    if (!result.confirm || !String(result.content || '').trim()) return
    try { await reportPost(post.value.id, String(result.content).trim()); uni.showToast({ title: '举报已提交', icon: 'none' }) }
    catch (error) { uni.showToast({ title: error instanceof Error ? error.message : '举报失败', icon: 'none' }) }
  } })
}
function reportCurrentComment(item: CommentItem) {
  if (!item.id) return
  if (!getAccessToken()) return uni.navigateTo({ url: '/pages/login/index' })
  uni.showModal({ title: '举报评论', editable: true, placeholderText: '请说明举报原因', content: '', confirmText: '提交', success: async result => {
    if (!result.confirm || !String(result.content || '').trim()) return
    try { await reportComment(item.id!, String(result.content).trim()); uni.showToast({ title: '举报已提交', icon: 'none' }) }
    catch (error) { uni.showToast({ title: error instanceof Error ? error.message : '举报失败', icon: 'none' }) }
  } })
}
</script>

<template>
  <view class="page">
    <view v-if="notFound" class="article"><text class="not-found">内容不存在或已下线。</text></view>
    <view v-else class="article">
      <view class="post-top"><text class="tag">{{ post.platform }}</text><text>{{ post.author }}</text><text>·</text><text>{{ post.date }}</text></view>
      <text class="title">{{ title }}</text>
      <view class="access-row"><text class="access" :class="accessType()">{{ accessLabel() }}</text></view>
      <view class="tags"><text>{{ post.project }}</text><text>{{ post.skill }}</text></view>
      <image v-if="post.coverImage && !post.locked" class="cover" :src="mediaUrl(post.coverImage)" mode="aspectFill" />
      <view v-if="post.locked" class="paywall"><view><text class="paywall-title">{{ accessType() === 'member' ? '会员专享内容' : '积分购买后查看' }}</text><text class="paywall-sub">{{ accessType() === 'member' ? `开通${post.requiredPlanName || '会员'}即可阅读` : `需要 ${pricePoints()} ${pointUnit()}` }}</text></view><button @click="accessType() === 'member' ? openMembership() : buyPost()">{{ accessType() === 'member' ? '开通会员' : '立即购买' }}</button></view>
      <rich-text v-else class="body" :nodes="post.contentHtml || post.excerpt"></rich-text>
      <view class="metrics"><text>⚓ {{ post.counts[0] }}</text><text>♡ {{ post.counts[1] }}</text><text>◌ {{ post.counts[2] }}</text><text>☆ {{ post.counts[3] }}</text></view>
      <view class="actions"><button @click="interact('anchor')">投锚</button><button @click="interact('like')">点赞</button><button @click="interact('favorite')">收藏</button><button @click="tipAuthor">{{ pointUnit() }}打赏</button><button class="report" @click="reportCurrentPost">举报</button></view>
    </view>
    <view v-if="!notFound" class="comments">
      <text class="comment-title">评论 {{ comments.length }}</text>
      <view v-for="item in comments" :key="item.id || item.content" :class="['comment', { reply: item.parentId }]">
        <text class="author">{{ item.author }}</text><text class="content">{{ item.content }}</text>
        <view class="comment-actions"><button class="reply-button" @click="startReply(item)">回复</button><button v-if="item.id" class="report-button" @click="reportCurrentComment(item)">举报</button></view>
        <view v-if="replyTarget === item.id" class="reply-box"><textarea v-model="replyText" placeholder="写下你的回复" maxlength="500"/><button class="submit" @click="submitReply">发布回复</button></view>
      </view>
      <textarea v-model="comment" placeholder="写下你的评论" maxlength="500"/><button class="submit" @click="submitComment">发表评论</button>
    </view>
  </view>
</template>

<style scoped>
.page{padding:24rpx;background:#f7f8fa;min-height:100vh}.article,.comments{background:#fff;border:1px solid #e9edf1;border-radius:16rpx;padding:26rpx;margin-bottom:20rpx}.not-found{display:block;color:#7b8490;font-size:28rpx}.post-top,.metrics{display:flex;gap:14rpx;color:#7b8490;font-size:22rpx}.tag{color:#2d6bff;background:#eef3ff;padding:5rpx 10rpx;border-radius:6rpx}.access-row{margin:14rpx 0}.access{display:inline-block;padding:5rpx 10rpx;border-radius:6rpx;font-size:20rpx}.access.free{color:#378b5b;background:#eaf8ef}.access.member{color:#8a5a00;background:#fff4d9}.access.paid{color:#9b4a75;background:#fbeaf4}.cover{display:block;width:100%;height:360rpx;border-radius:12rpx;margin:18rpx 0;object-fit:cover}.paywall{display:flex;align-items:center;gap:18rpx;border:1px solid #f1dfb2;background:#fffaf0;border-radius:10rpx;padding:18rpx;margin:18rpx 0}.paywall view{display:flex;flex-direction:column;gap:4rpx}.paywall-title{font-size:26rpx;font-weight:600}.paywall-sub{font-size:22rpx;color:#9a8358}.paywall button{margin-left:auto;background:#2d6bff;color:#fff;border-radius:8rpx;font-size:22rpx;padding:10rpx 16rpx}.title{display:block;font-size:38rpx;line-height:1.4;font-weight:700;margin:20rpx 0}.tags{display:flex;gap:10rpx}.tags text{background:#f5f7fa;color:#687482;border-radius:6rpx;padding:5rpx 10rpx;font-size:20rpx}.body{display:block;color:#3c444d;font-size:28rpx;line-height:1.9;margin:24rpx 0}.metrics{color:#a0a7b0}.actions{display:flex;gap:12rpx;margin-top:18rpx;flex-wrap:wrap}.actions button{margin:0;background:#fff;border:1px solid #e9edf1;border-radius:8rpx;color:#596370;font-size:22rpx}.actions button.report{color:#a44949}.comment-title{display:block;font-size:28rpx;font-weight:600;margin-bottom:18rpx}.comment{border-top:1px solid #f1f3f5;padding:16rpx 0}.comment.reply{margin-left:24rpx;padding-left:14rpx;border-left:4rpx solid #dfe7ff}.author{display:block;font-size:24rpx;font-weight:600}.content{display:block;color:#596370;font-size:24rpx;margin-top:6rpx}.comment-actions{display:flex;gap:20rpx}.reply-button,.report-button{margin:10rpx 0 0;padding:0;background:transparent;color:#2d6bff;font-size:22rpx;text-align:left}.report-button{color:#a44949}.reply-box{margin-top:12rpx}textarea{width:100%;height:140rpx;border:1px solid #e9edf1;border-radius:10rpx;padding:14rpx;font-size:24rpx;box-sizing:border-box}.submit{background:#2d6bff;color:#fff;border-radius:8rpx;font-size:24rpx;margin-top:16rpx}
</style>
