import type { Post } from '../data/posts'
import { getAccessToken } from './auth'

const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '')
function authHeaders() { const token = getAccessToken(); return token ? { Authorization: `Bearer ${token}` } : {} }

export type UploadedMedia = { url: string; name?: string }

export function mediaUrl(url: string): string {
  if (!url) return ''
  if (/^(?:https?:)?\/\//i.test(url) || url.startsWith('data:')) return url
  return `${API_BASE}${url.startsWith('/') ? url : `/${url}`}`
}

export function uploadImage(filePath: string, fileName = 'image.jpg'): Promise<UploadedMedia> {
  return new Promise((resolve, reject) => {
    uni.uploadFile({
      url: `${API_BASE}/api/v1/uploads`,
      filePath,
      name: 'files',
      header: authHeaders(),
      success: (response) => {
        let body: any = response.data
        if (typeof body === 'string') {
          try { body = JSON.parse(body) } catch { body = null }
        }
        if (response.statusCode < 200 || response.statusCode >= 300) return reject(new Error(body?.message || `upload failed: ${response.statusCode}`))
        const item = body?.items?.[0] || body?.file || body
        if (!item?.url) return reject(new Error('上传接口没有返回图片地址'))
        resolve({ url: String(item.url), name: String(item.name || fileName) })
      },
      fail: reject
    })
  })
}

type SearchPayload = {
  keyword?: string
  platformId?: string
  projectId?: string
  skillId?: string
  tab?: string
  dateStart?: string
  dateEnd?: string
  sort?: string
  pageSize?: number
  cursor?: string | null
}

type SearchResponse = { items: Array<any>; total: number; nextCursor: string | null; hasMore: boolean }

export function toPost(item: any): Post {
  const contentHtml = String(item.content || '').replace(/(src=["'])(\/uploads\/[^"']+)(["'])/g, (_match, prefix, url, suffix) => `${prefix}${mediaUrl(url)}${suffix}`)
  return {
    id: String(item.id),
    title: String(item.title),
    excerpt: String(item.excerpt || ''),
    contentHtml,
    platform: String(item.platform || ''),
    project: String(item.project || ''),
    skill: String(item.skill || ''),
    author: String(item.author?.name || item.author || ''),
    date: item.date || (item.publishedAt ? new Date(item.publishedAt).toLocaleDateString('zh-CN') : ''),
    publishedAt: item.publishedAt ? String(item.publishedAt) : undefined,
    digest: Boolean(item.digest),
    accessType: item.accessType || (item.memberOnly ? 'member' : item.priceCents ? 'paid' : 'free'),
    pricePoints: Number(item.pricePoints ?? item.priceCents ?? 0),
    priceCents: 0,
    priceUnitName: String(item.priceUnitName || item.pointsUnitName || item.unitName || '积分'),
    requiredPlanName: String(item.requiredPlanName || item.requiredPlan?.name || ''),
    locked: Boolean(item.locked),
    coverImage: item.coverImage ? String(item.coverImage) : undefined,
    images: Array.isArray(item.images) ? item.images.map((image: any) => String(image)) : [],
    counts: [Number(item.counts?.anchors || 0), Number(item.counts?.likes || 0), Number(item.counts?.comments || 0), Number(item.counts?.favorites || 0)]
  }
}

export function getPost(id: string): Promise<any> {
  return new Promise((resolve, reject) => {
    uni.request({ url: `${API_BASE}/api/v1/posts/${encodeURIComponent(id)}`, method: 'GET', header: authHeaders(), success: (response) => { if (response.statusCode !== 200) return reject(new Error(`detail failed: ${response.statusCode}`)); resolve(response.data) }, fail: reject })
  })
}

export function createComment(id: string, content: string): Promise<any> {
  return new Promise((resolve, reject) => {
    uni.request({ url: `${API_BASE}/api/v1/posts/${encodeURIComponent(id)}/comments`, method: 'POST', header: { ...authHeaders(), 'content-type': 'application/json' }, data: { content }, success: (response) => { if (response.statusCode !== 201) return reject(new Error(`comment failed: ${response.statusCode}`)); resolve(response.data) }, fail: reject })
  })
}

export function createReply(commentId: string, content: string): Promise<any> {
  return new Promise((resolve, reject) => {
    uni.request({ url: `${API_BASE}/api/v1/comments/${encodeURIComponent(commentId)}/replies`, method: 'POST', header: { ...authHeaders(), 'content-type': 'application/json' }, data: { content }, success: (response) => { if (response.statusCode !== 201) return reject(new Error(`reply failed: ${response.statusCode}`)); resolve(response.data) }, fail: reject })
  })
}

export function toggleInteraction(id: string, type: 'like' | 'favorite' | 'anchor', active = true): Promise<any> {
  return new Promise((resolve, reject) => {
    uni.request({ url: `${API_BASE}/api/v1/posts/${encodeURIComponent(id)}/${type}`, method: active ? 'POST' : 'DELETE', header: authHeaders(), success: (response) => { if (response.statusCode !== 200) return reject(new Error(`interaction failed: ${response.statusCode}`)); resolve(response.data) }, fail: reject })
  })
}

export function getSavedFilters(): Promise<any[]> {
  return new Promise((resolve, reject) => {
    uni.request({ url: `${API_BASE}/api/v1/saved-filters`, method: 'GET', header: authHeaders(), success: (response) => { if (response.statusCode !== 200) return reject(new Error(`saved filters failed: ${response.statusCode}`)); resolve((response.data as any).items || []) }, fail: reject })
  })
}

export function createSavedFilter(name: string, filter: Record<string, string>): Promise<any> {
  return new Promise((resolve, reject) => {
    uni.request({ url: `${API_BASE}/api/v1/saved-filters`, method: 'POST', header: { ...authHeaders(), 'content-type': 'application/json' }, data: { name, filter }, success: (response) => { if (response.statusCode !== 201) return reject(new Error(`save filter failed: ${response.statusCode}`)); resolve(response.data) }, fail: reject })
  })
}

export function deleteSavedFilter(id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    uni.request({ url: `${API_BASE}/api/v1/saved-filters/${encodeURIComponent(id)}`, method: 'DELETE', header: authHeaders(), success: (response) => { if (response.statusCode !== 200) return reject(new Error(`delete filter failed: ${response.statusCode}`)); resolve() }, fail: reject })
  })
}

