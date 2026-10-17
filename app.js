let posts = [
  { id: 'post_1', title: '累计开通 500+ YPP：YouTube 直播玩法开源', excerpt: '把选题、直播和复盘拆成一套可复制的流程，适合刚开始做内容出海的团队。', author: 'Gary', platform: 'YouTube', project: '出海', skill: 'AI', date: '1天前', publishedAt: '2026-10-13T08:00:00+08:00', digest: true, accessType: 'paid', priceCents: 990, counts: [44, 144, 4, 51] },
  { id: 'post_2', title: '从 0 到 1 做一个垂直小号的完整记录', excerpt: '从定位、素材收集到发布节奏，分享一套低成本验证方法。', author: '小满', platform: '小红书', project: '垂直小号', skill: '自媒体', date: '2天前', publishedAt: '2026-10-12T08:00:00+08:00', digest: true, accessType: 'member', requiredPlanName: '创作者会员', counts: [31, 102, 12, 36] },
  { id: 'post_3', title: 'AI 工作流如何接入日常内容生产', excerpt: '把调研、提纲、脚本和复盘串起来，减少重复劳动，把时间留给判断。', author: '林默', platform: '公众号', project: 'AI自媒体', skill: 'AI工作流', date: '3天前', publishedAt: '2026-10-11T08:00:00+08:00', digest: false, accessType: 'paid', priceCents: 900, counts: [18, 88, 7, 24] },
  { id: 'post_4', title: '一套跨境电商素材管理方法', excerpt: '当素材数量变多后，如何按照市场、产品和投放阶段组织素材。', author: '周予', platform: 'TikTok', project: '电商', skill: 'AI视频', date: '5天前', publishedAt: '2026-10-09T08:00:00+08:00', digest: false, accessType: 'free', counts: [22, 64, 5, 19] },
  { id: 'post_5', title: 'Codex 辅助项目开发的实践清单', excerpt: '从需求拆解到代码审查，记录一个真实项目中的协作方式。', author: '苏然', platform: 'X', project: 'AI产品开发', skill: 'Codex', date: '1周前', publishedAt: '2026-10-07T08:00:00+08:00', digest: true, accessType: 'member', requiredPlanName: '创作者会员', counts: [15, 73, 6, 28] },
  { id: 'post_6', title: '做内容之前，先把用户问题说清楚', excerpt: '内容不是信息堆积，找到具体问题，才能让经验被真正使用。', author: '闻舟', platform: 'B站', project: '自媒体', skill: '生财认知', date: '1周前', publishedAt: '2026-10-07T06:00:00+08:00', digest: false, accessType: 'free', counts: [11, 51, 3, 16] }
];

const filterGroups = [];
const state = { platform: 'YouTube', keyword: '', tab: 'hot', date: 'all', sort: 'latest', mode: 'normal' };
const query = new URLSearchParams(location.search);
state.platform = 'YouTube';
state.keyword = query.get('keyword') || state.keyword;
state.tab = ['hot', 'digest', 'all'].includes(query.get('tab')) ? query.get('tab') : state.tab;
state.sort = ['latest', 'oldest', 'favorites', 'comments', 'likes', 'anchors', 'anchor-latest'].includes(query.get('sort')) ? query.get('sort') : state.sort;
state.date = ['all', 'yesterday', '3d', '7d', 'month', 'last-month', '3month'].includes(query.get('date')) ? query.get('date') : state.date;
state.mode = ['normal', 'compact', 'streamline'].includes(query.get('mode')) ? query.get('mode') : state.mode;
const counts = { hot: 1582, digest: 210, all: 405 };
const cards = document.querySelector('#cards');
const toastEl = document.querySelector('#toast');
const apiBase = window.CONTENT_API_BASE || 'http://127.0.0.1:8787';
const authHeaders = () => { const token = localStorage.getItem('accessToken'); return token ? { Authorization: `Bearer ${token}` } : {}; };
const REQUEST_TIMEOUT_MS = 6500;
async function fetchWithTimeout(url, options = {}, timeout = REQUEST_TIMEOUT_MS) { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeout); try { return await fetch(url, { ...options, signal: controller.signal }); } catch (error) { if (error.name === 'AbortError') throw new Error('服务响应较慢，请稍后重试'); throw error; } finally { clearTimeout(timer); } }
let remoteActive = false;
let remoteTotal = null;
let remoteTabTotals = null;
let remoteNextCursor = null;
let remoteLoading = false;
let remoteError = '';
let remoteRequestId = 0;
let remoteTimer = null;
const loadMoreBtn = document.querySelector('#loadMoreBtn');

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => toastEl.classList.remove('show'), 1800);
}

