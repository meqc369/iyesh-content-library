<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { getAccessToken } from '../../api/auth'
import { createPost, getMyPost, mediaUrl, type UploadedMedia, updatePost, uploadImage } from '../../api/client'

const platforms = ['小红书', '视频号', '公众号', '抖音', 'YouTube', 'TikTok', 'X', 'B站', '其他']
const projects = ['出海', '自媒体', '垂直小号', 'AI产品开发', '电商', 'AI自媒体', 'AI短剧', '虚拟产品', 'IP', '其他']
const skills = ['AI', 'AI视频', 'AI编程', 'AI工作流', 'Codex', 'AI写作', 'Claude Code', 'Gemini', '其他']
const accessOptions = ['免费公开', '会员专享', '付费阅读']
const accessValues: Array<'free' | 'member' | 'paid'> = ['free', 'member', 'paid']
const title = ref('')
const excerpt = ref('')
const content = ref('')
const platform = ref('小红书')
const project = ref('自媒体')
const skill = ref('AI')
const accessType = ref<'free' | 'member' | 'paid'>('free')
const price = ref('100')
const submitting = ref(false)
const submitted = ref<any>(null)
const errorMessage = ref('')
const editingId = ref('')
const coverImage = ref<UploadedMedia | null>(null)
const bodyImages = ref<UploadedMedia[]>([])
const uploadingMedia = ref(false)
const uploadError = ref('')
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_BODY_IMAGES = 8

const accessIndex = computed(() => accessValues.indexOf(accessType.value))

