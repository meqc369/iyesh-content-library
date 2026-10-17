export type Post = {
  id: string
  title: string
  excerpt: string
  contentHtml?: string
  platform: string
  project: string
  skill: string
  author: string
  date: string
  publishedAt?: string
  digest: boolean
  accessType?: 'free' | 'member' | 'paid'
  pricePoints?: number
  priceCents?: number
  priceUnitName?: string
  requiredPlanName?: string
  locked?: boolean
  coverImage?: string
  images?: string[]
  counts: [number, number, number, number]
}

export const posts: Post[] = [
  { id: 'post_1', title: '累计开通 500+ YPP：YouTube 直播玩法开源', excerpt: '把选题、直播和复盘拆成一套可复制的流程，适合刚开始做内容出海的团队。', platform: 'YouTube', project: '出海', skill: 'AI', author: 'Gary', date: '1天前', publishedAt: '2026-10-13T08:00:00Z', digest: true, accessType: 'paid', pricePoints: 990, priceUnitName: '积分', locked: true, counts: [44, 144, 4, 51] },
  { id: 'post_2', title: '从 0 到 1 做一个垂直小号的完整记录', excerpt: '从定位、素材收集到发布节奏，分享一套低成本验证方法。', platform: '小红书', project: '垂直小号', skill: '自媒体', author: '小满', date: '2天前', publishedAt: '2026-10-12T08:00:00Z', digest: true, accessType: 'member', requiredPlanName: '创作者会员', locked: true, counts: [31, 102, 12, 36] },
  { id: 'post_3', title: 'AI 工作流如何接入日常内容生产', excerpt: '把调研、提纲、脚本和复盘串起来，减少重复劳动，把时间留给判断。', platform: '公众号', project: 'AI自媒体', skill: 'AI工作流', author: '林默', date: '3天前', publishedAt: '2026-10-11T08:00:00Z', digest: false, accessType: 'paid', pricePoints: 900, priceUnitName: '积分', locked: true, counts: [18, 88, 7, 24] },
  { id: 'post_4', title: '一套跨境电商素材管理方法', excerpt: '当素材数量变多后，如何按照市场、产品和投放阶段组织素材。', platform: 'TikTok', project: '电商', skill: 'AI视频', author: '周予', date: '5天前', publishedAt: '2026-10-09T08:00:00Z', digest: false, accessType: 'free', counts: [22, 64, 5, 19] },
  { id: 'post_5', title: 'Codex 辅助项目开发的实践清单', excerpt: '从需求拆解到代码审查，记录一个真实项目中的协作方式。', platform: 'X', project: 'AI产品开发', skill: 'Codex', author: '苏然', date: '1周前', publishedAt: '2026-10-07T08:00:00Z', digest: true, accessType: 'member', requiredPlanName: '创作者会员', locked: true, counts: [15, 73, 6, 28] }
]
