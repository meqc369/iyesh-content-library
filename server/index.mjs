import http from 'node:http'
import { createHmac, createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto'
import nodemailer from 'nodemailer'
import sharp from 'sharp'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { URL } from 'node:url'

const DATA_FILE = join(dirname(fileURLToPath(import.meta.url)), 'data', 'store.json')
const UPLOADS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'uploads')
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
const MAX_UPLOAD_COUNT = 9
// A post may reference more images than a single upload request carries.
const MAX_POST_IMAGES = 20
const MAX_UPLOAD_TOTAL_BYTES = 25 * 1024 * 1024
const MAX_STORED_IMAGE_BYTES = 2 * 1024 * 1024
const MAX_IMAGE_DIMENSION = Math.max(640, Math.min(6000, Number(process.env.MAX_IMAGE_DIMENSION || 2400) || 2400))
const MAX_IMAGE_PIXELS = Math.max(4_000_000, Math.min(40_000_000, Number(process.env.MAX_IMAGE_PIXELS || 40_000_000) || 40_000_000))
const MAX_JSON_BODY_BYTES = 2 * 1024 * 1024
const NOTIFICATION_RETENTION_DAYS = Math.max(1, Math.min(3650, Number(process.env.NOTIFICATION_RETENTION_DAYS || 180) || 180))
const NOTIFICATION_CLEANUP_INTERVAL_MS = Math.max(60 * 60 * 1000, Number(process.env.NOTIFICATION_CLEANUP_INTERVAL_MS || 6 * 60 * 60 * 1000) || 6 * 60 * 60 * 1000)
const UPLOAD_PUBLIC_BASE_URL = String(process.env.UPLOAD_PUBLIC_BASE_URL || '').replace(/\/+$/, '')
const IS_PRODUCTION = process.env.NODE_ENV === 'production'
// Share links are consumed by the H5 share sheet and by social previews. Keep
// the public origin explicit so an internal API host is never exposed in a
// copied link or an image URL.
const PUBLIC_WEB_BASE_URL = String(process.env.PUBLIC_WEB_BASE_URL || process.env.WEB_PUBLIC_BASE_URL || (IS_PRODUCTION ? 'https://iyesh.com' : 'http://127.0.0.1:4173')).replace(/\/+$/, '')
// The API HTML variant works through the existing /api/ reverse proxy, so
// sharing remains usable even when the optional /share/:id Nginx location has
// not been installed yet.
const PUBLIC_SHARE_BASE_PATH = String(process.env.PUBLIC_SHARE_BASE_PATH || '/share').replace(/^\/+|\/+$/g, '')
const AUTH_SECRET = process.env.AUTH_SECRET || 'local-development-secret-change-me'
// The legacy header is kept only for local smoke tests. Production administrators
// must authenticate through the account/session flow below.
const ADMIN_KEY = IS_PRODUCTION ? '' : (process.env.ADMIN_KEY || 'local-admin')
const INITIAL_ADMIN_PASSWORD = String(process.env.INITIAL_ADMIN_PASSWORD || '')
const CORS_ORIGIN = IS_PRODUCTION ? String(process.env.CORS_ORIGIN || '').trim() : '*'
const PAYMENT_PROVIDER = String(process.env.PAYMENT_PROVIDER || (IS_PRODUCTION ? 'wechat' : 'mock')).toLowerCase()
const PAYMENT_WEBHOOK_SECRET = String(process.env.PAYMENT_WEBHOOK_SECRET || '')
const SMTP_ENV_CONFIG = {
  host: String(process.env.SMTP_HOST || 'smtp.qq.com').trim(),
  port: Number(process.env.SMTP_PORT || 465),
  secure: String(process.env.SMTP_SECURE || 'true').toLowerCase() !== 'false',
  user: String(process.env.SMTP_USER || '').trim(),
  pass: String(process.env.SMTP_PASS || ''),
  from: String(process.env.SMTP_FROM || '').trim()
}

function isPlaceholderSecret(value) {
  return !value || /replace-with|change-me|your-(?:app|wechat)|example/i.test(String(value))
}

if (IS_PRODUCTION) {
  if (isPlaceholderSecret(process.env.AUTH_SECRET) || String(process.env.AUTH_SECRET).length < 32) throw new Error('生产环境必须设置至少 32 位随机 AUTH_SECRET')
  if (!CORS_ORIGIN || CORS_ORIGIN === '*') throw new Error('生产环境必须设置具体的 CORS_ORIGIN')
}

let posts = [
  { id: 'post_1', title: '累计开通 500+ YPP：YouTube 直播玩法开源', excerpt: '把选题、直播和复盘拆成一套可复制的流程，适合刚开始做内容出海的团队。', content: '把选题、直播和复盘拆成一套可复制的流程，适合刚开始做内容出海的团队。\n\n本文提供完整执行清单和复盘模板。', platform: 'YouTube', project: '出海', skill: 'AI', author: { id: 'user_1', name: 'Gary', avatarUrl: null }, publishedAt: '2026-10-13T08:00:00Z', digest: true, accessType: 'paid', priceCents: 990, counts: { anchors: 44, likes: 144, comments: 4, favorites: 51, tips: 0 } },
  { id: 'post_2', title: '从 0 到 1 做一个垂直小号的完整记录', excerpt: '从定位、素材收集到发布节奏，分享一套低成本验证方法。', content: '从定位、素材收集到发布节奏，分享一套低成本验证方法。\n\n会员可查看完整案例和数据表。', platform: '小红书', project: '垂直小号', skill: '自媒体', author: { id: 'user_2', name: '小满', avatarUrl: null }, publishedAt: '2026-10-12T08:00:00Z', digest: true, accessType: 'member', counts: { anchors: 31, likes: 102, comments: 12, favorites: 36, tips: 0 } },
  { id: 'post_3', title: 'AI 工作流如何接入日常内容生产', excerpt: '把调研、提纲、脚本和复盘串起来，减少重复劳动，把时间留给判断。', platform: '公众号', project: 'AI自媒体', skill: 'AI工作流', author: { id: 'user_3', name: '林默', avatarUrl: null }, publishedAt: '2026-10-11T08:00:00Z', digest: false, accessType: 'free', counts: { anchors: 18, likes: 88, comments: 7, favorites: 24, tips: 0 } },
  { id: 'post_4', title: '一套跨境电商素材管理方法', excerpt: '当素材数量变多后，如何按照市场、产品和投放阶段组织素材。', platform: 'TikTok', project: '电商', skill: 'AI视频', author: { id: 'user_4', name: '周予', avatarUrl: null }, publishedAt: '2026-10-09T08:00:00Z', digest: false, accessType: 'free', counts: { anchors: 22, likes: 64, comments: 5, favorites: 19, tips: 0 } },
  { id: 'post_5', title: 'Codex 辅助项目开发的实践清单', excerpt: '从需求拆解到代码审查，记录一个真实项目中的协作方式。', platform: 'X', project: 'AI产品开发', skill: 'Codex', author: { id: 'user_5', name: '苏然', avatarUrl: null }, publishedAt: '2026-10-07T08:00:00Z', digest: true, accessType: 'free', counts: { anchors: 15, likes: 73, comments: 6, favorites: 28, tips: 0 } }
]

let tags = {
  platform: ['小红书', '视频号', '公众号', '抖音', '微信', '闲鱼', 'YouTube', 'TikTok', 'X', 'Reddit', 'B站', '快手', '线下实体'],
  project: ['出海', '自媒体', '垂直小号', 'AI产品开发', '电商', 'AI自媒体', 'AI短剧', '虚拟产品', 'IP', '垂直小店', '出海工具'],
  skill: ['AI', 'AI视频', '生财认知', 'AI编程', 'AI工作流', 'Seedance2.0', 'Codex', '即梦', 'AI写作', 'Claude Code', 'Gemini']
}
const DEFAULT_STORE = {
  posts: null,
  tags: null,
  savedFilters: {},
  profiles: {},
  notifications: {},
  reports: [],
  commentReports: [],
  comments: { post_1: [{ id: 'comment_1', user: { name: '示例用户' }, content: '这套流程很适合拿来做第一次验证。', createdAt: '2026-10-13T10:00:00Z' }] },
  interactions: {},
  memberGroups: [
    { id: 'group_member', code: 'member', name: '普通会员', description: '解锁会员专享内容', rank: 10, status: 'active', permissions: ['content.member.read'], initialPoints: 0 },
    { id: 'group_pro', code: 'pro', name: '专业会员', description: '解锁全部高级内容', rank: 20, status: 'active', permissions: ['content.member.read', 'content.pro.read'], initialPoints: 0 }
  ],
  plans: [
    { id: 'plan_monthly', groupId: 'group_member', name: '月度会员', description: '解锁全部会员内容', priceCents: 2900, redeemPoints: 1000, durationDays: 30, benefits: ['会员内容', '会员专属资料'], status: 'active', sort: 1, initialPoints: 0 },
    { id: 'plan_yearly', groupId: 'group_member', name: '年度会员', description: '全年解锁全部会员内容', priceCents: 19900, redeemPoints: 6000, durationDays: 365, benefits: ['会员内容', '会员专属资料', '年度资料包'], status: 'active', sort: 2, initialPoints: 0 }
  ],
  memberships: {},
  entitlements: [],
  orders: [],
  tips: [],
  paymentEvents: [],
  pointsAccounts: {},
  pointsLedger: [],
  pointsConfig: { unitName: '积分', purchaseContact: { wechatId: '', qrCodeUrl: '', note: '请添加客服微信，线下购买兑换码。', offlineTitle: '线下开通', offlineNote: '联系管理员完成收款，确认后立即生效。' }, withdrawal: { pointsPerRmb: 100, feePercent: 0, minPoints: 1 } },
  referralConfig: { enabled: true, directPercent: 10, level1Percent: 10, level2Percent: 0 },
  referralRelations: {},
  referralCommissions: [],
  checkinConfig: { enabled: true, dailyPoints: 10, streakRewards: [{ days: 3, bonusPoints: 5 }, { days: 7, bonusPoints: 15 }, { days: 30, bonusPoints: 50 }], streakBonusPoints: 0, timezone: 'Asia/Shanghai', leaderboardDays: 30 },
  checkins: {},
  withdrawals: [],
  accounts: {},
  admins: {},
  emailVerifications: [],
  smtpConfig: SMTP_ENV_CONFIG,
  cdkeys: [],
  cdkeyRedemptions: [],
  auditLogs: []
}
let savedFilters = new Map()
let profiles = new Map()
let notifications = new Map()
let reports = []
let commentReports = []
let comments = new Map()
let interactions = new Map()
let memberGroups = []
let plans = []
let memberships = new Map()
let entitlements = []
let orders = []
let tips = []
let paymentEvents = []
let pointsAccounts = new Map()
let pointsLedger = []
let pointsConfig = { unitName: '积分', purchaseContact: { wechatId: '', qrCodeUrl: '', note: '请添加客服微信，线下购买兑换码。', offlineTitle: '线下开通', offlineNote: '联系管理员完成收款，确认后立即生效。' }, withdrawal: { pointsPerRmb: 100, feePercent: 0, minPoints: 1 } }
let referralConfig = { enabled: true, directPercent: 10, level1Percent: 10, level2Percent: 0 }
let referralRelations = new Map()
let referralCommissions = []
let checkinConfig = { enabled: true, dailyPoints: 10, streakRewards: [{ days: 3, bonusPoints: 5 }, { days: 7, bonusPoints: 15 }, { days: 30, bonusPoints: 50 }], streakBonusPoints: 0, timezone: 'Asia/Shanghai', leaderboardDays: 30 }
let checkins = new Map()
let withdrawals = []
let accounts = new Map()
let admins = new Map()
let emailVerifications = []
let smtpConfig = { ...SMTP_ENV_CONFIG }
const verificationIpBuckets = new Map()
const passwordResetIpBuckets = new Map()
const adminLoginBuckets = new Map()
const userLoginBuckets = new Map()
let cdkeys = []
let cdkeyRedemptions = []
let auditLogs = []
let persistQueue = Promise.resolve()

async function loadStore() {
  let data = DEFAULT_STORE
  try { data = { ...DEFAULT_STORE, ...JSON.parse(await readFile(DATA_FILE, 'utf8')) } } catch {}
  if (Array.isArray(data.posts)) posts = data.posts
  if (data.tags && typeof data.tags === 'object') tags = data.tags
  savedFilters = new Map(Object.entries(data.savedFilters || {}))
  profiles = new Map(Object.entries(data.profiles || {}))
  notifications = new Map(Object.entries(data.notifications || {}).map(([userId, list]) => [userId, normalizeNotificationList(userId, list)]))
  reports = Array.isArray(data.reports) ? data.reports : []
  commentReports = Array.isArray(data.commentReports) ? data.commentReports : []
  comments = new Map(Object.entries(data.comments || {}))
  interactions = new Map(Object.entries(data.interactions || {}))
  memberGroups = (Array.isArray(data.memberGroups) ? data.memberGroups : [...DEFAULT_STORE.memberGroups]).map(group => ({ ...group, permissions: normalizePermissions(group.permissions?.length ? group.permissions : group.code === 'pro' ? ['content.member.read', 'content.pro.read'] : ['content.member.read']), initialPoints: normalizePoints(group.initialPoints) }))
  plans = (Array.isArray(data.plans) ? data.plans : [...DEFAULT_STORE.plans]).map(plan => ({ ...plan, initialPoints: normalizePoints(plan.initialPoints), redeemPoints: normalizePoints(plan.redeemPoints ?? plan.pricePoints) }))
  memberships = new Map(Object.entries(data.memberships || {}))
  entitlements = Array.isArray(data.entitlements) ? data.entitlements : []
  orders = Array.isArray(data.orders) ? data.orders : []
  tips = Array.isArray(data.tips) ? data.tips : []
  paymentEvents = Array.isArray(data.paymentEvents) ? data.paymentEvents : []
  pointsAccounts = new Map(Object.entries(data.pointsAccounts || {}).map(([userId, value]) => [userId, Math.max(0, Math.floor(Number(value) || 0))]))
  pointsLedger = Array.isArray(data.pointsLedger) ? data.pointsLedger : []
  const configuredUnitName = data.pointsConfig?.unitName ?? data.pointConfig?.unitName
  const configuredContact = data.pointsConfig?.purchaseContact || data.purchaseContact || {}
  pointsConfig = { unitName: String(configuredUnitName || '积分').trim().slice(0, 20) || '积分', purchaseContact: { wechatId: String(configuredContact.wechatId || '').trim().slice(0, 80), qrCodeUrl: String(configuredContact.qrCodeUrl || configuredContact.wechatQrUrl || '').trim().slice(0, 500), note: String(configuredContact.note || configuredContact.instructions || '请添加客服微信，线下购买兑换码。').trim().slice(0, 300), offlineTitle: String(configuredContact.offlineTitle || configuredContact.offlineHeading || '线下开通').trim().slice(0, 50) || '线下开通', offlineNote: String(configuredContact.offlineNote || configuredContact.offlineInstructions || '联系管理员完成收款，确认后立即生效。').trim().slice(0, 500) || '联系管理员完成收款，确认后立即生效。' }, withdrawal: normalizeWithdrawalConfig(data.pointsConfig?.withdrawal || data.withdrawalConfig) }
  referralConfig = normalizeReferralConfig(data.referralConfig || data.referrals?.config)
  referralRelations = new Map(Object.entries(data.referralRelations || data.referrals?.relations || {}).map(([childId, value]) => [childId, normalizeReferralRelation({ childId, ...value })]).filter(([, value]) => value))
  referralCommissions = (Array.isArray(data.referralCommissions) ? data.referralCommissions : Array.isArray(data.referrals?.commissions) ? data.referrals.commissions : []).map(normalizeReferralCommission).filter(Boolean)
  checkinConfig = normalizeCheckinConfig(data.checkinConfig || data.checkins?.config)
  const storedCheckins = data.checkins && !Array.isArray(data.checkins) ? (data.checkins.records && typeof data.checkins.records === 'object' ? data.checkins.records : data.checkins) : (data.checkinRecords && typeof data.checkinRecords === 'object' ? data.checkinRecords : {})
  checkins = new Map(Object.entries(storedCheckins).filter(([key]) => key !== 'config').map(([userId, records]) => [String(userId), (Array.isArray(records) ? records : []).map(item => normalizeCheckinRecord({ ...item, userId })).filter(Boolean)]))
  withdrawals = (Array.isArray(data.withdrawals) ? data.withdrawals : []).map(normalizeWithdrawalRecord).filter(Boolean)
  accounts = new Map(Object.entries(data.accounts || {}))
  admins = new Map(Object.entries(data.admins || {}))
  let seededAdmin = false
  if (!admins.size && INITIAL_ADMIN_PASSWORD) {
    const passwordData = passwordHash(INITIAL_ADMIN_PASSWORD)
    const createdAt = nowIso()
    admins.set('admin', { id: 'admin', username: 'admin', usernameKey: 'admin', name: '初始管理员', role: 'superadmin', status: 'active', passwordHash: passwordData.hash, passwordSalt: passwordData.salt, authVersion: randomBytes(16).toString('hex'), createdAt, lastLoginAt: null })
    seededAdmin = true
  }
  let seededReferralCodes = false
  const knownReferralCodes = new Set()
  for (const account of accounts.values()) {
    let code = normalizeReferralCode(account.referralCode)
    if (!code || knownReferralCodes.has(code)) { code = generateReferralCode(knownReferralCodes); seededReferralCodes = true }
    if (account.referralCode !== code) { account.referralCode = code; seededReferralCodes = true }
    knownReferralCodes.add(code)
  }
  for (const [childId, relation] of [...referralRelations.entries()]) {
    if (!accounts.has(childId) || !accounts.has(relation.parentId) || childId === relation.parentId) { referralRelations.delete(childId); seededReferralCodes = true }
  }
  for (const account of accounts.values()) {
    const parentId = String(account.referrerId || '').trim()
    if (parentId && parentId !== account.id && accounts.has(parentId) && !referralRelations.has(account.id)) { referralRelations.set(account.id, normalizeReferralRelation({ childId: account.id, parentId, createdAt: account.createdAt })); seededReferralCodes = true }
  }
  emailVerifications = Array.isArray(data.emailVerifications) ? data.emailVerifications : []
  const storedSmtp = data.smtpConfig || {}
  smtpConfig = { host: String(storedSmtp.host || SMTP_ENV_CONFIG.host).trim(), port: Math.max(1, Math.min(65535, Number(storedSmtp.port || SMTP_ENV_CONFIG.port))), secure: storedSmtp.secure !== false, user: String(storedSmtp.user || SMTP_ENV_CONFIG.user).trim(), pass: String(storedSmtp.pass ?? SMTP_ENV_CONFIG.pass), from: String(storedSmtp.from || SMTP_ENV_CONFIG.from || storedSmtp.user || SMTP_ENV_CONFIG.user).trim() }
  cdkeys = Array.isArray(data.cdkeys) ? data.cdkeys.map(migrateCdkey) : []
  cdkeyRedemptions = Array.isArray(data.cdkeyRedemptions) ? data.cdkeyRedemptions : []
  auditLogs = Array.isArray(data.auditLogs) ? data.auditLogs : []
  posts = posts.map(post => ({ ...post, status: post.status || 'published', accessType: ['free', 'member', 'paid'].includes(post.accessType) ? post.accessType : 'free', pricePoints: normalizePoints(post.pricePoints ?? post.priceCents), priceCents: 0, memberPlanIds: Array.isArray(post.memberPlanIds) ? post.memberPlanIds : [], coverImage: normalizeUploadedUrl(post.coverImage), images: normalizeUploadedImages(post.images), counts: { anchors: 0, likes: 0, comments: 0, favorites: 0, tips: 0, ...(post.counts || {}) } }))
  if (seededAdmin || seededReferralCodes) await persistStore()
}

async function persistStore() {
  const persist = async () => {
    await mkdir(dirname(DATA_FILE), { recursive: true })
    const temporary = `${DATA_FILE}.tmp-${process.pid}-${Date.now()}-${randomBytes(8).toString('hex')}`
    try {
      await writeFile(temporary, JSON.stringify({ posts, tags, savedFilters: Object.fromEntries(savedFilters), profiles: Object.fromEntries(profiles), notifications: Object.fromEntries(notifications), reports, commentReports, comments: Object.fromEntries(comments), interactions: Object.fromEntries(interactions), memberGroups, plans, memberships: Object.fromEntries(memberships), entitlements, orders, tips, paymentEvents, pointsAccounts: Object.fromEntries(pointsAccounts), pointsLedger, pointsConfig, referralConfig, referralRelations: Object.fromEntries(referralRelations), referralCommissions, checkinConfig, checkins: Object.fromEntries(checkins), withdrawals, accounts: Object.fromEntries(accounts), admins: Object.fromEntries(admins), emailVerifications, smtpConfig, cdkeys: cdkeys.map(({ code, ...item }) => item), cdkeyRedemptions, auditLogs }, null, 2))
      await rename(temporary, DATA_FILE)
    } finally {
      await unlink(temporary).catch(() => {})
    }
  }
  const next = persistQueue.then(persist, persist)
  persistQueue = next.catch(() => {})
  return next
}

function json(res, status, value) {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'access-control-allow-headers': 'content-type, authorization, x-admin-key, x-admin-token, idempotency-key' }
  if (CORS_ORIGIN) headers['access-control-allow-origin'] = CORS_ORIGIN
  res.writeHead(status, headers)
  res.end(JSON.stringify(value))
}

function html(res, status, value, extraHeaders = {}) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'public, max-age=60, s-maxage=300',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    ...extraHeaders
  })
  res.end(value)
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
}

// Post bodies are stored as lightweight text: blank-line separated blocks,
// with optional "## " headings, "- " / "1. " lists, "> " quotes, **bold**
// and inline images written as ![说明](/uploads/name.ext). Everything is
// escaped first, so the renderer can never emit author-supplied markup.
const INLINE_IMAGE_PATTERN = /^!\[([^\]\n]{0,120})\]\((\/uploads\/[A-Za-z0-9][A-Za-z0-9._-]*)\)$/
function formatInlineText(value) {
  return escapeHtml(value).replace(/\*\*([^*\n]{1,200})\*\*/g, '<strong>$1</strong>')
}
function renderInlineText(value) {
  const text = String(value ?? '')
  let html = ''
  let last = 0
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'，。！？、；：）)\]】]+/g)) {
    const url = match[0].replace(/[.,;:!?]+$/, '')
    html += formatInlineText(text.slice(last, match.index))
    html += `<a href="${escapeHtml(url)}" target="_blank" rel="nofollow noopener noreferrer">${escapeHtml(url)}</a>${escapeHtml(match[0].slice(url.length))}`
    last = match.index + match[0].length
  }
  return html + formatInlineText(text.slice(last))
}
function inlineImageUrls(content) {
  return String(content || '').replace(/\r\n?/g, '\n').split('\n').map(line => line.trim().match(INLINE_IMAGE_PATTERN)?.[2]).filter(Boolean)
}
function contentHtml(post) {
  // Keep uploads same-origin by default. The API is often bound to 127.0.0.1
  // behind the H5 reverse proxy, so returning that internal address would make
  // otherwise valid images impossible for a browser to load in production.
  const imageBase = UPLOAD_PUBLIC_BASE_URL || ''
  const used = new Set()
  let imageIndex = 0
  const figure = (url, caption) => { imageIndex += 1; return `<figure class="post-image"><img src="${escapeHtml(`${imageBase}${url}`)}" alt="${escapeHtml(caption || `正文配图 ${imageIndex}`)}" loading="lazy">${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''}</figure>` }
  const html = []
  for (const block of String(post.content || post.excerpt || '').replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const lines = block.split('\n').map(line => line.replace(/\s+$/, '')).filter(line => line.trim())
    let index = 0
    while (index < lines.length) {
      const line = lines[index]
      const image = line.trim().match(INLINE_IMAGE_PATTERN)
      if (image) { used.add(image[2]); html.push(figure(image[2], image[1].trim())); index += 1; continue }
      const heading = line.match(/^\s*(#{2,3})\s+(.+)$/)
      if (heading) { html.push(`<h${heading[1].length}>${renderInlineText(heading[2])}</h${heading[1].length}>`); index += 1; continue }
      const groups = [
        [/^\s*[-•*]\s+/, items => `<ul>${items.map(item => `<li>${renderInlineText(item)}</li>`).join('')}</ul>`],
        [/^\s*\d{1,3}[.、)]\s*/, items => `<ol>${items.map(item => `<li>${renderInlineText(item)}</li>`).join('')}</ol>`],
        [/^\s*>\s?/, items => `<blockquote>${items.map(renderInlineText).join('<br>')}</blockquote>`]
      ]
      const group = groups.find(([pattern]) => pattern.test(line))
      if (group) {
        const items = []
        while (index < lines.length && group[0].test(lines[index]) && !INLINE_IMAGE_PATTERN.test(lines[index].trim())) { items.push(lines[index].replace(group[0], '')); index += 1 }
        html.push(group[1](items)); continue
      }
      const paragraph = []
      while (index < lines.length && !INLINE_IMAGE_PATTERN.test(lines[index].trim()) && !/^\s*#{2,3}\s+/.test(lines[index]) && !groups.some(([pattern]) => pattern.test(lines[index]))) { paragraph.push(lines[index]); index += 1 }
      html.push(`<p>${paragraph.map(renderInlineText).join('<br>')}</p>`)
    }
  }
  const extra = normalizeUploadedImages(post.images).filter(url => !used.has(url)).map(url => figure(url, '')).join('')
  return `${html.join('')}${extra}`
}
function plainTextFromContent(content) {
  return String(content || '').replace(/\r\n?/g, '\n').split('\n')
    .filter(line => !INLINE_IMAGE_PATTERN.test(line.trim()))
    .map(line => line.replace(/^\s*#{2,3}\s+/, '').replace(/^\s*(?:[-•*]|\d{1,3}[.、)]|>)\s*/, '').replace(/\*\*/g, ''))
    .join(' ').replace(/\s+/g, ' ').trim()
}
function autoExcerpt(content, limit = 120) {
  const text = plainTextFromContent(content)
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

function publicAssetUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) return `${PUBLIC_WEB_BASE_URL}/assets/iyesh-logo.webp`
  if (/^https?:\/\//i.test(raw)) return raw
  return `${PUBLIC_WEB_BASE_URL}${raw.startsWith('/') ? '' : '/'}${raw}`
}

function shareMetadata(post, userId = null) {
  const access = accessFor(post, userId)
  const author = typeof post.author === 'string' ? post.author : post.author?.name || '用户'
  const excerpt = String(post.excerpt || '').trim() || '查看这篇来自月入万刀的实战内容。'
  const accessLabel = access.accessType === 'member'
    ? `会员 · ${access.requiredPlanName || '会员专享'}`
    : access.accessType === 'paid'
      ? `付费 · ${access.pricePoints} ${access.priceUnitName}`
      : '免费'
  const canonicalUrl = `${PUBLIC_WEB_BASE_URL}/detail.html?id=${encodeURIComponent(post.id)}`
  // Body images are private for member/paid posts. Use the brand image for
  // locked content so a social crawler cannot expose the first正文图片.
  const image = access.locked ? '' : (post.coverImage || (Array.isArray(post.images) ? post.images[0] : ''))
  const shareUrl = PUBLIC_SHARE_BASE_PATH === 'share'
    ? `${PUBLIC_WEB_BASE_URL}/share/${encodeURIComponent(post.id)}`
    : `${PUBLIC_WEB_BASE_URL}/${PUBLIC_SHARE_BASE_PATH}/${encodeURIComponent(post.id)}/share?format=html`
  return {
    id: post.id,
    title: String(post.title || '月入万刀内容'),
    description: excerpt,
    excerpt,
    author: { id: post.author?.id || null, name: author, avatarUrl: post.author?.avatarUrl || null },
    platform: String(post.platform || ''),
    accessType: access.accessType,
    accessLabel,
    pricePoints: access.pricePoints,
    priceUnitName: access.priceUnitName,
    requiredPlanName: access.requiredPlanName || null,
    locked: access.locked,
    url: canonicalUrl,
    canonicalUrl,
    shareUrl,
    imageUrl: publicAssetUrl(image),
    shareText: `${String(post.title || '月入万刀内容')} · ${excerpt}`
  }
}

function sharePageHtml(post) {
  const metadata = shareMetadata(post, null)
  const title = metadata.title
  const description = metadata.description
  const image = metadata.imageUrl
  const metaImage = image || `${PUBLIC_WEB_BASE_URL}/assets/iyesh-logo.webp`
  const shareUrl = metadata.shareUrl
  const canonicalUrl = metadata.canonicalUrl
  const accessLabel = metadata.accessLabel
  const byline = [metadata.platform, metadata.author?.name, accessLabel].filter(Boolean).join(' · ')
  const redirectScript = `<script>window.setTimeout(function(){window.location.replace(${JSON.stringify(canonicalUrl)})},220)</script>`
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · 月入万刀</title><meta name="description" content="${escapeHtml(description)}"><meta property="og:type" content="article"><meta property="og:site_name" content="月入万刀"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(shareUrl)}"><meta property="og:image" content="${escapeHtml(metaImage)}"><meta property="og:image:alt" content="${escapeHtml(title)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(title)}"><meta name="twitter:description" content="${escapeHtml(description)}"><meta name="twitter:image" content="${escapeHtml(metaImage)}"><link rel="canonical" href="${escapeHtml(canonicalUrl)}"><link rel="icon" type="image/png" href="${escapeHtml(`${PUBLIC_WEB_BASE_URL}/assets/iyesh-favicon.png`)}"><style> :root{color-scheme:light}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#f4f5f1;color:#142033;font:16px/1.65 -apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft Yahei",sans-serif}.top{height:180px;background:#13213b}.page{max-width:560px;margin:-132px auto 0;padding:0 16px 48px}.brand{display:flex;align-items:center;gap:10px;margin-bottom:20px;color:#fff;font-size:16px;font-weight:700}.brand img{width:30px;height:30px;object-fit:contain;border-radius:8px;background:#fff;padding:3px}.card{overflow:hidden;border:1px solid #e3e6df;border-radius:20px;background:#fff;box-shadow:0 24px 48px -28px rgba(19,33,59,.45)}.visual{aspect-ratio:16/9;background:#e9ecf3 center/cover}.content{padding:24px}.eyebrow{margin:0 0 8px;color:#2c62db;font-size:13px;font-weight:700}.title{margin:0;font-size:24px;line-height:1.35}.description{margin:12px 0 0;color:#5b6577}.byline{margin:16px 0 0;color:#8a92a0;font-size:13px}.open{display:flex;justify-content:center;margin-top:22px;padding:13px 18px;border-radius:12px;background:#2c62db;color:#fff;text-decoration:none;font-weight:700}.hint{margin:18px 0 0;color:#8a92a0;font-size:12px;text-align:center}@media(max-width:480px){.content{padding:20px}.title{font-size:21px}}</style></head><body><div class="top"></div><main class="page"><div class="brand"><img src="${escapeHtml(`${PUBLIC_WEB_BASE_URL}/assets/iyesh-logo.webp`)}" alt="">月入万刀</div><article class="card">${image ? `<div class="visual" style="background-image:url('${escapeHtml(image)}')"></div>` : ''}<div class="content"><p class="eyebrow">${escapeHtml(metadata.platform || '实战内容')}</p><h1 class="title">${escapeHtml(title)}</h1><p class="description">${escapeHtml(description)}</p><p class="byline">${escapeHtml(byline)}</p><a class="open" href="${escapeHtml(canonicalUrl)}">打开内容详情</a></div></article><p class="hint">正在打开内容详情…</p></main>${redirectScript}</body></html>`
}

async function readBody(req) {
  const contentLength = Number(req.headers['content-length'])
  if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BODY_BYTES) throw new Error('请求内容超过大小限制')
  let body = ''
  let size = 0
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk)
    if (size > MAX_JSON_BODY_BYTES) throw new Error('请求内容超过大小限制')
    body += chunk
  }
  return body ? JSON.parse(body) : {}
}