function syncUrl() {
  const params = new URLSearchParams()
  if (state.keyword) params.set('keyword', state.keyword)
  if (state.tab !== 'hot') params.set('tab', state.tab)
  if (state.date !== 'all') params.set('date', state.date)
  if (state.sort !== 'latest') params.set('sort', state.sort)
  if (state.mode !== 'normal') params.set('mode', state.mode)
  history.replaceState(null, '', `${location.pathname}${params.toString() ? `?${params}` : ''}`)
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function accessMeta(post) {
  const type = post.accessType || (post.memberOnly ? 'member' : post.priceCents ? 'paid' : 'free');
  if (type === 'member') return { type, label: post.requiredPlanName ? `会员 · ${post.requiredPlanName}` : '会员专享', className: 'member-access' };
  if (type === 'paid') return { type, label: `付费 · ${Number(post.pricePoints ?? post.priceCents ?? 0).toLocaleString()} ${post.priceUnitName || post.pointsUnitName || '积分'}`, className: 'paid-access' };
  return { type: 'free', label: '免费', className: 'free-access' };
}

function filteredPosts() {
  let list = [...posts];
  if (state.keyword) {
    const keyword = state.keyword.toLowerCase();
    list = list.filter(post => [post.title, post.excerpt, post.author, post.platform, post.project, post.skill]
      .some(value => String(value ?? '').toLowerCase().includes(keyword)));
  }
  if (state.platform !== '全部') list = list.filter(post => post.platform === state.platform);
  if (state.date !== 'all') {
    const end = new Date(); end.setHours(23, 59, 59, 999); const start = new Date(end);
    if (state.date === 'yesterday') { start.setDate(start.getDate() - 1); start.setHours(0, 0, 0, 0); end.setDate(end.getDate() - 1); end.setHours(23, 59, 59, 999); }
    if (state.date === '3d') start.setDate(start.getDate() - 2);
    if (state.date === '7d') start.setDate(start.getDate() - 6);
    if (state.date === 'month') start.setMonth(start.getMonth() - 1);
    if (state.date === '3month') start.setMonth(start.getMonth() - 3);
    if (state.date === 'last-month') { start.setMonth(start.getMonth() - 1, 1); start.setHours(0, 0, 0, 0); end.setDate(0); end.setHours(23, 59, 59, 999); }
    list = list.filter(post => new Date(post.publishedAt) >= start && new Date(post.publishedAt) <= end);
  }
  if (state.tab === 'digest') list = list.filter(post => post.digest);
  if (state.sort === 'oldest') list.reverse();
  if (state.sort === 'likes') list.sort((a, b) => b.counts[1] - a.counts[1]);
  if (state.sort === 'comments') list.sort((a, b) => b.counts[2] - a.counts[2]);
  if (state.sort === 'favorites') list.sort((a, b) => b.counts[3] - a.counts[3]);
  if (state.sort === 'anchors') list.sort((a, b) => b.counts[0] - a.counts[0]);
  if (state.sort === 'anchor-latest') list.sort((a, b) => b.counts[0] - a.counts[0]);
  return list;
}

function renderCard(post) {
  const mode = state.mode;
  const summary = mode === 'streamline' ? '' : `<p>${escapeHtml(post.excerpt)}</p>`;
  const metrics = `<div class="meta"><span>⚓ ${post.counts[0]}</span><span>♡ ${post.counts[1]}</span><span>◌ ${post.counts[2]}</span><span>☆ ${post.counts[3]}</span></div>`;
  const digest = post.digest ? '<span class="digest">精华</span>' : '';
  const access = accessMeta(post);
  return `<article class="card ${mode}" data-post-id="${escapeHtml(String(post.id))}"><div class="card-top"><span>${escapeHtml(post.author)}</span><span>·</span><span>${escapeHtml(post.date)}</span>${digest}<span class="access-badge ${access.className}">${escapeHtml(access.label)}</span></div><h2>${escapeHtml(post.title)}</h2>${summary}${metrics}<div class="card-tags"><button class="expand-card" type="button" data-expand-post="${escapeHtml(String(post.id))}">展开全文</button><button class="more-btn share-list-btn" aria-label="分享内容"><span aria-hidden="true">↗</span><span>分享</span></button></div></article>`;
}

function render() {
  const list = filteredPosts();
  const hasTag = [];
  const hasNarrowFilter = state.keyword || state.date !== 'all';
  const resultCount = remoteActive && remoteTotal !== null ? remoteTotal : (hasNarrowFilter ? list.length : counts[state.tab]);
  document.querySelector('#resultCount').textContent = resultCount;
  document.querySelector('#summaryCount').textContent = resultCount;
  document.querySelector('#activeSummary').textContent = 'YouTube';
  const errorHint = remoteError ? '<div class="remote-error" role="status"><span>在线内容暂时不可用，当前显示本地示例。</span><button type="button" data-retry-search>重试</button></div>' : '';
  cards.innerHTML = errorHint + (list.length ? list.map(renderCard).join('') : '<div class="card empty-card"><p>没有找到匹配内容，试试清除筛选。</p></div>');
  cards.className = `cards mode-${state.mode}`;
  if (loadMoreBtn) {
    loadMoreBtn.hidden = !remoteActive || !remoteNextCursor;
    loadMoreBtn.disabled = remoteLoading;
    loadMoreBtn.textContent = remoteLoading ? '正在加载…' : '加载更多';
  }
  document.querySelector('#hotCount').textContent = remoteActive && remoteTabTotals ? remoteTabTotals.hot : counts.hot;
  document.querySelector('#digestCount').textContent = remoteActive && remoteTabTotals ? remoteTabTotals.digest : counts.digest;
}

function selectInGroup(group, value) {
  state[group] = value;
  document.querySelectorAll(`[data-group="${group}"] .chip`).forEach(button => button.classList.toggle('selected', button.dataset.value === value));
  render(); syncUrl(); scheduleRemote();
  toast(`已按“${value}”筛选`);
}

document.querySelectorAll('.chips').forEach(group => group.addEventListener('click', event => {
  if (event.target.matches('.chip')) selectInGroup(group.dataset.group, event.target.dataset.value);
}));

document.querySelectorAll('.expand-btn').forEach(button => button.addEventListener('click', () => {
  const group = button.dataset.expand;
  if (button.dataset.expanded === 'true') {
    expanded[group].forEach(value => document.querySelector(`[data-group="${group}"] [data-value="${CSS.escape(value)}"]`)?.remove());
    if (expanded[group].includes(state[group])) { state[group] = '全部'; render(); syncUrl(); scheduleRemote(); }
    button.textContent = '＋7';
    button.dataset.expanded = 'false';
    return;
  }
  expanded[group].forEach(value => {
    const item = document.createElement('button'); item.className = 'chip extra-chip'; item.dataset.value = value; item.textContent = value; button.before(item);
  });
  button.textContent = '收起'; button.dataset.expanded = 'true';
}));

document.querySelector('.tabs').addEventListener('click', event => {
  const button = event.target.closest('.tab');
  if (!button) return;
  state.tab = button.dataset.value;
  document.querySelectorAll('.tab').forEach(item => item.classList.toggle('selected', item === button));
  render(); syncUrl(); scheduleRemote();
});

document.querySelector('#dateSelect').addEventListener('change', event => { state.date = event.target.value; render(); syncUrl(); scheduleRemote(); toast(`日期：${event.target.options[event.target.selectedIndex].text}`); });
document.querySelector('#sortSelect').addEventListener('change', event => { state.sort = event.target.value; render(); syncUrl(); scheduleRemote(); });
document.querySelector('#modeSelect').addEventListener('change', event => { state.mode = event.target.value; render(); syncUrl(); });
document.querySelector('#keywordInput').addEventListener('input', event => { state.keyword = event.target.value.trim(); render(); syncUrl(); scheduleRemote(); });
function syncProfileLink() {
  const link = document.querySelector('#profileLink');
  if (!link) return;
  let user = null;
  try { user = JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch {}
  const name = user?.name || user?.nickname || '林';
  link.textContent = name.slice(0, 1);
  link.title = user ? `${name} · 个人中心` : '登录 / 个人中心';
}
syncProfileLink();
document.querySelector('#profileLink')?.addEventListener('click', () => { window.location.href = 'profile.html'; });

document.querySelector('#resetBtn').addEventListener('click', () => {
  Object.assign(state, { platform: 'YouTube', keyword: '', tab: 'hot', date: 'all', sort: 'latest', mode: 'normal' });
  document.querySelectorAll('.chip').forEach(button => button.classList.toggle('selected', button.dataset.value === 'YouTube'));
  document.querySelectorAll('.tab').forEach(button => button.classList.toggle('selected', button.dataset.value === 'hot'));
  document.querySelector('#dateSelect').value = 'all'; document.querySelector('#sortSelect').value = 'latest'; document.querySelector('#modeSelect').value = 'normal';
  document.querySelector('#keywordInput').value = '';
  render(); syncUrl(); scheduleRemote(); toast('筛选条件已清除');
});

const savedFilters = [];
function renderSaved() {
  document.querySelector('#savedCount').textContent = `${savedFilters.length}/7`;
  document.querySelector('#savedFilters').innerHTML = savedFilters.length ? savedFilters.map((item, index) => `<button data-index="${index}">${escapeHtml(String(item.name))}</button>`).join('') : '<span class="empty">暂无常用筛选</span>';
}
document.querySelector('#saveFilterBtn').addEventListener('click', async () => {
  if (savedFilters.length >= 7) return toast('最多保存 7 组常用筛选');
  const name = 'YouTube 内容'; const filter = { ...state, platform: 'YouTube' };
  try { const response = await fetchWithTimeout(`${apiBase}/api/v1/saved-filters`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify({ name, filter }) }); const remote = await response.json(); if (response.status === 401) { toast('请先登录后保存常用筛选'); window.location.href = `login.html?return=${encodeURIComponent(location.href)}`; return; } if (response.ok) savedFilters.push({ id: remote.id, name: remote.name, state: remote.filter }); else throw new Error(remote.message || '保存失败'); } catch (error) { toast(error.message || '常用筛选保存失败，请稍后重试'); return; }
  renderSaved(); toast('已保存为常用筛选');
});
document.querySelector('#clearSaved').addEventListener('click', async () => { const items = [...savedFilters]; const results = await Promise.allSettled(items.filter(item => item.id).map(item => fetchWithTimeout(`${apiBase}/api/v1/saved-filters/${encodeURIComponent(item.id)}`, { method: 'DELETE', headers: authHeaders() }))); if (results.some(result => result.status === 'rejected' || !result.value.ok)) return toast('清空失败，原有筛选仍保留'); savedFilters.splice(0); renderSaved(); toast('常用筛选已清空'); });
document.querySelector('#savedFilters').addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button) return;
  Object.assign(state, savedFilters[Number(button.dataset.index)].state, { platform: 'YouTube' });
  filterGroups.forEach(group => document.querySelectorAll(`[data-group="${group}"] .chip`).forEach(item => item.classList.toggle('selected', item.dataset.value === state[group])));
  document.querySelector('#dateSelect').value = state.date; document.querySelector('#sortSelect').value = state.sort; document.querySelector('#modeSelect').value = state.mode;
  document.querySelectorAll('.tab').forEach(item => item.classList.toggle('selected', item.dataset.value === state.tab));
  render(); syncUrl(); scheduleRemote(); toast('已应用常用筛选');
});
loadMoreBtn?.addEventListener('click', () => loadRemote(true));
cards.addEventListener('click', async event => {
  if (event.target.closest('[data-retry-search]')) {
    event.stopPropagation();
    loadRemote(false);
    return;
  }
  const expandButton = event.target.closest('.expand-card');
  if (expandButton) {
    event.stopPropagation();
    const card = expandButton.closest('[data-post-id]');
    if (card.dataset.expanded === 'true') {
      card.querySelector('.inline-content')?.remove();
      card.dataset.expanded = 'false';
      expandButton.textContent = '展开全文';
      return;
    }
    expandButton.disabled = true;
    let content = '';
    let locked = false;
    let lockedPost = null;
    try {
      const response = await fetchWithTimeout(`${apiBase}/api/v1/posts/${encodeURIComponent(card.dataset.postId)}`);
      if (response.ok) {
        lockedPost = await response.json();
        locked = Boolean(lockedPost.locked);
        content = String(lockedPost.content || '');
      }
    } catch {}
    if (locked) {
      const access = accessMeta(lockedPost || {});
      content = `<div class="inline-paywall"><strong>${access.type === 'member' ? '会员专享内容' : '积分购买后查看'}</strong><span>${access.type === 'member' ? `开通${escapeHtml(lockedPost?.requiredPlanName || '会员')}即可阅读` : `需要 ${Number(lockedPost?.pricePoints ?? lockedPost?.priceCents ?? 0).toLocaleString()} ${escapeHtml(lockedPost?.priceUnitName || '积分')}`}</span><button type="button" class="paywall-action" data-paywall-post="${escapeHtml(card.dataset.postId)}">${access.type === 'member' ? '开通会员' : '去购买'}</button></div>`;
    }
    if (!content) {
      const local = posts.find(post => String(post.id) === card.dataset.postId);
      if (local && (local.locked || accessMeta(local).type !== 'free')) {
        const access = accessMeta(local);
        content = `<div class="inline-paywall"><strong>${access.type === 'member' ? '会员专享内容' : '积分购买后查看'}</strong><span>${access.type === 'member' ? `开通${escapeHtml(local.requiredPlanName || '会员')}即可阅读` : `需要 ${Number(local.pricePoints ?? local.priceCents ?? 0).toLocaleString()} ${escapeHtml(local.priceUnitName || '积分')}`}</span><button type="button" class="paywall-action" data-paywall-post="${escapeHtml(card.dataset.postId)}">${access.type === 'member' ? '开通会员' : '去购买'}</button></div>`;
      } else content = `<p>${escapeHtml(String(local?.excerpt || '暂无正文'))}</p>`;
    }
    const body = document.createElement('div');
    body.className = 'inline-content';
    body.innerHTML = content;
    card.querySelector('h2')?.after(body);
    card.dataset.expanded = 'true';
    expandButton.disabled = false;
    expandButton.textContent = '收起全文';
    return;
  }
  const paywallButton = event.target.closest('.paywall-action');
  if (paywallButton) {
    event.stopPropagation();
    window.location.href = `detail.html?id=${encodeURIComponent(paywallButton.dataset.paywallPost)}`;
    return;
  }
  const moreButton = event.target.closest('.more-btn');
  if (moreButton) {
    event.stopPropagation();
    const card = moreButton.closest('[data-post-id]');
    const post = posts.find(item => String(item.id) === String(card?.dataset.postId)) || {};
    const postId = card?.dataset.postId || '';
    const url = typeof window.shareUrlForPost === 'function'
      ? window.shareUrlForPost(postId)
      : new URL(`detail.html?id=${encodeURIComponent(postId)}`, location.href).href;
    if (typeof window.openShareSheet === 'function') {
      window.openShareSheet({ title: post.title, excerpt: post.excerpt, platform: post.platform, author: post.author, cover: post.coverImage, url });
    } else {
      try { await navigator.clipboard.writeText(url); toast('内容链接已复制'); } catch { window.prompt('复制内容链接', url); }
    }
    return;
  }
  const card = event.target.closest('[data-post-id]');
  if (card) window.location.href = `detail.html?id=${encodeURIComponent(card.dataset.postId)}`;
});