function choose(values: string[], index: number) { return values[index] || values[0] }
function requireLogin() { if (getAccessToken()) return true; uni.showModal({ title: '需要登录', content: '登录后才能发布内容。', confirmText: '去登录', success: result => { if (result.confirm) uni.navigateTo({ url: '/pages/login/index' }) } }); return false }
function chooseImages(count: number): Promise<any> {
  return new Promise((resolve, reject) => uni.chooseImage({ count, sizeType: ['compressed', 'original'], sourceType: ['album', 'camera'], success: resolve, fail: reject }))
}
function chosenFiles(result: any): Array<{ path: string; size?: number; name?: string }> {
  if (Array.isArray(result?.tempFiles) && result.tempFiles.length) return result.tempFiles.map((file: any) => ({ path: file.path, size: file.size, name: file.name }))
  return (result?.tempFilePaths || []).map((path: string) => ({ path }))
}
function checkImage(file: { path: string; size?: number }) {
  if (file.size && file.size > MAX_IMAGE_BYTES) { uni.showToast({ title: '单张图片不能超过 5MB', icon: 'none' }); return false }
  return true
}
async function chooseCover() {
  if (uploadingMedia.value || !requireLogin()) return
  try {
    const file = chosenFiles(await chooseImages(1))[0]
    if (!file || !checkImage(file)) return
    uploadingMedia.value = true; uploadError.value = ''
    coverImage.value = await uploadImage(file.path, file.name || 'cover.jpg')
  } catch (error) { uploadError.value = error instanceof Error ? error.message : '封面上传失败，请重试' } finally { uploadingMedia.value = false }
}
async function chooseBodyImages() {
  if (uploadingMedia.value || !requireLogin()) return
  const remaining = MAX_BODY_IMAGES - bodyImages.value.length
  if (remaining <= 0) return uni.showToast({ title: `正文配图最多 ${MAX_BODY_IMAGES} 张`, icon: 'none' })
  try {
    const files = chosenFiles(await chooseImages(remaining)).filter(checkImage)
    if (!files.length) return
    uploadingMedia.value = true; uploadError.value = ''
    for (const file of files) bodyImages.value.push(await uploadImage(file.path, file.name || 'image.jpg'))
  } catch (error) { uploadError.value = error instanceof Error ? error.message : '配图上传失败，请重试' } finally { uploadingMedia.value = false }
}
function removeCover() { coverImage.value = null }
function removeBodyImage(index: number) { bodyImages.value.splice(index, 1) }
function previewImage(url: string) {
  const urls = [coverImage.value, ...bodyImages.value].filter(Boolean).map(item => mediaUrl((item as UploadedMedia).url))
  uni.previewImage({ current: mediaUrl(url), urls })
}
function rememberSubmission(post: any) {
  const stored = uni.getStorageSync('mySubmissions'); const list = Array.isArray(stored) ? stored : []
  const next = { id: post.id, title: post.title, status: post.status || 'pending', submittedAt: post.submittedAt || new Date().toISOString(), rejectionReason: post.rejectionReason || null }
  const existing = list.findIndex((item: any) => item.id === post.id)
  if (existing >= 0) list.splice(existing, 1)
  list.unshift(next)
  uni.setStorageSync('mySubmissions', list.slice(0, 30))
}
async function submit() {
  if (!requireLogin()) return
  const cleanTitle = title.value.trim(); const cleanExcerpt = excerpt.value.trim(); const cleanContent = content.value.trim()
  if (cleanTitle.length < 4) return uni.showToast({ title: '标题至少 4 个字', icon: 'none' })
  if (!cleanExcerpt && !cleanContent) return uni.showToast({ title: '请填写摘要或正文', icon: 'none' })
  if (accessType.value === 'paid' && (!Number.isInteger(Number(price.value)) || Number(price.value) <= 0)) return uni.showToast({ title: '请填写有效积分价格', icon: 'none' })
  submitting.value = true; errorMessage.value = ''
  try {
    const payload = { title: cleanTitle, excerpt: cleanExcerpt, content: cleanContent, platform: platform.value, project: project.value, skill: skill.value, accessType: accessType.value, pricePoints: accessType.value === 'paid' ? Math.round(Number(price.value)) : 0, coverImage: coverImage.value?.url || null, images: bodyImages.value.map(image => image.url), status: 'pending' as const }
    const post = editingId.value ? await updatePost(editingId.value, payload) : await createPost(payload)
    submitted.value = post; rememberSubmission(post); uni.showToast({ title: '已提交审核', icon: 'none' })
  } catch (error) { errorMessage.value = error instanceof Error ? error.message : '提交失败，请稍后重试' } finally { submitting.value = false }
}
async function saveDraft() {
  if (!requireLogin()) return
  const cleanTitle = title.value.trim()
  if (!cleanTitle) return uni.showToast({ title: '请先填写草稿标题', icon: 'none' })
  submitting.value = true; errorMessage.value = ''
  try {
    const payload = { title: cleanTitle, excerpt: excerpt.value.trim(), content: content.value.trim(), platform: platform.value, project: project.value, skill: skill.value, accessType: accessType.value, pricePoints: accessType.value === 'paid' ? Math.max(0, Math.round(Number(price.value))) : 0, coverImage: coverImage.value?.url || null, images: bodyImages.value.map(image => image.url), status: 'draft' as const }
    const post = editingId.value ? await updatePost(editingId.value, payload) : await createPost({ ...payload, draft: true })
    submitted.value = post; rememberSubmission(post); uni.showToast({ title: '草稿已保存', icon: 'none' })
  } catch (error) { errorMessage.value = error instanceof Error ? error.message : '保存失败，请稍后重试' } finally { submitting.value = false }
}
function openProfile() { uni.switchTab({ url: '/pages/profile/index' }) }
function reset() { title.value = ''; excerpt.value = ''; content.value = ''; platform.value = '小红书'; project.value = '自媒体'; skill.value = 'AI'; accessType.value = 'free'; price.value = '100'; coverImage.value = null; bodyImages.value = []; submitted.value = null; errorMessage.value = ''; uploadError.value = ''; editingId.value = '' }
onLoad(async options => {
  const id = String(options?.id || '')
  if (!id || !getAccessToken()) return
  editingId.value = id
  try {
    const post = await getMyPost(id)
    title.value = post.title || ''; excerpt.value = post.excerpt || ''; content.value = post.content || ''
    platform.value = platforms.includes(post.platform) ? post.platform : '其他'; project.value = projects.includes(post.project) ? post.project : '其他'; skill.value = skills.includes(post.skill) ? post.skill : '其他'
    accessType.value = ['free', 'member', 'paid'].includes(post.accessType) ? post.accessType : 'free'; price.value = String(Number(post.pricePoints ?? post.priceCents ?? 0))
    coverImage.value = post.coverImage ? { url: String(post.coverImage) } : null
    bodyImages.value = Array.isArray(post.images) ? post.images.map((url: any) => ({ url: String(url) })) : []
  } catch (error) { errorMessage.value = error instanceof Error ? error.message : '投稿加载失败' }
})
</script>

