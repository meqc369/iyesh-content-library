import { createHash } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const fileIndex = args.indexOf('--file')
const sourceFile = fileIndex >= 0 ? args[fileIndex + 1] : null
const dryRun = args.includes('--dry-run')
if (!sourceFile) { console.error('用法: node import-content.mjs --file content.json [--dry-run]'); process.exit(2) }

const dataFile = join(dirname(fileURLToPath(import.meta.url)), 'data', 'store.json')
const source = JSON.parse(await readFile(sourceFile, 'utf8'))
const incoming = Array.isArray(source) ? source : source.posts
if (!Array.isArray(incoming)) throw new Error('输入必须是帖子数组，或包含 posts 数组的对象')

let store = { posts: [], tags: { platform: [], project: [], skill: [] }, savedFilters: {}, comments: {}, interactions: {} }
try { store = { ...store, ...JSON.parse(await readFile(dataFile, 'utf8')) } } catch {}
const existing = new Map((store.posts || []).map(post => [post.id, post]))
const imported = []
for (const raw of incoming) {
  const title = String(raw.title || '').trim()
  if (!title) throw new Error('每条内容都必须有 title')
  const platform = String(raw.platform || '').trim(); const project = String(raw.project || '').trim(); const skill = String(raw.skill || '').trim()
  if (!platform || !project || !skill) throw new Error(`内容“${title}”缺少 platform/project/skill`)
  const stableKey = `${title}|${raw.authorName || raw.author?.name || ''}|${raw.publishedAt || ''}`
  const id = String(raw.id || `import_${createHash('sha1').update(stableKey).digest('hex').slice(0, 16)}`)
  const accessType = ['free', 'member', 'paid'].includes(String(raw.accessType || 'free')) ? String(raw.accessType || 'free') : 'free'
  const post = { id, title, excerpt: String(raw.excerpt || ''), content: String(raw.content || raw.body || ''), platform, project, skill, author: { id: String(raw.authorId || 'imported'), name: String(raw.authorName || raw.author?.name || '导入内容'), avatarUrl: raw.avatarUrl || null }, publishedAt: raw.publishedAt || new Date().toISOString(), digest: Boolean(raw.digest), status: raw.status === 'archived' ? 'archived' : 'published', accessType, priceCents: Math.max(0, Number(raw.priceCents) || 0), memberPlanIds: Array.isArray(raw.memberPlanIds) ? raw.memberPlanIds.map(String) : (raw.requiredPlanId ? [String(raw.requiredPlanId)] : []), counts: { anchors: Number(raw.counts?.anchors || 0), likes: Number(raw.counts?.likes || 0), comments: Number(raw.counts?.comments || 0), favorites: Number(raw.counts?.favorites || 0), tips: Number(raw.counts?.tips || 0) } }
  existing.set(id, post); imported.push(post)
}
const tags = { platform: [...new Set([...(store.tags?.platform || []), ...imported.map(post => post.platform)])], project: [...new Set([...(store.tags?.project || []), ...imported.map(post => post.project)])], skill: [...new Set([...(store.tags?.skill || []), ...imported.map(post => post.skill)])] }
const result = { ...store, posts: [...existing.values()], tags }
console.log(JSON.stringify({ imported: imported.length, totalPosts: result.posts.length, tags: { platform: tags.platform.length, project: tags.project.length, skill: tags.skill.length }, dryRun }, null, 2))
if (!dryRun) {
  const temporary = `${dataFile}.tmp-${process.pid}`
  await writeFile(temporary, JSON.stringify(result, null, 2))
  await rename(temporary, dataFile)
}