renderSaved();
filterGroups.forEach(group => document.querySelectorAll(`[data-group="${group}"] .chip`).forEach(item => item.classList.toggle('selected', item.dataset.value === state[group])));
document.querySelectorAll('.tab').forEach(item => item.classList.toggle('selected', item.dataset.value === state.tab));
document.querySelector('#keywordInput').value = state.keyword;
document.querySelector('#dateSelect').value = state.date;
document.querySelector('#sortSelect').value = state.sort;
document.querySelector('#modeSelect').value = state.mode;
render();
async function loadSavedFilters() { try { const response = await fetchWithTimeout(`${apiBase}/api/v1/saved-filters`, { headers: authHeaders() }); const body = await response.json(); if (response.ok && Array.isArray(body.items)) { savedFilters.splice(0, savedFilters.length, ...body.items.map(item => ({ id: item.id, name: item.name, state: item.filter }))); renderSaved(); } } catch {} }
loadSavedFilters();

function remoteDateRange(value) {
  if (value === 'all') return {};
  const end = new Date(); end.setHours(23, 59, 59, 999); const start = new Date(end);
  if (value === 'yesterday') { start.setDate(start.getDate() - 1); start.setHours(0, 0, 0, 0); end.setDate(end.getDate() - 1); end.setHours(23, 59, 59, 999); }
  if (value === '3d') start.setDate(start.getDate() - 2);
  if (value === '7d') start.setDate(start.getDate() - 6);
  if (value === 'month') start.setMonth(start.getMonth() - 1);
  if (value === '3month') start.setMonth(start.getMonth() - 3);
  if (value === 'last-month') { start.setMonth(start.getMonth() - 1, 1); start.setHours(0, 0, 0, 0); end.setDate(0); end.setHours(23, 59, 59, 999); }
  return { dateStart: start.toISOString(), dateEnd: end.toISOString() };
}
function scheduleRemote() { window.clearTimeout(remoteTimer); remoteTimer = window.setTimeout(() => loadRemote(false), 120); }
async function loadRemote(append = false) {
  const requestId = ++remoteRequestId;
  remoteLoading = true;
  remoteError = '';
  if (!append) remoteNextCursor = null;
  render();
  try {
    const response = await fetchWithTimeout(`${apiBase}/api/v1/posts/search`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify({ keyword: state.keyword, platformId: state.platform, tab: state.tab, sort: state.sort, pageSize: 50, cursor: append ? remoteNextCursor : null, ...remoteDateRange(state.date) }) });
    if (!response.ok) throw new Error('search failed');
    const body = await response.json();
    if (requestId !== remoteRequestId) return;
    const mapped = (body.items || []).map(item => ({
      title: String(item.title ?? ''),
      excerpt: String(item.excerpt ?? ''),
      author: String(item.author?.name ?? item.author ?? ''),
      platform: String(item.platform ?? ''),
      project: String(item.project ?? ''),
      skill: String(item.skill ?? ''),
      date: item.date || (item.publishedAt ? new Date(item.publishedAt).toLocaleDateString('zh-CN') : ''),
      publishedAt: item.publishedAt || '',
      digest: Boolean(item.digest),
      accessType: item.accessType || (item.memberOnly ? 'member' : (item.pricePoints ?? item.priceCents) ? 'paid' : 'free'),
      pricePoints: Number(item.pricePoints ?? item.priceCents ?? 0),
      priceUnitName: item.priceUnitName || '积分',
      requiredPlanName: item.requiredPlanName || item.requiredPlan?.name || '',
      coverImage: item.coverImage || item.cover || '',
      locked: Boolean(item.locked),
      counts: [Number(item.counts?.anchors || 0), Number(item.counts?.likes || 0), Number(item.counts?.comments || 0), Number(item.counts?.favorites || 0)],
      id: item.id
    }));
    posts = append ? [...posts, ...mapped] : mapped;
    remoteTotal = Number(body.total || 0); remoteTabTotals = body.tabTotals || null; remoteActive = true; render();
    remoteNextCursor = body.nextCursor || null;
  } catch {
    if (requestId !== remoteRequestId) return;
    remoteError = 'search-unavailable';
    if (!append) { remoteActive = false; remoteTotal = null; remoteTabTotals = null; remoteNextCursor = null; }
  } finally {
    if (requestId === remoteRequestId) { remoteLoading = false; render(); }
  }
}
loadRemote();