async function readRawBody(req, maxBytes) {
  const contentLength = Number(req.headers['content-length'])
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new Error('上传内容超过大小限制')
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxBytes) throw new Error('上传内容超过大小限制')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks, size)
}

function parseMultipart(body, boundary) {
  const delimiter = Buffer.from(`--${boundary}`)
  const files = []
  let offset = body.indexOf(delimiter)
  while (offset >= 0) {
    let partStart = offset + delimiter.length
    if (body.slice(partStart, partStart + 2).toString() === '--') break
    if (body.slice(partStart, partStart + 2).toString() === '\r\n') partStart += 2
    const next = body.indexOf(delimiter, partStart)
    if (next < 0) break
    let partEnd = next
    if (body.slice(partEnd - 2, partEnd).toString() === '\r\n') partEnd -= 2
    const part = body.slice(partStart, partEnd)
    const separator = part.indexOf(Buffer.from('\r\n\r\n'))
    if (separator >= 0) {
      const headerText = part.slice(0, separator).toString('utf8')
      const content = part.slice(separator + 4)
      const disposition = headerText.match(/content-disposition:\s*form-data;([^\r\n]*)/i)?.[1] || ''
      const name = disposition.match(/(?:^|;)\s*name="([^"]*)"/i)?.[1] || disposition.match(/(?:^|;)\s*name=([^;\s]*)/i)?.[1] || ''
      const filename = disposition.match(/(?:^|;)\s*filename="([^"]*)"/i)?.[1] || disposition.match(/(?:^|;)\s*filename=([^;\s]*)/i)?.[1] || ''
      const type = headerText.match(/^content-type:\s*([^\r\n]+)/im)?.[1]?.trim().toLowerCase() || 'application/octet-stream'
      if (filename) files.push({ name, filename, type, content })
    }
    offset = next
  }
  return files
}

function imageType(buffer, declaredType) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return declaredType === 'image/png' ? 'png' : null
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return declaredType === 'image/jpeg' ? 'jpg' : null
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) return declaredType === 'image/gif' ? 'gif' : null
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return declaredType === 'image/webp' ? 'webp' : null
  return null
}

const IMAGE_OUTPUTS = {
  jpeg: { extension: 'jpg', mimeType: 'image/jpeg' },
  png: { extension: 'png', mimeType: 'image/png' },
  webp: { extension: 'webp', mimeType: 'image/webp' },
  gif: { extension: 'gif', mimeType: 'image/gif' }
}

function imageCompressionError(message, statusCode = 422) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

/**
 * Decode and re-encode uploads before they touch disk. The highest quality
 * candidate under the stored-size cap is preferred, while already optimized
 * originals are preserved. GIFs are also offered as animated WebP so an
 * oversized animation can be reduced without retaining a multi-megabyte GIF.
 */
async function compressUploadedImage(file) {
  const animated = file.type === 'image/gif'
  let metadata
  try {
    metadata = await sharp(file.content, { animated, limitInputPixels: MAX_IMAGE_PIXELS }).metadata()
  } catch {
    throw imageCompressionError('图片无法解析，请重新选择图片', 415)
  }
  const width = Number(metadata.width || 0)
  const height = Number(metadata.height || 0)
  if (!width || !height) throw imageCompressionError('图片尺寸无效，请重新选择图片', 415)
  const needsResize = width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION
  const resizeOptions = { width: MAX_IMAGE_DIMENSION, height: MAX_IMAGE_DIMENSION, fit: 'inside', withoutEnlargement: true }
  const qualitySteps = [82, 72, 60, 48]
  const candidates = []
  const addCandidate = async (format, quality) => {
    let pipeline = sharp(file.content, { animated, limitInputPixels: MAX_IMAGE_PIXELS }).rotate().resize(resizeOptions)
    if (format === 'jpeg') pipeline = pipeline.jpeg({ quality, mozjpeg: true, progressive: true })
    if (format === 'png') pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true, palette: true })
    if (format === 'webp') pipeline = pipeline.webp({ quality, effort: 5, smartSubsample: true })
    if (format === 'gif') pipeline = pipeline.gif({ effort: 7, reuse: true })
    try {
      const buffer = await pipeline.toBuffer()
      candidates.push({ buffer, ...IMAGE_OUTPUTS[format] })
    } catch {}
  }

  const addLossyCandidates = async format => {
    for (const quality of qualitySteps) {
      await addCandidate(format, quality)
      if (candidates.at(-1)?.buffer.length <= MAX_STORED_IMAGE_BYTES) break
    }
  }
  if (file.type === 'image/jpeg') await addLossyCandidates('jpeg')
  if (file.type === 'image/png') {
    await addCandidate('png')
    if (candidates.at(-1)?.buffer.length > MAX_STORED_IMAGE_BYTES) await addLossyCandidates('webp')
  }
  if (file.type === 'image/webp') await addLossyCandidates('webp')
  if (file.type === 'image/gif') {
    await addCandidate('gif')
    if (candidates.at(-1)?.buffer.length > MAX_STORED_IMAGE_BYTES) await addLossyCandidates('webp')
  }
  if (!candidates.length) throw imageCompressionError('图片压缩失败，请更换图片', 422)

  const preferredFormat = file.type === 'image/jpeg' ? 'jpeg' : file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'gif'
  const preferred = candidates.find(candidate => candidate.extension === IMAGE_OUTPUTS[preferredFormat].extension && candidate.buffer.length <= MAX_STORED_IMAGE_BYTES)
  const smallest = [...candidates].sort((a, b) => a.buffer.length - b.buffer.length)[0]
  // Do not inflate an already optimized image. A large source still has to
  // pass the stored-size cap, so it cannot bypass server-side protection.
  const selectedCandidate = preferred && preferred.buffer.length <= MAX_STORED_IMAGE_BYTES ? preferred : smallest
  const selected = !needsResize && file.content.length <= selectedCandidate.buffer.length ? { buffer: file.content, extension: file.extension, mimeType: file.type } : selectedCandidate
  if (selected.buffer.length > MAX_STORED_IMAGE_BYTES) throw imageCompressionError(`图片压缩后仍超过 ${MAX_STORED_IMAGE_BYTES / 1024 / 1024}MB，请更换图片`, 413)
  return selected
}

function uploadUrl(req, filename) {
  const path = `/uploads/${encodeURIComponent(filename)}`
  return UPLOAD_PUBLIC_BASE_URL ? `${UPLOAD_PUBLIC_BASE_URL}${path}` : path
}

function uploadContentType(filename) {
  return { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' }[extname(filename).toLowerCase()] || 'application/octet-stream'
}

function normalizeUploadedUrl(value) {
  const raw = typeof value === 'string' ? value : value && typeof value === 'object' ? value.url : ''
  if (!raw) return null
  try {
    const pathname = new URL(String(raw), 'http://localhost').pathname
    return /^\/uploads\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(pathname) ? pathname : null
  } catch { return null }
}

function normalizeUploadedImages(value) {
  const list = Array.isArray(value) ? value : []
  return [...new Set(list.map(normalizeUploadedUrl).filter(Boolean))].slice(0, MAX_POST_IMAGES)
}

function normalizePoints(value) {
  const points = Number(value)
  return Number.isFinite(points) ? Math.max(0, Math.min(Math.floor(points), 1000000000)) : 0
}

function normalizePermissions(value) {
  const source = Array.isArray(value) ? value : []
  return [...new Set(source.map(item => String(item || '').trim()).filter(item => /^[A-Za-z0-9_.:-]{1,80}$/.test(item)))].slice(0, 50)
}

function groupPermissions(groupId) {
  return normalizePermissions(memberGroups.find(group => group.id === groupId)?.permissions)
}

function membershipPermissions(userId) {
  const permissions = new Set()
  for (const membership of activeMembershipsFor(userId)) for (const permission of groupPermissions(membership.groupId)) permissions.add(permission)
  return [...permissions].sort()
}

function hasPermission(userId, permission) {
  return membershipPermissions(userId).includes(String(permission || '').trim())
}

function pointsBalance(userId) {
  return Math.max(0, Math.floor(Number(pointsAccounts.get(userId) || 0)))
}
function pointsUnitName() { return pointsConfig.unitName || '积分' }
function normalizeReferralCode(value) {
  const code = String(value || '').trim().toUpperCase()
  return /^[A-Z0-9_-]{4,40}$/.test(code) ? code : ''
}
function generateReferralCode(existing = new Set()) {
  let code = ''
  do code = `Y${randomBytes(5).toString('hex').toUpperCase()}`
  while (existing.has(code))
  return code
}
function normalizeReferralConfig(value = {}) {
  const directRaw = value.directPercent ?? value.level1Percent ?? value.rate1 ?? value.commissionPercent ?? value.rechargePercent ?? 10
  const directNumber = Number(directRaw)
  const directPercent = Number.isFinite(directNumber) ? Math.min(Math.max(directNumber, 0), 100) : 10
  const enabled = value.enabled !== false && String(value.enabled).toLowerCase() !== 'false'
  return { enabled, directPercent: Number(directPercent.toFixed(4)), level1Percent: Number(directPercent.toFixed(4)), level2Percent: 0 }
}
function referralConfigPublic() {
  const configured = normalizeReferralConfig(referralConfig)
  return { ...configured, rate1: configured.directPercent, rate2: 0, commissionPercent: configured.directPercent, directRate: configured.directPercent }
}
function normalizeReferralRelation(value) {
  if (!value) return null
  const childId = String(value.childId || value.userId || '').trim()
  const parentId = String(value.parentId || value.referrerId || value.inviterId || '').trim()
  if (!childId || !parentId || childId === parentId) return null
  return { childId, userId: childId, parentId, referrerId: parentId, level: 1, referralCode: normalizeReferralCode(value.referralCode || value.code) || null, createdAt: value.createdAt && !Number.isNaN(new Date(value.createdAt).getTime()) ? new Date(value.createdAt).toISOString() : nowIso() }
}
function normalizeReferralCommission(value) {
  if (!value || !value.beneficiaryId || !value.sourceUserId || !value.sourceId) return null
  const commissionPoints = normalizePoints(value.commissionPoints ?? value.rewardPoints ?? value.amountPoints)
  if (commissionPoints < 1) return null
  return { id: String(value.id || id('referral_commission')), beneficiaryId: String(value.beneficiaryId), userId: String(value.beneficiaryId), sourceUserId: String(value.sourceUserId), sourceId: String(value.sourceId), sourceType: String(value.sourceType || value.orderType || 'points_recharge').slice(0, 60), orderType: String(value.orderType || value.sourceType || 'points_recharge').slice(0, 60), basePoints: normalizePoints(value.basePoints ?? value.points), points: commissionPoints, commissionPoints, ratePercent: Number(value.ratePercent ?? value.percent ?? referralConfig.directPercent) || 0, level: 1, status: ['pending', 'reviewing', 'paid', 'settled', 'rejected', 'cancelled'].includes(String(value.status)) ? String(value.status) : 'paid', ledgerId: value.ledgerId ? String(value.ledgerId) : null, note: value.note ? String(value.note).slice(0, 300) : null, createdAt: value.createdAt && !Number.isNaN(new Date(value.createdAt).getTime()) ? new Date(value.createdAt).toISOString() : nowIso(), settledAt: value.settledAt ? String(value.settledAt) : null }
}
function referralParentId(userId) {
  const relation = referralRelations.get(String(userId))
  const parentId = String(relation?.parentId || '').trim()
  if (!parentId || parentId === String(userId)) return null
  const parent = accounts.get(parentId)
  return parent && parent.status !== 'disabled' ? parentId : null
}
function referralCommissionFor({ sourceUserId, sourceType, sourceId, basePoints, note = null, metadata = {} }) {
  const amount = normalizePoints(basePoints)
  const config = normalizeReferralConfig(referralConfig)
  if (!config.enabled || config.directPercent <= 0 || amount < 1) return []
  const parentId = referralParentId(sourceUserId)
  if (!parentId) return []
  const normalizedSourceType = String(sourceType || 'points_recharge').slice(0, 60)
  const normalizedSourceId = String(sourceId || '').trim()
  if (!normalizedSourceId) return []
  if (referralCommissions.some(item => item.sourceUserId === String(sourceUserId) && item.sourceType === normalizedSourceType && item.sourceId === normalizedSourceId && item.beneficiaryId === parentId)) return []
  const commissionPoints = Math.floor(amount * config.directPercent / 100)
  if (commissionPoints < 1) return []
  const commissionId = id('referral_commission')
  const ledger = appendPointsLedger({ userId: parentId, delta: commissionPoints, type: 'referral_commission', reason: '直属邀请积分提成', actorId: 'system', sourceId: commissionId, note, metadata: { ...metadata, sourceUserId: String(sourceUserId), sourceType: normalizedSourceType, sourceId: normalizedSourceId, ratePercent: config.directPercent, level: 1 } })
  const commission = normalizeReferralCommission({ id: commissionId, beneficiaryId: parentId, sourceUserId, sourceId: normalizedSourceId, sourceType: normalizedSourceType, orderType: normalizedSourceType, basePoints: amount, commissionPoints, points: commissionPoints, ratePercent: config.directPercent, level: 1, status: 'paid', ledgerId: ledger.id, note, createdAt: nowIso(), settledAt: nowIso() })
  referralCommissions.unshift(commission)
  notifyUser(parentId, { type: 'referral_commission', title: '收到直属邀请提成', body: `你的直属用户产生了 ${amount} ${pointsUnitName()} 消费，获得 ${commissionPoints} ${pointsUnitName()} 提成`, targetType: 'referral_commission', targetId: commissionId })
  return [commission]
}
function referralUserPublic(userId) {
  const account = accounts.get(String(userId))
  if (!account && !IS_PRODUCTION && String(userId) === 'demo') return { id: 'demo', name: '演示用户', username: 'demo', avatarUrl: null, createdAt: null }
  if (!account) return { id: String(userId), name: '已注销用户', username: '', createdAt: null }
  const profile = profileFor(account)
  return { id: account.id, name: profile.name || account.username, username: account.username, avatarUrl: profile.avatarUrl || null, createdAt: account.createdAt || profile.createdAt || null }
}
function referralCommissionPublic(item) {
  if (!item) return null
  const sourceUser = referralUserPublic(item.sourceUserId)
  return { ...item, level: 1, unitName: pointsUnitName(), inviteeName: sourceUser.name, sourceUserName: sourceUser.name, username: sourceUser.username, action: item.orderType || item.sourceType, amountPoints: item.commissionPoints, rewardPoints: item.commissionPoints }
}
function referralSummary(userId, includeItems = true) {
  const directRelations = [...referralRelations.values()].filter(item => item.parentId === String(userId) && item.level === 1)
  const directIds = new Set(directRelations.map(item => item.childId))
  const commissions = referralCommissions.filter(item => item.beneficiaryId === String(userId) && directIds.has(item.sourceUserId)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  const total = commissions.filter(item => !['rejected', 'cancelled'].includes(item.status)).reduce((sum, item) => sum + normalizePoints(item.commissionPoints), 0)
  const pending = commissions.filter(item => ['pending', 'reviewing'].includes(item.status)).reduce((sum, item) => sum + normalizePoints(item.commissionPoints), 0)
  const account = accounts.get(String(userId))
  const code = normalizeReferralCode(account?.referralCode) || ''
  const shareUrl = code ? `${PUBLIC_WEB_BASE_URL}/login.html?ref=${encodeURIComponent(code)}` : ''
  return { ...referralConfigPublic(), code, referralCode: code, inviteCode: code, shareUrl, inviteUrl: shareUrl, qrUrl: '', level1Count: directRelations.length, directCount: directRelations.length, firstLevelCount: directRelations.length, level2Count: 0, totalEarningsPoints: total, directEarningsPoints: total, pendingEarningsPoints: pending, totalCommissionPoints: total, pendingCommissionPoints: pending, unitName: pointsUnitName(), invites: directRelations.map(item => ({ ...referralUserPublic(item.childId), level: 1, relationLevel: 1, boundAt: item.createdAt, registeredAt: referralUserPublic(item.childId).createdAt })), commissionItems: includeItems ? commissions.slice(0, 100).map(referralCommissionPublic) : [] }
}
function normalizeCheckinConfig(value = {}) {
  const dailyRaw = value.dailyPoints ?? value.basePoints ?? value.dailyReward ?? value.points ?? 10
  const dailyNumber = Number(dailyRaw)
  const dailyPoints = Number.isFinite(dailyNumber) ? normalizePoints(dailyNumber) : 10
  const sourceRewards = value.streakRewards ?? value.streakBonuses ?? value.continuousRewards ?? value.continuousBonus ?? []
  const rewards = Array.isArray(sourceRewards) ? sourceRewards : []
  const byDays = new Map()
  for (const item of rewards) {
    const days = Number(item?.days ?? item?.streak ?? item?.day)
    const bonus = Number(item?.bonusPoints ?? item?.points ?? item?.reward ?? item?.amount)
    if (Number.isInteger(days) && days >= 2 && days <= 3650 && Number.isFinite(bonus) && bonus >= 0) byDays.set(days, { days, bonusPoints: normalizePoints(bonus) })
  }
  const streakBonusRaw = Number(value.streakBonusPoints ?? value.continuousBonusPoints ?? 0)
  const timezone = String(value.timezone || 'Asia/Shanghai') === 'Asia/Shanghai' ? 'Asia/Shanghai' : 'Asia/Shanghai'
  const leaderboardDaysRaw = Number(value.leaderboardDays ?? value.rankingDays ?? 30)
  const leaderboardDays = Number.isInteger(leaderboardDaysRaw) ? Math.min(Math.max(leaderboardDaysRaw, 7), 3650) : 30
  return { enabled: value.enabled !== false && String(value.enabled).toLowerCase() !== 'false', dailyPoints, streakRewards: [...byDays.values()].sort((a, b) => a.days - b.days).slice(0, 30), streakBonusPoints: Number.isFinite(streakBonusRaw) ? normalizePoints(streakBonusRaw) : 0, timezone, leaderboardDays }
}
function checkinConfigPublic() {
  const configured = normalizeCheckinConfig(checkinConfig)
  return { ...configured, basePoints: configured.dailyPoints, dailyReward: configured.dailyPoints, continuousRewards: configured.streakRewards, unitName: pointsUnitName() }
}
function checkinDateKey(date = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(date))
  const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}
function checkinDateOffset(dateKey, offset) {
  const match = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return dateKey
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + Number(offset || 0)))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}
function normalizeCheckinRecord(value) {
  if (!value || !value.userId) return null
  const checkinDate = String(value.checkinDate || value.date || '').match(/^\d{4}-\d{2}-\d{2}$/)?.[0]
  if (!checkinDate) return null
  const basePoints = normalizePoints(value.basePoints ?? value.dailyPoints ?? value.points)
  const bonusPoints = normalizePoints(value.bonusPoints ?? value.streakBonus ?? 0)
  const totalPoints = normalizePoints(value.totalPoints ?? basePoints + bonusPoints)
  return { id: String(value.id || id('checkin')), userId: String(value.userId), checkinDate, date: checkinDate, basePoints, bonusPoints, totalPoints, points: totalPoints, streak: Math.max(1, Math.floor(Number(value.streak) || 1)), ledgerId: value.ledgerId ? String(value.ledgerId) : null, createdAt: value.createdAt && !Number.isNaN(new Date(value.createdAt).getTime()) ? new Date(value.createdAt).toISOString() : nowIso() }
}
function userCheckinRecords(userId) {
  return (checkins.get(String(userId)) || []).filter(Boolean).sort((a, b) => a.checkinDate.localeCompare(b.checkinDate))
}
function checkinStreak(records, anchorDate) {
  const dates = new Set(records.map(record => record.checkinDate))
  let streak = 0
  let cursor = anchorDate
  while (dates.has(cursor)) { streak += 1; cursor = checkinDateOffset(cursor, -1) }
  return streak
}
function checkinLongestStreak(records) {
  const dates = [...new Set(records.map(record => record.checkinDate))].sort()
  let longest = 0; let current = 0; let previous = null
  for (const date of dates) { current = previous && checkinDateOffset(previous, 1) === date ? current + 1 : 1; longest = Math.max(longest, current); previous = date }
  return longest
}
function checkinSummary(userId) {
  const records = userCheckinRecords(userId)
  const today = checkinDateKey()
  const todayRecord = records.find(record => record.checkinDate === today) || null
  const currentStreak = checkinStreak(records, todayRecord ? today : checkinDateOffset(today, -1))
  const totalPoints = records.reduce((sum, record) => sum + record.totalPoints, 0)
  const last = records.at(-1) || null
  const todayCount = [...checkins.values()].filter(items => items.some(record => record.checkinDate === today)).length
  const config = normalizeCheckinConfig(checkinConfig); const nextStreak = todayRecord ? todayRecord.streak : checkinStreak(records, checkinDateOffset(today, -1)) + 1; const milestone = config.streakRewards.find(item => item.days === nextStreak); const expectedBonus = todayRecord ? todayRecord.bonusPoints : normalizePoints((milestone?.bonusPoints || 0) + (config.streakBonusPoints > 0 && nextStreak > 1 ? config.streakBonusPoints : 0)); const expectedReward = normalizePoints(config.dailyPoints + expectedBonus)
  return { todaySigned: Boolean(todayRecord), checkedIn: Boolean(todayRecord), todayReward: todayRecord?.totalPoints ?? expectedReward, nextReward: expectedReward, bonusPoints: expectedBonus, reward: todayRecord ? { ...todayRecord, unitName: pointsUnitName() } : null, currentStreak, streak: currentStreak, longestStreak: checkinLongestStreak(records), totalDays: records.length, totalCheckinDays: records.length, totalPoints, todayCount, unitName: pointsUnitName(), lastCheckinDate: last?.checkinDate || null, recentRecords: records.slice(-30).reverse().map(record => ({ ...record, unitName: pointsUnitName() })) }
}
function checkinPeriodRange(period = 'month', today = checkinDateKey()) {
  const normalized = String(period || 'month').toLowerCase()
  if (normalized === 'all' || normalized === 'total') return { period: 'all', start: null, end: today }
  if (normalized === '7d' || normalized === 'week') return { period: '7d', start: checkinDateOffset(today, -6), end: today }
  if (normalized === '30d' || normalized === 'month30') return { period: '30d', start: checkinDateOffset(today, -29), end: today }
  if (normalized === 'month') return { period: 'month', start: `${today.slice(0, 7)}-01`, end: today }
  const days = Number(normalized)
  if (Number.isInteger(days) && days > 0) return { period: `${days}d`, start: checkinDateOffset(today, -(days - 1)), end: today }
  return { period: 'month', start: `${today.slice(0, 7)}-01`, end: today }
}
function checkinLeaderboard(input = {}) {
  const today = checkinDateKey(); const range = checkinPeriodRange(input.period || 'month', today)
  const rows = []
  for (const [userId, values] of checkins.entries()) {
    const records = userCheckinRecords(userId); const scoped = records.filter(record => (!range.start || record.checkinDate >= range.start) && record.checkinDate <= range.end)
    if (!scoped.length) continue
    const account = accounts.get(userId); const profile = account ? profileFor(account) : null
    const displayName = profile?.name || account?.name || account?.username || '用户'
    rows.push({ userId, id: userId, name: displayName, nickname: displayName, avatarUrl: profile?.avatarUrl || account?.avatarUrl || null, days: scoped.length, checkinDays: scoped.length, totalDays: records.length, points: scoped.reduce((sum, record) => sum + record.totalPoints, 0), totalPoints: records.reduce((sum, record) => sum + record.totalPoints, 0), streak: checkinStreak(records, today), currentStreak: checkinStreak(records, today), todaySigned: records.some(record => record.checkinDate === today) })
  }
  rows.sort((a, b) => b.streak - a.streak || b.days - a.days || b.points - a.points || String(a.name).localeCompare(String(b.name)))
  rows.forEach((row, index) => { row.rank = index + 1 })
  const requestedLimit = Number(input.limit ?? input.pageSize ?? 20); const limit = Math.min(Math.max(Number.isInteger(requestedLimit) ? requestedLimit : 20, 1), 100)
  const page = paginate(rows, { ...input, pageSize: limit })
  const mine = input.userId ? rows.find(row => row.userId === String(input.userId)) || null : null
  return { ...page, items: page.items.slice(0, limit), period: range.period, startDate: range.start, endDate: range.end, today, todayCount: rows.filter(row => row.todaySigned).length, myRank: mine?.rank || null, ranking: page.items.slice(0, limit) }
}
function checkinAdminSummary() {
  const today = checkinDateKey(); const allRecords = [...checkins.values()].flat(); const todayRecords = allRecords.filter(record => record.checkinDate === today)
  const activeStreakUsers = [...checkins.entries()].filter(([, records]) => checkinStreak(userCheckinRecords(records[0]?.userId), today) > 0).length
  return { todayCount: new Set(todayRecords.map(record => record.userId)).size, totalCount: allRecords.length, totalPoints: allRecords.reduce((sum, record) => sum + record.totalPoints, 0), activeStreakUsers }
}
function checkinRecordPublic(record) { return record ? { ...record, unitName: pointsUnitName() } : null }
function createCheckin(userId, req) {
  const config = normalizeCheckinConfig(checkinConfig)
  if (!config.enabled) return { status: 403, error: '签到功能暂未开放' }
  const today = checkinDateKey(); const records = userCheckinRecords(userId)
  const existing = records.find(record => record.checkinDate === today)
  if (existing) return { status: 409, error: '今天已经签到', duplicate: true, record: checkinRecordPublic(existing), summary: checkinSummary(userId) }
  const previousStreak = checkinStreak(records, checkinDateOffset(today, -1)); const streak = previousStreak + 1
  const milestone = config.streakRewards.find(item => item.days === streak)
  const recurringBonus = config.streakBonusPoints > 0 && streak > 1 ? config.streakBonusPoints : 0
  const bonusPoints = normalizePoints((milestone?.bonusPoints || 0) + recurringBonus)
  const totalPoints = normalizePoints(config.dailyPoints + bonusPoints)
  const recordId = id('checkin')
  const ledger = appendPointsLedger({ userId, delta: totalPoints, type: 'checkin_reward', reason: streak > 1 ? `连续签到第 ${streak} 天奖励` : '每日签到奖励', actorId: userId, sourceId: recordId, note: milestone ? `连续签到 ${milestone.days} 天额外奖励` : null, metadata: { checkinDate: today, streak, basePoints: config.dailyPoints, bonusPoints } })
  const record = normalizeCheckinRecord({ id: recordId, userId, checkinDate: today, basePoints: config.dailyPoints, bonusPoints, totalPoints, streak, ledgerId: ledger.id, createdAt: nowIso() })
  checkins.set(String(userId), [...records, record])
  notifyUser(userId, { type: 'checkin_reward', title: '签到成功', body: `获得 ${totalPoints} ${pointsUnitName()}${bonusPoints ? `（含连续签到奖励 ${bonusPoints}）` : ''}`, targetType: 'checkin', targetId: record.id })
  appendAudit(req, 'create', 'checkin', record.id, { userId, checkinDate: today, streak, basePoints: config.dailyPoints, bonusPoints, totalPoints })
  return { status: 201, record: checkinRecordPublic(record), summary: checkinSummary(userId) }
}
function normalizeWithdrawalConfig(value = {}) {
  const pointsPerYuanRaw = value.pointsPerYuan ?? value.pointsPerRmb ?? value.pointsRate ?? value.pointsToRmb
  const feeRaw = value.withdrawFeePercent ?? value.feePercent ?? value.withdrawalFeePercent
  const minRaw = value.minPoints ?? value.minimumPoints ?? 1
  const pointsPerYuanNumber = Number(pointsPerYuanRaw)
  const feeNumber = Number(feeRaw)
  const minNumber = Number(minRaw)
  const pointsPerYuan = Number.isFinite(pointsPerYuanNumber) && pointsPerYuanNumber > 0 ? Math.min(pointsPerYuanNumber, 1000000000) : 100
  const withdrawFeePercent = Number.isFinite(feeNumber) ? Math.min(Math.max(feeNumber, 0), 100) : 0
  const minPoints = Number.isFinite(minNumber) ? Math.min(Math.max(Math.floor(minNumber), 1), 1000000000) : 1
  return { pointsPerYuan: Number(pointsPerYuan.toFixed(6)), withdrawFeePercent: Number(withdrawFeePercent.toFixed(4)), minPoints }
}
function withdrawalConfig() {
  const configured = normalizeWithdrawalConfig(pointsConfig.withdrawal)
  return { ...configured, pointsPerRmb: configured.pointsPerYuan, feePercent: configured.withdrawFeePercent }
}
function roundRmb(value) { return Number(Math.max(0, Number(value) || 0).toFixed(2)) }
function withdrawalQuote(points) {
  const config = withdrawalConfig()
  const amount = Math.max(0, Math.floor(Number(points) || 0))
  const grossAmountRmb = roundRmb(amount / config.pointsPerYuan)
  const feeAmountRmb = roundRmb(grossAmountRmb * config.withdrawFeePercent / 100)
  const netAmountRmb = roundRmb(grossAmountRmb - feeAmountRmb)
  return { points: amount, unitName: pointsUnitName(), pointsPerYuan: config.pointsPerYuan, pointsPerRmb: config.pointsPerYuan, withdrawFeePercent: config.withdrawFeePercent, feePercent: config.withdrawFeePercent, minPoints: config.minPoints, grossAmountRmb, feeAmountRmb, netAmountRmb, grossRmb: grossAmountRmb, feeRmb: feeAmountRmb, netRmb: netAmountRmb }
}
function normalizeWithdrawalQrCode(value) {
  const raw = String(value || '').trim().slice(0, 500)
  if (!raw) return ''
  const uploaded = normalizeUploadedUrl(raw)
  if (uploaded) return uploaded
  return ''
}
function normalizeWithdrawalPhone(value) { return String(value || '').trim().replace(/[\s()-]/g, '') }
function validWithdrawalPhone(value) { return /^1[3-9]\d{9}$/.test(normalizeWithdrawalPhone(value)) }
function normalizeWithdrawalRecord(item) {
  if (!item || !item.userId) return null
  const points = normalizePoints(item.points)
  const quote = withdrawalQuote(points)
  const status = ['pending', 'paid', 'rejected'].includes(String(item.status)) ? String(item.status) : 'pending'
  return {
    id: String(item.id || id('withdrawal')),
    userId: String(item.userId),
    qrCodeUrl: normalizeWithdrawalQrCode(item.qrCodeUrl || item.paymentQrCodeUrl),
    channel: ['alipay', 'wechat'].includes(String(item.channel)) ? String(item.channel) : null,
    phone: normalizeWithdrawalPhone(item.phone || item.contactPhone),
    points,
    pointsPerYuan: Number(item.pointsPerYuan || item.pointsPerRmb || quote.pointsPerYuan),
    withdrawFeePercent: Number(item.withdrawFeePercent ?? item.feePercent ?? quote.withdrawFeePercent),
    grossAmountRmb: Number(item.grossAmountRmb ?? item.grossRmb ?? quote.grossAmountRmb),
    feeAmountRmb: Number(item.feeAmountRmb ?? item.feeRmb ?? quote.feeAmountRmb),
    netAmountRmb: Number(item.netAmountRmb ?? item.netRmb ?? quote.netAmountRmb),
    status,
    createdAt: item.createdAt && !Number.isNaN(new Date(item.createdAt).getTime()) ? new Date(item.createdAt).toISOString() : nowIso(),
    paidAt: item.paidAt ? String(item.paidAt) : null,
    paidBy: item.paidBy ? String(item.paidBy) : null,
    rejectedAt: item.rejectedAt ? String(item.rejectedAt) : null,
    rejectedBy: item.rejectedBy ? String(item.rejectedBy) : null,
    rejectReason: item.rejectReason ? String(item.rejectReason).slice(0, 500) : null,
    note: item.note ? String(item.note).slice(0, 500) : null,
    adminNote: item.adminNote ? String(item.adminNote).slice(0, 500) : null,
    ledgerId: item.ledgerId ? String(item.ledgerId) : null,
    refundLedgerId: item.refundLedgerId ? String(item.refundLedgerId) : null
  }
}
function withdrawalPublic(item, includeUser = false) {
  if (!item) return null
  const quote = withdrawalQuote(item.points)
  const pointsPerYuan = Number(item.pointsPerYuan || quote.pointsPerYuan)
  const withdrawFeePercent = Number(item.withdrawFeePercent ?? quote.withdrawFeePercent)
  const grossAmountRmb = Number(item.grossAmountRmb ?? quote.grossAmountRmb)
  const feeAmountRmb = Number(item.feeAmountRmb ?? quote.feeAmountRmb)
  const netAmountRmb = Number(item.netAmountRmb ?? quote.netAmountRmb)
  const result = { ...item, unitName: pointsUnitName(), pointsPerYuan, pointsPerRmb: pointsPerYuan, withdrawFeePercent, feePercent: withdrawFeePercent, minPoints: quote.minPoints, grossAmountRmb, feeAmountRmb, netAmountRmb, grossRmb: grossAmountRmb, feeRmb: feeAmountRmb, netRmb: netAmountRmb }
  if (includeUser) {
    const account = accounts.get(item.userId)
    result.user = account ? { ...accountUser(account), name: profileFor(account)?.name || account.name || account.username } : { id: item.userId, name: item.userId }
  }
  return result
}
function purchaseContact() {
  const contact = { ...(pointsConfig.purchaseContact || {}) }
  return { ...contact, wechatQrUrl: contact.qrCodeUrl || '', instructions: contact.note || '', offlineTitle: contact.offlineTitle || '线下开通', offlineNote: contact.offlineNote || '联系管理员完成收款，确认后立即生效。', displayName: '客服微信', isEnabled: Boolean(contact.wechatId || contact.qrCodeUrl) }
}
function normalizeCdkey(value) { return String(value || '').trim().toUpperCase().replace(/\s+/g, '') }
function cdkeyHash(value) { return createHash('sha256').update(normalizeCdkey(value)).digest('hex') }
function migrateCdkey(item) {
  const next = { ...item }
  const legacyCode = normalizeCdkey(next.code)
  if (!next.codeHash && legacyCode) next.codeHash = cdkeyHash(legacyCode)
  if (!next.codePrefix && legacyCode) next.codePrefix = legacyCode.slice(0, 7)
  if (!next.codeSuffix && legacyCode) next.codeSuffix = legacyCode.slice(-4)
  delete next.code
  return next
}
function generateCdkey() {
  let key = ''
  do key = `SC-${randomBytes(4).toString('hex').toUpperCase()}-${randomBytes(6).toString('hex').toUpperCase()}-${randomBytes(6).toString('hex').toUpperCase()}`
  while (cdkeys.some(item => item.codeHash === cdkeyHash(key)))
  return key
}
function cdkeyStatus(item) {
  return item.status === 'unused' && item.expiresAt && new Date(item.expiresAt).getTime() <= Date.now() ? 'expired' : item.status
}
function cdkeyForPublic(item, { includeCode = true } = {}) {
  const plan = item.planId ? plans.find(candidate => candidate.id === item.planId) : null
  const redeemPoints = item.kind === 'points' ? item.points : plan?.redeemPoints || 0
  const rawCode = item.code || ''
  const prefix = item.codePrefix || rawCode.slice(0, 7)
  const suffix = item.codeSuffix || rawCode.slice(-4)
  const code = includeCode && rawCode ? rawCode : `${prefix}••••${suffix}`
  const { code: _code, codeHash: _codeHash, codePrefix: _codePrefix, codeSuffix: _codeSuffix, ...safeItem } = item
  return { ...safeItem, code, status: cdkeyStatus(item), planName: plan?.name || null, redeemPoints, pricePoints: redeemPoints }
}
function membershipRedeemPoints(plan) { return normalizePoints(plan?.redeemPoints ?? plan?.pricePoints) }

