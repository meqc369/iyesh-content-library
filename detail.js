const fallback = { post_1: { title: '累计开通 500+ YPP：YouTube 直播玩法开源', platform: 'YouTube', project: '出海', skill: 'AI', author: { name: 'Gary' }, date: '1天前', publishedAt: '1天前', excerpt: '把选题、直播和复盘拆成一套可复制的流程，适合刚开始做内容出海的团队。', accessType: 'paid', priceCents: 990, locked: true, counts: { anchors: 44, likes: 144, comments: 4, favorites: 51 }, content: '<p>这是一份用于演示的内容详情。正式版本会从服务端返回经过白名单过滤的富文本、图片和附件。</p><p>可以在这里继续承载正文、操作步骤和作者补充。</p>' } };
Object.assign(fallback, {
  post_2: { ...fallback.post_1, title: '从 0 到 1 做一个垂直小号的完整记录', platform: '小红书', project: '垂直小号', skill: '自媒体', author: { name: '小满' }, date: '2天前', accessType: 'member', requiredPlanName: '创作者会员', locked: true },
  post_3: { ...fallback.post_1, title: 'AI 工作流如何接入日常内容生产', platform: '公众号', project: 'AI自媒体', skill: 'AI工作流', author: { name: '林默' }, date: '3天前', accessType: 'paid', priceCents: 900, locked: true },
  post_4: { ...fallback.post_1, title: '一套跨境电商素材管理方法', platform: 'TikTok', project: '电商', skill: 'AI视频', author: { name: '周予' }, date: '5天前', accessType: 'free', priceCents: 0, locked: false },
  post_5: { ...fallback.post_1, title: 'Codex 辅助项目开发的实践清单', platform: 'X', project: 'AI产品开发', skill: 'Codex', author: { name: '苏然' }, date: '1周前', accessType: 'member', requiredPlanName: '创作者会员', locked: true },
  post_6: { ...fallback.post_1, title: '做内容之前，先把用户问题说清楚', platform: 'B站', project: '自媒体', skill: '生财认知', author: { name: '闻舟' }, date: '1周前', accessType: 'free', priceCents: 0, locked: false }
});
const id = new URLSearchParams(location.search).get('id') || 'post_1';
const apiBase = window.CONTENT_API_BASE || 'http://127.0.0.1:8787';
const detail = document.querySelector('#detail');
const commentsEl = document.querySelector('#comments');
const toastEl = document.querySelector('#toast');
const commentSortEl = document.querySelector('#commentSort');
const commentLoadMore = document.querySelector('#commentLoadMore');
const commentRefresh = document.querySelector('#markCommentRefresh');
let currentComments = [];
let currentPost = null;
let commentSort = 'latest';
let commentVisibleCount = 6;
let commentsCursor = null;
let commentsHasMore = false;
let pointUnitName = '积分';
const REQUEST_TIMEOUT_MS = 6500;
try {
  const currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
  const avatar = document.querySelector('.top-actions .avatar');
  if (avatar && currentUser) { avatar.textContent = String(currentUser.name || currentUser.nickname || '林').slice(0, 1); avatar.title = currentUser.name || currentUser.nickname || '个人中心'; }
} catch {}
function authHeaders() { const token = localStorage.getItem('accessToken'); return token ? { Authorization: `Bearer ${token}` } : {}; }
function toast(message) { toastEl.textContent = message; toastEl.classList.add('show'); setTimeout(() => toastEl.classList.remove('show'), 1600); }
function escapeHtml(value) { return String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
function setSocialMeta(post) {
  const title = String(post?.title || '内容详情 · 月入万刀');
  const description = String(post?.excerpt || '月入万刀实战内容详情');
  const image = !post?.locked && post?.coverImage ? mediaUrl(post.coverImage) : new URL('assets/iyesh-logo.webp', location.href).href;
  document.title = `${title} · 月入万刀`;
  const values = { description, 'og:title': title, 'og:description': description, 'og:url': location.href, 'og:image': image };
  Object.entries(values).forEach(([key, value]) => {
    const attr = key.startsWith('og:') ? 'property' : 'name';
    let meta = document.head.querySelector(`meta[${attr}="${key}"]`);
    if (!meta) { meta = document.createElement('meta'); meta.setAttribute(attr, key); document.head.appendChild(meta); }
    meta.setAttribute('content', value);
  });
}
const platformTones = {
  'YouTube': 'platform-youtube', 'YouTube Shorts': 'platform-youtube', '小红书': 'platform-xhs',
  '视频号': 'platform-video', '公众号': 'platform-wechat-official', '微信': 'platform-wechat',
  '抖音': 'platform-douyin', 'TikTok': 'platform-tiktok', '闲鱼': 'platform-xianyu',
  'X': 'platform-x', 'Reddit': 'platform-reddit', 'B站': 'platform-bilibili',
  '快手': 'platform-kuaishou', '线下实体': 'platform-offline'
};
function platformTone(value) { return platformTones[String(value || '').trim()] || 'platform-neutral'; }
function mediaUrl(url) { return /^https?:\/\//i.test(String(url || '')) ? url : `${apiBase}${String(url || '').startsWith('/') ? '' : '/'}${url || ''}`; }
function resolveContentMedia(html) { return String(html || '').replace(/(src=["'])(\/uploads\/[A-Za-z0-9][A-Za-z0-9._-]*)(["'])/g, (_match, prefix, url, suffix) => `${prefix}${escapeHtml(mediaUrl(url))}${suffix}`); }
function pricePoints(post) { return Number(post.pricePoints ?? post.priceCents ?? 0); }
function pointUnit(post) { return post.priceUnitName || post.pointsUnitName || pointUnitName; }
function accessType(post) { return post.accessType || (post.memberOnly ? 'member' : pricePoints(post) ? 'paid' : 'free'); }
function accessLabel(post) { const type = accessType(post); return type === 'member' ? `会员 · ${post.requiredPlanName || '会员专享'}` : type === 'paid' ? `付费 · ${pricePoints(post)} ${pointUnit(post)}` : '免费'; }
function displayDate(post) {
  if (post?.date) return String(post.date);
  const raw = String(post?.publishedAt || '').trim();
  if (!raw) return '最近发布';
  if (/^(刚刚|今天|昨天|前天|\d+\s*(分钟|小时|天|周|月|年)前)$/.test(raw)) return raw;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? '最近发布' : new Date(parsed).toLocaleDateString('zh-CN');
}
function render(post) {
  currentPost = post;
  const date = displayDate(post);
  const author = typeof post.author === 'string' ? post.author : post.author?.name;
  const counts = post.counts || {};
  const type = accessType(post);
  const locked = Boolean(post.locked);
  const paywall = locked ? `<div class="detail-paywall"><div><strong>${type === 'member' ? '会员专享内容' : `${escapeHtml(pointUnit(post))}购买后查看`}</strong><span>${type === 'member' ? `开通${escapeHtml(post.requiredPlanName || '会员')}即可阅读` : `需要 ${pricePoints(post)} ${escapeHtml(pointUnit(post))}`}</span></div><button data-action="${type === 'member' ? 'membership' : 'buy'}">${type === 'member' ? '开通会员' : '立即购买'}</button></div>` : '';
  const body = locked ? `<p class="sub">${escapeHtml(post.excerpt || '这篇内容需要对应权益后查看。')}</p>` : resolveContentMedia(post.content || `<p>${escapeHtml(post.excerpt)}</p>`);
  const cover = !locked && post.coverImage ? `<img class="detail-cover" src="${escapeHtml(mediaUrl(post.coverImage))}" alt="${escapeHtml(post.title)}封面" loading="lazy">` : '';
  detail.innerHTML = `<div class="card-top"><span>${escapeHtml(author || '用户')}</span><span>·</span><span>${escapeHtml(date)}</span><span class="access-badge ${type === 'member' ? 'member-access' : type === 'paid' ? 'paid-access' : 'free-access'}">${escapeHtml(accessLabel(post))}</span></div><h1>${escapeHtml(post.title)}</h1>${cover}${paywall}<div class="detail-content">${body}</div><div class="meta"><span>⚓ ${Number(counts.anchors || 0)}</span><span>♡ ${Number(counts.likes || 0)}</span><span>◌ ${Number(counts.comments || 0)}</span><span>☆ ${Number(counts.favorites || 0)}</span></div><div class="detail-actions"><button data-action="anchor">投锚</button><button data-action="like">点赞</button><button data-action="favorite">收藏</button><button data-action="share" class="share-trigger">分享</button><button data-action="tip">${escapeHtml(pointUnitName)}打赏</button><button data-action="report" class="subtle-action">举报</button></div>`;
}
async function request(path, options = {}) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try { response = await fetch(`${apiBase}${path}`, { ...options, signal: controller.signal, headers: { ...authHeaders(), ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) } }); } catch (error) { if (error.name === 'AbortError') throw new Error('服务响应较慢，请稍后重试'); throw error; } finally { clearTimeout(timer); }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(body.message || `请求失败 ${response.status}`); error.status = response.status; throw error; }
  return body;
}
async function requireLogin() { if (localStorage.getItem('accessToken')) return true; toast('请先登录'); setTimeout(() => { location.href = `login.html?return=${encodeURIComponent(location.href)}`; }, 300); return false; }
async function buyPost() { if (!(await requireLogin())) return; try { await request(`/api/v1/posts/${encodeURIComponent(id)}/purchase`, { method: 'POST', body: JSON.stringify({}) }); toast(`${pointUnitName}购买成功，正在刷新内容`); await load(); } catch (error) { toast(error.message || `${pointUnitName}购买暂时不可用`); } }
async function openMembership() { location.href = `membership.html?return=${encodeURIComponent(location.href)}`; }
async function getPointsSummary() {
  for (const path of ['/api/v1/me/points', '/api/v1/points/balance', '/api/v1/me/points/balance']) {
    try {
      const body = await request(path);
      const wallet = body.wallet || body.points || body;
      return { balance: Number(wallet.balance ?? wallet.pointsBalance ?? wallet.amount ?? 0), unitName: wallet.unitName || wallet.unit || body.unitName || '积分' };
    } catch (error) { if (![404, 405].includes(error.status)) throw error; }
  }
  return { balance: 0, unitName: '积分' };
}
async function tipAuthor() {
  if (!(await requireLogin())) return;
  try {
    const summary = await getPointsSummary();
    const balance = summary.balance; const unit = summary.unitName;
    const amountPoints = Number(window.prompt(`输入打赏${unit}（当前余额 ${balance} ${unit}）`, '10'));
    if (!Number.isInteger(amountPoints) || amountPoints <= 0) return;
    if (balance < amountPoints) return toast(`${unit}不足，当前余额 ${balance} ${unit}`);
    const message = window.prompt('留言（可选）', '') || '';
    try { await request('/api/v1/tips', { method: 'POST', body: JSON.stringify({ postId: id, points: amountPoints, amountPoints, message }) }); } catch (error) { if (error.status !== 404) throw error; await request('/api/v1/tips/orders', { method: 'POST', body: JSON.stringify({ postId: id, points: amountPoints, amountPoints, message }) }); }
    toast(`已用 ${amountPoints} ${unit}支持作者`);
    await load();
  } catch (error) { toast(error.message || '积分打赏暂时不可用'); }
}
async function reportPost() { if (!(await requireLogin())) return; const reason = window.prompt('举报原因（如广告、侵权、违规内容）', '违规内容'); if (!reason?.trim()) return; const detail = window.prompt('补充说明（可选）', '') || ''; try { await request(`/api/v1/posts/${encodeURIComponent(id)}/report`, { method: 'POST', body: JSON.stringify({ reason: reason.trim(), detail: detail.trim() }) }); toast('举报已提交，感谢你的反馈'); } catch (error) { toast(error.message || '举报暂时不可用'); } }
function sortComments(items) {
  const replies = new Map();
  items.forEach(item => { if (item.parentId) replies.set(item.parentId, (replies.get(item.parentId) || 0) + 1); });
  return [...items].sort((left, right) => {
    if (commentSort === 'hot') {
      const hotLeft = (replies.get(left.id) || 0) * 10 + new Date(left.createdAt || 0).getTime();
      const hotRight = (replies.get(right.id) || 0) * 10 + new Date(right.createdAt || 0).getTime();
      return hotRight - hotLeft;
    }
    const leftTime = new Date(left.createdAt || 0).getTime();
    const rightTime = new Date(right.createdAt || 0).getTime();
    return commentSort === 'oldest' ? leftTime - rightTime : rightTime - leftTime;
  });
}
function renderComments(items) {
  currentComments = Array.isArray(items) ? items : [];
  const sorted = sortComments(currentComments);
  const visible = sorted.slice(0, commentVisibleCount);
  document.querySelector('#commentCount').textContent = `${currentComments.length} 条`;
  if (commentLoadMore) {
    commentLoadMore.hidden = !commentsHasMore && sorted.length <= visible.length;
    commentLoadMore.textContent = commentLoadMore.hidden ? '已全部加载' : '加载更多评论';
  }
  commentsEl.innerHTML = visible.length ? visible.map(item => `<div class="comment ${item.parentId ? 'reply' : ''}"><strong>${escapeHtml(item.user?.name || '用户')}</strong><span>${escapeHtml(item.createdAt ? new Date(item.createdAt).toLocaleString('zh-CN') : '')}</span><p>${escapeHtml(item.content)}</p><div class="comment-actions"><button class="reply-btn" data-reply-id="${escapeHtml(item.id)}">回复</button><button class="comment-action" data-comment-report-id="${escapeHtml(item.id)}">举报</button></div></div>`).join('') : '<p class="sub">还没有评论。</p>';
}
async function loadComments(reset = true) {
  if (reset) { commentsCursor = null; commentsHasMore = false; }
  try {
    const params = new URLSearchParams({ sort: commentSort, pageSize: '20' });
    if (!reset && commentsCursor) params.set('cursor', commentsCursor);
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response;
    try { response = await fetch(`${apiBase}/api/v1/posts/${encodeURIComponent(id)}/comments?${params}`, { signal: controller.signal, headers: authHeaders() }); } finally { clearTimeout(timer); }
    if (!response.ok) throw new Error('comments failed');
    const body = await response.json();
    currentComments = reset ? (body.items || []) : [...currentComments, ...(body.items || [])];
    commentsCursor = body.nextCursor || null;
    commentsHasMore = Boolean(body.hasMore);
    commentVisibleCount = currentComments.length;
    renderComments(currentComments);
  } catch {
    if (reset) { commentsHasMore = false; renderComments(currentPost?.comments || []); }
    else toast('评论加载失败，请稍后重试');
  }
}
async function load() { try { const config = await request('/api/v1/points/config'); pointUnitName = config.unitName || config.unit || pointUnitName; } catch {} let post = fallback[id]; let remoteUnavailable = false; try { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS); let response; try { response = await fetch(`${apiBase}/api/v1/posts/${encodeURIComponent(id)}`, { signal: controller.signal, headers: authHeaders() }); } finally { clearTimeout(timer); } if (response.ok) post = await response.json(); else if (response.status === 404) post = null; } catch { remoteUnavailable = true; } if (!post) { detail.innerHTML = '<p class="sub">内容不存在或已下线。</p>'; document.querySelector('#commentForm').hidden = true; renderComments([]); return; } setSocialMeta(post); render(post); if (remoteUnavailable) { detail.insertAdjacentHTML('afterbegin', '<div class="remote-error" id="detailRemoteError"><span>服务响应较慢，当前显示缓存内容。</span><button type="button" id="retryDetail">重试</button></div>'); } currentComments = post.comments || []; renderComments(currentComments); await loadComments(true); document.querySelector('#commentForm').hidden = Boolean(post.locked); }
document.querySelector('#commentForm').addEventListener('submit', async event => { event.preventDefault(); const input = document.querySelector('#commentInput'); const content = input.value.trim(); if (!content) return; try { const response = await fetch(`${apiBase}/api/v1/posts/${encodeURIComponent(id)}/comments`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify({ content }) }); if (response.status === 401) return toast('请先登录后发表评论'); if (!response.ok) throw new Error('comment failed'); const item = await response.json(); renderComments([...currentComments, item]); input.value = ''; toast('评论已发布'); } catch { toast('评论暂时不可用，请稍后重试'); } });
commentsEl.addEventListener('click', async event => {
  const reportButton = event.target.closest('[data-comment-report-id]');
  if (reportButton) {
    if (!(await requireLogin())) return;
    const reason = window.prompt('举报原因（如广告、辱骂、侵权）', '违规内容');
    if (!reason?.trim()) return;
    try {
      const response = await fetch(`${apiBase}/api/v1/comments/${encodeURIComponent(reportButton.dataset.commentReportId)}/report`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify({ reason: reason.trim() }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || '举报失败');
      reportButton.textContent = '已举报'; reportButton.disabled = true; toast('举报已提交');
    } catch (error) { toast(error.message || '举报暂时不可用'); }
    return;
  }
  const button = event.target.closest('[data-reply-id]');
  if (!button) return;
  const content = window.prompt('回复这条评论'); if (!content?.trim()) return;
  try { const response = await fetch(`${apiBase}/api/v1/comments/${encodeURIComponent(button.dataset.replyId)}/replies`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify({ content: content.trim() }) }); if (response.status === 401) return toast('请先登录后回复'); if (!response.ok) throw new Error('reply failed'); const item = await response.json(); renderComments([...currentComments, item]); if (currentPost?.counts) currentPost.counts.comments += 1; toast('回复已发布'); } catch { toast('回复暂时不可用，请稍后重试'); }
});
detail.addEventListener('click', async event => {
  if (event.target.closest('#retryDetail')) { await load(); return; }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'membership') return openMembership();
  if (action === 'buy') return buyPost();
  if (action === 'tip') return tipAuthor();
  if (action === 'report') return reportPost();
  if (action === 'share') {
    if (typeof window.openShareSheet === 'function') {
      const authorName = typeof currentPost?.author === 'string' ? currentPost.author : currentPost?.author?.name;
      const shareUrl = typeof window.shareUrlForPost === 'function'
        ? window.shareUrlForPost(currentPost?.id || id)
        : location.href;
      window.openShareSheet({ title: currentPost?.title, excerpt: currentPost?.excerpt, platform: currentPost?.platform, author: authorName, cover: !currentPost?.locked && currentPost?.coverImage ? mediaUrl(currentPost.coverImage) : '', url: shareUrl });
    }
    return;
  }
  try { const response = await fetch(`${apiBase}/api/v1/posts/${encodeURIComponent(id)}/${action}`, { method: 'POST', headers: authHeaders() }); if (response.status === 401) return toast('请先登录后操作'); if (!response.ok) throw new Error('interaction failed'); const result = await response.json(); currentPost.counts = result.counts; render(currentPost); toast(`${action === 'anchor' ? '已投锚' : action === 'like' ? '已点赞' : '已收藏'}`); } catch { toast('互动暂时不可用，请稍后重试'); }
});
commentSortEl?.addEventListener('change', async event => { commentSort = event.target.value; commentVisibleCount = 6; await loadComments(true); });
commentLoadMore?.addEventListener('click', async () => { if (commentsHasMore) await loadComments(false); else { commentVisibleCount += 6; renderComments(currentComments); } });
commentRefresh?.addEventListener('click', async () => { commentRefresh.disabled = true; try { await load(); toast('评论已刷新'); } finally { commentRefresh.disabled = false; } });
load();
