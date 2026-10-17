/* 发现页：搜索、筛选、内容流、常用筛选 */
(function () {
  'use strict';
  const { api, icon, escapeHtml, toast, relativeTime, compact, accessInfo, topicsOf, avatarHtml, session } = window.App;

  const PLATFORM = 'YouTube';
  const TABS = { hot: { tab: 'hot', sort: 'hot' }, latest: { tab: 'all', sort: 'latest' }, digest: { tab: 'digest', sort: 'latest' } };
  const DATE_OPTIONS = [['all', '不限'], ['yesterday', '昨天'], ['3d', '近 3 天'], ['7d', '近 7 天'], ['month', '近一个月'], ['last-month', '上个月'], ['3month', '近三个月']];
  const SORT_OPTIONS = [['', '跟随标签'], ['latest', '最新发布'], ['likes', '最多点赞'], ['favorites', '最多收藏'], ['comments', '最多评论'], ['anchors', '最多投锚'], ['oldest', '最早发布']];
  const PAGE_SIZE = 20;

  const params = new URLSearchParams(location.search);
  const legacyTab = params.get('tab');
  const state = {
    view: ['hot', 'latest', 'digest'].includes(params.get('view')) ? params.get('view') : legacyTab === 'digest' ? 'digest' : legacyTab === 'all' ? 'latest' : 'hot',
    keyword: params.get('keyword') || params.get('q') || '',
    project: params.get('project') || '',
    skill: params.get('skill') || '',
    date: DATE_OPTIONS.some(([value]) => value === params.get('date')) ? params.get('date') : 'all',
    sort: SORT_OPTIONS.some(([value]) => value && value === params.get('sort')) ? params.get('sort') : '',
    mode: params.get('mode') === 'compact' || params.get('mode') === 'streamline' ? 'compact' : 'normal'
  };
  try { if (!params.get('mode') && localStorage.getItem('iyesh:feedMode') === 'compact') state.mode = 'compact'; } catch {}

  const feed = document.querySelector('#feed');
  const keywordInput = document.querySelector('#keywordInput');
  const searchForm = document.querySelector('#searchForm');
  let tags = { project: [], skill: [] };
  let items = [];
  let cursor = null;
  let hasMore = false;
  let total = null;
  let loading = false;
  let requestId = 0;
  let savedFilters = [];
  let unitName = '积分';

  /* ---------- url ---------- */
  function syncUrl() {
    const next = new URLSearchParams();
    if (state.keyword) next.set('keyword', state.keyword);
    if (state.view !== 'hot') next.set('view', state.view);
    if (state.project) next.set('project', state.project);
    if (state.skill) next.set('skill', state.skill);
    if (state.date !== 'all') next.set('date', state.date);
    if (state.sort) next.set('sort', state.sort);
    if (state.mode !== 'normal') next.set('mode', state.mode);
    const query = next.toString();
    history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}`);
  }

  function dateRange(value) {
    if (value === 'all') return {};
    const end = new Date(); end.setHours(23, 59, 59, 999);
    const start = new Date(end); start.setHours(0, 0, 0, 0);
    if (value === 'yesterday') { start.setDate(start.getDate() - 1); end.setDate(end.getDate() - 1); }
    if (value === '3d') start.setDate(start.getDate() - 2);
    if (value === '7d') start.setDate(start.getDate() - 6);
    if (value === 'month') start.setMonth(start.getMonth() - 1);
    if (value === '3month') start.setMonth(start.getMonth() - 3);
    if (value === 'last-month') { start.setMonth(start.getMonth() - 1, 1); end.setDate(0); }
    return { dateStart: start.toISOString(), dateEnd: end.toISOString() };
  }
  function activeFilterCount() { return [state.project, state.skill, state.date !== 'all', state.sort].filter(Boolean).length; }
  function filterLabel(filter = state) {
    const parts = [filter.project, filter.skill, filter.date && filter.date !== 'all' ? DATE_OPTIONS.find(([value]) => value === filter.date)?.[1] : '', filter.keyword ? `“${filter.keyword}”` : ''].filter(Boolean);
    const view = { hot: '推荐', latest: '最新', digest: '精华' }[filter.view || 'hot'];
    return parts.length ? `${parts.join(' ')} ${view}` : `${view}内容`;
  }

  /* ---------- rendering ---------- */
  function renderTabs() {
    document.querySelectorAll('#tabs [data-tab]').forEach(button => { const active = button.dataset.tab === state.view; button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1; });
    document.querySelectorAll('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === state.mode)));
    feed.classList.toggle('is-compact', state.mode === 'compact');
    const count = activeFilterCount();
    const badge = document.querySelector('#filterCount');
    badge.hidden = !count; badge.textContent = String(count);
    document.querySelectorAll('#quickTopics [data-topic]').forEach(chip => chip.setAttribute('aria-pressed', String(chip.dataset.topic === state.project)));
    keywordInput.value = state.keyword;
    searchForm.classList.toggle('has-value', Boolean(state.keyword));
    const active = document.querySelector('#activeFilters');
    const chips = [];
    if (state.keyword) chips.push(['keyword', `搜索：${state.keyword}`]);
    if (state.project) chips.push(['project', state.project]);
    if (state.skill) chips.push(['skill', state.skill]);
    if (state.date !== 'all') chips.push(['date', DATE_OPTIONS.find(([value]) => value === state.date)?.[1] || '']);
    if (state.sort) chips.push(['sort', SORT_OPTIONS.find(([value]) => value === state.sort)?.[1] || '']);
    active.hidden = !chips.length;
    active.innerHTML = chips.map(([key, label]) => `<button class="chip" type="button" data-remove="${key}" aria-label="移除筛选：${escapeHtml(label)}">${escapeHtml(label)}${icon('x', 'x')}</button>`).join('') + (chips.length > 1 ? '<button class="text-btn is-muted" type="button" data-remove="all">全部清除</button>' : '');
  }

  function itemHtml(post) {
    const access = accessInfo(post, unitName);
    const author = typeof post.author === 'string' ? { name: post.author } : (post.author || {});
    const counts = post.counts || {};
    const url = `detail.html?id=${encodeURIComponent(post.id)}`;
    const topics = topicsOf(post);
    const thumb = post.thumbnail || post.coverImage;
    const showThumb = Boolean(thumb) && state.mode !== 'compact';
    return `<article class="feed-item${showThumb ? ' has-thumb' : ''}" data-id="${escapeHtml(post.id)}">
      <div class="feed-item__main">
        <div class="feed-item__meta">${avatarHtml(author)}<span class="author">${escapeHtml(author.name || '用户')}</span><time datetime="${escapeHtml(post.publishedAt || '')}">${escapeHtml(relativeTime(post.publishedAt) || '')}</time>${access.html}</div>
        <h2>${post.digest ? '<span class="tag tag--digest">精华</span>' : ''}<a href="${url}">${escapeHtml(post.title)}</a></h2>
        ${post.excerpt ? `<p class="feed-item__excerpt">${escapeHtml(post.excerpt)}</p>` : ''}
        <div class="feed-item__foot">
          <span class="stat" title="点赞">${icon('heart')}<span class="num">${compact(counts.likes)}</span></span>
          <span class="stat" title="评论">${icon('comment')}<span class="num">${compact(counts.comments)}</span></span>
          <span class="stat" title="收藏">${icon('star')}<span class="num">${compact(counts.favorites)}</span></span>
          ${topics.length ? `<span class="topics">${topics.map(topic => `<span>${escapeHtml(topic)}</span>`).join('')}</span>` : ''}
          <button class="share" type="button" data-share="${escapeHtml(post.id)}" aria-label="分享《${escapeHtml(post.title)}》">${icon('share')}</button>
        </div>
      </div>
      ${showThumb ? `<a class="feed-item__thumb" href="${url}" tabindex="-1" aria-hidden="true"><img src="${escapeHtml(window.App.mediaUrl(thumb))}" alt="" loading="lazy"></a>` : ''}
    </article>`;
  }
  function skeletonHtml(count = 4) {
    return Array.from({ length: count }, () => '<div class="feed-item feed-item--skeleton" aria-hidden="true"><div class="feed-item__main"><div class="skeleton" style="width:38%"></div><div class="skeleton" style="height:20px;width:86%"></div><div class="skeleton" style="width:72%"></div><div class="skeleton" style="width:30%"></div></div></div>').join('');
  }
  function renderFeed({ error = '' } = {}) {
    feed.setAttribute('aria-busy', String(loading));
    if (loading && !items.length) { feed.innerHTML = skeletonHtml(); return; }
    if (error && !items.length) {
      feed.innerHTML = `<div class="empty">${icon('alert')}<strong>内容暂时没有加载出来</strong><p>${escapeHtml(error)}</p><button class="btn btn--sm" type="button" data-retry>重新加载</button></div>`;
      return;
    }
    if (!items.length) {
      const filtered = activeFilterCount() || state.keyword || state.view === 'digest';
      feed.innerHTML = `<div class="empty">${icon('search')}<strong>${filtered ? '没有符合条件的内容' : '这里还没有内容'}</strong><p>${filtered ? '换个关键词，或减少一些筛选条件再试试。' : '第一篇实战经验，可以由你来写。'}</p>${filtered ? '<button class="btn btn--sm" type="button" data-remove="all">清除筛选</button>' : '<a class="btn btn--primary btn--sm" href="publish.html">发布内容</a>'}</div>`;
      return;
    }
    feed.innerHTML = items.map(itemHtml).join('') + (hasMore
      ? `<div class="feed-more" id="feedMore"><button class="btn btn--sm${loading ? ' is-loading' : ''}" type="button" data-more>加载更多</button></div>`
      : `<div class="feed-end">${error ? `<button class="text-btn" type="button" data-more>${escapeHtml(error)}，点击重试</button>` : `已显示全部 ${items.length} 篇`}</div>`);
    observeMore();
  }
  function renderCount() {
    const node = document.querySelector('#heroCount');
    if (total === null) return;
    node.innerHTML = state.keyword || activeFilterCount() || state.view === 'digest'
      ? `找到 <span class="num">${total}</span> 篇相关内容`
      : `已收录 <span class="num">${total}</span> 篇实战内容`;
  }

  /* ---------- data ---------- */
  async function load(append = false) {
    const id = ++requestId;
    loading = true;
    if (!append) { items = []; cursor = null; hasMore = false; }
    renderFeed();
    const view = TABS[state.view];
    try {
      const body = await api('/api/v1/posts/search', { method: 'POST', body: { keyword: state.keyword, platformId: PLATFORM, projectId: state.project || undefined, skillId: state.skill || undefined, tab: view.tab, sort: state.sort || view.sort, pageSize: PAGE_SIZE, cursor: append ? cursor : null, ...dateRange(state.date) } });
      if (id !== requestId) return;
      items = append ? items.concat(body.items || []) : (body.items || []);
      cursor = body.nextCursor || null;
      hasMore = Boolean(body.hasMore && cursor);
      total = Number(body.total || 0);
      loading = false;
      renderFeed();
      renderCount();
    } catch (error) {
      if (id !== requestId) return;
      loading = false;
      renderFeed({ error: error.message });
    }
  }
  const reload = () => { syncUrl(); renderTabs(); load(false); };

  let moreObserver;
  function observeMore() {
    const target = document.querySelector('#feedMore');
    if (!target || !('IntersectionObserver' in window)) return;
    moreObserver?.disconnect();
    moreObserver = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting) && hasMore && !loading) load(true); }, { rootMargin: '400px 0px' });
    moreObserver.observe(target);
  }

  async function loadTags() {
    const [projects, skills] = await Promise.allSettled([api('/api/v1/tags?dimension=project', { auth: false }), api('/api/v1/tags?dimension=skill', { auth: false })]);
    tags = { project: projects.status === 'fulfilled' ? (projects.value.items || []).map(item => item.name) : [], skill: skills.status === 'fulfilled' ? (skills.value.items || []).map(item => item.name) : [] };
    document.querySelector('#quickTopics').innerHTML = tags.project.slice(0, 8).map(name => `<button class="chip" type="button" data-topic="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join('');
    renderTabs();
  }
  async function loadUnit() { try { const config = await api('/api/v1/points/config', { auth: false }); unitName = config.unitName || unitName; } catch {} }

  /* ---------- saved filters ---------- */
  function renderSaved() {
    const list = document.querySelector('#savedFilters');
    const count = document.querySelector('#savedCount');
    if (!session.loggedIn()) { count.textContent = ''; list.innerHTML = `<p class="hint">登录后可以保存最多 7 组筛选，下次一键打开。</p><a class="btn btn--sm" href="${window.App.loginUrl()}">登录</a>`; return; }
    count.textContent = `${savedFilters.length}/7`;
    list.innerHTML = savedFilters.length
      ? savedFilters.map((item, index) => `<div class="saved-item"><button class="apply" type="button" data-apply="${index}">${escapeHtml(item.name)}</button><button class="remove" type="button" data-delete="${index}" aria-label="删除常用筛选 ${escapeHtml(item.name)}">${icon('x')}</button></div>`).join('')
      : '<p class="hint">在“筛选”里设好条件，点“存为常用”，就会出现在这里。</p>';
  }
  async function loadSaved() {
    if (!session.loggedIn()) { renderSaved(); return; }
    try { const body = await api('/api/v1/saved-filters'); savedFilters = body.items || []; } catch { savedFilters = []; }
    renderSaved();
  }
  function applyFilter(filter = {}) {
    const legacyView = filter.tab === 'digest' ? 'digest' : filter.tab === 'all' ? 'latest' : 'hot';
    Object.assign(state, {
      view: ['hot', 'latest', 'digest'].includes(filter.view) ? filter.view : legacyView,
      keyword: filter.keyword || '',
      project: filter.project || '',
      skill: filter.skill || '',
      date: DATE_OPTIONS.some(([value]) => value === filter.date) ? filter.date : 'all',
      sort: SORT_OPTIONS.some(([value]) => value && value === filter.sort) && !(filter.sort === 'latest' && !filter.view) ? filter.sort : '',
      mode: filter.mode === 'compact' ? 'compact' : state.mode
    });
    reload();
  }
  async function saveCurrentFilter() {
    if (!session.loggedIn()) { window.App.goLogin(); return; }
    if (savedFilters.length >= 7) { toast('最多保存 7 组常用筛选，请先删除一组', 'error'); return; }
    const name = await window.App.prompt({ title: '存为常用筛选', label: '名称', value: filterLabel().slice(0, 30), maxLength: 30, confirmText: '保存' });
    if (!name) return;
    try {
      const item = await api('/api/v1/saved-filters', { method: 'POST', body: { name, filter: { ...state, platform: PLATFORM, tab: TABS[state.view].tab } } });
      savedFilters.push(item); renderSaved(); toast('已存为常用筛选', 'success');
    } catch (error) { toast(error.message, 'error'); }
  }

  /* ---------- filter sheet ---------- */
  function openFilterSheet() {
    const draft = { project: state.project, skill: state.skill, date: state.date, sort: state.sort, mode: state.mode };
    const group = (title, key, options) => `<section class="filter-group"><h3>${title}</h3><div class="chip-row">${options.map(([value, label]) => `<button class="chip" type="button" data-key="${key}" data-value="${escapeHtml(value)}" aria-pressed="${String(draft[key] === value)}">${escapeHtml(label)}</button>`).join('')}</div></section>`;
    const body = document.createElement('div');
    const render = () => {
      body.innerHTML = [
        tags.project.length ? group('方向', 'project', [['', '全部'], ...tags.project.map(name => [name, name])]) : '',
        tags.skill.length ? group('技能', 'skill', [['', '全部'], ...tags.skill.map(name => [name, name])]) : '',
        group('发布时间', 'date', DATE_OPTIONS),
        group('排序', 'sort', SORT_OPTIONS),
        group('阅读模式', 'mode', [['normal', '常规'], ['compact', '精简']])
      ].join('');
    };
    render();
    body.addEventListener('click', event => {
      const chip = event.target.closest('[data-key]');
      if (!chip) return;
      draft[chip.dataset.key] = chip.dataset.value;
      body.querySelectorAll(`[data-key="${chip.dataset.key}"]`).forEach(item => item.setAttribute('aria-pressed', String(item === chip)));
    });
    window.App.modal({
      title: '筛选内容',
      body,
      wide: true,
      actions: [
        { label: '存为常用', onClick: async ({ close }) => { Object.assign(state, draft); syncUrl(); renderTabs(); close(null); load(false); await saveCurrentFilter(); return false; } },
        { label: '重置', onClick: () => { Object.assign(draft, { project: '', skill: '', date: 'all', sort: '', mode: 'normal' }); render(); return false; } },
        { label: '查看结果', primary: true, onClick: () => { Object.assign(state, draft); try { localStorage.setItem('iyesh:feedMode', state.mode); } catch {} reload(); } }
      ]
    });
  }

  /* ---------- events ---------- */
  document.querySelector('#tabs').addEventListener('click', event => {
    const button = event.target.closest('[data-tab]');
    if (!button || button.dataset.tab === state.view) return;
    state.view = button.dataset.tab;
    reload();
  });
  document.querySelector('#tabs').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const order = ['hot', 'latest', 'digest'];
    const next = order[(order.indexOf(state.view) + (event.key === 'ArrowRight' ? 1 : 2)) % 3];
    state.view = next; reload();
    document.querySelector(`#tabs [data-tab="${next}"]`)?.focus();
  });
  document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
    state.mode = button.dataset.mode;
    try { localStorage.setItem('iyesh:feedMode', state.mode); } catch {}
    syncUrl(); renderTabs(); renderFeed();
  }));
  document.querySelector('#openFilters').addEventListener('click', openFilterSheet);
  searchForm.addEventListener('submit', event => {
    event.preventDefault();
    state.keyword = keywordInput.value.trim();
    keywordInput.blur();
    reload();
    document.querySelector('#filterbar').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  keywordInput.addEventListener('input', () => searchForm.classList.toggle('has-value', Boolean(keywordInput.value)));
  document.querySelector('#clearKeyword').addEventListener('click', () => { keywordInput.value = ''; searchForm.classList.remove('has-value'); if (state.keyword) { state.keyword = ''; reload(); } keywordInput.focus(); });
  document.querySelector('#quickTopics').addEventListener('click', event => {
    const chip = event.target.closest('[data-topic]');
    if (!chip) return;
    state.project = state.project === chip.dataset.topic ? '' : chip.dataset.topic;
    reload();
  });
  document.addEventListener('click', event => {
    const remove = event.target.closest('[data-remove]');
    if (remove) {
      const key = remove.dataset.remove;
      if (key === 'all') Object.assign(state, { keyword: '', project: '', skill: '', date: 'all', sort: '' });
      else if (key === 'date') state.date = 'all';
      else state[key] = '';
      reload();
      return;
    }
    if (event.target.closest('[data-retry]')) { load(false); return; }
    if (event.target.closest('[data-more]')) { if (!loading) load(true); return; }
    const shareButton = event.target.closest('[data-share]');
    if (shareButton) {
      const post = items.find(item => String(item.id) === shareButton.dataset.share);
      if (!post) return;
      const author = typeof post.author === 'string' ? { name: post.author } : post.author;
      const access = accessInfo(post, unitName);
      window.Share.open({ id: post.id, title: post.title, excerpt: post.excerpt, author, cover: post.thumbnail || post.coverImage, topics: topicsOf(post), access: { type: access.type, price: access.price, unit: access.unit }, dateText: window.App.dateText(post.publishedAt) });
    }
  });
  document.querySelector('#savedFilters').addEventListener('click', async event => {
    const apply = event.target.closest('[data-apply]');
    if (apply) { const item = savedFilters[Number(apply.dataset.apply)]; if (item) { applyFilter(item.filter || {}); toast(`已打开：${item.name}`); } return; }
    const remove = event.target.closest('[data-delete]');
    if (remove) {
      const item = savedFilters[Number(remove.dataset.delete)];
      if (!item || !(await window.App.confirm({ title: '删除常用筛选', message: `确定删除“${item.name}”吗？`, confirmText: '删除', danger: true }))) return;
      try { await api(`/api/v1/saved-filters/${encodeURIComponent(item.id)}`, { method: 'DELETE' }); savedFilters = savedFilters.filter(entry => entry !== item); renderSaved(); toast('已删除', 'success'); }
      catch (error) { toast(error.message, 'error'); }
    }
  });
  const filterbar = document.querySelector('#filterbar');
  if ('IntersectionObserver' in window) {
    const sentinel = document.createElement('div');
    filterbar.before(sentinel);
    new IntersectionObserver(([entry]) => filterbar.classList.toggle('is-stuck', !entry.isIntersecting), { rootMargin: '-64px 0px 0px 0px' }).observe(sentinel);
  }

  renderTabs();
  loadUnit().finally(() => load(false));
  loadTags();
  loadSaved();
})();