function appendPointsLedger({ userId, delta, type, reason, actorId = 'system', sourceId = null, note = null, metadata = {} }) {
  const amount = Math.trunc(Number(delta))
  if (!userId || !Number.isInteger(amount) || amount === 0) throw new Error('积分变动参数无效')
  const balanceBefore = pointsBalance(userId)
  const balanceAfter = balanceBefore + amount
  if (balanceAfter < 0) throw new Error('积分余额不足')
  pointsAccounts.set(userId, balanceAfter)
  const entry = { id: id('points_tx'), userId, delta: amount, balanceBefore, balanceAfter, type: String(type || (amount > 0 ? 'credit' : 'debit')), reason: String(reason || '').trim().slice(0, 200), sourceId, note: note ? String(note).trim().slice(0, 500) : null, actorId, createdAt: nowIso(), metadata }
  pointsLedger.unshift(entry)
  return entry
}

function refundPointsOrder(order, actorId = 'system') {
  if (order?.refundLedgerIds?.length || order?.refundLedgerId) return []
  const amount = normalizePoints(order?.amountPoints)
  if (!order || order.paymentProvider !== 'points' || amount < 1) return []
  const effects = [{ userId: order.userId, delta: amount, reason: '积分订单退款', sourceId: order.id, note: order.title || null }]
  if (order.kind === 'post' && order.recipientLedgerId) {
    const recipient = pointsLedger.find(item => item.id === order.recipientLedgerId && item.delta > 0)
    if (recipient) effects.push({ userId: recipient.userId, delta: -recipient.delta, reason: '付费内容退款回冲', sourceId: order.id, note: order.title || null })
  }
  if (order.kind === 'membership' && order.membershipId) {
    const gift = pointsLedger.find(item => item.sourceId === order.membershipId && item.type === 'membership_gift' && item.delta > 0)
    if (gift) effects.push({ userId: gift.userId, delta: -gift.delta, reason: '会员退款回收赠送积分', sourceId: order.id, note: order.title || null })
  }
  const totals = new Map()
  for (const effect of effects) totals.set(effect.userId, (totals.get(effect.userId) || 0) + effect.delta)
  for (const [userId, delta] of totals) if (pointsBalance(userId) + delta < 0) throw new Error('收款方积分余额不足，暂不能完成退款')
  const entries = effects.map(effect => appendPointsLedger({ ...effect, type: effect.delta > 0 ? 'order_refund' : 'order_refund_reversal', actorId, metadata: { orderId: order.id, originalLedgerId: order.ledgerId || null } }))
  order.refundLedgerIds = entries.map(entry => entry.id)
  return entries
}

function refundPointsTip(tip, actorId = 'system') {
  if (tip?.refundLedgerIds?.length || tip?.refundLedgerId) return []
  const amount = normalizePoints(tip?.points)
  if (!tip || amount < 1 || !tip.ledgerId) return []
  const effects = [{ userId: tip.userId, delta: amount, reason: '积分打赏退款', sourceId: tip.id, note: tip.message || null }]
  if (tip.recipientLedgerId) {
    const recipient = pointsLedger.find(item => item.id === tip.recipientLedgerId && item.delta > 0)
    if (recipient) effects.push({ userId: recipient.userId, delta: -recipient.delta, reason: '打赏退款回冲', sourceId: tip.id, note: tip.message || null })
  }
  const totals = new Map()
  for (const effect of effects) totals.set(effect.userId, (totals.get(effect.userId) || 0) + effect.delta)
  for (const [userId, delta] of totals) if (pointsBalance(userId) + delta < 0) throw new Error('收款方积分余额不足，暂不能完成退款')
  const entries = effects.map(effect => appendPointsLedger({ ...effect, type: effect.delta > 0 ? 'tip_refund' : 'tip_refund_reversal', actorId, metadata: { tipId: tip.id, originalLedgerId: tip.ledgerId } }))
  tip.refundLedgerIds = entries.map(entry => entry.id)
  return entries
}

function membershipGroup(membership) {
  return memberGroups.find(group => group.id === membership?.groupId) || null
}