export function searchPosts(payload: SearchPayload): Promise<{ items: Post[]; total: number; nextCursor: string | null; hasMore: boolean }> {
  return new Promise((resolve, reject) => {
    uni.request({
      url: `${API_BASE}/api/v1/posts/search`,
      method: 'POST',
      data: payload,
      header: authHeaders(),
      success: (response) => {
        if (response.statusCode !== 200) return reject(new Error(`search failed: ${response.statusCode}`))
        const body = response.data as SearchResponse
        resolve({ items: (body.items || []).map(toPost), total: body.total || 0, nextCursor: body.nextCursor, hasMore: Boolean(body.hasMore) })
      },
      fail: reject
    })
  })
}

function requestJson(path: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', data?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    uni.request({ url: `${API_BASE}${path}`, method, data, header: { ...authHeaders(), ...(data ? { 'content-type': 'application/json' } : {}) }, success: (response) => { if (response.statusCode < 200 || response.statusCode >= 300) { const error = new Error((response.data as any)?.message || `request failed: ${response.statusCode}`); (error as any).status = response.statusCode; return reject(error) } resolve(response.data) }, fail: reject })
  })
}

async function requestFirstJson(paths: string[], method: 'GET' | 'POST' = 'GET', data?: any): Promise<any> {
  let lastError: unknown
  for (const path of paths) {
    try { return await requestJson(path, method, data) } catch (error) { lastError = error; if ((error as any)?.status && ![404, 405].includes((error as any).status)) throw error }
  }
  throw lastError instanceof Error ? lastError : new Error('request failed')
}