<template>
  <view class="page">
    <view class="hero"><text class="eyebrow">SHARE YOUR PLAYBOOK</text><text class="title">发布内容</text><text class="sub">提交后会进入审核，通过后展示在内容检索和你的主页。</text></view>
    <view v-if="submitted" class="success card"><text class="success-title">{{ submitted.status === 'draft' ? '草稿已保存' : '已提交，等待审核' }}</text><text class="success-sub">{{ submitted.status === 'draft' ? '草稿只对你可见，你可以回个人中心继续整理。' : '审核通过后，其他用户才能看到这篇内容。你可以先回个人中心查看状态。' }}</text><view class="success-actions"><button class="primary" @click="openProfile">查看投稿状态</button><button class="secondary" @click="reset">继续发布</button></view></view>
    <view v-else class="form card">
      <view class="field"><text class="label">标题 <text class="required">*</text></text><input v-model="title" maxlength="120" placeholder="一句话说清楚这篇内容能解决什么问题" /></view>
      <view class="field"><text class="label">摘要</text><textarea v-model="excerpt" maxlength="1200" placeholder="用 1-3 句话介绍内容价值，帮助读者决定是否阅读"></textarea><text class="counter">{{ excerpt.length }}/1200</text></view>
      <view class="field"><text class="label">正文</text><textarea v-model="content" class="content" maxlength="200000" placeholder="分享你的方法、步骤、数据或复盘。支持纯文本和换行。"></textarea><text class="counter">{{ content.length }}/200000</text></view>
      <view class="field media-field"><view class="media-head"><view><text class="label">图片素材</text><text class="media-hint">封面图和正文配图会在审核通过后展示</text></view><text class="media-limit">JPG / PNG / WEBP / GIF · 单张 ≤ 5MB</text></view><view class="media-grid"><view v-if="coverImage" class="media-item"><image class="media-thumb" :src="mediaUrl(coverImage.url)" mode="aspectFill" @click="previewImage(coverImage.url)"/><view class="remove-media" @click="removeCover">×</view><text class="media-caption">封面图</text></view><view v-else class="upload-tile" @click="chooseCover"><text class="upload-plus">＋</text><text class="upload-title">上传封面图</text><text class="upload-sub">建议 16:9</text></view><view v-for="(image, index) in bodyImages" :key="image.url" class="media-item"><image class="media-thumb" :src="mediaUrl(image.url)" mode="aspectFill" @click="previewImage(image.url)"/><view class="remove-media" @click="removeBodyImage(index)">×</view><text class="media-caption">正文配图 {{ index + 1 }}</text></view><view class="upload-tile body-tile" @click="chooseBodyImages"><text class="upload-plus">＋</text><text class="upload-title">添加正文配图</text><text class="upload-sub">最多 {{ MAX_BODY_IMAGES }} 张</text></view></view><text v-if="uploadingMedia" class="upload-state">图片上传中，请稍候…</text><text v-if="uploadError" class="upload-error">{{ uploadError }}</text></view>
      <view class="field"><text class="label">分类</text><view class="picker-row"><picker :value="platforms.indexOf(platform)" :range="platforms" @change="platform = choose(platforms, $event.detail.value)"><view class="picker">平台：{{ platform }}</view></picker><picker :value="projects.indexOf(project)" :range="projects" @change="project = choose(projects, $event.detail.value)"><view class="picker">项目：{{ project }}</view></picker><picker :value="skills.indexOf(skill)" :range="skills" @change="skill = choose(skills, $event.detail.value)"><view class="picker">技能：{{ skill }}</view></picker></view></view>
      <view class="field"><text class="label">阅读权限</text><picker :value="accessIndex" :range="accessOptions" @change="accessType = accessValues[$event.detail.value]"><view class="picker wide">{{ accessOptions[accessIndex] }}</view></picker><text class="hint">免费内容公开展示；会员和付费内容会在审核通过后按权限展示。</text></view>
      <view v-if="accessType === 'paid'" class="field"><text class="label">单篇价格（积分）</text><input v-model="price" type="number" maxlength="10" placeholder="例如 100" /></view>
      <view v-if="errorMessage" class="error">{{ errorMessage }} <button @click="submit">重试</button></view>
      <view class="submit-actions"><button class="secondary" :loading="submitting" @click="saveDraft">保存草稿</button><button class="primary submit" :loading="submitting" @click="submit">提交审核</button></view>
    </view>
  </view>