function encodeBase64Url(value) { return Buffer.from(value).toString('base64url') }
function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(String(password), salt, 64).toString('hex') }
}
function verifyPassword(password, account) {
  try { const actual = Buffer.from(passwordHash(password, account.passwordSalt).hash, 'hex'); const expected = Buffer.from(account.passwordHash, 'hex'); return actual.length === expected.length && timingSafeEqual(actual, expected) } catch { return false }
}
function normalizeUsername(value) { return String(value || '').trim().toLowerCase() }
function normalizeEmail(value) { return String(value || '').trim().toLowerCase() }
function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) }
function validUsername(value) { return /^[a-zA-Z0-9_\-\u4e00-\u9fa5]{3,24}$/.test(value) }
function verificationHash(code) { return createHash('sha256').update(String(code)).digest('hex') }
function safeEqualText(actual, expected) {
  const left = Buffer.from(String(actual || ''))
  const right = Buffer.from(String(expected || ''))
  return left.length === right.length && timingSafeEqual(left, right)
}
function verificationPurpose(item) { return item?.purpose || 'register' }
function verificationFor(email, purpose) { return emailVerifications.find(item => item.email === email && verificationPurpose(item) === purpose) }
function requestIp(req) {
  return String(req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim() || 'unknown'
}
function verificationIpLimit(req, buckets) {
  const ip = requestIp(req)
  const bucket = buckets.get(ip) || { startedAt: Date.now(), count: 0 }
  if (Date.now() - bucket.startedAt > 10 * 60 * 1000) { bucket.startedAt = Date.now(); bucket.count = 0 }
  if (bucket.count >= 5) return false
  bucket.count += 1; buckets.set(ip, bucket)
  return true
}
function adminLoginThrottle(req, usernameKey) {
  const key = `${requestIp(req)}:${String(usernameKey || '<empty>')}`
  const now = Date.now()
  const bucket = adminLoginBuckets.get(key)
  if (!bucket || now - bucket.lastFailureAt > 15 * 60 * 1000) {
    adminLoginBuckets.set(key, { failures: 0, lastFailureAt: now, blockedUntil: 0 })
    return { key, allowed: true }
  }
  if (bucket.blockedUntil > now) return { key, allowed: false, retryAfter: Math.max(1, Math.ceil((bucket.blockedUntil - now) / 1000)) }
  return { key, allowed: true }
}
function recordAdminLoginFailure(key) {
  const now = Date.now()
  const bucket = adminLoginBuckets.get(key) || { failures: 0, lastFailureAt: now, blockedUntil: 0 }
  if (now - bucket.lastFailureAt > 15 * 60 * 1000) bucket.failures = 0
  bucket.failures += 1
  bucket.lastFailureAt = now
  if (bucket.failures >= 5) {
    const delay = Math.min(15 * 60 * 1000, 30 * 1000 * (2 ** Math.min(bucket.failures - 5, 5)))
    bucket.blockedUntil = now + delay
  }
  adminLoginBuckets.set(key, bucket)
  return bucket.blockedUntil > now ? Math.max(1, Math.ceil((bucket.blockedUntil - now) / 1000)) : 0
}
function clearAdminLoginFailures(key) { adminLoginBuckets.delete(key) }
function userLoginThrottle(req, identifier) {
  const key = `${requestIp(req)}:${String(identifier || '<empty>')}`
  const now = Date.now()
  const bucket = userLoginBuckets.get(key)
  if (!bucket || now - bucket.lastFailureAt > 15 * 60 * 1000) {
    userLoginBuckets.set(key, { failures: 0, lastFailureAt: now, blockedUntil: 0 })
    return { key, allowed: true }
  }
  if (bucket.blockedUntil > now) return { key, allowed: false, retryAfter: Math.max(1, Math.ceil((bucket.blockedUntil - now) / 1000)) }
  return { key, allowed: true }
}
function recordUserLoginFailure(key) {
  const now = Date.now()
  const bucket = userLoginBuckets.get(key) || { failures: 0, lastFailureAt: now, blockedUntil: 0 }
  if (now - bucket.lastFailureAt > 15 * 60 * 1000) bucket.failures = 0
  bucket.failures += 1
  bucket.lastFailureAt = now
  if (bucket.failures >= 5) {
    const delay = Math.min(15 * 60 * 1000, 30 * 1000 * (2 ** Math.min(bucket.failures - 5, 5)))
    bucket.blockedUntil = now + delay
  }
  userLoginBuckets.set(key, bucket)
  return bucket.blockedUntil > now ? Math.max(1, Math.ceil((bucket.blockedUntil - now) / 1000)) : 0
}
function clearUserLoginFailures(key) { userLoginBuckets.delete(key) }
function smtpForPublic() { return { host: smtpConfig.host, port: smtpConfig.port, secure: smtpConfig.secure, user: smtpConfig.user, from: smtpConfig.from, configured: Boolean(smtpConfig.host && smtpConfig.user && smtpConfig.pass) } }
async function sendVerificationEmail(email, code, purpose = 'register') {
  if (!smtpConfig.host || !smtpConfig.user || !smtpConfig.pass) {
    if (!IS_PRODUCTION) { console.log(`[dev] email verification code for ${email}: ${code}`); return }
    throw new Error('SMTP 尚未配置，暂时无法发送验证码')
  }
  const transporter = nodemailer.createTransport({ host: smtpConfig.host, port: smtpConfig.port, secure: smtpConfig.secure, auth: { user: smtpConfig.user, pass: smtpConfig.pass }, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 10000 })
  const reset = purpose === 'password_reset'
  const action = reset ? '密码找回' : '注册'
  await transporter.sendMail({ from: smtpConfig.from || smtpConfig.user, to: email, subject: `月入万刀${action}验证码`, text: `你的月入万刀${action}验证码是：${code}\n验证码 10 分钟内有效，请勿转发给他人。`, html: `<div style="font-family:Arial,sans-serif;line-height:1.7"><h2>月入万刀</h2><p>你的${action}验证码是：</p><p style="font-size:28px;letter-spacing:8px;font-weight:700">${code}</p><p>验证码 10 分钟内有效，请勿转发给他人。</p></div>` })
}
function accountUser(account) { return { id: account.id, name: account.name || account.username, username: account.username, email: account.email, avatarUrl: account.avatarUrl || null, referralCode: normalizeReferralCode(account.referralCode) || null } }
function signToken(user, remember = true) {
  const header = encodeBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = encodeBase64Url(JSON.stringify({ sub: user.id, name: user.name, email: user.email || null, ver: user.authVersion || null, exp: Date.now() + (remember ? 30 : 7) * 24 * 60 * 60 * 1000 }))
  const signature = createHmac('sha256', AUTH_SECRET).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}
const ADMIN_ROLES = {
  superadmin: { label: '超级管理员', permissions: ['*'] },
  content_admin: { label: '内容管理员', permissions: ['dashboard.read', 'content.manage', 'notifications.manage', 'system.audit'] },
  finance_admin: { label: '财务管理员', permissions: ['dashboard.read', 'finance.manage', 'membership.manage', 'notifications.manage', 'system.audit'] },
  support_admin: { label: '客服管理员', permissions: ['dashboard.read', 'content.read', 'membership.read', 'users.read', 'notifications.manage', 'system.audit'] }
}
function adminRole(role) { return ADMIN_ROLES[String(role)] ? String(role) : 'support_admin' }
function adminPublic(admin) {
  return { id: admin.id, username: admin.username, name: admin.name || admin.username, role: adminRole(admin.role), roleLabel: ADMIN_ROLES[adminRole(admin.role)].label, permissions: ADMIN_ROLES[adminRole(admin.role)].permissions, status: admin.status, createdAt: admin.createdAt || null, lastLoginAt: admin.lastLoginAt || null }
}
function signAdminToken(admin, remember = true) {
  const header = encodeBase64Url(JSON.stringify({ alg: 'HS256', typ: 'ADMIN' }))
  const payload = encodeBase64Url(JSON.stringify({ typ: 'admin', sub: admin.id, ver: admin.authVersion || null, exp: Date.now() + (remember ? 30 : 7) * 24 * 60 * 60 * 1000 }))
  const signature = createHmac('sha256', AUTH_SECRET).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}
function currentAdmin(req) {
  if (!IS_PRODUCTION && Boolean(ADMIN_KEY) && String(req.headers['x-admin-key'] || '') === ADMIN_KEY) return { id: 'legacy-admin', username: 'admin', name: '管理员密钥', role: 'superadmin', permissions: ['*'], status: 'active' }
  const token = String(req.headers['x-admin-token'] || req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  try {
    const [header, payload, signature] = token.split('.')
    const expected = createHmac('sha256', AUTH_SECRET).update(`${header}.${payload}`).digest('base64url')
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    const admin = admins.get(parsed.sub)
    if (parsed.typ !== 'admin' || !safeEqualText(signature, expected) || parsed.exp <= Date.now() || !admin || admin.status !== 'active' || (admin.authVersion && parsed.ver !== admin.authVersion)) return null
    return { ...adminPublic(admin), _record: admin }
  } catch { return null }
}
function hasAdminPermission(admin, permission) {
  if (!admin || !permission) return false
  const permissions = admin.permissions || ADMIN_ROLES[adminRole(admin.role)].permissions
  if (permissions.includes('*') || permissions.includes(permission)) return true
  const [resource, action] = String(permission).split('.')
  return action === 'read' && permissions.includes(`${resource}.manage`)
}
function adminPermissionFor(pathname, method) {
  if (pathname === '/api/v1/admin/overview') return 'dashboard.read'
  if (pathname === '/api/v1/admin/auth/me') return 'dashboard.read'
  if (pathname.startsWith('/api/v1/admin/auth/') || pathname.startsWith('/api/v1/admin/admins')) return 'system.admins'
  if (pathname.includes('/settings/smtp') || pathname === '/api/v1/admin/smtp') return 'system.settings'
  if (pathname === '/api/v1/admin/audit-logs') return 'system.audit'
  if (pathname.startsWith('/api/v1/admin/notifications')) return 'notifications.manage'
  if (/\/(points|point-recharges|cdkeys|cdkey-redemptions|orders|tips|withdrawals|withdrawal-config|referral|checkin)/.test(pathname)) return 'finance.manage'
  if (/^\/api\/v1\/admin\/users(?:\/[^/]+)?$/.test(pathname)) return method === 'GET' ? 'users.read' : 'users.manage'
  if (/\/(member-groups|member-plans|membership-plans|memberships)/.test(pathname)) return method === 'GET' ? 'membership.read' : 'membership.manage'
  if (/\/(reports|comment-reports|comments|posts|tags)/.test(pathname)) return method === 'GET' ? 'content.read' : 'content.manage'
  return 'dashboard.read'
}
function currentUser(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (token) {
    try {
      const [header, payload, signature] = token.split('.')
      const expected = createHmac('sha256', AUTH_SECRET).update(`${header}.${payload}`).digest('base64url')
      const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
      if (safeEqualText(signature, expected) && parsed.exp > Date.now()) {
        const account = accounts.get(parsed.sub)
        if (account && account.status !== 'disabled' && (!account.authVersion || parsed.ver === account.authVersion)) return { id: account.id, name: account.name || account.username, username: account.username, email: account.email, avatarUrl: account.avatarUrl || null, referralCode: normalizeReferralCode(account.referralCode) || null }
        if (!account && parsed.sub === 'demo') return { id: parsed.sub, name: parsed.name || '用户', avatarUrl: null }
      }
    } catch {}
  }
  return IS_PRODUCTION ? null : { id: 'demo', name: '演示用户', avatarUrl: null }
}
function isAdmin(req) { return Boolean(currentAdmin(req)) }

function nowIso() { return new Date().toISOString() }
function id(prefix) { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` }
function orderNumber() { return `SC${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}` }
function activePlans() { return plans.filter(plan => plan.status !== 'disabled' && plan.status !== 'archived' && memberGroups.find(group => group.id === plan.groupId)?.status === 'active').sort((a, b) => (a.sort || 0) - (b.sort || 0)) }
function validateMemberPlanIds(value) {
  const requested = [...new Set((Array.isArray(value) ? value : []).map(item => String(item || '').trim()).filter(Boolean))].slice(0, 10)
  const active = new Set(activePlans().map(plan => plan.id))
  return { ids: requested, invalid: requested.filter(planId => !active.has(planId)) }
}
function activeMembershipsFor(userId) {
  const values = memberships.get(userId) || []
  const timestamp = Date.now()
  return values.filter(item => item.status === 'active' && new Date(item.startsAt).getTime() <= timestamp && new Date(item.endsAt).getTime() > timestamp)
}
function hasMembership(userId, planIds = []) {
  const active = activeMembershipsFor(userId)
  return active.some(item => !planIds.length || planIds.includes(item.planId))
}
function hasContentEntitlement(userId, postId) {
  return entitlements.some(item => item.userId === userId && item.postId === postId && item.status === 'active' && (!item.endsAt || new Date(item.endsAt).getTime() > Date.now()))
}
function accessFor(post, userId) {
  const accessType = ['free', 'member', 'paid'].includes(post.accessType) ? post.accessType : 'free'
  const memberPlanIds = Array.isArray(post.memberPlanIds) ? post.memberPlanIds : []
  const permissions = membershipPermissions(userId)
  const canReadMemberContent = permissions.includes('content.member.read') || permissions.includes('content.read')
  const isAuthor = Boolean(userId) && post.author?.id === userId
  const entitled = accessType === 'free' || isAuthor || (accessType === 'member' && hasMembership(userId, memberPlanIds) && canReadMemberContent) || (accessType === 'paid' && hasContentEntitlement(userId, post.id))
  const requiredPlanName = memberPlanIds.length ? memberPlanIds.map(planId => plans.find(plan => plan.id === planId)?.name).filter(Boolean).join(' / ') : (accessType === 'member' ? '会员' : '')
  return { accessType, pricePoints: normalizePoints(post.pricePoints ?? post.priceCents), priceUnitName: pointsUnitName(), priceCents: 0, memberPlanIds, requiredPlanName, locked: !entitled, canRead: entitled, lockReason: accessType === 'member' ? '需要会员资格' : accessType === 'paid' ? '需要积分购买后查看' : null }
}
// List and detail payloads never expose body images of a locked post. An
// explicit cover is the author's chosen public visual; free posts fall back to
// their first body image so the feed can show a thumbnail.
function postThumbnail(post, access) {
  if (post.coverImage) return post.coverImage
  const images = normalizeUploadedImages(post.images)
  const first = inlineImageUrls(post.content)[0] || images[0] || null
  return access.canRead && access.accessType === 'free' ? first : null
}
function publicExcerpt(post, access) {
  const excerpt = String(post.excerpt || '').trim()
  if (excerpt) return excerpt
  return access.accessType === 'free' ? autoExcerpt(post.content) : ''
}
function summaryPost(post, userId) {
  const access = accessFor(post, userId)
  return { ...post, ...access, excerpt: publicExcerpt(post, access), thumbnail: postThumbnail(post, access), images: access.canRead ? normalizeUploadedImages(post.images) : [], imageCount: new Set([...normalizeUploadedImages(post.images), ...inlineImageUrls(post.content)]).size, content: undefined }
}
function appendAudit(req, action, targetType, targetId, detail = {}) {
  const admin = currentAdmin(req)
  auditLogs.unshift({ id: id('audit'), requestId: String(req.headers['x-request-id'] || id('request')), actorId: admin?.id || currentUser(req)?.id || 'system', action, targetType, targetId: targetId || null, detail, ipAddress: String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim() || null, userAgent: String(req.headers['user-agent'] || '').slice(0, 300) || null, createdAt: nowIso() })
}
function profileFor(user) {
  if (!user) return null
  const stored = profiles.get(user.id) || {}
  return { id: user.id, username: user.username || stored.username || '', email: user.email || stored.email || '', name: stored.name || user.name || '用户', nickname: stored.nickname || stored.name || user.name || '用户', avatarUrl: stored.avatarUrl || user.avatarUrl || null, bio: stored.bio || '', city: stored.city || '', website: stored.website || '', referralCode: normalizeReferralCode(user.referralCode || stored.referralCode) || null, createdAt: stored.createdAt || null, updatedAt: stored.updatedAt || null }
}
function knownUserId(userId) {
  const idValue = String(userId || '').trim()
  if (!idValue) return false
  if (!IS_PRODUCTION && idValue === 'demo') return true
  return accounts.has(idValue) || profiles.has(idValue) || memberships.has(idValue) || pointsAccounts.has(idValue) || posts.some(post => post.author?.id === idValue)
}
function normalizeNotificationList(userId, value) {
  const list = Array.isArray(value) ? value : []
  return list.map(item => ({
    id: String(item?.id || id('notification')),
    userId: String(item?.userId || userId),
    type: String(item?.type || 'system').slice(0, 40),
    title: String(item?.title || '系统通知').slice(0, 80),
    body: String(item?.body || '').slice(0, 500),
    targetType: item?.targetType ? String(item.targetType).slice(0, 40) : null,
    targetId: item?.targetId ? String(item.targetId).slice(0, 120) : null,
    batchId: item?.batchId ? String(item.batchId).slice(0, 80) : null,
    senderAdminId: item?.senderAdminId ? String(item.senderAdminId).slice(0, 80) : null,
    readAt: item?.readAt ? String(item.readAt) : null,
    createdAt: item?.createdAt && !Number.isNaN(new Date(item.createdAt).getTime()) ? new Date(item.createdAt).toISOString() : nowIso()
  }))
}
function notifyUser(userId, input) {
  if (!userId) return null
  const list = notifications.get(userId) || []
  const item = { id: id('notification'), userId: String(userId), type: String(input.type || 'system').slice(0, 40), title: String(input.title || '系统通知').slice(0, 80), body: String(input.body || '').slice(0, 500), targetType: input.targetType ? String(input.targetType).slice(0, 40) : null, targetId: input.targetId ? String(input.targetId).slice(0, 120) : null, batchId: input.batchId ? String(input.batchId).slice(0, 80) : null, senderAdminId: input.senderAdminId ? String(input.senderAdminId).slice(0, 80) : null, readAt: null, createdAt: nowIso() }
  notifications.set(userId, [item, ...list].slice(0, 200))
  return item
}
function notificationUserIds() {
  const ids = new Set()
  for (const [userId, account] of accounts.entries()) if (account?.status !== 'disabled') ids.add(userId)
  for (const userId of profiles.keys()) if (!accounts.has(userId) || accounts.get(userId)?.status !== 'disabled') ids.add(userId)
  for (const userId of memberships.keys()) if (!accounts.has(userId) || accounts.get(userId)?.status !== 'disabled') ids.add(userId)
  for (const userId of pointsAccounts.keys()) if (!accounts.has(userId) || accounts.get(userId)?.status !== 'disabled') ids.add(userId)
  if (!IS_PRODUCTION) ids.add('demo')
  return ids
}
function resolveNotificationRecipients(input = {}) {
  const requestedScope = String(input.scope || input.audience || input.recipientType || input.target || 'all').trim().toLowerCase()
  const userIds = new Set((Array.isArray(input.userIds) ? input.userIds : [input.userId]).filter(Boolean).map(value => String(value).trim()).filter(Boolean))
  const groupIds = new Set((Array.isArray(input.groupIds) ? input.groupIds : [input.groupId, input.memberGroupId]).filter(Boolean).map(value => String(value).trim()).filter(Boolean))
  const scope = ['user', 'users', '指定用户', '指定用户'].includes(requestedScope) || userIds.size ? 'users' : ['group', 'groups', 'member_group', '会员分组', '指定分组'].includes(requestedScope) || groupIds.size ? 'group' : 'all'
  const known = notificationUserIds()
  if (scope === 'users') return { scope, ids: [...userIds].filter(userId => known.has(userId)), requested: [...userIds], skipped: [...userIds].filter(userId => !known.has(userId)) }
  if (scope === 'group') {
    const normalizedGroupIds = [...groupIds].map(value => memberGroups.find(group => group.status === 'active' && (group.id === value || group.code === value))?.id).filter(Boolean)
    const ids = new Set()
    for (const [userId, values] of memberships.entries()) if (known.has(userId) && values.some(item => item.status === 'active' && normalizedGroupIds.includes(item.groupId) && new Date(item.startsAt).getTime() <= Date.now() && new Date(item.endsAt).getTime() > Date.now())) ids.add(userId)
    return { scope, ids: [...ids], groupIds: normalizedGroupIds, requestedGroupIds: [...groupIds], skippedGroups: [...groupIds].filter(value => !normalizedGroupIds.includes(value)) }
  }
  return { scope, ids: [...known] }
}
function cleanupNotifications(now = Date.now()) {
  const cutoff = now - NOTIFICATION_RETENTION_DAYS * 86400000
  let removed = 0
  for (const [userId, value] of notifications.entries()) {
    const list = normalizeNotificationList(userId, value)
    const next = list.filter(item => !(item.readAt && new Date(item.createdAt).getTime() < cutoff))
    removed += list.length - next.length
    if (next.length) notifications.set(userId, next)
    else if (list.length) notifications.delete(userId)
  }
  return removed
}
async function runNotificationCleanup() {
  const removed = cleanupNotifications()
  const beforeVerifications = emailVerifications.length
  emailVerifications = emailVerifications.filter(item => item?.expiresAt && new Date(item.expiresAt).getTime() > Date.now())
  const verificationRemoved = beforeVerifications - emailVerifications.length
  const pruneBuckets = buckets => {
    const cutoff = Date.now() - 30 * 60 * 1000
    for (const [key, bucket] of buckets.entries()) if (!bucket || Number(bucket.lastFailureAt || bucket.startedAt || 0) < cutoff) buckets.delete(key)
  }
  pruneBuckets(verificationIpBuckets); pruneBuckets(passwordResetIpBuckets); pruneBuckets(adminLoginBuckets); pruneBuckets(userLoginBuckets)
  if (removed > 0 || verificationRemoved > 0) await persistStore()
  return removed
}
function startNotificationCleanup() {
  const timer = setInterval(() => { runNotificationCleanup().catch(error => console.error('notification cleanup failed', error)) }, NOTIFICATION_CLEANUP_INTERVAL_MS)
  timer.unref?.()
  return timer
}
function findOrder(orderId) { return orders.find(order => order.id === orderId || order.orderNo === orderId) }
function ownsOrder(order, user) { return Boolean(order && user && (order.userId === user.id || isAdmin({ headers: { 'x-admin-key': '' } }))) }
function grantOrderBenefits(order) {
  if (order.status !== 'paid') return
  if (order.kind === 'membership') {
    const plan = plans.find(item => item.id === order.planId)
    if (!plan) return
    const userMemberships = memberships.get(order.userId) || []
    const current = activeMembershipsFor(order.userId).sort((a, b) => new Date(b.endsAt) - new Date(a.endsAt))[0]
    const startsAt = current ? current.endsAt : nowIso()
    const endsAt = new Date(new Date(startsAt).getTime() + Number(plan.durationDays || 30) * 86400000).toISOString()
    const existing = userMemberships.find(item => item.orderId === order.id)
    if (!existing) {
      const membership = { id: id('membership'), userId: order.userId, planId: plan.id, groupId: plan.groupId || 'group_member', orderId: order.id, source: 'legacy_order', status: 'active', startsAt, endsAt, createdAt: nowIso() }
      userMemberships.push(membership)
      const group = membershipGroup(membership)
      const giftPoints = normalizePoints(plan ? plan.initialPoints : group?.initialPoints)
      if (giftPoints) appendPointsLedger({ userId: order.userId, delta: giftPoints, type: 'membership_gift', reason: '会员开通赠送积分', actorId: 'system', sourceId: membership.id, metadata: { groupId: membership.groupId, planId: membership.planId } })
    }
    memberships.set(order.userId, userMemberships)
  }
  if (order.kind === 'post') {
    const existing = entitlements.find(item => item.orderId === order.id)
    if (!existing) entitlements.push({ id: id('entitlement'), userId: order.userId, postId: order.postId, orderId: order.id, status: 'active', startsAt: nowIso(), createdAt: nowIso() })
  }
  if (order.kind === 'tip') {
    const tip = tips.find(item => item.orderId === order.id)
    if (tip && tip.status !== 'paid') {
      tip.status = 'paid'; tip.paidAt = nowIso()
      const post = posts.find(item => item.id === tip.postId)
      if (post) post.counts.tips = (post.counts.tips || 0) + Number(tip.amountCents || 0)
    }
  }
}
async function markOrderPaid(order, payment = {}) {
  if (!order) return null
  if (order.status === 'paid') return order
  if (['refunded', 'cancelled', 'expired'].includes(order.status)) return order
  order.status = 'paid'; order.paidAt = nowIso(); order.transactionId = payment.transactionId || order.transactionId || `mock_tx_${Date.now()}`; order.paymentProvider = payment.provider || order.paymentProvider || PAYMENT_PROVIDER
  paymentEvents.push({ id: id('payment_evt'), orderId: order.id, event: 'paid', provider: order.paymentProvider, transactionId: order.transactionId, createdAt: nowIso() })
  grantOrderBenefits(order)
  notifyUser(order.userId, { type: 'order_paid', title: '订单支付成功', body: `${order.title || '订单'} 已支付完成`, targetType: 'order', targetId: order.id })
  if (order.kind === 'tip' && order.authorId && order.authorId !== order.userId) notifyUser(order.authorId, { type: 'tip_received', title: '收到新的打赏', body: `你的内容收到一笔 ¥${(Number(order.amountCents || 0) / 100).toFixed(2)} 打赏`, targetType: 'post', targetId: order.postId })
  await persistStore()
  return order
}
function createOrder(input, user) {
  const kind = input.kind || input.type
  if (!['post', 'membership', 'tip'].includes(kind)) throw new Error('订单类型无效')
  if (kind === 'membership') throw new Error('会员由管理员线下收款并手动开通，请联系管理员')
  if (kind === 'tip') throw new Error('打赏统一使用积分，请调用积分打赏接口')
  if (kind === 'post') return purchasePostWithPoints(input, user)
  const idempotencyKey = String(input.idempotencyKey || input.idempotency_key || '').trim().slice(0, 128)
  const fingerprint = JSON.stringify({ kind, postId: input.postId || null, planId: input.planId || null, amountCents: input.amountCents || null })
  if (idempotencyKey) {
    const existing = orders.find(item => item.userId === user.id && item.idempotencyKey === idempotencyKey)
    if (existing) {
      if (existing.idempotencyFingerprint && existing.idempotencyFingerprint !== fingerprint) throw new Error('幂等键已用于其他订单')
      return existing
    }
  }
  const order = { id: id('order'), orderNo: orderNumber(), kind, userId: user.id, status: 'pending', currency: 'CNY', idempotencyKey: idempotencyKey || null, idempotencyFingerprint: fingerprint, createdAt: nowIso(), expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(), paymentProvider: PAYMENT_PROVIDER }
  if (kind === 'post') {
    const post = posts.find(item => item.id === String(input.postId))
    if (!post || post.status !== 'published') throw new Error('内容不存在或尚未公开')
    const access = accessFor(post, user.id)
    if (access.accessType !== 'paid') throw new Error('该内容不需要购买')
    if (!access.locked) throw new Error('你已拥有该内容权益')
    order.postId = post.id; order.title = post.title; order.amountCents = access.priceCents
  }
  if (kind === 'membership') {
    const plan = activePlans().find(item => item.id === String(input.planId))
    if (!plan) throw new Error('会员套餐不存在')
    order.planId = plan.id; order.title = plan.name; order.amountCents = Number(plan.priceCents || 0)
  }
  if (kind === 'tip') {
    const post = posts.find(item => item.id === String(input.postId))
    const amountCents = Number(input.amountCents)
    if (!post || post.status !== 'published') throw new Error('内容不存在或尚未公开')
    if (!Number.isInteger(amountCents) || amountCents < 100 || amountCents > 1000000) throw new Error('打赏金额需为 1 至 10000 元的整数分')
    order.postId = post.id; order.authorId = post.author?.id || null; order.amountCents = amountCents; order.message = String(input.message || '').trim().slice(0, 200); order.anonymous = Boolean(input.anonymous)
    tips.push({ id: id('tip'), orderId: order.id, postId: post.id, userId: user.id, authorId: order.authorId, amountCents, message: order.message, anonymous: order.anonymous, status: 'pending', createdAt: nowIso() })
  }
  orders.unshift(order)
  return order
}

function activateMembership({ userId, groupId, planId, days, note, actorId = 'admin', source = 'offline_admin', paymentReference = null, amountCents = null, startsAt = null }) {
  const targetUserId = String(userId || '').trim()
  if (!targetUserId) throw new Error('userId 不能为空')
  const plan = planId ? plans.find(item => item.id === String(planId)) : null
  if (planId && !plan) throw new Error('会员套餐不存在')
  const targetGroupId = String(groupId || plan?.groupId || '').trim()
  const group = memberGroups.find(item => item.id === targetGroupId && item.status === 'active')
  if (!group) throw new Error('会员分组不存在')
  if (plan && plan.groupId && plan.groupId !== group.id) throw new Error('会员套餐与分组不匹配')
  const durationDays = Math.max(1, Math.min(3650, Math.floor(Number(days || plan?.durationDays || 30))))
  const previousActive = activeMembershipsFor(targetUserId).filter(item => (item.groupId || membershipGroup(item)?.id) === group.id).sort((a, b) => new Date(b.endsAt) - new Date(a.endsAt))[0]
  const start = startsAt && !Number.isNaN(new Date(startsAt).getTime()) ? new Date(startsAt) : new Date(Math.max(Date.now(), previousActive ? new Date(previousActive.endsAt).getTime() : 0))
  const end = new Date(start.getTime() + durationDays * 86400000)
  const membership = { id: id('membership'), userId: targetUserId, planId: plan?.id || null, groupId: group.id, source, status: 'active', startsAt: start.toISOString(), endsAt: end.toISOString(), durationDays, note: String(note || '').trim().slice(0, 500) || null, paymentReference: String(paymentReference || '').trim().slice(0, 120) || null, amountCents: amountCents === null || amountCents === undefined ? null : Math.max(0, Math.trunc(Number(amountCents) || 0)), createdAt: nowIso(), createdBy: actorId }
  const values = memberships.get(targetUserId) || []
  const hasPreviousMembership = values.some(item => item.groupId === group.id)
  values.push(membership)
  memberships.set(targetUserId, values)
  const configuredGiftPoints = plan && normalizePoints(plan.initialPoints) > 0 ? plan.initialPoints : group.initialPoints
  const giftPoints = hasPreviousMembership ? 0 : normalizePoints(configuredGiftPoints)
  if (giftPoints) appendPointsLedger({ userId: targetUserId, delta: giftPoints, type: 'membership_gift', reason: '会员开通赠送积分', actorId, sourceId: membership.id, note: membership.note, metadata: { groupId: group.id, planId: plan?.id || null } })
  return { membership, giftPoints }
}

function redeemMembershipWithPoints(planId, user, options = {}) {
  const plan = activePlans().find(item => item.id === String(planId))
  if (!plan) throw new Error('会员等级不存在或已停用')
  const cost = membershipRedeemPoints(plan)
  if (cost < 1) throw new Error('该会员等级尚未设置积分兑换价格，请联系管理员')
  const idempotencyKey = String(options.idempotencyKey || '').trim().slice(0, 128)
  if (idempotencyKey) {
    const existing = orders.find(item => item.userId === user.id && item.idempotencyKey === idempotencyKey)
    if (existing) return { order: existing, membership: memberships.get(user.id)?.find(item => item.orderId === existing.id) || null, giftPoints: 0 }
  }
  if (pointsBalance(user.id) < cost) throw new Error(`${pointsUnitName()}余额不足，开通需要 ${cost} ${pointsUnitName()}`)
  const order = { id: id('order'), orderNo: orderNumber(), kind: 'membership', userId: user.id, planId: plan.id, title: plan.name, status: 'paid', currency: pointsUnitName(), amountPoints: cost, amountCents: 0, paymentProvider: 'points', idempotencyKey: idempotencyKey || null, createdAt: nowIso(), paidAt: nowIso() }
  const debit = appendPointsLedger({ userId: user.id, delta: -cost, type: 'membership_redeem', reason: '积分兑换会员', actorId: user.id, sourceId: order.id, note: plan.name, metadata: { planId: plan.id, points: cost } })
  const result = activateMembership({ userId: user.id, groupId: plan.groupId, planId: plan.id, days: plan.durationDays, note: `使用 ${cost} ${pointsUnitName()} 兑换`, actorId: user.id, source: 'points', paymentReference: order.orderNo })
  order.membershipId = result.membership.id
  result.membership.orderId = order.id
  order.ledgerId = debit.id
  result.referralCommissions = referralCommissionFor({ sourceUserId: user.id, sourceType: 'membership_redeem', sourceId: order.id, basePoints: cost, note: plan.name, metadata: { planId: plan.id, orderId: order.id } })
  orders.unshift(order)
  return { order, membership: result.membership, giftPoints: result.giftPoints }
}

function tipWithPoints(input, user) {
  const post = posts.find(item => item.id === String(input.postId))
  if (!post || post.status !== 'published') throw new Error('内容不存在或尚未公开')
  const points = Math.trunc(Number(input.points ?? input.amountPoints ?? input.amount))
  if (!Number.isInteger(points) || points < 1 || points > 1000000) throw new Error(`打赏${pointsUnitName()}需为 1 至 1000000 的整数`)
  if (pointsBalance(user.id) < points) throw new Error(`${pointsUnitName()}余额不足`)
  const tipId = id('tip')
  const ledger = appendPointsLedger({ userId: user.id, delta: -points, type: 'tip_spend', reason: '内容打赏', actorId: user.id, sourceId: tipId, note: input.message, metadata: { postId: post.id } })
  const tip = { id: tipId, postId: post.id, userId: user.id, authorId: post.author?.id || null, points, amountCents: 0, message: String(input.message || '').trim().slice(0, 200), anonymous: Boolean(input.anonymous), status: 'paid', createdAt: nowIso(), paidAt: nowIso(), ledgerId: ledger.id }
  tips.unshift(tip)
  post.counts.tips = (post.counts.tips || 0) + 1
  if (tip.authorId && tip.authorId !== user.id) {
    const received = appendPointsLedger({ userId: tip.authorId, delta: points, type: 'tip_received', reason: '收到内容积分打赏', actorId: user.id, sourceId: tipId, note: tip.message, metadata: { postId: post.id } })
    tip.recipientLedgerId = received.id
  }
  notifyUser(user.id, { type: 'tip_sent', title: `${pointsUnitName()}打赏成功`, body: `你已使用 ${points} ${pointsUnitName()}打赏《${post.title}》`, targetType: 'post', targetId: post.id })
  if (tip.authorId && tip.authorId !== user.id) notifyUser(tip.authorId, { type: 'tip_received', title: `收到新的${pointsUnitName()}打赏`, body: `你的内容收到 ${points} ${pointsUnitName()}打赏`, targetType: 'post', targetId: post.id })
  return tip
}
function purchasePostWithPoints(input, user) {
  const post = posts.find(item => item.id === String(input.postId))
  if (!post || post.status !== 'published') throw new Error('内容不存在或尚未公开')
  const access = accessFor(post, user.id)
  if (access.accessType !== 'paid') throw new Error('该内容不需要购买')
  if (!access.locked) {
    const existing = orders.find(order => order.userId === user.id && order.kind === 'post' && order.postId === post.id && order.status === 'paid')
    if (existing) return existing
    throw new Error('你已拥有该内容权益')
  }
  const points = normalizePoints(access.pricePoints)
  if (points < 1) throw new Error('该内容尚未设置有效的积分价格')
  const idempotencyKey = String(input.idempotencyKey || input.idempotency_key || '').trim().slice(0, 128)
  if (idempotencyKey) {
    const existing = orders.find(item => item.userId === user.id && item.idempotencyKey === idempotencyKey)
    if (existing) return existing
  }
  if (pointsBalance(user.id) < points) throw new Error(`积分余额不足，购买需要 ${points} ${pointsUnitName()}`)
  const order = { id: id('order'), orderNo: orderNumber(), kind: 'post', userId: user.id, postId: post.id, title: post.title, status: 'paid', currency: pointsUnitName(), amountPoints: points, amountCents: 0, paymentProvider: 'points', idempotencyKey: idempotencyKey || null, createdAt: nowIso(), paidAt: nowIso() }
  const debit = appendPointsLedger({ userId: user.id, delta: -points, type: 'content_purchase', reason: '购买付费内容', actorId: user.id, sourceId: order.id, note: post.title, metadata: { postId: post.id } })
  entitlements.push({ id: id('entitlement'), userId: user.id, postId: post.id, orderId: order.id, status: 'active', startsAt: nowIso(), createdAt: nowIso(), source: 'points', points, ledgerId: debit.id })
  const authorId = post.author?.id
  if (authorId && authorId !== user.id) {
    const credit = appendPointsLedger({ userId: authorId, delta: points, type: 'content_sale_received', reason: '收到付费内容积分', actorId: user.id, sourceId: order.id, note: post.title, metadata: { postId: post.id } })
    order.recipientLedgerId = credit.id
  }
  orders.unshift(order)
  notifyUser(user.id, { type: 'order_paid', title: '内容购买成功', body: `你已使用 ${points} ${pointsUnitName()} 解锁《${post.title}》`, targetType: 'order', targetId: order.id })
  if (authorId && authorId !== user.id) notifyUser(authorId, { type: 'content_sale_received', title: '收到内容购买', body: `你的内容收到 ${points} ${pointsUnitName()}`, targetType: 'post', targetId: post.id })
  return order
}
function paymentPayload(order) {
  if (PAYMENT_PROVIDER === 'mock') return { provider: 'mock', orderId: order.id, orderNo: order.orderNo, amountCents: order.amountCents, mockToken: createHash('sha256').update(`${order.id}:${AUTH_SECRET}`).digest('hex'), expiresAt: order.expiresAt }
  if (PAYMENT_PROVIDER === 'wechat') {
    if (!process.env.WECHAT_MCHID || !process.env.WECHAT_API_KEY) return null
    return { provider: 'wechat', orderId: order.id, orderNo: order.orderNo, amountCents: order.amountCents, tradeType: 'JSAPI', appId: process.env.WECHAT_APPID, status: 'pending' }
  }
  return null
}
function verifyWebhookSignature(input, rawBody) {
  if (!PAYMENT_WEBHOOK_SECRET) return !IS_PRODUCTION
  const signature = String(input.signature || '')
  const expected = createHmac('sha256', PAYMENT_WEBHOOK_SECRET).update(rawBody).digest('hex')
  return safeEqualText(signature, expected)
}

function search(input, userId = null) {
  let result = posts.filter(post => post.status === 'published')
  const keyword = String(input.keyword || input.query || '').trim().toLowerCase()
  if (keyword) result = result.filter(post => [post.title, post.excerpt, post.author?.name || post.author, post.platform, post.project, post.skill].some(value => String(value || '').toLowerCase().includes(keyword)))
  const platformId = input.platformId === '387806' ? 'YouTube' : input.platformId
  if (platformId && platformId !== '全部') result = result.filter(post => post.platform === platformId)
  if (input.projectId && input.projectId !== '全部') result = result.filter(post => post.project === input.projectId)
  if (input.skillId && input.skillId !== '全部') result = result.filter(post => post.skill === input.skillId)
  const dateStart = input.dateStart || input.gmtCreateStart
  const dateEnd = input.dateEnd || input.gmtCreateEnd
  if (dateStart) result = result.filter(post => new Date(post.publishedAt) >= new Date(dateStart))
  if (dateEnd) result = result.filter(post => new Date(post.publishedAt) <= new Date(dateEnd))
  const scoped = [...result]
  if (input.tab === 'digest' || input.isDigested) result = result.filter(post => post.digest)
  // An explicit sort always wins. Without one, the "hot" tab ranks by
  // engagement and every other tab by publish time.
  const sort = String(input.sort || input.orderBy || (input.tab === 'hot' ? 'hot' : 'latest'))
  const field = { likes: 'likes', comments: 'comments', favorites: 'favorites', anchors: 'anchors', 'anchor-latest': 'anchors' }[sort]
  const publishedTime = post => new Date(post.publishedAt || post.submittedAt || 0).getTime() || 0
  const hotScore = post => {
    const counts = post.counts || {}
    const engagement = Number(counts.likes || 0) + Number(counts.comments || 0) * 2 + Number(counts.favorites || 0) * 3 + Number(counts.anchors || 0) * 2 + Number(counts.tips || 0) * 4 + (post.digest ? 20 : 0)
    const ageHours = Math.max(0, (Date.now() - publishedTime(post)) / 3600000)
    return (engagement + 1) / Math.pow(ageHours + 2, 0.8)
  }
  if (sort === 'oldest') result.sort((a, b) => publishedTime(a) - publishedTime(b))
  else if (field) result.sort((a, b) => Number(b.counts?.[field] || 0) - Number(a.counts?.[field] || 0) || publishedTime(b) - publishedTime(a))
  else if (sort === 'hot') result.sort((a, b) => hotScore(b) - hotScore(a) || publishedTime(b) - publishedTime(a))
  else result.sort((a, b) => publishedTime(b) - publishedTime(a))
  const pageSize = Math.min(Math.max(Number(input.pageSize) || 20, 1), 100)
  const cursor = Number(input.cursor)
  const start = Number.isFinite(cursor) && cursor >= 0 ? cursor : (Math.max(Number(input.page) || 1, 1) - 1) * pageSize
  const items = result.slice(start, start + pageSize).map(post => summaryPost(post, userId))
  return { items, total: result.length, nextCursor: start + pageSize < result.length ? String(start + pageSize) : null, hasMore: start + pageSize < result.length, tabTotals: { hot: scoped.length, digest: scoped.filter(post => post.digest).length, all: scoped.length }, facets: { platforms: tags.platform.map(name => ({ id: name, name, count: result.filter(post => post.platform === name).length })), projects: tags.project.map(name => ({ id: name, name, count: result.filter(post => post.project === name).length })), skills: tags.skill.map(name => ({ id: name, name, count: result.filter(post => post.skill === name).length })) } }
}

function paginate(items, input = {}) {
  const pageSize = Math.min(Math.max(Number(input.pageSize) || 20, 1), 100)
  const parsedCursor = Number(input.cursor)
  const start = Number.isFinite(parsedCursor) && parsedCursor >= 0 ? parsedCursor : (Math.max(Number(input.page) || 1, 1) - 1) * pageSize
  const page = items.slice(start, start + pageSize)
  return { items: page, total: items.length, nextCursor: start + pageSize < items.length ? String(start + pageSize) : null, hasMore: start + pageSize < items.length }
}

function visibleComments(postId, input = {}) {
  const source = (comments.get(postId) || []).filter(item => item.status !== 'deleted')
  const sort = String(input.sort || input.orderBy || 'latest')
  // thread=1 pages through top-level comments and nests every reply (at any
  // depth) under its root, so a thread never splits across pages.
  if (String(input.thread || '') === '1' || input.thread === true) {
    const byId = new Map(source.map(item => [item.id, item]))
    const rootOf = item => { let current = item; const seen = new Set(); while (current?.parentId && byId.has(current.parentId) && !seen.has(current.id)) { seen.add(current.id); current = byId.get(current.parentId) } return current }
    const replies = new Map()
    for (const item of source) {
      if (!item.parentId) continue
      const root = rootOf(item)
      if (!root || root.id === item.id) continue
      const parent = byId.get(item.parentId)
      const list = replies.get(root.id) || []
      list.push({ ...item, replyTo: parent && parent.id !== root.id ? { id: parent.id, name: parent.user?.name || '用户' } : null })
      replies.set(root.id, list)
    }
    const roots = source.filter(item => !item.parentId || !byId.has(item.parentId))
    const replyCount = item => (replies.get(item.id) || []).length
    if (sort === 'oldest') roots.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    else if (sort === 'hot') roots.sort((a, b) => replyCount(b) - replyCount(a) || new Date(b.createdAt) - new Date(a.createdAt))
    else roots.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    const page = paginate(roots, input)
    return { ...page, total: source.length, rootTotal: roots.length, items: page.items.map(item => ({ ...item, replies: (replies.get(item.id) || []).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)) })) }
  }
  const items = [...source]
  if (sort === 'oldest') items.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
  else if (sort === 'hot') items.sort((a, b) => Number(b.likes || 0) - Number(a.likes || 0) || new Date(b.createdAt) - new Date(a.createdAt))
  else items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  return paginate(items, input)
}

function postForUser(post, userId) {
  if (!post || post.author?.id !== userId) return null
  return { ...summaryPost(post, userId), excerpt: post.excerpt || '', images: normalizeUploadedImages(post.images), coverImage: post.coverImage || null, content: post.content || '', status: post.status || 'published', submittedAt: post.submittedAt || null, publishedAt: post.publishedAt || null, rejectedAt: post.rejectedAt || null, rejectionReason: post.rejectionReason || null }
}

function findComment(commentId) {
  for (const [postId, list] of comments.entries()) {
    const comment = list.find(item => item.id === commentId)
    if (comment) return { comment, postId }
  }
  return null
}

function softDeleteCommentTree(postId, commentId) {
  const list = comments.get(postId) || []
  const targets = new Set([commentId])
  let changed = 0
  let foundNew = true
  while (foundNew) {
    foundNew = false
    for (const item of list) if (item.parentId && targets.has(item.parentId) && !targets.has(item.id)) { targets.add(item.id); foundNew = true }
  }
  const deletedAt = nowIso()
  for (const item of list) if (targets.has(item.id) && item.status !== 'deleted') { item.status = 'deleted'; item.deletedAt = deletedAt; changed += 1 }
  return changed
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  try {
    if (req.method === 'OPTIONS') {
      const headers = { 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'access-control-allow-headers': 'content-type, authorization, x-admin-key, x-admin-token, idempotency-key' }
      if (CORS_ORIGIN) headers['access-control-allow-origin'] = CORS_ORIGIN
      res.writeHead(204, headers)
      return res.end()
    }
    const user = currentUser(req)
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, service: 'content-library-api' })
    const uploadAssetMatch = url.pathname.match(/^\/uploads\/([A-Za-z0-9][A-Za-z0-9._-]*)$/)
    if (req.method === 'GET' && uploadAssetMatch) {
      try {
        const filename = uploadAssetMatch[1]
        const content = await readFile(join(UPLOADS_DIR, filename))
        // CORS lets the share-poster canvas draw covers when the API runs on another origin.
        res.writeHead(200, { 'content-type': uploadContentType(filename), 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff', ...(CORS_ORIGIN ? { 'access-control-allow-origin': CORS_ORIGIN } : {}) })
        return res.end(content)
      } catch {
        return json(res, 404, { message: '资源不存在' })
      }
    }
    const postMatch = url.pathname.match(/^\/api\/v1\/posts\/([^/]+)$/)
    const postShareMatch = url.pathname.match(/^\/api\/v1\/posts\/([^/]+)\/share$/)
    const sharePageMatch = url.pathname.match(/^\/share\/([^/]+)$/)
    const myPostMatch = url.pathname.match(/^\/api\/v1\/me\/posts\/([^/]+)$/)
    const postReportMatch = url.pathname.match(/^\/api\/v1\/posts\/([^/]+)\/report$/)
    const commentMatch = url.pathname.match(/^\/api\/v1\/posts\/([^/]+)\/comments$/)
    const replyMatch = url.pathname.match(/^\/api\/v1\/comments\/([^/]+)\/replies$/)
    const commentReportMatch = url.pathname.match(/^\/api\/v1\/comments\/([^/]+)\/report$/)
    const commentDeleteMatch = url.pathname.match(/^\/api\/v1\/comments\/([^/]+)$/)
    const interactionMatch = url.pathname.match(/^\/api\/v1\/posts\/([^/]+)\/(like|favorite|anchor)$/)
    const pointPurchaseMatch = url.pathname.match(/^\/api\/v1\/posts\/([^/]+)\/purchase$/)
    const orderPath = url.pathname === '/api/v1/orders' || /^\/api\/v1\/orders\/[^/]+(?:\/pay|\/payments|\/mock-success|\/cancel)?$/.test(url.pathname)
    const postCreate = url.pathname === '/api/v1/posts' && req.method === 'POST'
    const uploadCreate = url.pathname === '/api/v1/uploads' && req.method === 'POST'
    const userPostWrite = postMatch && ['PATCH', 'DELETE'].includes(req.method)
    const writesUserData = uploadCreate || postCreate || userPostWrite || (postReportMatch && req.method === 'POST') || (commentReportMatch && req.method === 'POST') || (commentDeleteMatch && req.method === 'DELETE') || (replyMatch && req.method === 'POST') || (commentMatch && req.method === 'POST') || (interactionMatch && (req.method === 'POST' || req.method === 'DELETE')) || (pointPurchaseMatch && req.method === 'POST') || (url.pathname.startsWith('/api/v1/saved-filters') && ['POST', 'PATCH', 'DELETE'].includes(req.method)) || (orderPath && req.method === 'POST') || (url.pathname === '/api/v1/member/me' && req.method !== 'GET') || (url.pathname === '/api/v1/me/profile' && ['PATCH', 'POST'].includes(req.method)) || (/^\/api\/v1\/me\/notifications\/[^/]+\/read$/.test(url.pathname) && req.method === 'PATCH') || (url.pathname === '/api/v1/me/notifications/read-all' && req.method === 'POST') || ((url.pathname === '/api/v1/me/withdrawals' || url.pathname === '/api/v1/withdrawals') && req.method === 'POST') || ((url.pathname === '/api/v1/me/checkin' || url.pathname === '/api/v1/checkin' || url.pathname === '/api/v1/checkins/sign') && req.method === 'POST')
    // Administrators upload images for posts and the purchase QR code from the console.
    if (writesUserData && !user && !(uploadCreate && currentAdmin(req))) return json(res, 401, { message: '需要登录' })
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/register/request-code') {
      try {
        const input = await readBody(req); const email = normalizeEmail(input.email)
        if (!validEmail(email)) return json(res, 422, { message: '请输入有效的邮箱地址' })
        if (!verificationIpLimit(req, verificationIpBuckets)) return json(res, 429, { message: '验证码请求过于频繁，请稍后再试' })
        if ([...accounts.values()].some(account => account.email === email)) return json(res, 409, { message: '该邮箱已注册，请直接登录' })
        const previous = verificationFor(email, 'register')
        if (previous && new Date(previous.sentAt).getTime() > Date.now() - 60000) return json(res, 429, { message: '验证码已发送，请 60 秒后再试', retryAfter: Math.max(1, Math.ceil((new Date(previous.sentAt).getTime() + 60000 - Date.now()) / 1000)) })
        const code = String(randomInt(100000, 1000000)); const sentAt = nowIso(); const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
        emailVerifications = emailVerifications.filter(item => !(item.email === email && verificationPurpose(item) === 'register') && new Date(item.expiresAt).getTime() > Date.now())
        await sendVerificationEmail(email, code, 'register')
        emailVerifications.push({ email, purpose: 'register', codeHash: verificationHash(code), sentAt, expiresAt, attempts: 0 }); await persistStore()
        return json(res, 200, { sent: true, expiresAt, retryAfter: 60 })
      } catch (error) { return json(res, 422, { message: error instanceof Error ? error.message : '验证码发送失败' }) }
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/password-reset/request-code') {
      try {
        const input = await readBody(req); const email = normalizeEmail(input.email)
        if (!validEmail(email)) return json(res, 422, { message: '请输入有效的邮箱地址' })
        if (!verificationIpLimit(req, passwordResetIpBuckets)) return json(res, 429, { message: '验证码请求过于频繁，请稍后再试' })
        const previous = verificationFor(email, 'password_reset')
        if (previous && new Date(previous.sentAt).getTime() > Date.now() - 60000) return json(res, 429, { message: '验证码已发送，请 60 秒后再试', retryAfter: Math.max(1, Math.ceil((new Date(previous.sentAt).getTime() + 60000 - Date.now()) / 1000)) })
        const account = [...accounts.values()].find(item => item.email === email && item.status !== 'disabled')
        const code = String(randomInt(100000, 1000000)); const sentAt = nowIso(); const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
        emailVerifications = emailVerifications.filter(item => !(item.email === email && verificationPurpose(item) === 'password_reset') && new Date(item.expiresAt).getTime() > Date.now())
        // Keep the same response for unknown addresses to avoid exposing account existence.
        if (account) {
          await sendVerificationEmail(email, code, 'password_reset')
          emailVerifications.push({ email, purpose: 'password_reset', userId: account.id, codeHash: verificationHash(code), sentAt, expiresAt, attempts: 0 }); await persistStore()
        }
        return json(res, 200, { sent: true, expiresAt, retryAfter: 60 })
      } catch (error) { return json(res, 422, { message: error instanceof Error ? error.message : '验证码发送失败' }) }
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/password-reset') {
      try {
        const input = await readBody(req); const email = normalizeEmail(input.email); const code = String(input.code || '').trim(); const password = String(input.password || '')
        if (!validEmail(email)) return json(res, 422, { message: '请输入有效的邮箱地址' })
        if (!/^\d{6}$/.test(code)) return json(res, 422, { message: '请输入 6 位邮箱验证码' })
        if (password.length < 8 || password.length > 72) return json(res, 422, { message: '密码长度需为 8-72 位' })
        const account = [...accounts.values()].find(item => item.email === email && item.status !== 'disabled')
        const verification = verificationFor(email, 'password_reset')
        if (!account || !verification || new Date(verification.expiresAt).getTime() <= Date.now()) return json(res, 422, { message: '验证码已过期，请重新获取' })
        verification.attempts = Number(verification.attempts || 0) + 1
        if (verification.attempts > 5) return json(res, 429, { message: '验证码尝试次数过多，请重新获取' })
        if (verificationHash(code) !== verification.codeHash) { await persistStore(); return json(res, 422, { message: '验证码不正确' }) }
        const passwordData = passwordHash(password); account.passwordHash = passwordData.hash; account.passwordSalt = passwordData.salt; account.authVersion = randomBytes(16).toString('hex'); account.passwordChangedAt = nowIso(); account.lastPasswordResetAt = account.passwordChangedAt
        emailVerifications = emailVerifications.filter(item => item !== verification); appendAudit(req, 'reset_password', 'account', account.id, { email }); await persistStore()
        return json(res, 200, { reset: true, message: '密码已重置，请使用新密码登录' })
      } catch (error) { return json(res, 422, { message: error instanceof Error ? error.message : '密码重置失败' }) }
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/register') {
      try {
        const input = await readBody(req); const username = String(input.username || '').trim(); const usernameKey = normalizeUsername(username); const email = normalizeEmail(input.email); const password = String(input.password || ''); const code = String(input.code || '').trim()
        if (!validUsername(username)) return json(res, 422, { message: '用户名需为 3-24 位中文、字母、数字、下划线或短横线' })
        if (!validEmail(email)) return json(res, 422, { message: '请输入有效的邮箱地址' })
        if (password.length < 8 || password.length > 72) return json(res, 422, { message: '密码长度需为 8-72 位' })
        if (!/^\d{6}$/.test(code)) return json(res, 422, { message: '请输入 6 位邮箱验证码' })
        if ([...accounts.values()].some(account => account.usernameKey === usernameKey)) return json(res, 409, { message: '用户名已存在' })
        if ([...accounts.values()].some(account => account.email === email)) return json(res, 409, { message: '该邮箱已注册，请直接登录' })
        const verification = verificationFor(email, 'register')
        if (!verification || new Date(verification.expiresAt).getTime() <= Date.now()) return json(res, 422, { message: '验证码已过期，请重新获取' })
        verification.attempts = Number(verification.attempts || 0) + 1
        if (verification.attempts > 5) return json(res, 429, { message: '验证码尝试次数过多，请重新获取' })
        if (verificationHash(code) !== verification.codeHash) { await persistStore(); return json(res, 422, { message: '验证码不正确' }) }
        const referralCodeInput = normalizeReferralCode(input.referralCode || input.ref || input.referrerCode)
        const referrer = referralCodeInput ? [...accounts.values()].find(candidate => normalizeReferralCode(candidate.referralCode) === referralCodeInput && candidate.status !== 'disabled') : null
        if (referralCodeInput && !referrer) return json(res, 422, { message: '邀请链接已失效，请重新获取' })
        const id = `user_${randomBytes(9).toString('hex')}`; const passwordData = passwordHash(password); const usedCodes = new Set([...accounts.values()].map(candidate => normalizeReferralCode(candidate.referralCode)).filter(Boolean)); const ownReferralCode = generateReferralCode(usedCodes); const account = { id, username, usernameKey, email, name: username, avatarUrl: null, referralCode: ownReferralCode, referrerId: referrer?.id || null, passwordHash: passwordData.hash, passwordSalt: passwordData.salt, authVersion: randomBytes(16).toString('hex'), emailVerified: true, status: 'active', createdAt: nowIso(), lastLoginAt: nowIso() }
        accounts.set(id, account); emailVerifications = emailVerifications.filter(item => item !== verification); profiles.set(id, { id, name: username, nickname: username, avatarUrl: null, bio: '', city: '', website: '', createdAt: account.createdAt, updatedAt: account.createdAt }); if (referrer) referralRelations.set(id, normalizeReferralRelation({ childId: id, parentId: referrer.id, referralCode: referralCodeInput, createdAt: account.createdAt })); appendAudit(req, 'create', 'account', id, { username, email, referralCode: referralCodeInput || null, referrerId: referrer?.id || null }); if (referrer) notifyUser(referrer.id, { type: 'referral_bound', title: '新的直属用户已绑定', body: `${username} 已通过你的邀请链接注册`, targetType: 'referral', targetId: id }); await persistStore()
        return json(res, 201, { accessToken: signToken(account, true), expiresInDays: 30, user: accountUser(account) })
      } catch (error) { return json(res, 422, { message: error instanceof Error ? error.message : '注册失败' }) }
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/login') {
      try {
        const input = await readBody(req); const identifier = String(input.identifier || input.username || input.email || '').trim(); const key = normalizeUsername(identifier); const email = normalizeEmail(identifier); const password = String(input.password || ''); const account = [...accounts.values()].find(item => item.usernameKey === key || item.email === email)
        const throttle = userLoginThrottle(req, key || email)
        if (!throttle.allowed) return json(res, 429, { message: '登录尝试过于频繁，请稍后再试', retryAfter: throttle.retryAfter })
        if (!account || account.status === 'disabled' || !verifyPassword(password, account)) {
          const retryAfter = recordUserLoginFailure(throttle.key)
          if (retryAfter) return json(res, 429, { message: '登录尝试过于频繁，请稍后再试', retryAfter })
          return json(res, 401, { message: '账号或密码不正确' })
        }
        clearUserLoginFailures(throttle.key)
        account.lastLoginAt = nowIso(); appendAudit(req, 'login', 'account', account.id, { username: account.username }); await persistStore(); return json(res, 200, { accessToken: signToken(account, input.remember !== false), expiresInDays: input.remember === false ? 7 : 30, user: accountUser(account) })
      } catch (error) { return json(res, 422, { message: error instanceof Error ? error.message : '登录失败' }) }
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/dev-login') {
      if (IS_PRODUCTION && process.env.ENABLE_DEV_LOGIN !== 'true') return json(res, 404, { message: 'Not Found' })
      const demo = { id: 'demo', name: '演示用户', avatarUrl: null }
      return json(res, 200, { accessToken: signToken(demo), user: demo })
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/me') {
      if (!user) return json(res, 401, { message: '需要登录' })
      const membership = activeMembershipsFor(user.id)[0] || null
      const group = membershipGroup(membership)
      return json(res, 200, { user: profileFor(user), membership: membership ? { ...membership, planName: plans.find(plan => plan.id === membership.planId)?.name || '会员', groupName: group?.name || '会员', permissions: membershipPermissions(user.id) } : null, points: { balance: pointsBalance(user.id), unitName: pointsUnitName(), unit: pointsUnitName() }, permissions: membershipPermissions(user.id), unreadNotifications: (notifications.get(user.id) || []).filter(item => !item.readAt).length })
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/me/referral') {
      if (!user) return json(res, 401, { message: '需要登录' })
      const summary = referralSummary(user.id, true)
      return json(res, 200, { referral: summary, ...summary })
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/me/referral/commissions') {
      if (!user) return json(res, 401, { message: '需要登录' })
      const summary = referralSummary(user.id, false)
      const page = paginate(summary.commissionItems, Object.fromEntries(url.searchParams))
      return json(res, 200, { ...page, items: page.items, commissions: page.items, records: page.items, totalEarningsPoints: summary.totalEarningsPoints, pendingEarningsPoints: summary.pendingEarningsPoints, unitName: pointsUnitName(), ...referralConfigPublic() })
    }
    if (req.method === 'GET' && (url.pathname === '/api/v1/me/checkin' || url.pathname === '/api/v1/me/checkin/status' || url.pathname === '/api/v1/me/checkins/status' || url.pathname === '/api/v1/checkin/status')) {
      if (!user) return json(res, 401, { message: '需要登录' })
      const summary = checkinSummary(user.id); const ranking = checkinLeaderboard({ period: url.searchParams.get('period') || checkinConfig.leaderboardDays || 'month', limit: 20, userId: user.id })
      return json(res, 200, { ...summary, config: checkinConfigPublic(), ranking: ranking.items, leaderboard: ranking, rank: ranking.myRank })
    }
    if (req.method === 'POST' && (url.pathname === '/api/v1/me/checkin' || url.pathname === '/api/v1/me/checkin/sign' || url.pathname === '/api/v1/checkin' || url.pathname === '/api/v1/checkin/sign' || url.pathname === '/api/v1/checkins/sign')) {
      if (!user) return json(res, 401, { message: '需要登录' })
      const result = createCheckin(user.id, req)
      if (result.error) return json(res, result.status, { message: result.error, alreadySigned: Boolean(result.duplicate), todaySigned: Boolean(result.duplicate), record: result.record || null, ...result.summary, config: checkinConfigPublic() })
      await persistStore()
      const ranking = checkinLeaderboard({ period: url.searchParams.get('period') || 'month', limit: 20, userId: user.id })
      return json(res, result.status, { ...result.summary, config: checkinConfigPublic(), record: result.record, reward: result.record, ranking: ranking.items, leaderboard: ranking, rank: ranking.myRank })
    }
    if (req.method === 'GET' && (url.pathname === '/api/v1/me/checkins' || url.pathname === '/api/v1/me/checkins/history' || url.pathname === '/api/v1/checkins/history')) {
      if (!user) return json(res, 401, { message: '需要登录' })
      const records = userCheckinRecords(user.id).reverse().map(checkinRecordPublic); const page = paginate(records, Object.fromEntries(url.searchParams))
      return json(res, 200, { ...page, records: page.items, history: page.items, config: checkinConfigPublic(), ...checkinSummary(user.id) })
    }
    if (req.method === 'GET' && (url.pathname === '/api/v1/checkins/leaderboard' || url.pathname === '/api/v1/me/checkins/leaderboard' || url.pathname === '/api/v1/checkin/leaderboard' || url.pathname === '/api/v1/me/checkin/ranking' || url.pathname === '/api/v1/checkin/ranking')) {
      const ranking = checkinLeaderboard({ period: url.searchParams.get('period') || 'month', limit: url.searchParams.get('limit') || url.searchParams.get('pageSize') || 20, userId: user?.id })
      return json(res, 200, { ...ranking, config: checkinConfigPublic(), unitName: pointsUnitName() })
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/me/profile') {
      if (!user) return json(res, 401, { message: '需要登录' })
      return json(res, 200, { profile: profileFor(user) })
    }
    if (req.method === 'PATCH' && url.pathname === '/api/v1/me/profile') {
      if (!user) return json(res, 401, { message: '需要登录' })
      const input = await readBody(req); const previous = profileFor(user)
      const profile = { ...previous }
      for (const field of ['name', 'nickname', 'avatarUrl', 'bio', 'city', 'website']) if (input[field] !== undefined) {
        if (field === 'avatarUrl') {
          const rawAvatar = String(input[field] || '').trim()
          if (rawAvatar && !normalizeUploadedUrl(rawAvatar)) return json(res, 422, { message: '头像必须使用站内上传图片' })
          profile[field] = rawAvatar ? normalizeUploadedUrl(rawAvatar) : null
        } else profile[field] = String(input[field] || '').trim().slice(0, field === 'bio' ? 500 : 120)
      }
      if (!profile.name && !profile.nickname) return json(res, 422, { message: '昵称不能为空' })
      profile.id = user.id; profile.updatedAt = nowIso(); profile.createdAt = previous.createdAt || profile.updatedAt
      profiles.set(user.id, profile); await persistStore()
      return json(res, 200, { profile })
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/me/posts') {
      if (!user) return json(res, 401, { message: '需要登录' })
      const status = url.searchParams.get('status')
      const sort = url.searchParams.get('sort') || 'latest'
      let items = posts.filter(post => post.author?.id === user.id && (!status || post.status === status))
      if (sort === 'oldest') items.sort((a, b) => new Date(a.submittedAt || a.publishedAt || 0) - new Date(b.submittedAt || b.publishedAt || 0))
      else if (sort === 'status') items.sort((a, b) => String(a.status).localeCompare(String(b.status)) || new Date(b.submittedAt || b.publishedAt || 0) - new Date(a.submittedAt || a.publishedAt || 0))
      else items.sort((a, b) => new Date(b.submittedAt || b.publishedAt || 0) - new Date(a.submittedAt || a.publishedAt || 0))
      return json(res, 200, paginate(items.map(post => postForUser(post, user.id)), Object.fromEntries(url.searchParams)))
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/me/interactions') {
      if (!user) return json(res, 401, { message: '需要登录' })
      const type = ['like', 'favorite', 'anchor'].includes(url.searchParams.get('type')) ? url.searchParams.get('type') : 'favorite'
      const suffix = `:${user.id}:${type}`
      const marked = []
      for (const [key, value] of interactions.entries()) {
        if (!value || !key.endsWith(suffix)) continue
        const post = posts.find(item => item.id === key.slice(0, -suffix.length) && item.status === 'published')
        if (post) marked.push({ post, at: typeof value === 'string' ? value : null })
      }
      marked.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0))
      const page = paginate(marked, Object.fromEntries(url.searchParams))
      return json(res, 200, { ...page, type, items: page.items.map(item => ({ ...summaryPost(item.post, user.id), interactedAt: item.at })) })
    }
    if (myPostMatch && req.method === 'GET') {
      if (!user) return json(res, 401, { message: '需要登录' })
      const post = posts.find(item => item.id === myPostMatch[1] && item.author?.id === user.id)
      if (!post) return json(res, 404, { message: '内容不存在' })
      return json(res, 200, postForUser(post, user.id))
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/me/notifications') {
      if (!user) return json(res, 401, { message: '需要登录' })
      const unreadOnly = url.searchParams.get('unread') === 'true' || url.searchParams.get('status') === 'unread'
      const type = url.searchParams.get('type')
      const batchId = url.searchParams.get('batchId')
      const all = (notifications.get(user.id) || []).filter(item => (!unreadOnly || !item.readAt) && (!type || item.type === type) && (!batchId || item.batchId === batchId))
      const page = paginate(all, Object.fromEntries(url.searchParams))
      return json(res, 200, { ...page, unread: (notifications.get(user.id) || []).filter(item => !item.readAt).length })
    }
    const notificationReadMatch = url.pathname.match(/^\/api\/v1\/me\/notifications\/([^/]+)\/read$/)
    if (notificationReadMatch && req.method === 'PATCH') {
      if (!user) return json(res, 401, { message: '需要登录' })
      const list = notifications.get(user.id) || []; const item = list.find(notification => notification.id === notificationReadMatch[1])
      if (!item) return json(res, 404, { message: '通知不存在' })
      item.readAt = nowIso(); notifications.set(user.id, list); await persistStore(); return json(res, 200, item)
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/me/notifications/read-all') {
      if (!user) return json(res, 401, { message: '需要登录' })
      const list = notifications.get(user.id) || []; const readAt = nowIso(); let count = 0
      for (const item of list) if (!item.readAt) { item.readAt = readAt; count += 1 }
      notifications.set(user.id, list); await persistStore(); return json(res, 200, { updated: count, readAt })
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/wechat-login') {
      const input = await readBody(req)
      if (!input.code) return json(res, 422, { message: '缺少微信登录 code' })
      if (!process.env.WECHAT_APPID || !process.env.WECHAT_SECRET) return json(res, 503, { message: '服务端尚未配置 WECHAT_APPID 和 WECHAT_SECRET' })
      const wxUrl = new URL('https://api.weixin.qq.com/sns/jscode2session'); wxUrl.searchParams.set('appid', process.env.WECHAT_APPID); wxUrl.searchParams.set('secret', process.env.WECHAT_SECRET); wxUrl.searchParams.set('js_code', input.code); wxUrl.searchParams.set('grant_type', 'authorization_code')
      let wx
      try {
        const response = await fetch(wxUrl, { signal: AbortSignal.timeout(8000) })
        wx = await response.json()
      } catch (error) {
        return json(res, 502, { message: '微信登录服务暂时不可用' })
      }
      if (!wx || (wx.errcode && Number(wx.errcode) !== 0) || !wx.openid) return json(res, 401, { message: wx?.errmsg || '微信登录失败' })
      const id = `wx_${createHash('sha256').update(wx.openid).digest('hex').slice(0, 20)}`
      let account = accounts.get(id)
      if (!account) {
        const createdAt = nowIso()
        account = { id, username: id, usernameKey: id, email: null, name: '微信用户', avatarUrl: null, passwordHash: '', passwordSalt: '', authVersion: randomBytes(16).toString('hex'), provider: 'wechat', emailVerified: false, status: 'active', createdAt, lastLoginAt: createdAt }
        accounts.set(id, account); profiles.set(id, { id, name: '微信用户', nickname: '微信用户', avatarUrl: null, bio: '', city: '', website: '', createdAt, updatedAt: createdAt })
      } else account.lastLoginAt = nowIso()
      const loggedIn = accountUser(account)
      await persistStore()
      return json(res, 200, { accessToken: signToken(account), user: loggedIn })
    }
    if (uploadCreate) {
      const rawContentType = String(req.headers['content-type'] || '')
      const contentType = rawContentType.toLowerCase()
      let files = []
      let body
      try { body = await readRawBody(req, MAX_UPLOAD_TOTAL_BYTES) } catch (error) { return json(res, 413, { message: error instanceof Error ? error.message : '上传内容超过大小限制' }) }
      if (contentType.startsWith('multipart/form-data')) {
        const boundaryMatch = rawContentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)
        const boundary = boundaryMatch?.[1] || boundaryMatch?.[2]?.trim()
        if (!boundary) return json(res, 415, { message: '缺少 multipart boundary' })
        files = parseMultipart(body, boundary).filter(file => file.name === 'file' || file.name === 'files' || file.name === 'images' || file.name === '')
      } else if (contentType.startsWith('application/json')) {
        let input
        try { input = JSON.parse(body.toString('utf8')) } catch { return json(res, 400, { message: '上传数据格式无效' }) }
        const data = String(input.data || '')
        const dataUrl = data.match(/^data:(image\/(?:jpeg|png|gif|webp));base64,([A-Za-z0-9+/=_-]+)$/i)
        if (!dataUrl) return json(res, 415, { message: '图片 data URL 无效' })
        files = [{ name: 'file', filename: String(input.filename || 'image'), type: dataUrl[1].toLowerCase(), content: Buffer.from(dataUrl[2], 'base64') }]
      } else {
        return json(res, 415, { message: '请使用 multipart/form-data 上传图片' })
      }
      if (!files.length) return json(res, 422, { message: '至少上传一张图片' })
      if (files.length > MAX_UPLOAD_COUNT) return json(res, 422, { message: `最多上传 ${MAX_UPLOAD_COUNT} 张图片` })
      if (files.reduce((sum, file) => sum + file.content.length, 0) > MAX_UPLOAD_TOTAL_BYTES) return json(res, 413, { message: '上传内容超过大小限制' })
      const accepted = []
      for (const file of files) {
        if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type)) return json(res, 415, { message: '仅支持 JPG、PNG、GIF、WEBP 图片' })
        if (!file.content.length || file.content.length > MAX_UPLOAD_BYTES) return json(res, 413, { message: `单张图片不能超过 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB` })
        const extension = imageType(file.content, file.type)
        if (!extension) return json(res, 415, { message: '图片格式与文件内容不一致' })
        accepted.push({ ...file, extension })
      }
      await mkdir(UPLOADS_DIR, { recursive: true })
      const items = []
      for (const file of accepted) {
        let compressed
        try {
          compressed = await compressUploadedImage(file)
        } catch (error) {
          return json(res, Number(error?.statusCode) || 422, { message: error instanceof Error ? error.message : '图片压缩失败' })
        }
        const filename = `${id('image')}.${compressed.extension}`
        await writeFile(join(UPLOADS_DIR, filename), compressed.buffer, { flag: 'wx' })
        items.push({ name: file.filename.slice(-120), mimeType: compressed.mimeType, size: compressed.buffer.length, url: uploadUrl(req, filename) })
      }
      return json(res, 201, { items, url: items[0]?.url || null, file: items[0] || null })
    }
    if (req.method === 'GET' && (url.pathname === '/api/v1/points/config' || url.pathname === '/api/v1/me/points/config' || url.pathname === '/api/v1/points/purchase-config')) return json(res, 200, { unitName: pointsUnitName(), unit: pointsUnitName(), purchaseContact: purchaseContact() })
    if (req.method === 'GET' && (url.pathname === '/api/v1/points/withdrawal-config' || url.pathname === '/api/v1/me/withdrawals/config' || url.pathname === '/api/v1/me/withdrawal-config' || url.pathname === '/api/v1/withdrawals/config')) return json(res, 200, { unitName: pointsUnitName(), unit: pointsUnitName(), ...withdrawalConfig() })
    if (req.method === 'POST' && (url.pathname === '/api/v1/me/withdrawals/quote' || url.pathname === '/api/v1/withdrawals/quote')) {
      if (!user) return json(res, 401, { message: '需要登录' })
      const input = await readBody(req)
      const rawPoints = Number(input.points ?? input.amountPoints)
      if (!Number.isInteger(rawPoints) || rawPoints < 1) return json(res, 422, { message: `提现${pointsUnitName()}数量必须为正整数` })
      const quote = withdrawalQuote(rawPoints)
      return json(res, 200, { ...quote, balance: pointsBalance(user.id), canSubmit: rawPoints >= quote.minPoints && rawPoints <= pointsBalance(user.id) })
    }
    if (req.method === 'GET' && (url.pathname === '/api/v1/me/withdrawals' || url.pathname === '/api/v1/withdrawals')) {
      if (!user) return json(res, 401, { message: '需要登录' })
      const items = withdrawals.filter(item => item.userId === user.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(item => withdrawalPublic(item))
      return json(res, 200, { ...paginate(items, Object.fromEntries(url.searchParams)), balance: pointsBalance(user.id), unitName: pointsUnitName(), ...withdrawalConfig() })
    }
    const userWithdrawalMatch = url.pathname.match(/^\/api\/v1\/(?:me\/)?withdrawals\/([^/]+)$/)
    if (userWithdrawalMatch && req.method === 'GET') {
      if (!user) return json(res, 401, { message: '需要登录' })
      const item = withdrawals.find(candidate => candidate.id === decodeURIComponent(userWithdrawalMatch[1]) && candidate.userId === user.id)
      return item ? json(res, 200, withdrawalPublic(item)) : json(res, 404, { message: '提现记录不存在' })
    }
    if (req.method === 'POST' && (url.pathname === '/api/v1/me/withdrawals' || url.pathname === '/api/v1/withdrawals')) {
      if (!user) return json(res, 401, { message: '需要登录' })
      try {
        const input = await readBody(req)
        const qrCodeUrl = normalizeWithdrawalQrCode(input.qrCodeUrl || input.paymentQrCodeUrl || input.paymentCodeUrl)
        if (!qrCodeUrl) return json(res, 422, { message: '请上传有效的收款二维码图片' })
        const phone = normalizeWithdrawalPhone(input.phone || input.contactPhone || input.mobile)
        if (!validWithdrawalPhone(phone)) return json(res, 422, { message: '请输入有效的 11 位手机号码' })
        const rawPoints = Number(input.points ?? input.amountPoints)
        if (!Number.isInteger(rawPoints) || rawPoints < 1 || rawPoints > 1000000000) return json(res, 422, { message: `提现${pointsUnitName()}数量必须为 1 至 1000000000 的整数` })
        const config = withdrawalConfig()
        if (rawPoints < config.minPoints) return json(res, 422, { message: `最低提现 ${config.minPoints} ${pointsUnitName()}` })
        if (pointsBalance(user.id) < rawPoints) return json(res, 422, { message: `${pointsUnitName()}余额不足，当前可用 ${pointsBalance(user.id)}` })
        const quote = withdrawalQuote(rawPoints)
        const withdrawalId = id('withdrawal')
        const ledger = appendPointsLedger({ userId: user.id, delta: -rawPoints, type: 'withdrawal_hold', reason: '提交积分提现申请', actorId: user.id, sourceId: withdrawalId, note: input.note, metadata: { grossAmountRmb: quote.grossAmountRmb, feeAmountRmb: quote.feeAmountRmb, netAmountRmb: quote.netAmountRmb } })
        const item = normalizeWithdrawalRecord({ id: withdrawalId, userId: user.id, qrCodeUrl, channel: ['alipay', 'wechat'].includes(String(input.channel || input.paymentMethod)) ? String(input.channel || input.paymentMethod) : null, phone, points: rawPoints, pointsPerYuan: config.pointsPerYuan, withdrawFeePercent: config.withdrawFeePercent, grossAmountRmb: quote.grossAmountRmb, feeAmountRmb: quote.feeAmountRmb, netAmountRmb: quote.netAmountRmb, status: 'pending', createdAt: nowIso(), ledgerId: ledger.id, note: input.note })
        withdrawals.unshift(item)
        appendAudit(req, 'create', 'withdrawal', item.id, { userId: user.id, points: rawPoints, grossAmountRmb: quote.grossAmountRmb, feeAmountRmb: quote.feeAmountRmb, netAmountRmb: quote.netAmountRmb, ledgerId: ledger.id })
        notifyUser(user.id, { type: 'withdrawal_submitted', title: '提现申请已提交', body: `已提交 ${rawPoints} ${pointsUnitName()} 提现申请，预计到账 ¥${quote.netAmountRmb.toFixed(2)}`, targetType: 'withdrawal', targetId: item.id })
        await persistStore()
        return json(res, 201, { ...withdrawalPublic(item), balance: pointsBalance(user.id) })
      } catch (error) { return json(res, 422, { message: error instanceof Error ? error.message : '提现申请提交失败' }) }
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/commerce/contact') return json(res, 200, purchaseContact())
    if (req.method === 'GET' && (url.pathname === '/api/v1/member/groups' || url.pathname === '/api/v1/membership/groups')) {
      return json(res, 200, { items: memberGroups.filter(group => group.status === 'active').sort((a, b) => Number(a.rank || 0) - Number(b.rank || 0)) })
    }
    if (req.method === 'GET' && (url.pathname === '/api/v1/member/plans' || url.pathname === '/api/v1/membership/plans')) {
      return json(res, 200, { purchaseMode: 'offline_contact_cdkey', pointUnitName: pointsUnitName(), items: activePlans().map(plan => { const group = memberGroups.find(candidate => candidate.id === plan.groupId); return { ...plan, pricePoints: membershipRedeemPoints(plan), purchaseMode: 'points_redeem', redeemPoints: membershipRedeemPoints(plan), redeemUnitName: pointsUnitName(), pointUnitName: pointsUnitName(), groupName: group?.name || '会员', permissions: normalizePermissions(group?.permissions) } }) })
    }
    const memberRedeemMatch = url.pathname.match(/^\/api\/v1\/member\/plans\/([^/]+)\/(?:redeem|activate)$/)
    if (memberRedeemMatch && req.method === 'POST') {
      if (!user) return json(res, 401, { message: '需要登录' })
      try {
        const input = await readBody(req)
        const idempotencyKey = String(input.idempotencyKey || req.headers['idempotency-key'] || '').trim().slice(0, 128)
        const result = redeemMembershipWithPoints(memberRedeemMatch[1], user, { idempotencyKey })
        appendAudit(req, 'redeem', 'membership', result.membership?.id || result.order.id, { userId: user.id, planId: memberRedeemMatch[1], points: result.order.amountPoints, orderId: result.order.id, referralCommissionIds: (result.referralCommissions || []).map(item => item.id) })
        notifyUser(user.id, { type: 'membership_redeemed', title: '会员兑换成功', body: `你已使用 ${result.order.amountPoints} ${pointsUnitName()}兑换会员`, targetType: 'membership', targetId: result.membership?.id || result.order.id })
        await persistStore()
        return json(res, 201, { ...result.order, membership: result.membership, giftPoints: result.giftPoints, unitName: pointsUnitName() })
      } catch (error) { return json(res, 422, { message: error instanceof Error ? error.message : '会员兑换失败' }) }
    }
    if (req.method === 'POST' && (url.pathname === '/api/v1/me/cdkeys/redeem' || url.pathname === '/api/v1/cdkeys/redeem')) {
      if (!user) return json(res, 401, { message: '需要登录' })
      try {
        const input = await readBody(req)
        const code = normalizeCdkey(input.code || input.cdkey || input.key)
        if (!code) return json(res, 422, { message: '请输入兑换码' })
        const key = cdkeys.find(item => item.codeHash === cdkeyHash(code) || item.code === code)
        if (!key) return json(res, 404, { message: '兑换码不存在' })
        if (key.status === 'redeemed' && key.redeemedBy === user.id) {
          const previous = cdkeyRedemptions.find(item => item.cdkeyId === key.id)
          if (previous) return json(res, 200, { ...previous, balance: pointsBalance(user.id), unitName: pointsUnitName() })
        }
        if (key.status !== 'unused') return json(res, 409, { message: key.status === 'redeemed' ? '兑换码已使用' : '兑换码已失效' })
        if (key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now()) { key.status = 'expired'; await persistStore(); return json(res, 409, { message: '兑换码已过期' }) }
        if (key.kind !== 'points') return json(res, 422, { message: '该兑换码用于会员兑换，请使用会员兑换入口' })
        const points = normalizePoints(key.points)
        if (points < 1) return json(res, 422, { message: '兑换码积分值无效' })
        const ledger = appendPointsLedger({ userId: user.id, delta: points, type: 'cdkey_redeem', reason: '兑换码充值', actorId: user.id, sourceId: key.id, note: key.note, metadata: { batchId: key.batchId } })
        const commissions = referralCommissionFor({ sourceUserId: user.id, sourceType: 'points_recharge', sourceId: key.id, basePoints: points, note: key.note, metadata: { batchId: key.batchId, ledgerId: ledger.id } })
        key.status = 'redeemed'; key.redeemedAt = nowIso(); key.redeemedBy = user.id; key.redeemLedgerId = ledger.id
        const redemption = { id: id('cdkey_redemption'), cdkeyId: key.id, code: cdkeyForPublic(key, { includeCode: false }).code, kind: key.kind, userId: user.id, points, createdAt: nowIso(), ledgerId: ledger.id }
        cdkeyRedemptions.unshift(redemption)
        appendAudit(req, 'redeem', 'cdkey', key.id, { userId: user.id, points, ledgerId: ledger.id, referralCommissionIds: commissions.map(item => item.id) })
        notifyUser(user.id, { type: 'cdkey_redeemed', title: '兑换码使用成功', body: `已到账 ${points} ${pointsUnitName()}`, targetType: 'points', targetId: ledger.id })
        await persistStore()
        return json(res, 201, { ...redemption, balance: ledger.balanceAfter, unitName: pointsUnitName(), referralCommissions: commissions.map(referralCommissionPublic) })
      } catch (error) { return json(res, 422, { message: error instanceof Error ? error.message : '兑换失败' }) }
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/me/cdkey-redemptions') {
      if (!user) return json(res, 401, { message: '需要登录' })
      const items = cdkeyRedemptions.filter(item => item.userId === user.id)
      return json(res, 200, paginate(items, Object.fromEntries(url.searchParams)))
    }
    if (req.method === 'GET' && (url.pathname === '/api/v1/member/me' || url.pathname === '/api/v1/me/membership')) {
      if (!user) return json(res, 401, { message: '需要登录' })
      const current = activeMembershipsFor(user.id)
      const withPlan = item => { const plan = plans.find(candidate => candidate.id === item.planId); const group = memberGroups.find(candidate => candidate.id === (item.groupId || plan?.groupId)); return { ...item, planName: plan?.name || '会员', groupName: group?.name || '会员', permissions: normalizePermissions(group?.permissions) } }
      const active = current[0] ? withPlan(current[0]) : null
      return json(res, 200, { user, active, membership: active, member: active, memberships: (memberships.get(user.id) || []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(withPlan), entitlements: entitlements.filter(item => item.userId === user.id && item.status === 'active'), points: { balance: pointsBalance(user.id), unitName: pointsUnitName(), unit: pointsUnitName(), ledger: pointsLedger.filter(item => item.userId === user.id).slice(0, 100) }, permissions: membershipPermissions(user.id) })
    }
    if (req.method === 'GET' && (url.pathname === '/api/v1/me/points' || url.pathname === '/api/v1/me/points/ledger')) {
      if (!user) return json(res, 401, { message: '需要登录' })
      const ledger = pointsLedger.filter(item => item.userId === user.id)
      return json(res, 200, { balance: pointsBalance(user.id), unitName: pointsUnitName(), unit: pointsUnitName(), items: paginate(ledger, Object.fromEntries(url.searchParams)).items, total: ledger.length })
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/member/permissions') {
      if (!user) return json(res, 401, { message: '需要登录' })
      const requested = String(url.searchParams.get('permission') || '').trim()
      return json(res, 200, { permissions: membershipPermissions(user.id), ...(requested ? { permission: requested, allowed: hasPermission(user.id, requested) } : {}) })
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/member/entitlements') {
      if (!user) return json(res, 401, { message: '需要登录' })
      return json(res, 200, { memberships: activeMembershipsFor(user.id), posts: entitlements.filter(item => item.userId === user.id && item.status === 'active') })
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/orders') {
      if (!user) return json(res, 401, { message: '需要登录' })
      const status = url.searchParams.get('status'); const kind = url.searchParams.get('kind')
      const items = orders.filter(order => order.userId === user.id && (!status || order.status === status) && (!kind || order.kind === kind))
      return json(res, 200, paginate(items, Object.fromEntries(url.searchParams)))
    }
    if (pointPurchaseMatch && req.method === 'POST') {
      if (!user) return json(res, 401, { message: '需要登录' })
      try {
        const input = await readBody(req)
        const order = purchasePostWithPoints({ ...input, postId: pointPurchaseMatch[1] }, user)
        appendAudit(req, 'create', 'content_purchase', order.id, { postId: order.postId, points: order.amountPoints })
        await persistStore()
        return json(res, 201, order)
      } catch (error) { return json(res, 422, { message: error instanceof Error ? error.message : '积分购买失败' }) }
    }
    const orderDetailMatch = url.pathname.match(/^\/api\/v1\/orders\/([^/]+)$/)
    if (orderDetailMatch && req.method === 'GET') {
      const order = findOrder(orderDetailMatch[1])
      if (!order) return json(res, 404, { message: '订单不存在' })
      if (!user || order.userId !== user.id) return json(res, 404, { message: '订单不存在' })
      return json(res, 200, order)
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/tips') {
      const postId = url.searchParams.get('postId')
      const allItems = tips.filter(tip => tip.status === 'paid' && (!postId || tip.postId === postId)).map(tip => ({ ...tip, userId: tip.anonymous ? null : tip.userId, message: tip.message || '' }))
      const page = paginate(allItems, Object.fromEntries(url.searchParams))
      return json(res, 200, { ...page, totalPoints: allItems.reduce((sum, item) => sum + Number(item.points || 0), 0), totalCents: allItems.reduce((sum, item) => sum + Number(item.amountCents || 0), 0) })
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/me/tips') {
      if (!user) return json(res, 401, { message: '需要登录' })
      return json(res, 200, paginate(tips.filter(tip => tip.userId === user.id), Object.fromEntries(url.searchParams)))
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/tips') {
      if (!user) return json(res, 401, { message: '需要登录' })
      try {
        const input = await readBody(req)
        const tip = tipWithPoints(input, user)
        appendAudit(req, 'create', 'tip', tip.id, { postId: tip.postId, points: tip.points })
        await persistStore()
        return json(res, 201, tip)
      } catch (error) { return json(res, 422, { message: error instanceof Error ? error.message : '积分打赏失败' }) }
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/orders') {
      if (!user) return json(res, 401, { message: '需要登录' })
      try {
        const input = await readBody(req)
        if (!input.idempotencyKey && req.headers['idempotency-key']) input.idempotencyKey = String(req.headers['idempotency-key'])
        const order = createOrder(input, user)
        if (order.paymentProvider === 'points') appendAudit(req, 'create', 'content_purchase', order.id, { postId: order.postId, points: order.amountPoints, unitName: pointsUnitName() })
        await persistStore()
        return json(res, 201, order)
      } catch (error) { return json(res, 422, { message: error instanceof Error ? error.message : '订单创建失败' }) }
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/tips/orders') {
      if (!user) return json(res, 401, { message: '需要登录' })
      try { const input = await readBody(req); const tip = tipWithPoints(input, user); appendAudit(req, 'create', 'tip', tip.id, { postId: tip.postId, points: tip.points, compatibilityEndpoint: true }); await persistStore(); return json(res, 201, tip) } catch (error) { return json(res, 422, { message: error instanceof Error ? error.message : '积分打赏失败' }) }
    }
    const orderActionMatch = url.pathname.match(/^\/api\/v1\/orders\/([^/]+)\/(pay|payments|mock-success|cancel)$/)
    if (orderActionMatch && req.method === 'POST') {
      const order = findOrder(orderActionMatch[1])
      if (!order) return json(res, 404, { message: '订单不存在' })
      if (!user || (order.userId !== user.id && !isAdmin(req))) return json(res, 403, { message: '无权操作该订单' })
      if (orderActionMatch[2] === 'mock-success') {
        if (PAYMENT_PROVIDER !== 'mock' || IS_PRODUCTION) return json(res, 403, { message: '生产环境不允许使用模拟支付' })
        if (order.expiresAt && new Date(order.expiresAt).getTime() <= Date.now()) { order.status = 'expired'; await persistStore(); return json(res, 409, { message: '订单已过期', order }) }
        await markOrderPaid(order, { provider: 'mock', transactionId: `mock_tx_${Date.now()}` })
        return json(res, 200, { order, paid: true })
      }
      if (orderActionMatch[2] === 'cancel') {
        if (order.status !== 'pending') return json(res, 409, { message: '订单当前状态不可取消', order })
        order.status = 'cancelled'; order.cancelledAt = nowIso(); await persistStore(); return json(res, 200, order)
      }
      if (order.status !== 'pending') return json(res, 409, { message: '订单当前状态不可支付', order })
      if (order.expiresAt && new Date(order.expiresAt).getTime() <= Date.now()) { order.status = 'expired'; await persistStore(); return json(res, 409, { message: '订单已过期', order }) }
      const payment = paymentPayload(order)
      if (!payment) return json(res, 503, { message: '支付服务尚未配置完成' })
      order.paymentCreatedAt = nowIso(); await persistStore()
      return json(res, 200, payment)
    }
    if (req.method === 'POST' && ['/api/v1/payments/webhook', '/api/v1/payments/wechat/notify', '/api/v1/payments/alipay/notify'].includes(url.pathname)) {
      const input = await readBody(req)
      if (!verifyWebhookSignature(input, JSON.stringify(input))) return json(res, 401, { message: '支付回调签名无效' })
      const order = findOrder(input.orderId || input.orderNo)
      if (!order) return json(res, 404, { message: '订单不存在' })
      if (String(input.status || 'paid') !== 'paid') return json(res, 200, { received: true })
      await markOrderPaid(order, { provider: input.provider || PAYMENT_PROVIDER, transactionId: input.transactionId })
      return json(res, 200, { received: true, orderId: order.id })
    }
    if (postCreate) {
      if (!user) return json(res, 401, { message: '需要登录' })
      const input = await readBody(req)
      const isDraft = input.draft === true || String(input.status || '').toLowerCase() === 'draft'
      const title = String(input.title || (isDraft ? '未命名草稿' : '')).trim().slice(0, 200)
      const excerpt = String(input.excerpt || '').trim().slice(0, 1200)
      const content = String(input.content || '').trim().slice(0, 200000)
      const images = normalizeUploadedImages(input.images)
      if (!title || (!isDraft && (!input.platform || (!excerpt && !content && !images.length)))) return json(res, 422, { message: isDraft ? '草稿标题不能为空' : '提交审核前请填写标题、平台和摘要、正文或正文配图' })
      const author = profileFor(user)
      const accessType = ['free', 'member', 'paid'].includes(String(input.accessType || 'free')) ? String(input.accessType || 'free') : 'free'
      const memberPlanIds = validateMemberPlanIds(input.memberPlanIds)
      if (memberPlanIds.invalid.length) return json(res, 422, { message: '会员套餐不存在或已停用', invalidPlanIds: memberPlanIds.invalid })
      const post = { id: id('post'), title, excerpt, content, coverImage: normalizeUploadedUrl(input.coverImage), images, platform: String(input.platform || '未分类').trim().slice(0, 80), project: String(input.project || '未分类').trim().slice(0, 80), skill: String(input.skill || '未分类').trim().slice(0, 80), author: { id: author.id, name: author.name, avatarUrl: author.avatarUrl }, publishedAt: null, submittedAt: nowIso(), digest: false, status: isDraft ? 'draft' : 'pending', accessType, pricePoints: accessType === 'paid' ? normalizePoints(input.pricePoints ?? input.priceCents) : 0, priceCents: 0, memberPlanIds: memberPlanIds.ids, counts: { anchors: 0, likes: 0, comments: 0, favorites: 0, tips: 0 } }
      posts.unshift(post); await persistStore(); return json(res, 201, { ...post, content: undefined })
    }
    if (postMatch && req.method === 'PATCH') {
      if (!user) return json(res, 401, { message: '需要登录' })
      const post = posts.find(item => item.id === postMatch[1])
      if (!post || post.author?.id !== user.id) return json(res, 404, { message: '内容不存在' })
      if (post.status === 'published') return json(res, 409, { message: '已发布内容请联系管理员修改' })
      if (post.status === 'archived') return json(res, 409, { message: '已归档内容不能修改' })
      const input = await readBody(req)
      for (const field of ['title', 'excerpt', 'content', 'platform', 'project', 'skill']) if (input[field] !== undefined) post[field] = String(input[field] || '').trim().slice(0, field === 'content' ? 200000 : field === 'excerpt' ? 1200 : field === 'title' ? 200 : 80)
      if (input.coverImage !== undefined) post.coverImage = normalizeUploadedUrl(input.coverImage)
      if (input.images !== undefined) post.images = normalizeUploadedImages(input.images)
      if (input.accessType !== undefined && ['free', 'member', 'paid'].includes(String(input.accessType))) post.accessType = String(input.accessType)
      if (input.pricePoints !== undefined || input.priceCents !== undefined) post.pricePoints = post.accessType === 'paid' ? normalizePoints(input.pricePoints ?? input.priceCents) : 0
      if (post.accessType !== 'paid') post.pricePoints = 0
      post.priceCents = 0
      if (Array.isArray(input.memberPlanIds)) {
        const memberPlanIds = validateMemberPlanIds(input.memberPlanIds)
        if (memberPlanIds.invalid.length) return json(res, 422, { message: '会员套餐不存在或已停用', invalidPlanIds: memberPlanIds.invalid })
        post.memberPlanIds = memberPlanIds.ids
      }
      const requestedStatus = input.status === undefined ? null : String(input.status)
      if (requestedStatus && !['draft', 'pending'].includes(requestedStatus)) return json(res, 422, { message: '投稿状态只能是 draft 或 pending' })
      if (requestedStatus === 'pending') {
        if (!post.title || !post.platform || (!post.excerpt && !post.content && !post.images?.length)) return json(res, 422, { message: '提交审核前请完善标题、平台和摘要、正文或正文配图' })
        post.status = 'pending'; post.submittedAt = nowIso(); post.rejectedAt = null; post.rejectionReason = null
      } else if (requestedStatus === 'draft') {
        post.status = 'draft'; post.rejectedAt = null; post.rejectionReason = null
      }
      post.updatedAt = nowIso()
      appendAudit(req, 'update', 'post', post.id, { status: post.status, owner: true })
      await persistStore(); return json(res, 200, { ...post, content: undefined })
    }
    if (postMatch && req.method === 'DELETE') {
      if (!user) return json(res, 401, { message: '需要登录' })
      const post = posts.find(item => item.id === postMatch[1])
      if (!post || post.author?.id !== user.id) return json(res, 404, { message: '内容不存在' })
      if (post.status === 'published') return json(res, 409, { message: '已发布内容不能删除，请提交举报或联系管理员' })
      if (post.status === 'archived') return json(res, 200, { archived: true })
      post.status = 'archived'; post.archivedAt = nowIso(); appendAudit(req, 'archive', 'post', post.id, { owner: true }); await persistStore(); return json(res, 200, { archived: true })
    }
    if (postReportMatch && req.method === 'POST') {
      if (!user) return json(res, 401, { message: '需要登录' })
      const post = posts.find(item => item.id === postReportMatch[1])
      if (!post || post.status !== 'published') return json(res, 404, { message: 'Post not found' })
      const input = await readBody(req); const reason = String(input.reason || input.category || 'other').trim().slice(0, 40); const detail = String(input.detail || input.description || '').trim().slice(0, 1000)
      if (!detail && reason === 'other') return json(res, 422, { message: '请填写举报原因' })
      if (reports.some(report => report.postId === post.id && report.reporterId === user.id && report.status === 'pending')) return json(res, 409, { message: '你已举报过该内容，请等待处理' })
      const report = { id: id('report'), postId: post.id, reporterId: user.id, reason, detail, status: 'pending', createdAt: nowIso(), resolvedAt: null, resolution: null }
      reports.unshift(report); await persistStore(); return json(res, 201, report)
    }
    if (commentReportMatch && req.method === 'POST') {
      if (!user) return json(res, 401, { message: '需要登录' })
      let found = null; let postId = null
      for (const [candidatePostId, list] of comments.entries()) {
        const candidate = list.find(item => item.id === commentReportMatch[1] && item.status !== 'deleted')
        if (candidate) { found = candidate; postId = candidatePostId; break }
      }
      if (!found) return json(res, 404, { message: '评论不存在' })
      const input = await readBody(req); const reason = String(input.reason || input.category || 'other').trim().slice(0, 40); const detail = String(input.detail || input.description || '').trim().slice(0, 1000)
      if (!detail && reason === 'other') return json(res, 422, { message: '请填写举报原因' })
      if (commentReports.some(report => report.commentId === found.id && report.reporterId === user.id && report.status === 'pending')) return json(res, 409, { message: '你已举报过该评论，请等待处理' })
      const report = { id: id('comment_report'), commentId: found.id, postId, reporterId: user.id, reason, detail, status: 'pending', createdAt: nowIso(), resolvedAt: null, resolution: null }
      commentReports.unshift(report); await persistStore(); return json(res, 201, report)
    }
    if (commentDeleteMatch && req.method === 'DELETE') {
      if (!user) return json(res, 401, { message: '需要登录' })
      const found = findComment(commentDeleteMatch[1]); if (!found || found.comment.user?.id !== user.id) return json(res, 404, { message: '评论不存在' })
      if (found.comment.status === 'deleted') return json(res, 200, { deleted: true })
      const deletedCount = softDeleteCommentTree(found.postId, found.comment.id); const post = posts.find(item => item.id === found.postId); if (post) post.counts.comments = Math.max(0, Number(post.counts.comments || 0) - deletedCount)
      appendAudit(req, 'delete', 'comment', found.comment.id, { postId: found.postId, owner: true }); await persistStore(); return json(res, 200, { deleted: true })
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/admin/auth/login') {
      try {
        const input = await readBody(req); const usernameKey = normalizeUsername(input.username || input.identifier); const password = String(input.password || '')
        const throttle = adminLoginThrottle(req, usernameKey)
        if (!throttle.allowed) return json(res, 429, { message: '登录尝试过于频繁，请稍后再试', retryAfter: throttle.retryAfter })
        const admin = [...admins.values()].find(item => item.usernameKey === usernameKey)
        if (!admin || admin.status !== 'active' || !verifyPassword(password, admin)) {
          const retryAfter = recordAdminLoginFailure(throttle.key)
          if (retryAfter) return json(res, 429, { message: '登录尝试过于频繁，请稍后再试', retryAfter })
          return json(res, 401, { message: '管理员账号或密码不正确' })
        }
        clearAdminLoginFailures(throttle.key)
        admin.lastLoginAt = nowIso(); appendAudit(req, 'login', 'admin', admin.id, { username: admin.username }); await persistStore()
        return json(res, 200, { accessToken: signAdminToken(admin, input.remember !== false), expiresInDays: input.remember === false ? 7 : 30, admin: adminPublic(admin) })
      } catch (error) { return json(res, 422, { message: error instanceof Error ? error.message : '管理员登录失败' }) }
    }
    if (url.pathname.startsWith('/api/v1/admin/')) {
      const admin = currentAdmin(req)
      if (!admin) return json(res, 401, { message: '需要管理员登录' })
      const requiredPermission = adminPermissionFor(url.pathname, req.method)
      if (!hasAdminPermission(admin, requiredPermission)) return json(res, 403, { message: '当前管理员角色没有此操作权限', requiredPermission })
      if (req.method === 'GET' && url.pathname === '/api/v1/admin/auth/me') return json(res, 200, { admin: adminPublic(admin) })
      if (req.method === 'GET' && /^\/api\/v1\/admin\/users(?:\/[^/]+)?$/.test(url.pathname)) {
        const userMatch = url.pathname.match(/^\/api\/v1\/admin\/users\/([^/]+)$/)
        const query = String(url.searchParams.get('q') || url.searchParams.get('search') || '').trim().toLowerCase()
        const status = String(url.searchParams.get('status') || '').trim()
        const source = [...accounts.values()].map(account => {
          const profile = profileFor(account)
          const active = activeMembershipsFor(account.id)[0] || null
          const group = membershipGroup(active)
          return { ...accountUser(account), ...profile, status: account.status, createdAt: account.createdAt || profile.createdAt || null, lastLoginAt: account.lastLoginAt || null, points: pointsBalance(account.id), membership: active ? { id: active.id, groupId: active.groupId, groupName: group?.name || '会员', planId: active.planId, endsAt: active.endsAt } : null }
        })
        if (userMatch) {
          const item = source.find(value => value.id === decodeURIComponent(userMatch[1]))
          return item ? json(res, 200, { user: item }) : json(res, 404, { message: '用户不存在' })
        }
        const items = source.filter(item => (!status || item.status === status) && (!query || [item.id, item.username, item.email, item.name].some(value => String(value || '').toLowerCase().includes(query))))
        return json(res, 200, paginate(items, Object.fromEntries(url.searchParams)))
      }
      const adminUserPatchMatch = url.pathname.match(/^\/api\/v1\/admin\/users\/([^/]+)$/)
      if (adminUserPatchMatch && req.method === 'PATCH') {
        const account = accounts.get(decodeURIComponent(adminUserPatchMatch[1]))
        if (!account) return json(res, 404, { message: '用户不存在' })
        const input = await readBody(req)
        const status = String(input.status || '').trim()
        if (!['active', 'disabled'].includes(status)) return json(res, 422, { message: '用户状态只能是 active 或 disabled' })
        const previous = account.status || 'active'
        account.status = status
        // Disabling must end every existing session immediately.
        if (status === 'disabled' && previous !== 'disabled') account.authVersion = randomBytes(16).toString('hex')
        account.statusNote = String(input.note || input.reason || '').trim().slice(0, 300) || null
        account.statusUpdatedAt = nowIso()
        appendAudit(req, status === 'disabled' ? 'disable' : 'enable', 'account', account.id, { previous, note: account.statusNote })
        await persistStore()
        return json(res, 200, { user: { ...accountUser(account), status: account.status, statusNote: account.statusNote } })
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/admin/notifications') {
        const userId = String(url.searchParams.get('userId') || '').trim()
        const batchId = String(url.searchParams.get('batchId') || '').trim()
        const type = String(url.searchParams.get('type') || '').trim()
        const unreadOnly = url.searchParams.get('unread') === 'true' || url.searchParams.get('status') === 'unread'
        const items = []
        for (const [recipientId, list] of notifications.entries()) for (const item of list) {
          if (userId && recipientId !== userId) continue
          if (batchId && item.batchId !== batchId) continue
          if (type && item.type !== type) continue
          if (unreadOnly && item.readAt) continue
          items.push({ ...item, recipientId })
        }
        items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        const page = paginate(items, Object.fromEntries(url.searchParams))
        return json(res, 200, { ...page, retentionDays: NOTIFICATION_RETENTION_DAYS, unread: items.filter(item => !item.readAt).length })
      }
      if (req.method === 'POST' && url.pathname === '/api/v1/admin/notifications') {
        const input = await readBody(req)
        const title = String(input.title || '').trim().slice(0, 80)
        const body = String(input.body || input.content || '').trim().slice(0, 500)
        if (!title) return json(res, 422, { message: '站内信标题不能为空' })
        if (!body) return json(res, 422, { message: '站内信内容不能为空' })
        const recipients = resolveNotificationRecipients(input)
        if (recipients.scope === 'users' && recipients.requested.length && recipients.ids.length === 0) return json(res, 422, { message: '指定用户不存在或已停用' })
        if (recipients.scope === 'group' && recipients.groupIds.length === 0) return json(res, 422, { message: '指定会员分组不存在或已停用' })
        if (recipients.ids.length === 0) return json(res, 422, { message: '没有符合条件的收件人' })
        const batchId = id('notification_batch')
        const type = String(input.type || 'admin_message').trim().slice(0, 40) || 'admin_message'
        const targetType = input.targetType ? String(input.targetType).trim().slice(0, 40) : null
        const targetId = input.targetId ? String(input.targetId).trim().slice(0, 120) : null
        const sentAt = nowIso()
        for (const userId of recipients.ids) notifyUser(userId, { type, title, body, targetType, targetId, batchId, senderAdminId: admin.id })
        appendAudit(req, 'send', 'notification', batchId, { scope: recipients.scope, userIds: recipients.scope === 'users' ? recipients.ids : undefined, groupIds: recipients.scope === 'group' ? recipients.groupIds : undefined, recipientCount: recipients.ids.length, title, type })
        await persistStore()
        return json(res, 201, { batchId, scope: recipients.scope, recipientCount: recipients.ids.length, skippedUserIds: recipients.skipped || [], skippedGroupIds: recipients.skippedGroups || [], title, type, sentAt })
      }
      if (url.pathname === '/api/v1/admin/admins' && req.method === 'GET') return json(res, 200, { items: [...admins.values()].map(adminPublic) })
      if (url.pathname === '/api/v1/admin/admins' && req.method === 'POST') {
        const input = await readBody(req); const username = String(input.username || '').trim(); const usernameKey = normalizeUsername(username); const password = String(input.password || '')
        if (!validUsername(username)) return json(res, 422, { message: '管理员用户名需为 3-24 位中文、字母、数字、下划线或短横线' })
        if (password.length < 8 || password.length > 72) return json(res, 422, { message: '管理员密码长度需为 8-72 位' })
        if ([...admins.values()].some(item => item.usernameKey === usernameKey)) return json(res, 409, { message: '管理员用户名已存在' })
        const passwordData = passwordHash(password); const adminId = `admin_${randomBytes(9).toString('hex')}`; const createdAt = nowIso()
        const record = { id: adminId, username, usernameKey, name: String(input.name || username).trim().slice(0, 80) || username, role: adminRole(input.role), status: 'active', passwordHash: passwordData.hash, passwordSalt: passwordData.salt, authVersion: randomBytes(16).toString('hex'), createdAt, lastLoginAt: null }
        admins.set(adminId, record); appendAudit(req, 'create', 'admin', adminId, { username, role: record.role }); await persistStore(); return json(res, 201, { admin: adminPublic(record) })
      }
      const adminMatch = url.pathname.match(/^\/api\/v1\/admin\/admins\/([^/]+)$/)
      if (adminMatch && (req.method === 'PATCH' || req.method === 'DELETE')) {
        const record = admins.get(adminMatch[1]); if (!record) return json(res, 404, { message: '管理员不存在' })
        const input = req.method === 'PATCH' ? await readBody(req) : {}
        if (record.id === admin.id && String(input.status || '') === 'disabled') return json(res, 422, { message: '不能停用当前登录管理员' })
        if (req.method === 'DELETE' || input.status === 'disabled') record.status = 'disabled'
        if (input.status === 'active') record.status = 'active'
        if (input.role !== undefined) record.role = adminRole(input.role)
        if (input.name !== undefined) record.name = String(input.name || record.username).trim().slice(0, 80) || record.username
        if (input.password !== undefined) { const password = String(input.password || ''); if (password.length < 8 || password.length > 72) return json(res, 422, { message: '管理员密码长度需为 8-72 位' }); const passwordData = passwordHash(password); record.passwordHash = passwordData.hash; record.passwordSalt = passwordData.salt; record.authVersion = randomBytes(16).toString('hex') }
        appendAudit(req, req.method === 'DELETE' ? 'disable' : 'update', 'admin', record.id, { status: record.status, role: record.role }); await persistStore(); return json(res, 200, { admin: adminPublic(record) })
      }
      if (req.method === 'GET' && (url.pathname === '/api/v1/admin/settings/smtp' || url.pathname === '/api/v1/admin/smtp')) return json(res, 200, smtpForPublic())
      if (req.method === 'PATCH' && (url.pathname === '/api/v1/admin/settings/smtp' || url.pathname === '/api/v1/admin/smtp')) {
        const input = await readBody(req); const next = { ...smtpConfig }
        if (input.host !== undefined) next.host = String(input.host || '').trim().slice(0, 200)
        if (input.port !== undefined) next.port = Math.max(1, Math.min(65535, Number(input.port) || 465))
        if (input.secure !== undefined) next.secure = input.secure === true || String(input.secure).toLowerCase() === 'true'
        if (input.user !== undefined) next.user = normalizeEmail(input.user)
        if (input.from !== undefined) next.from = String(input.from || '').trim().slice(0, 200)
        if (input.pass !== undefined && String(input.pass).trim()) next.pass = String(input.pass).trim().slice(0, 300)
        smtpConfig = next; appendAudit(req, 'update', 'smtp_config', 'default', { host: next.host, port: next.port, secure: next.secure, user: next.user, configured: Boolean(next.pass) }); await persistStore(); return json(res, 200, smtpForPublic())
      }
      if (req.method === 'GET' && (url.pathname === '/api/v1/admin/checkin-config' || url.pathname === '/api/v1/admin/checkins/config')) {
        const config = checkinConfigPublic(); return json(res, 200, { ...config, checkinConfig: config })
      }
      if (req.method === 'PATCH' && (url.pathname === '/api/v1/admin/checkin-config' || url.pathname === '/api/v1/admin/checkins/config')) {
        const input = await readBody(req); const source = input.checkinConfig && typeof input.checkinConfig === 'object' ? input.checkinConfig : input
        if (source.dailyPoints !== undefined || source.basePoints !== undefined || source.dailyReward !== undefined) {
          const value = Number(source.dailyPoints ?? source.basePoints ?? source.dailyReward); if (!Number.isInteger(value) || value < 0 || value > 1000000000) return json(res, 422, { message: '每日签到积分必须是 0 到 1000000000 的整数' })
        }
        const next = normalizeCheckinConfig({ ...checkinConfig, ...source }); checkinConfig = next
        appendAudit(req, 'update', 'checkin_config', 'default', next); await persistStore()
        const config = checkinConfigPublic(); return json(res, 200, { ...config, checkinConfig: config })
      }
      if (req.method === 'GET' && (url.pathname === '/api/v1/admin/checkins/stats' || url.pathname === '/api/v1/admin/checkin-stats')) {
        const today = checkinDateKey(); const allRecords = [...checkins.values()].flat(); const todayRecords = allRecords.filter(record => record.checkinDate === today); const summary = { ...checkinAdminSummary(), totalCheckins: allRecords.length, totalUsers: [...checkins.values()].filter(records => records.length).length, todayCheckins: todayRecords.length, todayUsers: new Set(todayRecords.map(record => record.userId)).size }
        return json(res, 200, { ...summary, stats: summary, today, config: checkinConfigPublic() })
      }
      if (req.method === 'GET' && (url.pathname === '/api/v1/admin/checkins' || url.pathname === '/api/v1/admin/checkins/records')) {
        const userId = String(url.searchParams.get('userId') || '').trim(); const date = String(url.searchParams.get('date') || '').trim(); const period = url.searchParams.get('period'); const query = String(url.searchParams.get('q') || url.searchParams.get('search') || '').trim().toLowerCase(); const from = String(url.searchParams.get('from') || url.searchParams.get('dateStart') || '').trim(); const to = String(url.searchParams.get('to') || url.searchParams.get('dateEnd') || '').trim()
        const range = period ? checkinPeriodRange(period) : null
        const items = [...checkins.values()].flat().filter(record => { const account = accounts.get(record.userId); const profile = account ? profileFor(account) : null; const searchText = [record.userId, account?.username, account?.email, profile?.name].join(' ').toLowerCase(); return (!userId || record.userId === userId) && (!date || record.checkinDate === date) && (!from || record.checkinDate >= from) && (!to || record.checkinDate <= to) && (!query || searchText.includes(query)) && (!range || ((!range.start || record.checkinDate >= range.start) && record.checkinDate <= range.end)) }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(record => ({ ...checkinRecordPublic(record), user: referralUserPublic(record.userId) }))
        const page = paginate(items, Object.fromEntries(url.searchParams)); return json(res, 200, { ...page, records: page.items, summary: checkinAdminSummary(), config: checkinConfigPublic() })
      }
      if (req.method === 'GET' && (url.pathname === '/api/v1/admin/checkin-leaderboard' || url.pathname === '/api/v1/admin/checkins/leaderboard')) {
        const ranking = checkinLeaderboard({ period: url.searchParams.get('period') || 'month', limit: url.searchParams.get('limit') || url.searchParams.get('pageSize') || 20 })
        return json(res, 200, { ...ranking, summary: checkinAdminSummary(), config: checkinConfigPublic() })
      }
      if (req.method === 'GET' && (url.pathname === '/api/v1/admin/referral-config' || url.pathname === '/api/v1/admin/referrals/config')) {
        const config = referralConfigPublic()
        return json(res, 200, { ...config, referralConfig: config })
      }
      if (req.method === 'PATCH' && (url.pathname === '/api/v1/admin/referral-config' || url.pathname === '/api/v1/admin/referrals/config')) {
        const input = await readBody(req)
        const source = input.referralConfig && typeof input.referralConfig === 'object' ? input.referralConfig : input
        const next = normalizeReferralConfig({ ...referralConfig, ...source })
        referralConfig = next
        const config = referralConfigPublic()
        appendAudit(req, 'update', 'referral_config', 'default', config)
        await persistStore()
        return json(res, 200, { ...config, referralConfig: config })
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/admin/referrals') {
        const parentId = String(url.searchParams.get('parentId') || url.searchParams.get('referrerId') || '').trim()
        const childId = String(url.searchParams.get('childId') || url.searchParams.get('userId') || '').trim()
        const items = [...referralRelations.values()].filter(item => (!parentId || item.parentId === parentId) && (!childId || item.childId === childId)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(item => ({ ...item, level: 1, parent: referralUserPublic(item.parentId), child: referralUserPublic(item.childId), referrer: referralUserPublic(item.parentId), invitee: referralUserPublic(item.childId) }))
        return json(res, 200, { ...paginate(items, Object.fromEntries(url.searchParams)), config: referralConfigPublic() })
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/admin/referral-commissions') {
        const beneficiaryId = String(url.searchParams.get('beneficiaryId') || url.searchParams.get('userId') || '').trim()
        const sourceUserId = String(url.searchParams.get('sourceUserId') || url.searchParams.get('inviteeId') || '').trim()
        const status = String(url.searchParams.get('status') || '').trim()
        const type = String(url.searchParams.get('sourceType') || url.searchParams.get('type') || '').trim()
        const items = referralCommissions.filter(item => (!beneficiaryId || item.beneficiaryId === beneficiaryId) && (!sourceUserId || item.sourceUserId === sourceUserId) && (!status || item.status === status) && (!type || item.sourceType === type)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(item => ({ ...referralCommissionPublic(item), beneficiary: referralUserPublic(item.beneficiaryId), sourceUser: referralUserPublic(item.sourceUserId) }))
        return json(res, 200, { ...paginate(items, Object.fromEntries(url.searchParams)), config: referralConfigPublic() })
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/admin/overview') {
        const activePostCount = posts.filter(item => item.status !== 'archived').length
        const paidOrderCount = orders.filter(item => item.status === 'paid').length
        const pointsInCirculation = [...pointsAccounts.values()].reduce((total, value) => total + Number(value || 0), 0)
        return json(res, 200, { posts: activePostCount, publishedPosts: posts.filter(item => item.status === 'published').length, pendingPosts: posts.filter(item => item.status === 'pending').length, tags: Object.values(tags).reduce((total, values) => total + values.length, 0), comments: [...comments.values()].reduce((total, values) => total + values.length, 0), reports: reports.filter(report => report.status === 'pending').length + commentReports.filter(report => report.status === 'pending').length, plans: activePlans().length, memberGroups: memberGroups.filter(group => group.status === 'active').length, memberships: [...memberships.values()].reduce((total, values) => total + values.filter(item => item.status === 'active').length, 0), orders: orders.length, paidOrders: paidOrderCount, revenueCents: orders.filter(item => item.status === 'paid').reduce((total, item) => total + Number(item.amountCents || 0), 0), tipsCents: tips.filter(item => item.status === 'paid').reduce((total, item) => total + Number(item.amountCents || 0), 0), tipsPoints: tips.filter(item => item.status === 'paid').reduce((total, item) => total + Number(item.points || 0), 0), points: pointsInCirculation, pointsAccounts: pointsAccounts.size, pointsInCirculation, pointsTransactions: pointsLedger.length, recharges: pointsLedger.filter(item => item.type === 'admin_recharge').length, withdrawals: withdrawals.length, pendingWithdrawals: withdrawals.filter(item => item.status === 'pending').length, auditLogs: auditLogs.length, users: accounts.size, newUsers7d: [...accounts.values()].filter(item => item.createdAt && Date.now() - new Date(item.createdAt).getTime() < 7 * 86400000).length, posts7d: posts.filter(item => item.status === 'published' && item.publishedAt && Date.now() - new Date(item.publishedAt).getTime() < 7 * 86400000).length, checkinsToday: [...checkins.values()].flat().filter(record => record.checkinDate === checkinDateKey()).length })
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/admin/reports') {
        const status = url.searchParams.get('status'); const postId = url.searchParams.get('postId')
        const items = reports.filter(report => (!status || report.status === status) && (!postId || report.postId === postId)).map(report => ({ ...report, post: posts.find(post => post.id === report.postId) ? { id: report.postId, title: posts.find(post => post.id === report.postId).title, status: posts.find(post => post.id === report.postId).status } : null }))
        return json(res, 200, paginate(items, Object.fromEntries(url.searchParams)))
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/admin/comment-reports') {
        const status = url.searchParams.get('status'); const postId = url.searchParams.get('postId')
        const filtered = commentReports.filter(report => (!status || report.status === status) && (!postId || report.postId === postId)).map(report => ({ ...report, comment: findComment(report.commentId)?.comment || null, post: posts.find(post => post.id === report.postId) ? { id: report.postId, title: posts.find(post => post.id === report.postId).title, status: posts.find(post => post.id === report.postId).status } : null }))
        return json(res, 200, paginate(filtered, Object.fromEntries(url.searchParams)))
      }
      const adminCommentReportMatch = url.pathname.match(/^\/api\/v1\/admin\/comment-reports\/([^/]+)(?:\/resolve)?$/)
      if (adminCommentReportMatch && (req.method === 'PATCH' || req.method === 'POST')) {
        const report = commentReports.find(item => item.id === adminCommentReportMatch[1]); if (!report) return json(res, 404, { message: 'Comment report not found' })
        const input = await readBody(req); const nextStatus = String(input.status || (url.pathname.endsWith('/resolve') ? 'resolved' : 'resolved'))
        if (!['pending', 'resolved', 'rejected'].includes(nextStatus)) return json(res, 422, { message: '举报状态无效' })
        report.status = nextStatus; report.resolution = String(input.resolution || input.note || '').trim().slice(0, 500) || null; report.resolvedAt = nextStatus === 'pending' ? null : nowIso(); report.resolvedBy = admin.id
        appendAudit(req, 'update', 'comment_report', report.id, { status: report.status })
        notifyUser(report.reporterId, { type: 'comment_report_update', title: '评论举报处理结果', body: report.status === 'resolved' ? '你提交的评论举报已处理' : report.status === 'rejected' ? '你提交的评论举报未通过' : '评论举报已重新打开', targetType: 'comment_report', targetId: report.id })
        await persistStore(); return json(res, 200, report)
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/admin/comments') {
        const postId = url.searchParams.get('postId'); const status = url.searchParams.get('status')
        const all = [...comments.entries()].flatMap(([candidatePostId, list]) => list.filter(comment => (!postId || candidatePostId === postId) && (!status || (comment.status || 'published') === status)).map(comment => ({ ...comment, postId: candidatePostId })))
        all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        return json(res, 200, paginate(all, Object.fromEntries(url.searchParams)))
      }
      const adminCommentMatch = url.pathname.match(/^\/api\/v1\/admin\/comments\/([^/]+)$/)
      if (adminCommentMatch && (req.method === 'PATCH' || req.method === 'DELETE')) {
        const found = findComment(adminCommentMatch[1]); if (!found) return json(res, 404, { message: 'Comment not found' })
        const previous = found.comment.status || 'published'
        const input = req.method === 'PATCH' ? await readBody(req) : {}
        const nextStatus = req.method === 'DELETE' ? 'deleted' : String(input.status || 'published')
        if (!['published', 'deleted'].includes(nextStatus)) return json(res, 422, { message: '评论状态无效' })
        const deletedCount = nextStatus === 'deleted' ? softDeleteCommentTree(found.postId, found.comment.id) : 0
        found.comment.status = nextStatus; if (nextStatus === 'deleted') found.comment.deletedAt = nowIso(); else found.comment.deletedAt = null
        if (previous !== 'deleted' && nextStatus === 'deleted') { const post = posts.find(item => item.id === found.postId); if (post) post.counts.comments = Math.max(0, Number(post.counts.comments || 0) - deletedCount) }
        if (previous === 'deleted' && nextStatus !== 'deleted') { const post = posts.find(item => item.id === found.postId); if (post) post.counts.comments = Number(post.counts.comments || 0) + 1 }
        appendAudit(req, nextStatus === 'deleted' ? 'delete' : 'restore', 'comment', found.comment.id, { postId: found.postId }); await persistStore(); return json(res, 200, found.comment)
      }
      const adminReportMatch = url.pathname.match(/^\/api\/v1\/admin\/reports\/([^/]+)(?:\/resolve)?$/)
      if (adminReportMatch && (req.method === 'PATCH' || req.method === 'POST')) {
        const report = reports.find(item => item.id === adminReportMatch[1]); if (!report) return json(res, 404, { message: 'Report not found' })
        const input = await readBody(req); const nextStatus = String(input.status || (url.pathname.endsWith('/resolve') ? 'resolved' : 'resolved'))
        if (!['pending', 'resolved', 'rejected'].includes(nextStatus)) return json(res, 422, { message: '举报状态无效' })
        report.status = nextStatus; report.resolution = String(input.resolution || input.note || '').trim().slice(0, 500) || null; report.resolvedAt = nextStatus === 'pending' ? null : nowIso(); report.resolvedBy = admin.id
        appendAudit(req, 'update', 'report', report.id, { status: report.status })
        notifyUser(report.reporterId, { type: 'report_update', title: '举报处理结果', body: report.status === 'resolved' ? '你提交的举报已处理' : report.status === 'rejected' ? '你提交的举报未通过' : '举报已重新打开', targetType: 'report', targetId: report.id })
        await persistStore(); return json(res, 200, report)
      }
      const adminGroupMatch = url.pathname.match(/^\/api\/v1\/admin\/member-groups(?:\/([^/]+))?$/)
      if (adminGroupMatch && req.method === 'GET') return json(res, 200, { items: memberGroups })
      if (adminGroupMatch && req.method === 'POST' && !adminGroupMatch[1]) {
        const input = await readBody(req); const code = String(input.code || '').trim(); const name = String(input.name || '').trim()
        if (!code || !name) return json(res, 422, { message: 'code 和 name 均为必填项' })
        if (input.status !== undefined && !['active', 'disabled', 'archived'].includes(String(input.status))) return json(res, 422, { message: '会员分组状态无效' })
        if (memberGroups.some(group => group.code === code)) return json(res, 409, { message: '会员分组编码已存在' })
        const group = { id: id('group'), code, name, description: String(input.description || '').trim().slice(0, 500), rank: Number(input.rank) || 0, status: input.status === 'disabled' ? 'disabled' : 'active', permissions: normalizePermissions(Array.isArray(input.permissions) && input.permissions.length ? input.permissions : ['content.member.read']), initialPoints: normalizePoints(input.initialPoints ?? input.giftPoints), createdAt: nowIso() }
        memberGroups.push(group); appendAudit(req, 'create', 'member_group', group.id, { code, name }); await persistStore(); return json(res, 201, group)
      }
      if (adminGroupMatch && adminGroupMatch[1] && (req.method === 'PATCH' || req.method === 'DELETE')) {
        const group = memberGroups.find(item => item.id === adminGroupMatch[1]); if (!group) return json(res, 404, { message: 'Member group not found' })
        if (req.method === 'DELETE') group.status = 'archived'
        else {
          const input = await readBody(req)
          if (input.code !== undefined) { const code = String(input.code).trim(); if (!code || (memberGroups.some(candidate => candidate.id !== group.id && candidate.code === code))) return json(res, 409, { message: '会员分组编码无效或已存在' }); group.code = code }
          if (input.name !== undefined) { const name = String(input.name).trim(); if (!name) return json(res, 422, { message: '会员分组名称不能为空' }); group.name = name }
          if (input.status !== undefined) {
            const status = String(input.status).trim()
            if (!['active', 'disabled', 'archived'].includes(status)) return json(res, 422, { message: '会员分组状态无效' })
            group.status = status
          }
          if (input.description !== undefined) group.description = String(input.description || '').trim().slice(0, 500)
          if (input.rank !== undefined) { const rank = Number(input.rank); if (!Number.isInteger(rank) || rank < 0) return json(res, 422, { message: '会员分组排序值无效' }); group.rank = rank }
          if (input.permissions !== undefined) group.permissions = normalizePermissions(input.permissions)
          if (input.initialPoints !== undefined || input.giftPoints !== undefined) group.initialPoints = normalizePoints(input.initialPoints ?? input.giftPoints)
        }
        appendAudit(req, req.method === 'DELETE' ? 'archive' : 'update', 'member_group', group.id); await persistStore(); return json(res, 200, group)
      }
      const adminPlanMatch = url.pathname.match(/^\/api\/v1\/admin\/(?:plans|membership-plans|member-plans)(?:\/([^/]+))?$/)
      if (adminPlanMatch && req.method === 'GET') return json(res, 200, { items: plans })
      if (adminPlanMatch && req.method === 'POST' && !adminPlanMatch[1]) {
        const input = await readBody(req); const priceCents = Number(input.priceCents)
        if (!input.name || !Number.isInteger(priceCents) || priceCents < 0 || !Number.isInteger(Number(input.durationDays)) || Number(input.durationDays) < 1) return json(res, 422, { message: 'name、priceCents、durationDays 参数无效' })
        if (input.status !== undefined && !['active', 'disabled', 'archived'].includes(String(input.status))) return json(res, 422, { message: '会员套餐状态无效' })
        const groupId = String(input.groupId || 'group_member')
        if (!memberGroups.some(group => group.id === groupId && group.status !== 'archived')) return json(res, 422, { message: '会员分组不存在' })
        const plan = { id: id('plan'), groupId, name: String(input.name).trim(), description: String(input.description || ''), priceCents, redeemPoints: normalizePoints(input.redeemPoints ?? input.pricePoints), durationDays: Number(input.durationDays), benefits: Array.isArray(input.benefits) ? input.benefits.map(String).slice(0, 20) : [], initialPoints: normalizePoints(input.initialPoints ?? input.giftPoints), status: input.status === 'disabled' ? 'disabled' : 'active', sort: Number(input.sort) || plans.length + 1, createdAt: nowIso() }
        plans.push(plan); appendAudit(req, 'create', 'plan', plan.id, { name: plan.name }); await persistStore(); return json(res, 201, plan)
      }
      if (adminPlanMatch && adminPlanMatch[1] && (req.method === 'PATCH' || req.method === 'DELETE')) {
        const plan = plans.find(item => item.id === adminPlanMatch[1]); if (!plan) return json(res, 404, { message: 'Plan not found' })
        if (req.method === 'DELETE') plan.status = 'archived'
        else {
          const input = await readBody(req)
          if (input.name !== undefined) { const name = String(input.name || '').trim(); if (!name) return json(res, 422, { message: '会员套餐名称不能为空' }); plan.name = name.slice(0, 120) }
          if (input.description !== undefined) plan.description = String(input.description || '').trim().slice(0, 500)
          if (input.status !== undefined) { const status = String(input.status).trim(); if (!['active', 'disabled', 'archived'].includes(status)) return json(res, 422, { message: '会员套餐状态无效' }); plan.status = status }
          if (input.groupId !== undefined) { if (!memberGroups.some(group => group.id === String(input.groupId) && group.status !== 'archived')) return json(res, 422, { message: '会员分组不存在或已归档' }); plan.groupId = String(input.groupId) }
          if (input.priceCents !== undefined) { const priceCents = Number(input.priceCents); if (!Number.isInteger(priceCents) || priceCents < 0) return json(res, 422, { message: '会员套餐价格无效' }); plan.priceCents = priceCents }
          if (input.redeemPoints !== undefined || input.pricePoints !== undefined) plan.redeemPoints = normalizePoints(input.redeemPoints ?? input.pricePoints)
          if (input.durationDays !== undefined) { const durationDays = Number(input.durationDays); if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 3650) return json(res, 422, { message: '会员套餐有效期无效' }); plan.durationDays = durationDays }
          if (input.benefits !== undefined && Array.isArray(input.benefits)) plan.benefits = input.benefits.map(value => String(value).trim()).filter(Boolean).slice(0, 20)
          if (input.initialPoints !== undefined || input.giftPoints !== undefined) plan.initialPoints = normalizePoints(input.initialPoints ?? input.giftPoints)
          if (input.sort !== undefined) { const sort = Number(input.sort); if (!Number.isInteger(sort) || sort < 0) return json(res, 422, { message: '会员套餐排序值无效' }); plan.sort = sort }
        }
        appendAudit(req, req.method === 'DELETE' ? 'archive' : 'update', 'plan', plan.id); await persistStore(); return json(res, 200, plan)
      }
      const adminOrderMatch = url.pathname.match(/^\/api\/v1\/admin\/orders(?:\/([^/]+))?$/)
      if (adminOrderMatch && req.method === 'GET') {
        const status = url.searchParams.get('status'); const kind = url.searchParams.get('kind'); const items = orders.filter(order => (!status || order.status === status) && (!kind || order.kind === kind)); return json(res, 200, paginate(items, Object.fromEntries(url.searchParams)))
      }
      if (adminOrderMatch && adminOrderMatch[1] && req.method === 'PATCH') {
        const order = findOrder(adminOrderMatch[1]); if (!order) return json(res, 404, { message: 'Order not found' }); const input = await readBody(req)
        if (input.status === 'paid') await markOrderPaid(order, { provider: input.provider || 'admin', transactionId: input.transactionId || `admin_tx_${Date.now()}` })
        else if (['cancelled', 'refunded'].includes(input.status)) {
          const nextStatus = String(input.status)
          if (nextStatus === 'cancelled' && order.status === 'paid' && order.paymentProvider === 'points') return json(res, 409, { message: '积分订单已支付，请使用退款操作以恢复积分' })
          if (nextStatus === 'refunded' && order.status === 'paid' && order.paymentProvider === 'points') {
            try { refundPointsOrder(order, admin.id) } catch (error) { return json(res, 409, { message: error instanceof Error ? error.message : '积分退款失败' }) }
          }
          order.status = nextStatus; order.updatedAt = nowIso(); if (order.kind === 'post') entitlements.filter(item => item.orderId === order.id).forEach(item => { item.status = 'revoked' }); if (order.kind === 'membership') (memberships.get(order.userId) || []).filter(item => item.orderId === order.id).forEach(item => { item.status = 'revoked' }); if (order.kind === 'tip' && order.status === 'refunded') { const tip = tips.find(item => item.orderId === order.id); if (tip && tip.status !== 'refunded') { tip.status = 'refunded'; const post = posts.find(item => item.id === tip.postId); if (post) post.counts.tips = Math.max(0, (post.counts.tips || 0) - Number(tip.amountCents || 0)) } } await persistStore()
        }
        appendAudit(req, 'update', 'order', order.id, { status: order.status }); await persistStore(); return json(res, 200, order)
      }
      const adminRefundMatch = url.pathname.match(/^\/api\/v1\/admin\/orders\/([^/]+)\/refund$/)
      if (adminRefundMatch && req.method === 'POST') {
        const order = findOrder(adminRefundMatch[1]); if (!order) return json(res, 404, { message: 'Order not found' });
        if (order.status === 'paid' && order.paymentProvider === 'points') {
          try { refundPointsOrder(order, admin.id) } catch (error) { return json(res, 409, { message: error instanceof Error ? error.message : '积分退款失败' }) }
        }
        order.status = 'refunded'; order.refundedAt = nowIso(); entitlements.filter(item => item.orderId === order.id).forEach(item => { item.status = 'revoked' }); (memberships.get(order.userId) || []).filter(item => item.orderId === order.id).forEach(item => { item.status = 'revoked' }); const tip = tips.find(item => item.orderId === order.id); if (tip) { tip.status = 'refunded'; const post = posts.find(item => item.id === tip.postId); if (post) post.counts.tips = Math.max(0, (post.counts.tips || 0) - Number(tip.amountCents || 0)) } appendAudit(req, 'refund', 'order', order.id); await persistStore(); return json(res, 200, order)
      }
      const adminTipsMatch = url.pathname.match(/^\/api\/v1\/admin\/tips(?:\/([^/]+))?$/)
      if (adminTipsMatch && !adminTipsMatch[1] && req.method === 'GET') {
        const status = url.searchParams.get('status'); const postId = url.searchParams.get('postId'); const recipientUserId = url.searchParams.get('recipientUserId')
        const items = tips.filter(tip => (!status || tip.status === status) && (!postId || tip.postId === postId) && (!recipientUserId || tip.authorId === recipientUserId))
        return json(res, 200, paginate(items, Object.fromEntries(url.searchParams)))
      }
      if (adminTipsMatch && adminTipsMatch[1] && req.method === 'PATCH') {
        const tip = tips.find(item => item.id === adminTipsMatch[1]); if (!tip) return json(res, 404, { message: 'Tip not found' }); const input = await readBody(req); const nextStatus = input.status ? String(input.status) : ''
        if (nextStatus && !['pending', 'paid', 'refunded', 'rejected'].includes(nextStatus)) return json(res, 422, { message: '打赏状态无效' })
        if (nextStatus === 'rejected' && tip.status === 'paid' && normalizePoints(tip.points) > 0) return json(res, 409, { message: '已支付的积分打赏请使用退款操作' })
        if (nextStatus === 'paid' && tip.status === 'refunded') return json(res, 409, { message: '已退款的打赏不能重新标记为已支付' })
        if (nextStatus === 'refunded' && tip.status === 'paid' && normalizePoints(tip.points) > 0) {
          try { refundPointsTip(tip, admin.id) } catch (error) { return json(res, 409, { message: error instanceof Error ? error.message : '积分退款失败' }) }
        }
        if (nextStatus === 'refunded' && tip.status === 'paid') {
          const post = posts.find(item => item.id === tip.postId)
          if (post) post.counts.tips = Math.max(0, (post.counts.tips || 0) - (normalizePoints(tip.points) > 0 ? 1 : Number(tip.amountCents || 0)))
        }
        if (nextStatus) tip.status = nextStatus; appendAudit(req, 'update', 'tip', tip.id, { status: tip.status }); await persistStore(); return json(res, 200, tip)
      }
      if (req.method === 'GET' && (url.pathname === '/api/v1/admin/withdrawal-config' || url.pathname === '/api/v1/admin/withdrawals/config')) return json(res, 200, { unitName: pointsUnitName(), ...withdrawalConfig() })
      if (req.method === 'PATCH' && (url.pathname === '/api/v1/admin/withdrawal-config' || url.pathname === '/api/v1/admin/withdrawals/config')) {
        const input = await readBody(req)
        const source = input.withdrawal && typeof input.withdrawal === 'object' ? input.withdrawal : input
        const next = normalizeWithdrawalConfig({ ...withdrawalConfig(), ...source })
        pointsConfig = { ...pointsConfig, withdrawal: next }
        appendAudit(req, 'update', 'withdrawal_config', 'default', next)
        await persistStore()
        return json(res, 200, { unitName: pointsUnitName(), ...withdrawalConfig() })
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/admin/withdrawals') {
        const status = String(url.searchParams.get('status') || '').trim()
        const userId = String(url.searchParams.get('userId') || '').trim()
        const items = withdrawals.filter(item => (!status || item.status === status) && (!userId || item.userId === userId)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(item => withdrawalPublic(item, true))
        return json(res, 200, { ...paginate(items, Object.fromEntries(url.searchParams)), config: withdrawalConfig(), unitName: pointsUnitName() })
      }
      const adminWithdrawalMatch = url.pathname.match(/^\/api\/v1\/admin\/withdrawals\/([^/]+)$/)
      if (adminWithdrawalMatch && req.method === 'PATCH') {
        const item = withdrawals.find(candidate => candidate.id === decodeURIComponent(adminWithdrawalMatch[1]))
        if (!item) return json(res, 404, { message: '提现记录不存在' })
        const input = await readBody(req)
        const requestedStatus = String(input.status || '').trim().toLowerCase()
        const nextStatus = requestedStatus === 'completed' || requestedStatus === 'success' || requestedStatus === 'paid' ? 'paid' : requestedStatus === 'cancelled' || requestedStatus === 'failed' || requestedStatus === 'rejected' ? 'rejected' : requestedStatus
        if (!['paid', 'rejected'].includes(nextStatus)) return json(res, 422, { message: '提现状态只能改为 paid 或 rejected' })
        if (item.status !== 'pending') return json(res, 409, { message: '只有待处理的提现申请可以操作' })
        if (nextStatus === 'paid') {
          item.status = 'paid'; item.paidAt = nowIso(); item.paidBy = admin.id; item.adminNote = String(input.note || input.adminNote || '').trim().slice(0, 500) || null
          notifyUser(item.userId, { type: 'withdrawal_paid', title: '提现已打款', body: `你的提现申请已完成打款 ¥${Number(item.netAmountRmb || 0).toFixed(2)}`, targetType: 'withdrawal', targetId: item.id })
        } else {
          const rejectNote = String(input.reason || input.rejectReason || input.note || input.adminNote || '提现申请未通过').trim().slice(0, 500)
          const refund = appendPointsLedger({ userId: item.userId, delta: item.points, type: 'withdrawal_refund', reason: '提现申请驳回，积分退回', actorId: admin.id, sourceId: item.id, note: rejectNote, metadata: { withdrawalId: item.id } })
          item.status = 'rejected'; item.rejectedAt = nowIso(); item.rejectedBy = admin.id; item.rejectReason = rejectNote; item.adminNote = rejectNote; item.refundLedgerId = refund.id
          notifyUser(item.userId, { type: 'withdrawal_rejected', title: '提现申请未通过', body: `${item.rejectReason}，${item.points} ${pointsUnitName()} 已退回账户`, targetType: 'withdrawal', targetId: item.id })
        }
        appendAudit(req, 'update', 'withdrawal', item.id, { userId: item.userId, status: item.status, points: item.points, paidBy: item.paidBy || null, refundLedgerId: item.refundLedgerId || null })
        await persistStore()
        return json(res, 200, withdrawalPublic(item, true))
      }
      if (req.method === 'GET' && (url.pathname === '/api/v1/admin/points/accounts' || url.pathname === '/api/v1/admin/points')) {
        const userId = url.searchParams.get('userId')
        const items = [...pointsAccounts.entries()].filter(([candidate]) => !userId || candidate === userId).map(([candidate, balance]) => ({ userId: candidate, balance }))
        return json(res, 200, { items, total: items.length })
      }
      if (req.method === 'GET' && (url.pathname === '/api/v1/admin/points/config' || url.pathname === '/api/v1/admin/point-config' || url.pathname === '/api/v1/admin/points/purchase-config')) return json(res, 200, { unitName: pointsUnitName(), unit: pointsUnitName(), purchaseContact: purchaseContact() })
      if (req.method === 'GET' && url.pathname === '/api/v1/admin/commerce/contact') return json(res, 200, { ...purchaseContact(), unitName: pointsUnitName(), unit: pointsUnitName(), purchaseContact: purchaseContact() })
      if (req.method === 'PATCH' && (url.pathname === '/api/v1/admin/points/config' || url.pathname === '/api/v1/admin/point-config' || url.pathname === '/api/v1/admin/points/purchase-config' || url.pathname === '/api/v1/admin/commerce/contact')) {
        const input = await readBody(req)
        const nextUnitName = input.unitName === undefined && input.unit === undefined ? pointsUnitName() : String(input.unitName ?? input.unit ?? '').trim().slice(0, 20)
        if (!nextUnitName) return json(res, 422, { message: '积分名称不能为空' })
        const contactInput = input.purchaseContact || input.contact || {}
        const nextContact = { wechatId: String(contactInput.wechatId ?? input.wechatId ?? pointsConfig.purchaseContact?.wechatId ?? '').trim().slice(0, 80), qrCodeUrl: String(contactInput.qrCodeUrl ?? contactInput.wechatQrUrl ?? input.qrCodeUrl ?? input.wechatQrUrl ?? pointsConfig.purchaseContact?.qrCodeUrl ?? '').trim().slice(0, 500), note: String(contactInput.note ?? contactInput.instructions ?? input.contactNote ?? input.instructions ?? pointsConfig.purchaseContact?.note ?? '请添加客服微信，线下购买兑换码。').trim().slice(0, 300), offlineTitle: String(contactInput.offlineTitle ?? contactInput.offlineHeading ?? input.offlineTitle ?? input.offlineHeading ?? pointsConfig.purchaseContact?.offlineTitle ?? '线下开通').trim().slice(0, 50) || '线下开通', offlineNote: String(contactInput.offlineNote ?? contactInput.offlineInstructions ?? input.offlineNote ?? input.offlineInstructions ?? pointsConfig.purchaseContact?.offlineNote ?? '联系管理员完成收款，确认后立即生效。').trim().slice(0, 500) || '联系管理员完成收款，确认后立即生效。' }
        pointsConfig = { unitName: nextUnitName, purchaseContact: nextContact, withdrawal: withdrawalConfig() }
        appendAudit(req, 'update', 'points_config', 'default', { unitName: nextUnitName, purchaseContact: nextContact })
        await persistStore()
        return json(res, 200, { unitName: pointsUnitName(), unit: pointsUnitName(), purchaseContact: purchaseContact() })
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/admin/cdkeys') {
        const kind = url.searchParams.get('kind'); const status = url.searchParams.get('status'); const code = normalizeCdkey(url.searchParams.get('code')); const codeDigest = code ? cdkeyHash(code) : ''
        const items = cdkeys.filter(item => (!kind || item.kind === kind) && (!status || cdkeyStatus(item) === status) && (!code || item.codeHash === codeDigest || item.codePrefix?.includes(code) || item.codeSuffix?.includes(code))).map(item => cdkeyForPublic(item, { includeCode: false }))
        const page = paginate(items, Object.fromEntries(url.searchParams)); return json(res, 200, page)
      }
      if (req.method === 'POST' && url.pathname === '/api/v1/admin/cdkeys') {
        try {
          const input = await readBody(req); const kind = String(input.kind || 'points') === 'membership' ? 'membership' : 'points'; const quantity = Math.min(500, Math.max(1, Math.floor(Number(input.quantity || 1))))
          const points = normalizePoints(input.points ?? input.amountPoints)
          const planId = String(input.planId || '').trim() || null
          if (kind === 'points' && points < 1) return json(res, 422, { message: '积分兑换码的 points 必须为正整数' })
          if (kind === 'membership' && (!planId || !activePlans().some(plan => plan.id === planId))) return json(res, 422, { message: '会员兑换码必须选择有效会员等级' })
          const expiresAt = input.expiresAt && !Number.isNaN(new Date(input.expiresAt).getTime()) ? new Date(input.expiresAt).toISOString() : null
          const batchId = id('cdkey_batch'); const created = []
          for (let index = 0; index < quantity; index += 1) { const code = generateCdkey(); const item = { id: id('cdkey'), code, codeHash: cdkeyHash(code), codePrefix: code.slice(0, 7), codeSuffix: code.slice(-4), kind, points: kind === 'points' ? points : 0, planId, batchId, status: 'unused', expiresAt, note: String(input.note || '').trim().slice(0, 300) || null, createdAt: nowIso(), createdBy: admin.id }; cdkeys.unshift(item); created.push(cdkeyForPublic(item)) }
          appendAudit(req, 'create', 'cdkey_batch', batchId, { kind, quantity, points, planId, expiresAt })
          await persistStore(); return json(res, 201, { batchId, items: created, total: created.length })
        } catch (error) { return json(res, 422, { message: error instanceof Error ? error.message : '兑换码生成失败' }) }
      }
      const adminCdkeyMatch = url.pathname.match(/^\/api\/v1\/admin\/cdkeys\/([^/]+)(?:\/revoke)?$/)
      if (adminCdkeyMatch && (req.method === 'PATCH' || (req.method === 'POST' && url.pathname.endsWith('/revoke')))) {
        const item = cdkeys.find(candidate => candidate.id === adminCdkeyMatch[1]); if (!item) return json(res, 404, { message: '兑换码不存在' })
        const input = await readBody(req); const status = String(input.status || (url.pathname.endsWith('/revoke') ? 'disabled' : ''))
        if (status !== 'disabled' || item.status !== 'unused') return json(res, 422, { message: '只能停用未使用的兑换码' })
        item.status = 'disabled'; item.disabledAt = nowIso(); item.disabledReason = String(input.reason || '管理员停用').trim().slice(0, 200); appendAudit(req, 'disable', 'cdkey', item.id, { reason: item.disabledReason }); await persistStore(); return json(res, 200, cdkeyForPublic(item, { includeCode: false }))
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/admin/cdkey-redemptions') {
        const userId = url.searchParams.get('userId'); const items = cdkeyRedemptions.filter(item => !userId || item.userId === userId); return json(res, 200, paginate(items, Object.fromEntries(url.searchParams)))
      }
      if (req.method === 'GET' && (url.pathname === '/api/v1/admin/points/ledger' || url.pathname === '/api/v1/admin/points/transactions')) {
        const userId = url.searchParams.get('userId'); const type = url.searchParams.get('type')
        const items = pointsLedger.filter(item => (!userId || item.userId === userId) && (!type || item.type === type))
        const paging = Object.fromEntries(url.searchParams); if (!paging.pageSize) paging.pageSize = paging.limit || 100
        const page = paginate(items, paging); return json(res, 200, page)
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/admin/point-recharges') {
        const userId = url.searchParams.get('userId')
        const items = pointsLedger.filter(item => item.type === 'admin_recharge' && (!userId || item.userId === userId))
        const paging = Object.fromEntries(url.searchParams); if (!paging.pageSize) paging.pageSize = paging.limit || 100
        const page = paginate(items, paging); return json(res, 200, { ...page, items: page.items.map(item => ({ ...item, user: referralUserPublic(item.userId) })) })
      }
      if (req.method === 'DELETE' && (url.pathname === '/api/v1/admin/point-recharges' || url.pathname === '/api/v1/admin/points/ledger' || url.pathname === '/api/v1/admin/audit-logs')) return json(res, 405, { message: '积分流水和系统日志只允许追加与查询，不允许删除' })
      const adminPointsRechargeMatch = url.pathname.match(/^\/api\/v1\/admin\/(?:points\/recharge|users\/([^/]+)\/points)$/)
      if (adminPointsRechargeMatch && req.method === 'POST') {
        const input = await readBody(req); const userId = String(adminPointsRechargeMatch[1] || input.userId || '').trim(); const points = Math.trunc(Number(input.points ?? input.amount))
        if (!userId || !Number.isInteger(points) || points <= 0 || points > 1000000000) return json(res, 422, { message: 'userId 和 points 参数无效，充值积分必须为正整数' })
        if (!knownUserId(userId)) return json(res, 404, { message: '用户不存在或已无法识别' })
        const entry = appendPointsLedger({ userId, delta: points, type: 'admin_recharge', reason: '管理员线下积分充值', actorId: admin.id, note: input.note || input.reason, metadata: { reference: String(input.reference || '').trim().slice(0, 120) || null } })
        const commissions = input.commissionEligible === false ? [] : referralCommissionFor({ sourceUserId: userId, sourceType: 'points_recharge', sourceId: entry.id, basePoints: points, note: entry.note, metadata: { reference: String(input.reference || '').trim().slice(0, 120) || null, rechargeLedgerId: entry.id } })
        appendAudit(req, 'recharge', 'points_account', userId, { ledgerId: entry.id, points, note: entry.note, commissionEligible: input.commissionEligible !== false, referralCommissionIds: commissions.map(item => item.id) })
        await persistStore()
        return json(res, 201, { entry, balance: entry.balanceAfter, referralCommissions: commissions.map(referralCommissionPublic) })
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/admin/audit-logs') {
        const actorId = url.searchParams.get('actorId'); const targetType = url.searchParams.get('targetType') || url.searchParams.get('resourceType'); const action = url.searchParams.get('action')
        const filtered = auditLogs.filter(item => (!actorId || item.actorId === actorId) && (!targetType || item.targetType === targetType) && (!action || item.action === action))
        const paging = Object.fromEntries(url.searchParams); if (!paging.pageSize) paging.pageSize = paging.limit || 100
        const page = paginate(filtered, paging); return json(res, 200, page)
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/admin/memberships') {
        const userId = url.searchParams.get('userId'); const status = url.searchParams.get('status')
        const items = [...memberships.entries()].flatMap(([candidateUserId, values]) => values.filter(item => (!userId || candidateUserId === userId) && (!status || item.status === status)).map(item => ({ ...item, userId: candidateUserId, user: referralUserPublic(candidateUserId), groupName: membershipGroup(item)?.name || '会员', planName: plans.find(plan => plan.id === item.planId)?.name || null }))).sort((a, b) => new Date(b.createdAt || b.startsAt || 0) - new Date(a.createdAt || a.startsAt || 0))
        const paging = Object.fromEntries(url.searchParams); if (!paging.pageSize) paging.pageSize = paging.limit || 100
        const page = paginate(items, paging); return json(res, 200, page)
      }
      const adminMembershipGrantMatch = url.pathname.match(/^\/api\/v1\/admin\/(?:memberships\/grant|users\/([^/]+)\/memberships)$/)
      if (adminMembershipGrantMatch && req.method === 'POST') {
        try {
          const input = await readBody(req); const userId = String(adminMembershipGrantMatch[1] || input.userId || '').trim()
          if (!knownUserId(userId)) return json(res, 404, { message: '用户不存在或已无法识别' })
          const result = activateMembership({ userId, groupId: input.groupId, planId: input.planId, days: input.days ?? input.durationDays, note: input.note || input.reason, actorId: admin.id, paymentReference: input.paymentReference || input.reference, amountCents: input.amountCents })
          appendAudit(req, 'grant', 'membership', result.membership.id, { userId, groupId: result.membership.groupId, planId: result.membership.planId, days: result.membership.durationDays, giftPoints: result.giftPoints, note: result.membership.note })
          notifyUser(userId, { type: 'membership_granted', title: '会员已开通', body: `管理员已为你开通${membershipGroup(result.membership)?.name || '会员'}，有效期至 ${result.membership.endsAt.slice(0, 10)}`, targetType: 'membership', targetId: result.membership.id })
          await persistStore()
          return json(res, 201, { ...result.membership, groupName: membershipGroup(result.membership)?.name || '会员', giftPoints: result.giftPoints })
        } catch (error) { return json(res, 422, { message: error instanceof Error ? error.message : '会员开通失败' }) }
      }
      const adminMembershipRevokeMatch = url.pathname.match(/^\/api\/v1\/admin\/memberships\/([^/]+)\/revoke$/)
      if (adminMembershipRevokeMatch && req.method === 'POST') {
        const record = [...memberships.values()].flat().find(item => item.id === adminMembershipRevokeMatch[1])
        if (!record) return json(res, 404, { message: '会员记录不存在' })
        if (record.status !== 'active') return json(res, 409, { message: '会员记录当前不可撤销' })
        const input = await readBody(req); record.status = 'revoked'; record.revokedAt = nowIso(); record.revokedReason = String(input.reason || '管理员撤销').trim().slice(0, 500); appendAudit(req, 'revoke', 'membership', record.id, { userId: record.userId, reason: record.revokedReason }); await persistStore(); return json(res, 200, record)
      }
      const adminMembershipPatchMatch = url.pathname.match(/^\/api\/v1\/admin\/memberships\/([^/]+)$/)
      if (adminMembershipPatchMatch && req.method === 'PATCH') {
        const record = [...memberships.values()].flat().find(item => item.id === adminMembershipPatchMatch[1])
        if (!record) return json(res, 404, { message: '会员记录不存在' })
        const input = await readBody(req)
        if (input.status !== undefined && String(input.status) !== 'revoked') return json(res, 422, { message: '会员记录只支持撤销状态' })
        if (String(input.status || '') === 'revoked') {
          if (record.status !== 'active') return json(res, 409, { message: '会员记录当前不可撤销' })
          record.status = 'revoked'
          record.revokedAt = nowIso()
          record.revokedReason = String(input.reason || input.note || '管理员撤销').trim().slice(0, 500)
          appendAudit(req, 'revoke', 'membership', record.id, { userId: record.userId, reason: record.revokedReason })
          await persistStore()
        }
        return json(res, 200, record)
      }
      const adminPostMatch = url.pathname.match(/^\/api\/v1\/admin\/posts(?:\/([^/]+))?$/)
      if (adminPostMatch && req.method === 'GET' && adminPostMatch[1]) {
        const post = posts.find(item => item.id === adminPostMatch[1])
        if (!post) return json(res, 404, { message: '内容不存在' })
        return json(res, 200, { ...post, contentHtml: contentHtml(post), reports: reports.filter(report => report.postId === post.id).length })
      }
      if (adminPostMatch && req.method === 'GET') {
        const status = String(url.searchParams.get('status') || '').trim()
        const query = String(url.searchParams.get('q') || '').trim().toLowerCase()
        const time = post => new Date(post.submittedAt || post.publishedAt || post.updatedAt || 0).getTime() || 0
        const statusCounts = posts.reduce((counts, post) => { const key = post.status || 'published'; counts[key] = (counts[key] || 0) + 1; return counts }, {})
        const items = posts
          .filter(post => (!status || (post.status || 'published') === status) && (!query || [post.id, post.title, post.excerpt, post.author?.name, post.author?.id, post.project, post.skill].some(value => String(value || '').toLowerCase().includes(query))))
          .sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || time(b) - time(a))
          .map(post => ({ ...post, content: undefined, contentLength: plainTextFromContent(post.content).length, imageCount: new Set([...normalizeUploadedImages(post.images), ...inlineImageUrls(post.content)]).size, pendingReports: reports.filter(report => report.postId === post.id && report.status === 'pending').length }))
        const page = paginate(items, { pageSize: 100, ...Object.fromEntries(url.searchParams) })
        return json(res, 200, { ...page, statusCounts, total: items.length })
      }
      if (adminPostMatch && req.method === 'POST' && !adminPostMatch[1]) {
        const input = await readBody(req)
        // Project and skill are legacy metadata. The current publishing flow only
        // requires a title and platform, so the admin editor must follow the same
        // contract instead of rejecting otherwise valid posts.
        if (!input.title || !input.platform) return json(res, 422, { message: 'title 和 platform 均为必填项' })
        const accessType = ['free', 'member', 'paid'].includes(String(input.accessType || 'free')) ? String(input.accessType || 'free') : 'free'
        const memberPlanIds = validateMemberPlanIds(Array.isArray(input.memberPlanIds) ? input.memberPlanIds : (input.requiredPlanId ? [String(input.requiredPlanId)] : []))
        if (memberPlanIds.invalid.length) return json(res, 422, { message: '会员套餐不存在或已停用', invalidPlanIds: memberPlanIds.invalid })
        const post = { id: id('post'), title: String(input.title), excerpt: String(input.excerpt || ''), content: String(input.content || ''), coverImage: normalizeUploadedUrl(input.coverImage), images: normalizeUploadedImages(input.images), platform: String(input.platform), project: String(input.project || '未分类'), skill: String(input.skill || '未分类'), author: { id: 'admin', name: String(input.authorName || '管理员'), avatarUrl: null }, publishedAt: new Date().toISOString(), digest: Boolean(input.digest), status: 'published', accessType, pricePoints: accessType === 'paid' ? normalizePoints(input.pricePoints ?? input.priceCents) : 0, priceCents: 0, memberPlanIds: memberPlanIds.ids, counts: { anchors: 0, likes: 0, comments: 0, favorites: 0, tips: 0 } }
        posts.unshift(post); appendAudit(req, 'create', 'post', post.id, { status: post.status, accessType: post.accessType }); await persistStore(); return json(res, 201, post)
      }
      if (adminPostMatch && adminPostMatch[1] && (req.method === 'PATCH' || req.method === 'DELETE')) {
        const post = posts.find(item => item.id === adminPostMatch[1])
        if (!post) return json(res, 404, { message: 'Post not found' })
        if (req.method === 'DELETE') { post.status = 'archived'; appendAudit(req, 'archive', 'post', post.id, { admin: true }); await persistStore(); return json(res, 200, { archived: true }) }
        const input = await readBody(req)
        for (const field of ['title', 'excerpt', 'content', 'platform', 'project', 'skill']) if (input[field] !== undefined) post[field] = String(input[field])
        if (input.coverImage !== undefined) post.coverImage = normalizeUploadedUrl(input.coverImage)
        if (input.images !== undefined) post.images = normalizeUploadedImages(input.images)
        if (input.digest !== undefined) post.digest = Boolean(input.digest)
        const previousStatus = post.status
        if (input.status !== undefined && ['pending', 'published', 'rejected', 'archived'].includes(String(input.status))) post.status = String(input.status)
        if (previousStatus !== 'published' && post.status === 'published') { post.publishedAt = post.publishedAt || nowIso(); if (post.author?.id) notifyUser(post.author.id, { type: 'post_published', title: '你的内容已发布', body: `《${post.title}》已通过审核并公开`, targetType: 'post', targetId: post.id }) }
        if (post.status === 'rejected') { post.rejectedAt = nowIso(); post.rejectionReason = String(input.rejectionReason || input.reason || '内容未通过审核').trim().slice(0, 500); if (post.author?.id) notifyUser(post.author.id, { type: 'post_rejected', title: '你的内容未通过审核', body: `《${post.title}》未通过审核：${post.rejectionReason}`, targetType: 'post', targetId: post.id }) }
        if (post.status !== 'rejected') { post.rejectedAt = null; if (post.status === 'published') post.rejectionReason = null }
        if (input.accessType !== undefined && ['free', 'member', 'paid'].includes(String(input.accessType))) post.accessType = String(input.accessType)
        if (input.pricePoints !== undefined || input.priceCents !== undefined) post.pricePoints = post.accessType === 'paid' ? normalizePoints(input.pricePoints ?? input.priceCents) : 0
        if (post.accessType !== 'paid') post.pricePoints = 0
        post.priceCents = 0
        if (input.memberPlanIds !== undefined && Array.isArray(input.memberPlanIds)) {
          const memberPlanIds = validateMemberPlanIds(input.memberPlanIds)
          if (memberPlanIds.invalid.length) return json(res, 422, { message: '会员套餐不存在或已停用', invalidPlanIds: memberPlanIds.invalid })
          post.memberPlanIds = memberPlanIds.ids
        }
        if (input.requiredPlanId !== undefined) {
          const memberPlanIds = validateMemberPlanIds(input.requiredPlanId ? [String(input.requiredPlanId)] : [])
          if (memberPlanIds.invalid.length) return json(res, 422, { message: '会员套餐不存在或已停用', invalidPlanIds: memberPlanIds.invalid })
          post.memberPlanIds = memberPlanIds.ids
        }
        appendAudit(req, 'update', 'post', post.id, { accessType: post.accessType, priceCents: post.priceCents })
        await persistStore(); return json(res, 200, post)
      }
      const adminMonetizationMatch = url.pathname.match(/^\/api\/v1\/admin\/posts\/([^/]+)\/(?:monetization|access)$/)
      if (adminMonetizationMatch && (req.method === 'PATCH' || req.method === 'POST')) {
        const post = posts.find(item => item.id === adminMonetizationMatch[1]); if (!post) return json(res, 404, { message: 'Post not found' }); const input = await readBody(req)
        if (input.accessType !== undefined && !['free', 'member', 'paid'].includes(String(input.accessType))) return json(res, 422, { message: 'accessType 无效' })
        if (input.accessType !== undefined) post.accessType = String(input.accessType)
        if (input.pricePoints !== undefined || input.priceCents !== undefined) post.pricePoints = post.accessType === 'paid' ? normalizePoints(input.pricePoints ?? input.priceCents) : 0
        if (post.accessType !== 'paid') post.pricePoints = 0
        post.priceCents = 0
        if (input.memberPlanIds !== undefined && Array.isArray(input.memberPlanIds)) {
          const memberPlanIds = validateMemberPlanIds(input.memberPlanIds)
          if (memberPlanIds.invalid.length) return json(res, 422, { message: '会员套餐不存在或已停用', invalidPlanIds: memberPlanIds.invalid })
          post.memberPlanIds = memberPlanIds.ids
        }
        if (input.requiredPlanId !== undefined) {
          const memberPlanIds = validateMemberPlanIds(input.requiredPlanId ? [String(input.requiredPlanId)] : [])
          if (memberPlanIds.invalid.length) return json(res, 422, { message: '会员套餐不存在或已停用', invalidPlanIds: memberPlanIds.invalid })
          post.memberPlanIds = memberPlanIds.ids
        }
        appendAudit(req, 'update', 'post_monetization', post.id, { accessType: post.accessType, pricePoints: post.pricePoints, memberPlanIds: post.memberPlanIds }); await persistStore(); return json(res, 200, { ...post, ...accessFor(post, null) })
      }
      const adminTagItemMatch = url.pathname.match(/^\/api\/v1\/admin\/tags\/([^/]+)\/([^/]+)$/)
      if (adminTagItemMatch && (req.method === 'PATCH' || req.method === 'DELETE')) {
        const dimension = decodeURIComponent(adminTagItemMatch[1]); let name
        try { name = decodeURIComponent(adminTagItemMatch[2]) } catch { return json(res, 400, { message: '标签名称无效' }) }
        if (!tags[dimension]) return json(res, 422, { message: '标签维度无效' })
        const index = tags[dimension].indexOf(name)
        if (index < 0) return json(res, 404, { message: '标签不存在' })
        if (req.method === 'DELETE') {
          tags[dimension].splice(index, 1)
          appendAudit(req, 'delete', 'tag', `${dimension}:${name}`, { dimension, name })
          await persistStore(); return json(res, 200, { deleted: true, dimension, name })
        }
        const input = await readBody(req); const nextName = String(input.name || '').trim().slice(0, 40)
        if (!nextName) return json(res, 422, { message: '标签名称不能为空' })
        if (nextName !== name && tags[dimension].includes(nextName)) return json(res, 409, { message: '标签已存在' })
        tags[dimension][index] = nextName
        let updatedPosts = 0
        for (const post of posts) if (post[dimension] === name) { post[dimension] = nextName; updatedPosts += 1 }
        appendAudit(req, 'rename', 'tag', `${dimension}:${nextName}`, { dimension, from: name, to: nextName, updatedPosts })
        await persistStore(); return json(res, 200, { dimension, name: nextName, updatedPosts })
      }
      const adminTagsMatch = url.pathname.match(/^\/api\/v1\/admin\/tags\/([^/]+)$/)
      if (adminTagsMatch && req.method === 'GET') { const dimension = adminTagsMatch[1]; return json(res, 200, { dimension, items: tags[dimension] || [] }) }
      if (adminTagsMatch && req.method === 'POST') {
        const dimension = adminTagsMatch[1]; if (!tags[dimension]) return json(res, 422, { message: '标签维度无效' }); const input = await readBody(req); const name = String(input.name || '').trim(); if (!name) return json(res, 422, { message: '标签名称不能为空' }); if (tags[dimension].includes(name)) return json(res, 409, { message: '标签已存在' }); tags[dimension].push(name); appendAudit(req, 'create', 'tag', `${dimension}:${name}`, { dimension, name }); await persistStore(); return json(res, 201, { dimension, name })
      }
      return json(res, 404, { message: 'Admin route not found' })
    }
    if (req.method === 'GET' && postMatch) {
      const post = posts.find(item => item.id === postMatch[1])
      if (!post || post.status !== 'published') return json(res, 404, { message: 'Post not found' })
      const access = accessFor(post, user?.id || null)
      const viewerId = user?.id || null
      const interacted = type => Boolean(viewerId && interactions.get(`${post.id}:${viewerId}:${type}`))
      const viewer = viewerId ? { liked: interacted('like'), favorited: interacted('favorite'), anchored: interacted('anchor'), purchased: hasContentEntitlement(viewerId, post.id), isAuthor: post.author?.id === viewerId } : { liked: false, favorited: false, anchored: false, purchased: false, isAuthor: false }
      const summary = summaryPost(post, viewerId)
      return json(res, 200, { ...summary, content: access.canRead ? contentHtml(post) : '', viewer, comments: visibleComments(post.id, { pageSize: 20 }).items })
    }
    if (req.method === 'GET' && postShareMatch) {
      const post = posts.find(item => item.id === postShareMatch[1])
      if (!post || post.status !== 'published') return json(res, 404, { message: 'Post not found' })
      if (url.searchParams.get('format') === 'html' || String(req.headers.accept || '').includes('text/html')) return html(res, 200, sharePageHtml(post))
      // This endpoint intentionally returns summary metadata only. In
      // particular, no content, image list, or entitlement data is included.
      return json(res, 200, shareMetadata(post, user?.id || null))
    }
    if (req.method === 'GET' && sharePageMatch) {
      let postId
      try { postId = decodeURIComponent(sharePageMatch[1]) } catch { return html(res, 400, '<!doctype html><title>分享链接无效</title><p>分享链接无效，请返回重试。</p>') }
      const post = posts.find(item => item.id === postId)
      if (!post || post.status !== 'published') return html(res, 404, '<!doctype html><title>内容不存在</title><p>这篇内容不存在或已下线。</p>')
      return html(res, 200, sharePageHtml(post))
    }
    if (req.method === 'GET' && commentMatch) {
      const post = posts.find(item => item.id === commentMatch[1])
      if (!post || post.status !== 'published') return json(res, 404, { message: 'Post not found' })
      return json(res, 200, visibleComments(commentMatch[1], Object.fromEntries(url.searchParams)))
    }
    if (req.method === 'POST' && replyMatch) {
      const input = await readBody(req)
      const content = String(input.content || '').trim()
      if (!content) return json(res, 422, { message: '评论不能为空' })
      let parentPostId = null
      let parent = null
      for (const [postId, list] of comments.entries()) {
        const found = list.find(item => item.id === replyMatch[1])
        if (found && found.status !== 'deleted') { parentPostId = postId; parent = found; break }
      }
      if (!parent) return json(res, 404, { message: 'Parent comment not found' })
      const parentPost = posts.find(candidate => candidate.id === parentPostId)
      if (!parentPost || parentPost.status !== 'published') return json(res, 404, { message: 'Post not found' })
      const commenter = profileFor(user)
      const item = { id: id('comment'), parentId: parent.id, user: { id: user.id, name: commenter.name, avatarUrl: commenter.avatarUrl || null }, content: content.slice(0, 1000), createdAt: new Date().toISOString(), status: 'published' }
      const list = comments.get(parentPostId) || []
      comments.set(parentPostId, [...list, item])
      parentPost.counts.comments = Number(parentPost.counts.comments || 0) + 1
      if (parent.user?.id && parent.user.id !== user.id) notifyUser(parent.user.id, { type: 'comment_reply', title: '有人回复了你的评论', body: `${user.name} 回复了你的评论`, targetType: 'post', targetId: parentPostId })
      await persistStore()
      return json(res, 201, item)
    }
    if (req.method === 'POST' && commentMatch) {
      const post = posts.find(candidate => candidate.id === commentMatch[1])
      if (!post || post.status !== 'published') return json(res, 404, { message: 'Post not found' })
      const input = await readBody(req); const list = comments.get(commentMatch[1]) || []
      const parentId = input.parentId ? String(input.parentId) : null
      if (parentId && !list.some(comment => comment.id === parentId && comment.status !== 'deleted')) return json(res, 422, { message: '回复目标不存在' })
      const commenter = profileFor(user)
      const item = { id: id('comment'), parentId, user: { id: user.id, name: commenter.name, avatarUrl: commenter.avatarUrl || null }, content: String(input.content || '').trim().slice(0, 1000), createdAt: new Date().toISOString(), status: 'published' }
      if (!item.content) return json(res, 422, { message: '评论不能为空' })
      comments.set(commentMatch[1], [...list, item])
      post.counts.comments = Number(post.counts.comments || 0) + 1
      if (post.author?.id && post.author.id !== user.id) notifyUser(post.author.id, { type: 'comment', title: '你的内容有新评论', body: `${user.name} 评论了你的内容`, targetType: 'post', targetId: post.id })
      await persistStore(); return json(res, 201, item)
    }
    if (interactionMatch && (req.method === 'POST' || req.method === 'DELETE')) {
      const [, postId, type] = interactionMatch
      const post = posts.find(item => item.id === postId)
      if (!post || post.status !== 'published') return json(res, 404, { message: 'Post not found' })
      const key = `${postId}:${user.id}:${type}`
      const active = req.method === 'POST'
      const previous = Boolean(interactions.get(key))
      if (active && !previous) { interactions.set(key, nowIso()); post.counts[type === 'like' ? 'likes' : type === 'favorite' ? 'favorites' : 'anchors'] += 1 }
      if (!active && previous) { interactions.delete(key); post.counts[type === 'like' ? 'likes' : type === 'favorite' ? 'favorites' : 'anchors'] = Math.max(0, post.counts[type === 'like' ? 'likes' : type === 'favorite' ? 'favorites' : 'anchors'] - 1) }
      await persistStore(); return json(res, 200, { active, counts: post.counts })
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/tags') {
      const dimension = url.searchParams.get('dimension') || 'platform'
      return json(res, 200, { items: (tags[dimension] || []).map((name, index) => ({ id: `${dimension}_${index + 1}`, name, dimension })) })
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/posts/search') return json(res, 200, search(await readBody(req), user?.id || null))
    if (req.method === 'GET' && url.pathname === '/api/v1/saved-filters') {
      if (!user) return json(res, 401, { message: '需要登录' })
      return json(res, 200, { items: [...(savedFilters.get(user.id) || [])] })
    }
    const savedFilterMatch = url.pathname.match(/^\/api\/v1\/saved-filters\/([^/]+)$/)
    if (savedFilterMatch && (req.method === 'PATCH' || req.method === 'DELETE')) {
      const list = savedFilters.get(user.id) || []
      const index = list.findIndex(item => item.id === savedFilterMatch[1])
      if (index < 0) return json(res, 404, { message: 'Saved filter not found' })
      if (req.method === 'DELETE') { const next = list.filter((_, itemIndex) => itemIndex !== index); savedFilters.set(user.id, next); await persistStore(); return json(res, 200, { deleted: true }) }
      const input = await readBody(req); const updated = { ...list[index], name: input.name || list[index].name, filter: input.filter || list[index].filter, updatedAt: new Date().toISOString() }; const next = [...list]; next[index] = updated; savedFilters.set(user.id, next); await persistStore(); return json(res, 200, updated)
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/saved-filters') {
      const list = savedFilters.get(user.id) || []
      if (list.length >= 7) return json(res, 409, { message: '最多保存 7 组常用筛选' })
      const input = await readBody(req); const item = { id: `filter_${Date.now()}`, name: input.name || '未命名筛选', filter: input.filter || {}, createdAt: new Date().toISOString() }
      savedFilters.set(user.id, [...list, item]); await persistStore(); return json(res, 201, item)
    }
    return json(res, 404, { message: 'Not Found' })
  } catch (error) {
    return json(res, 400, { message: error instanceof Error ? error.message : 'Invalid request' })
  }
})

const port = Number(process.env.PORT || 8787)
const host = String(process.env.HOST || '127.0.0.1')
await loadStore()
await runNotificationCleanup()
startNotificationCleanup()
server.listen(port, host, () => console.log(`content-library-api listening on http://${host}:${port}`))