export type PointsSummary = { balance: number; totalEarned?: number; totalSpent?: number; unit?: string; unitName?: string }
export type PointLedgerItem = { id?: string; amountPoints?: number; points?: number; delta?: number; reason?: string; type?: string; createdAt?: string; balanceAfter?: number }
export function getPointsSummary(): Promise<PointsSummary> {
  return requestFirstJson(['/api/v1/me/points', '/api/v1/points/balance', '/api/v1/me/points/balance'], 'GET').then(body => {
    const wallet = body.wallet || body.points || body
    const unitName = String(wallet.unitName || wallet.unit || body.unitName || '积分')
    return { balance: Number(wallet.balance ?? wallet.pointsBalance ?? wallet.amount ?? 0), totalEarned: Number(wallet.totalEarned ?? wallet.earned ?? 0), totalSpent: Number(wallet.totalSpent ?? wallet.spent ?? 0), unit: unitName, unitName }
  })
}
export function getPointLedger(): Promise<PointLedgerItem[]> {
  return requestFirstJson(['/api/v1/me/points/ledger', '/api/v1/me/points/records', '/api/v1/points/ledger'], 'GET').then(body => body.items || body.records || body.ledger || [])
}
export async function createPointTip(data: { postId: string; amountPoints: number; message?: string }): Promise<any> {
  const payload = { postId: data.postId, points: data.amountPoints, amountPoints: data.amountPoints, message: data.message || '' }
  try { return await requestJson('/api/v1/tips', 'POST', payload) }
  catch (error) { if ((error as any)?.status !== 404) throw error; return requestJson('/api/v1/tips/orders', 'POST', payload) }
}
export function purchasePostWithPoints(postId: string): Promise<any> { return requestJson(`/api/v1/posts/${encodeURIComponent(postId)}/purchase`, 'POST', {}) }
export function getPointsConfig(): Promise<{ unitName: string }> { return requestJson('/api/v1/points/config', 'GET').then(body => ({ unitName: String(body.unitName || body.unit || '积分') })) }

export function getMemberPlans(): Promise<any[]> { return requestJson('/api/v1/member/plans', 'GET').then(body => (body.items || body.plans || []).map((item: any) => ({ ...item, pointUnitName: item.pointUnitName || body.pointUnitName || '积分' }))) }
export function getMember(): Promise<any> { return requestJson('/api/v1/member/me', 'GET') }
export function createOrder(data: { kind: 'post' | 'membership' | 'tip'; postId?: string; planId?: string; amountCents?: number; amountPoints?: number; message?: string }): Promise<any> { return requestJson('/api/v1/orders', 'POST', data) }
export function payOrder(orderId: string): Promise<any> { return requestJson(`/api/v1/orders/${encodeURIComponent(orderId)}/pay`, 'POST', {}) }
export function mockSuccess(orderId: string): Promise<any> { return requestJson(`/api/v1/orders/${encodeURIComponent(orderId)}/mock-success`, 'POST', {}) }

export function getProfile(): Promise<any> { return requestJson('/api/v1/me/profile', 'GET') }
export function updateProfile(data: { name?: string; nickname?: string; bio?: string; city?: string; website?: string; avatarUrl?: string }): Promise<any> { return requestJson('/api/v1/me/profile', 'PATCH', data) }
export function getNotifications(unreadOnly = false): Promise<{ items: any[]; unread: number }> { return requestJson(`/api/v1/me/notifications${unreadOnly ? '?unread=true' : ''}`, 'GET') }
export function markNotificationRead(id: string): Promise<any> { return requestJson(`/api/v1/me/notifications/${encodeURIComponent(id)}/read`, 'PATCH', {}) }
export function getOrders(): Promise<any[]> { return requestJson('/api/v1/orders', 'GET').then(body => body.items || []) }
export function getMyPosts(): Promise<any[]> { return requestJson('/api/v1/me/posts', 'GET').then(body => body.items || []) }
export function getMyPost(id: string): Promise<any> { return requestJson(`/api/v1/me/posts/${encodeURIComponent(id)}`, 'GET') }
export type PostInput = { title: string; excerpt: string; content: string; platform: string; project: string; skill: string; accessType: 'free' | 'member' | 'paid'; pricePoints?: number; priceCents?: number; memberPlanIds?: string[]; coverImage?: string | null; images?: string[]; draft?: boolean; status?: 'draft' | 'pending' }
export function createPost(data: PostInput): Promise<any> { return requestJson('/api/v1/posts', 'POST', data) }
export function updatePost(id: string, data: PostInput): Promise<any> { return requestJson(`/api/v1/posts/${encodeURIComponent(id)}`, 'PATCH', data) }
export function archivePost(id: string): Promise<any> { return requestJson(`/api/v1/posts/${encodeURIComponent(id)}`, 'DELETE') }
export function reportPost(postId: string, detail: string): Promise<any> { return requestJson(`/api/v1/posts/${encodeURIComponent(postId)}/report`, 'POST', { reason: 'other', detail }) }
export function reportComment(commentId: string, detail: string): Promise<any> { return requestJson(`/api/v1/comments/${encodeURIComponent(commentId)}/report`, 'POST', { reason: 'other', detail }) }