</template>

<style scoped>
.page{min-height:100vh;background:#f7f8fa;padding:30rpx 28rpx 60rpx;color:#20252b}.hero{margin-bottom:24rpx}.eyebrow{display:block;color:#2d6bff;font-size:20rpx;letter-spacing:3rpx}.title{display:block;font-size:50rpx;font-weight:700;margin:12rpx 0}.sub{display:block;color:#7b8490;font-size:24rpx;line-height:1.7}.card{background:#fff;border:1px solid #e9edf1;border-radius:18rpx}.form{padding:26rpx}.field{position:relative;margin-bottom:24rpx}.label{display:block;font-size:25rpx;font-weight:600;margin-bottom:10rpx}.required{color:#d35b5b}.field input,.field textarea{box-sizing:border-box;width:100%;border:1px solid #e1e6eb;border-radius:10rpx;background:#fafbfc;padding:18rpx 20rpx;font-size:24rpx;line-height:1.55}.field textarea{height:155rpx}.field textarea.content{height:360rpx}.counter{display:block;text-align:right;color:#a0a7b0;font-size:18rpx;margin-top:5rpx}.picker-row{display:flex;flex-wrap:wrap;gap:10rpx}.picker{display:flex;align-items:center;min-height:70rpx;box-sizing:border-box;padding:0 18rpx;background:#f7f8fa;border:1px solid #e1e6eb;border-radius:10rpx;color:#596370;font-size:22rpx}.picker.wide{width:100%}.hint{display:block;color:#9aa3ad;font-size:20rpx;line-height:1.5;margin-top:8rpx}.primary,.secondary{border-radius:10rpx;font-size:25rpx}.primary{background:#2d6bff;color:#fff}.secondary{background:#fff;color:#2d6bff;border:1px solid #d7e1ff}.submit-actions{display:flex;gap:12rpx;margin-top:12rpx}.submit-actions button{flex:1;margin:0}.submit{margin-top:0}.error{display:flex;align-items:center;justify-content:space-between;background:#fff0f0;color:#a44949;border-radius:10rpx;padding:14rpx 16rpx;font-size:22rpx;margin:6rpx 0 16rpx}.error button{background:none;color:#2d6bff;font-size:22rpx}.success{padding:34rpx 28rpx}.success-title{display:block;font-size:32rpx;font-weight:700}.success-sub{display:block;color:#687482;font-size:23rpx;line-height:1.7;margin-top:12rpx}.success-actions{display:flex;gap:12rpx;margin-top:24rpx}.success-actions button{flex:1;margin:0}
.media-field{padding-top:4rpx}.media-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16rpx}.media-hint{display:block;color:#98a1ab;font-size:19rpx;line-height:1.5;margin-top:-3rpx}.media-limit{color:#9aa3ad;font-size:18rpx;line-height:1.4;text-align:right;white-space:nowrap}.media-grid{display:flex;flex-wrap:wrap;gap:16rpx;margin-top:14rpx}.upload-tile,.media-item{width:calc((100% - 32rpx) / 3);min-width:180rpx;box-sizing:border-box}.upload-tile{height:190rpx;border:1px dashed #cbd8f8;border-radius:12rpx;background:#f8faff;display:flex;flex-direction:column;align-items:center;justify-content:center}.upload-plus{display:block;color:#2d6bff;font-size:42rpx;line-height:1}.upload-title{display:block;color:#2d6bff;font-size:21rpx;font-weight:600;margin-top:8rpx}.upload-sub,.media-caption{display:block;color:#98a1ab;font-size:18rpx;margin-top:5rpx;text-align:center}.media-item{position:relative}.media-thumb{display:block;width:100%;height:190rpx;border-radius:12rpx;background:#edf1f5}.remove-media{position:absolute;right:8rpx;top:8rpx;width:36rpx;height:36rpx;line-height:32rpx;border-radius:50%;background:rgba(25,31,40,.7);color:#fff;text-align:center;font-size:28rpx}.media-caption{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.upload-state,.upload-error{display:block;font-size:20rpx;margin-top:10rpx}.upload-state{color:#2d6bff}.upload-error{color:#b24f4f}
</style>
