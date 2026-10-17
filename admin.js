/* 月入万刀 · 运营后台
   单页后台：左侧导航按管理员角色显示，所有写操作都有确认或表单校验，
   不再使用 window.prompt / confirm。 */
(function () {
  'use strict';
  const App = window.App;
  const { icon, escapeHtml, toast, num, dateText, relativeTime } = App;
  const API = App.API;
  const view = document.querySelector('#view');

  let token = '';
  let admin = null;
  try { token = localStorage.getItem('adminAccessToken') || ''; admin = JSON.parse(localStorage.getItem('adminUser') || 'null'); } catch {}
  if (!token) { location.replace('admin-login.html'); return; }

  const cache = { unitName: '积分', overview: null, groups: null, plans: null, tags: null };

  /* ---------------- request ---------------- */
  async function req(path, { method = 'GET', body, timeout = 15000 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const headers = { 'x-admin-token': token };
    let payload = body;
    if (body !== undefined && !(body instanceof FormData)) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    let response;
    try {
      // nginx rate-limits the admin API; a GET refused with 429/503 is retried after a short pause.
      for (let attempt = 0; ; attempt += 1) {
        response = await fetch(`${API}${path}`, { method, headers, body: payload, signal: controller.signal });
        if (method !== 'GET' || attempt >= 2 || (response.status !== 429 && response.status !== 503)) break;
        await new Promise(resolve => setTimeout(resolve, 700 * (attempt + 1)));
      }
    }
    catch (error) { throw new App.ApiError(App.friendlyNetworkError(error), 0); }
    finally { clearTimeout(timer); }
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) { logout(true); throw new App.ApiError('登录已过期，请重新登录', 401); }
    if (!response.ok) throw new App.ApiError(data.message || `请求失败（${response.status}）`, response.status, data);
    return data;
  }
  async function upload(file) {
    const compressed = await App.compressImage(file);
    const form = new FormData();
    form.append('files', compressed, compressed.name || 'image.jpg');
    const data = await req('/api/v1/uploads', { method: 'POST', body: form, timeout: 60000 });
    return data.items?.[0]?.url;
  }
  function logout(expired = false) {
    try { localStorage.removeItem('adminAccessToken'); localStorage.removeItem('adminUser'); } catch {}
    location.replace(`admin-login.html${expired ? '?expired=1' : ''}`);
  }

  /* ---------------- permissions ---------------- */
  const permissions = () => new Set(admin?.permissions || []);
  function can(permission) {
    const list = Array.isArray(permission) ? permission : [permission];
    const owned = permissions();
    return list.some(item => { if (owned.has('*') || owned.has(item)) return true; const [resource, action] = String(item).split('.'); return action === 'read' && owned.has(`${resource}.manage`); });
  }

  /* ---------------- helpers ---------------- */
  const STATUS = {
    pending: ['待审核', 'tag--pending'], published: ['已发布', 'tag--ok'], rejected: ['未通过', 'tag--bad'], draft: ['草稿', 'tag--status'], archived: ['已下线', 'tag--status'],
    active: ['启用', 'tag--ok'], disabled: ['停用', 'tag--bad'], revoked: ['已撤销', 'tag--status'], expired: ['已过期', 'tag--status'],
    unused: ['未使用', 'tag--info'], redeemed: ['已兑换', 'tag--ok'], paid: ['已完成', 'tag--ok'], refunded: ['已退款', 'tag--status'], cancelled: ['已取消', 'tag--status'],
    resolved: ['已处理', 'tag--ok'], deleted: ['已隐藏', 'tag--bad']
  };
  const tag = (status, override) => { const [label, cls] = STATUS[status] || [status || '—', 'tag--status']; return `<span class="tag ${cls}">${escapeHtml(override || label)}</span>`; };
  const when = value => value ? `<span title="${escapeHtml(dateText(value, true))}">${escapeHtml(dateText(value, true))}</span>` : '<span class="sub">—</span>';
  const person = (user, fallbackId) => `<strong>${escapeHtml(user?.name || user?.username || fallbackId || '—')}</strong><span class="sub">${escapeHtml(user?.username ? `@${user.username}` : (user?.id || fallbackId || ''))}</span>`;
  const emptyRow = (cols, text = '暂无记录') => `<tr><td colspan="${cols}" class="table-empty">${escapeHtml(text)}</td></tr>`;
  const unit = () => cache.unitName;
  function card({ title, hint = '', tools = '', body = '', id = '', className = '' }) {
    return `<section class="card ${className}"${id ? ` id="${id}"` : ''}><div class="card-head"><h2>${escapeHtml(title)}</h2>${hint ? `<span class="hint">${hint}</span>` : ''}${tools ? `<div class="tools">${tools}</div>` : ''}</div>${body}</section>`;
  }
  function tableHtml(head, rows, cols) {
    // Only the trailing actions column is right-aligned; numbers stay left so headers and cells line up.
    return `<div class="table-wrap"><table class="data"><thead><tr>${head.map(item => { const label = item.replace(/^>/, ''); return `<th${label === '操作' ? ' class="right"' : ''}>${escapeHtml(label)}</th>`; }).join('')}</tr></thead><tbody>${rows || emptyRow(cols || head.length)}</tbody></table></div>`;
  }
  function errorCard(error, retry = true) {
    return `<div class="card"><div class="card-body"><div class="inline-alert inline-alert--error">${icon('alert')}<span>${escapeHtml(error.message || '加载失败')}</span>${retry ? '<button class="btn btn--sm" type="button" data-reload>重试</button>' : ''}</div></div></div>`;
  }
  function busy(button, on) { if (!button) return; button.classList.toggle('is-loading', on); button.disabled = on; }

  /* A small form builder for dialogs. */
  function fieldHtml(field) {
    const id = `f_${field.name}`;
    const required = field.required ? ' required' : '';
    const value = field.value ?? '';
    const attrs = `${field.min !== undefined ? ` min="${field.min}"` : ''}${field.max !== undefined ? ` max="${field.max}"` : ''}${field.step !== undefined ? ` step="${field.step}"` : ''}${field.maxLength ? ` maxlength="${field.maxLength}"` : ''}${field.placeholder ? ` placeholder="${escapeHtml(field.placeholder)}"` : ''}`;
    let control = '';
    if (field.type === 'textarea') control = `<textarea class="textarea" id="${id}" name="${field.name}" rows="${field.rows || 4}"${required}${attrs}>${escapeHtml(value)}</textarea>`;
    else if (field.type === 'select') control = `<select class="select" id="${id}" name="${field.name}"${required}>${(field.options || []).map(([optionValue, label]) => `<option value="${escapeHtml(optionValue)}"${String(optionValue) === String(value) ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select>`;
    else if (field.type === 'checkbox') return `<label class="check"><input type="checkbox" name="${field.name}"${value ? ' checked' : ''}> ${escapeHtml(field.label)}</label>`;
    else if (field.type === 'checks') return `<div class="field"><span class="label">${escapeHtml(field.label)}${field.hint ? ` <small>${escapeHtml(field.hint)}</small>` : ''}</span><div class="perm-grid">${(field.options || []).map(([optionValue, label]) => `<label class="check"><input type="checkbox" name="${field.name}" value="${escapeHtml(optionValue)}"${(value || []).includes(optionValue) ? ' checked' : ''}> ${escapeHtml(label)}</label>`).join('')}</div></div>`;
    else control = `<input class="input${field.type === 'number' ? ' num' : ''}" id="${id}" name="${field.name}" type="${field.type || 'text'}" value="${escapeHtml(value)}"${required}${attrs}${field.type === 'password' ? ' autocomplete="new-password"' : ''}>`;
    return `<div class="field${field.wide ? ' span-2' : ''}"><label class="label" for="${id}">${escapeHtml(field.label)}${field.hint && field.type !== 'checks' ? ` <small>${escapeHtml(field.hint)}</small>` : ''}</label>${control}</div>`;
  }
  function readForm(form) {
    const data = {};
    for (const element of form.elements) {
      if (!element.name) continue;
      if (element.type === 'checkbox') {
        const group = form.querySelectorAll(`input[type="checkbox"][name="${element.name}"]`);
        if (group.length > 1 || element.value !== 'on') { data[element.name] = [...group].filter(item => item.checked).map(item => item.value); }
        else data[element.name] = element.checked;
      } else if (element.type === 'number') data[element.name] = element.value === '' ? '' : Number(element.value);
      else data[element.name] = element.value.trim();
    }
    return data;
  }
  function formDialog({ title, intro = '', fields, submitText = '保存', danger = false, wide = false, onSubmit }) {
    const form = document.createElement('form');
    form.className = 'form-grid' + (wide ? ' cols-2' : '');
    form.noValidate = true;
    form.innerHTML = `${intro ? `<p class="hint span-2">${intro}</p>` : ''}${fields.map(fieldHtml).join('')}<p class="field-error span-2" hidden></p>`;
    form.addEventListener('submit', event => event.preventDefault());
    return App.modal({ title, body: form, wide, actions: [{ label: '取消', value: null }, { label: submitText, className: danger ? 'btn--danger' : 'btn--primary', onClick: async () => {
      const error = form.querySelector('.field-error');
      error.hidden = true;
      const invalid = [...form.elements].find(element => element.required && !String(element.value).trim());
      if (invalid) { error.textContent = `请填写「${invalid.closest('.field')?.querySelector('.label')?.childNodes[0]?.textContent?.trim() || '必填项'}」`; error.hidden = false; invalid.focus(); return false; }
      try { const result = await onSubmit(readForm(form), form); return result === undefined ? true : result; }
      catch (requestError) { error.textContent = requestError.message; error.hidden = false; return false; }
    } }] });
  }
  async function loadUnit() { try { const config = await req('/api/v1/points/config'); cache.unitName = config.unitName || '积分'; } catch {} }
  async function loadGroups(force = false) { if (!cache.groups || force) { const body = await req('/api/v1/admin/member-groups'); cache.groups = body.items || []; } return cache.groups; }
  async function loadPlans(force = false) { if (!cache.plans || force) { const body = await req('/api/v1/admin/member-plans'); cache.plans = body.items || []; } return cache.plans; }
  async function loadTags(force = false) {
    if (!cache.tags || force) {
      const [platform, project, skill] = await Promise.all(['platform', 'project', 'skill'].map(dimension => App.api(`/api/v1/tags?dimension=${dimension}`, { auth: false })));
      cache.tags = { platform: (platform.items || []).map(item => item.name), project: (project.items || []).map(item => item.name), skill: (skill.items || []).map(item => item.name) };
    }
    return cache.tags;
  }
  const PERMISSION_OPTIONS = [['content.member.read', '阅读会员内容'], ['content.pro.read', '阅读高级会员内容'], ['content.download', '下载资料'], ['content.publish', '发布内容'], ['content.tip', '积分打赏'], ['community.private', '私享社群'], ['support.priority', '优先客服']];

  /* =================================================================
     Views
     ================================================================= */
  const VIEWS = [
    { id: 'overview', title: '总览', icon: 'grid', group: '运营', perm: 'dashboard.read', render: renderOverview },
    { id: 'content', title: '内容审核', icon: 'file', group: '运营', perm: 'content.read', render: renderContent, badge: 'pendingPosts' },
    { id: 'comments', title: '评论与举报', icon: 'comment', group: '运营', perm: 'content.read', render: renderComments, badge: 'reports' },
    { id: 'users', title: '用户', icon: 'users', group: '运营', perm: 'users.read', render: renderUsers },
    { id: 'members', title: '会员与套餐', icon: 'member', group: '商业化', perm: 'membership.read', render: renderMembers },
    { id: 'points', title: '积分与兑换码', icon: 'coin', group: '商业化', perm: 'finance.manage', render: renderPoints },
    { id: 'finance', title: '提现', icon: 'wallet', group: '商业化', perm: 'finance.manage', render: renderFinance, badge: 'pendingWithdrawals' },
    { id: 'referral', title: '分销', icon: 'link', group: '商业化', perm: ['referral.manage', 'finance.manage'], render: renderReferral },
    { id: 'checkin', title: '签到', icon: 'calendar', group: '商业化', perm: ['checkin.manage', 'finance.manage', 'system.settings'], render: renderCheckin },
    { id: 'messages', title: '站内信', icon: 'bell', group: '系统', perm: 'notifications.manage', render: renderMessages },
    { id: 'tags', title: '标签', icon: 'flag', group: '系统', perm: 'content.read', render: renderTags },
    { id: 'admins', title: '管理员', icon: 'user', group: '系统', perm: 'system.admins', render: renderAdmins },
    { id: 'system', title: '系统设置', icon: 'settings', group: '系统', perm: ['system.settings', 'finance.manage'], render: renderSystem },
    { id: 'logs', title: '订单与日志', icon: 'clock', group: '系统', perm: 'system.audit', render: renderLogs }
  ];
  const LEGACY = { members: 'members', finance: 'finance' };
  let current = null;

  function renderNav() {
    const groups = [...new Set(VIEWS.map(item => item.group))];
    document.querySelector('#adminNav').innerHTML = groups.map(group => {
      const items = VIEWS.filter(item => item.group === group && can(item.perm));
      if (!items.length) return '';
      return `<h3>${escapeHtml(group)}</h3>${items.map(item => { const count = item.badge && cache.overview ? Number(cache.overview[item.badge] || 0) : 0; return `<a href="#${item.id}" data-view="${item.id}"${current?.id === item.id ? ' aria-current="page"' : ''}>${icon(item.icon)}<span>${escapeHtml(item.title)}</span>${count ? `<span class="count">${count > 99 ? '99+' : count}</span>` : ''}</a>`; }).join('')}`;
    }).join('');
  }
  // Overview numbers feed both the sidebar badges and the overview page; share one request.
  let overviewRequest = null, overviewRequestedAt = 0;
  function fetchOverview(fresh = false) {
    if (fresh || !overviewRequest || Date.now() - overviewRequestedAt > 3000) {
      overviewRequestedAt = Date.now();
      overviewRequest = req('/api/v1/admin/overview');
      overviewRequest.catch(() => { overviewRequest = null; });
    }
    return overviewRequest;
  }
  async function refreshOverview() {
    if (!can('dashboard.read')) return;
    try { cache.overview = await fetchOverview(true); renderNav(); } catch {}
  }
  async function show(id, { silent = false } = {}) {
    const target = VIEWS.find(item => item.id === id && can(item.perm)) || VIEWS.find(item => can(item.perm));
    if (!target) { view.innerHTML = '<div class="card forbidden">当前账号没有可用的后台权限。</div>'; return; }
    current = target;
    document.querySelector('#viewTitle').textContent = target.title;
    document.title = `${target.title} · 运营后台 · 月入万刀`;
    renderNav();
    closeSide();
    if (location.hash.slice(1) !== target.id) history.replaceState(null, '', `#${target.id}`);
    if (!silent) { view.innerHTML = '<div class="card"><div class="card-body" style="display:flex;justify-content:center;padding:48px"><span class="spinner"></span></div></div>'; window.scrollTo(0, 0); }
    try { await target.render(); } catch (error) { view.innerHTML = errorCard(error); }
  }
  const rerender = () => show(current.id, { silent: true });

  /* ---------------- overview ---------------- */
  async function renderOverview() {
    const data = await fetchOverview();
    cache.overview = data; renderNav();
    const kpi = (label, value, sub = '', href = '', alert = false) => `<div class="kpi${alert ? ' is-alert' : ''}"><span>${escapeHtml(label)}</span><strong>${num(value)}</strong>${sub ? `<small>${escapeHtml(sub)}</small>` : ''}${href ? `<a href="${href}" aria-label="${escapeHtml(label)}"></a>` : ''}</div>`;
    const todo = (label, count, href, show = true) => show ? `<a href="${href}"><span class="n${count ? '' : ' zero'}">${num(count)}</span><span>${escapeHtml(label)}</span>${icon('next')}</a>` : '';
    view.innerHTML = `
      <p class="view-intro">你好，${escapeHtml(admin?.name || '管理员')}。这里是今天需要处理的事情和关键数据。</p>
      <div class="kpis">
        ${kpi('待审核内容', data.pendingPosts, '投稿等待审核', '#content', data.pendingPosts > 0)}
        ${kpi('待处理举报', data.reports, '内容与评论', '#comments', data.reports > 0)}
        ${kpi('待处理提现', data.pendingWithdrawals, '需人工打款', '#finance', data.pendingWithdrawals > 0)}
        ${kpi('注册用户', data.users, `近 7 天新增 ${num(data.newUsers7d)}`, can('users.read') ? '#users' : '')}
        ${kpi('已发布内容', data.publishedPosts, `近 7 天发布 ${num(data.posts7d)}`, '#content')}
        ${kpi('有效会员', data.memberships, '', can('membership.read') ? '#members' : '')}
        ${kpi(`流通${unit()}`, data.pointsInCirculation, `打赏累计 ${num(data.tipsPoints)}`)}
        ${kpi('今日签到', data.checkinsToday, '')}
      </div>
      <div class="two-col">
        ${card({ title: '待办', body: `<div class="todo-list">${todo('篇投稿等待审核', data.pendingPosts, '#content', can('content.read'))}${todo('条举报等待处理', data.reports, '#comments', can('content.read'))}${todo('笔提现等待打款', data.pendingWithdrawals, '#finance', can('finance.manage'))}</div>` })}
        ${card({ title: '快捷操作', body: `<div class="card-body" style="display:flex;flex-wrap:wrap;gap:10px">${can('content.manage') ? `<button class="btn" type="button" data-quick="post">${icon('edit')}新建内容</button>` : ''}${can('finance.manage') ? `<button class="btn" type="button" data-quick="cdkey">${icon('gift')}生成兑换码</button>` : ''}${can('notifications.manage') ? `<button class="btn" type="button" data-quick="message">${icon('bell')}发站内信</button>` : ''}${can('membership.manage') ? `<button class="btn" type="button" data-quick="grant">${icon('member')}手动开通会员</button>` : ''}</div>` })}
      </div>`;
  }

  /* ---------------- content ---------------- */
  const contentState = { status: 'pending', q: '' };
  async function renderContent() {
    const query = new URLSearchParams({ pageSize: '100' });
    if (contentState.status) query.set('status', contentState.status);
    if (contentState.q) query.set('q', contentState.q);
    const data = await req(`/api/v1/admin/posts?${query}`);
    const counts = data.statusCounts || {};
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    const tabs = [['pending', '待审核'], ['published', '已发布'], ['rejected', '未通过'], ['draft', '草稿'], ['archived', '已下线'], ['', '全部']];
    const rows = (data.items || []).map(post => {
      const access = post.accessType === 'paid' ? `<span class="tag tag--paid">${num(post.pricePoints)} ${escapeHtml(unit())}</span>` : post.accessType === 'member' ? '<span class="tag tag--member">会员</span>' : '<span class="tag tag--free">免费</span>';
      const topics = [post.project, post.skill].filter(value => value && value !== '未分类');
      const actions = [];
      if (can('content.manage')) {
        if (post.status === 'pending') actions.push(`<button class="btn btn--sm btn--primary" type="button" data-post-act="publish" data-id="${escapeHtml(post.id)}">通过</button><button class="btn btn--sm btn--danger" type="button" data-post-act="reject" data-id="${escapeHtml(post.id)}">驳回</button>`);
        if (post.status === 'published') actions.push(`<button class="btn btn--sm" type="button" data-post-act="digest" data-id="${escapeHtml(post.id)}">${post.digest ? '取消精华' : '设为精华'}</button>`);
      }
      actions.push(`<button class="btn btn--sm btn--ghost" type="button" data-post-act="preview" data-id="${escapeHtml(post.id)}">查看</button>`);
      return `<tr class="is-clickable" data-row-post="${escapeHtml(post.id)}"><td class="title-cell"><strong>${post.digest ? '<span class="tag tag--digest">精华</span> ' : ''}${escapeHtml(post.title || '未命名')}</strong><span class="sub">${escapeHtml(post.author?.name || '—')}　${escapeHtml(post.status === 'published' ? `${dateText(post.publishedAt, true)} 发布` : `${dateText(post.submittedAt || post.updatedAt, true)} 提交`)}${post.pendingReports ? `　<b style="color:var(--danger)">${post.pendingReports} 条举报</b>` : ''}</span></td><td class="nowrap">${topics.length ? escapeHtml(topics.join(' / ')) : '<span class="sub">未分类</span>'}</td><td>${access}</td><td class="num">${num(post.counts?.likes)} / ${num(post.counts?.comments)}</td><td>${tag(post.status)}</td><td><div class="actions">${actions.join('')}</div></td></tr>`;
    }).join('');
    view.innerHTML = card({
      title: '内容',
      hint: '点任意一行查看全文与审核',
      tools: can('content.manage') ? `<button class="btn btn--sm btn--primary" type="button" data-quick="post">${icon('plus')}新建内容</button>` : '',
      body: `<div class="toolbar"><div class="status-tabs" role="group" aria-label="状态">${tabs.map(([value, label]) => `<button type="button" data-content-status="${value}" aria-pressed="${contentState.status === value}">${label}<span class="n">${num(value ? counts[value] || 0 : total)}</span></button>`).join('')}</div><form class="search" data-search="content">${icon('search')}<input class="input" name="q" type="search" placeholder="搜索标题、作者、ID" value="${escapeHtml(contentState.q)}"></form></div>${tableHtml(['标题', '分类', '权限', '赞 / 评', '状态', '>操作'], rows)}`
    });
  }
  async function previewPost(id) {
    const post = await req(`/api/v1/admin/posts/${encodeURIComponent(id)}`);
    const html = String(post.contentHtml || '').replace(/src="(\/uploads\/[^"]+)"/g, (_, url) => `src="${escapeHtml(App.mediaUrl(url))}"`);
    const access = post.accessType === 'paid' ? `积分解锁 ${num(post.pricePoints)} ${unit()}` : post.accessType === 'member' ? '会员专享' : '免费';
    const body = `<article class="preview-box">${tag(post.status)} ${post.digest ? '<span class="tag tag--digest">精华</span>' : ''}<h1 style="margin-top:10px">${escapeHtml(post.title)}</h1>
      <div class="preview-meta"><span>作者：${escapeHtml(post.author?.name || '—')}</span><span>${escapeHtml(access)}</span><span>${escapeHtml([post.project, post.skill].filter(value => value && value !== '未分类').join(' / ') || '未分类')}</span><span>${escapeHtml(dateText(post.submittedAt || post.publishedAt, true))}</span>${post.reports ? `<span style="color:var(--danger)">${post.reports} 条举报</span>` : ''}</div>
      ${post.rejectionReason && post.status === 'rejected' ? `<p class="inline-alert inline-alert--error">${icon('alert')}<span>驳回原因：${escapeHtml(post.rejectionReason)}</span></p>` : ''}
      ${post.excerpt ? `<p class="article-excerpt" style="margin-top:12px">${escapeHtml(post.excerpt)}</p>` : ''}
      <div class="prose">${html || '<p class="hint">正文为空</p>'}</div></article>`;
    const actions = [{ label: '关闭', value: null }];
    if (can('content.manage')) {
      actions.unshift({ label: '编辑', onClick: () => { setTimeout(() => editPost(post), 50); return true; } });
      if (post.status === 'published') actions.unshift({ label: '下线', className: 'btn--danger', onClick: async () => { if (await postAction('archive', post)) return true; return false; } });
      if (['archived', 'rejected', 'draft'].includes(post.status)) actions.push({ label: '发布', primary: true, onClick: async () => postAction('publish', post) });
      if (post.status === 'pending') { actions.push({ label: '驳回', className: 'btn--danger', onClick: async () => postAction('reject', post) }); actions.push({ label: '通过并发布', primary: true, onClick: async () => postAction('publish', post) }); }
      if (post.status === 'published') actions.push({ label: post.digest ? '取消精华' : '设为精华', primary: true, onClick: async () => postAction('digest', post) });
    }
    await App.modal({ title: '内容详情', body, drawer: true, actions, onOpen: ({ body: node }) => node.querySelectorAll('.prose img').forEach(image => image.addEventListener('click', () => App.viewImage(image.src))) });
  }
  async function postAction(action, post) {
    try {
      if (action === 'publish') { await req(`/api/v1/admin/posts/${encodeURIComponent(post.id)}`, { method: 'PATCH', body: { status: 'published' } }); toast('已发布，作者会收到通知', 'success'); }
      if (action === 'reject') {
        const reason = await App.prompt({ title: '驳回投稿', label: '驳回原因（作者可见）', presets: ['内容过短或不完整', '涉嫌广告引流', '与平台方向无关', '存在侵权风险'], maxLength: 200, confirmText: '确认驳回' });
        if (!reason) return false;
        await req(`/api/v1/admin/posts/${encodeURIComponent(post.id)}`, { method: 'PATCH', body: { status: 'rejected', rejectionReason: reason } });
        toast('已驳回，作者会收到原因', 'success');
      }
      if (action === 'digest') { await req(`/api/v1/admin/posts/${encodeURIComponent(post.id)}`, { method: 'PATCH', body: { digest: !post.digest } }); toast(post.digest ? '已取消精华' : '已设为精华', 'success'); }
      if (action === 'archive') {
        if (!(await App.confirm({ title: '下线内容', message: `《${post.title}》下线后将不再公开，已购用户也无法再访问。`, confirmText: '下线', danger: true }))) return false;
        await req(`/api/v1/admin/posts/${encodeURIComponent(post.id)}`, { method: 'DELETE' }); toast('已下线', 'success');
      }
      refreshOverview();
      if (current?.id === 'content') rerender();
      return true;
    } catch (error) { toast(error.message, 'error'); return false; }
  }
  async function editPost(post = null) {
    const [tags, plans] = await Promise.all([loadTags(), loadPlans().catch(() => [])]);
    const isNew = !post;
    const originalPlanIds = (post?.memberPlanIds || []).map(String);
    // Active plans plus any plan the post is already limited to (even if it has since been archived).
    const planOptions = plans.filter(plan => plan.status !== 'archived' || originalPlanIds.includes(String(plan.id))).map(plan => [String(plan.id), plan.status === 'archived' ? `${plan.name}（已停售）` : plan.name]);
    const inlineImages = text => [...String(text || '').matchAll(/!\[[^\]\n]*\]\((\/uploads\/[^)\s]+)\)/g)].map(match => match[1]);
    const originalInline = inlineImages(post?.content);
    const fields = [
      { name: 'title', label: '标题', required: true, value: post?.title || '', maxLength: 200, wide: true },
      ...(isNew ? [{ name: 'authorName', label: '作者显示名', value: '月入万刀编辑部', maxLength: 40 }] : []),
      { name: 'project', label: '方向', type: 'select', value: post?.project || '', options: [['', '未分类'], ...tags.project.map(name => [name, name])] },
      { name: 'skill', label: '技能', type: 'select', value: post?.skill || '', options: [['', '未分类'], ...tags.skill.map(name => [name, name])] },
      { name: 'accessType', label: '谁可以看', type: 'select', value: post?.accessType || 'free', options: [['free', '免费公开'], ['member', '会员专享'], ['paid', '积分解锁']] },
      { name: 'pricePoints', label: `解锁价格（${unit()}）`, type: 'number', min: 0, step: 1, value: post?.pricePoints || '', hint: '仅积分解锁时有效' },
      ...(planOptions.length ? [{ name: 'memberPlanIds', label: '限定会员套餐', type: 'checks', value: originalPlanIds, options: planOptions, hint: '仅会员专享时有效，都不选表示所有会员可看' }] : []),
      { name: 'excerpt', label: '摘要', type: 'textarea', rows: 2, value: post?.excerpt || '', maxLength: 300, wide: true },
      { name: 'content', label: '正文', type: 'textarea', rows: 12, value: post?.content || '', wide: true, hint: '空行分段；## 小标题；- 列表；> 引用；**加粗**' },
      { name: 'digest', label: '设为精华', type: 'checkbox', value: Boolean(post?.digest) }
    ];
    await formDialog({
      title: isNew ? '新建内容' : '编辑内容',
      intro: isNew ? '后台新建的内容会直接发布。' : '',
      fields, wide: true, submitText: isNew ? '发布' : '保存修改',
      onSubmit: async data => {
        if (data.accessType === 'paid' && !(Number(data.pricePoints) >= 1)) throw new Error('积分解锁需要设置至少 1 的价格');
        // Images removed from the text are dropped; older posts whose images were never
        // placed in the text keep them.
        const legacyImages = (post?.images || []).filter(url => !originalInline.includes(url));
        const images = [...new Set([...inlineImages(data.content), ...legacyImages])];
        const payload = { title: data.title, excerpt: data.excerpt, content: data.content, project: data.project || '未分类', skill: data.skill || '未分类', accessType: data.accessType, pricePoints: Number(data.pricePoints || 0), digest: data.digest, images };
        // Only send the plan list when the admin actually changed it, so editing text never
        // narrows or widens who can read the post.
        const selectedPlans = Array.isArray(data.memberPlanIds) ? data.memberPlanIds : originalPlanIds;
        const plansChanged = selectedPlans.length !== originalPlanIds.length || selectedPlans.some(planId => !originalPlanIds.includes(planId));
        if (data.accessType === 'member' && (isNew || plansChanged)) payload.memberPlanIds = selectedPlans;
        if (isNew) await req('/api/v1/admin/posts', { method: 'POST', body: { ...payload, authorName: data.authorName, platform: 'YouTube' } });
        else await req(`/api/v1/admin/posts/${encodeURIComponent(post.id)}`, { method: 'PATCH', body: payload });
        toast(isNew ? '内容已发布' : '修改已保存', 'success');
        if (current?.id === 'content') rerender();
      }
    });
  }
  // Image insertion for the content field inside the edit dialog.
  document.addEventListener('focusin', event => {
    const area = event.target.closest?.('textarea[name="content"]');
    if (!area || area.dataset.enhanced) return;
    area.dataset.enhanced = '1';
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:8px;margin-top:8px';
    bar.innerHTML = `<button class="btn btn--sm" type="button">${icon('image')}插入图片</button><input type="file" accept="image/*" hidden>`;
    area.after(bar);
    const input = bar.querySelector('input');
    bar.querySelector('button').addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const file = input.files?.[0]; input.value = '';
      if (!file) return;
      const button = bar.querySelector('button'); busy(button, true);
      try {
        const url = await upload(file);
        const position = area.selectionStart ?? area.value.length;
        const insert = `\n\n![](${url})\n\n`;
        area.value = `${area.value.slice(0, position).trimEnd()}${insert}${area.value.slice(position).trimStart()}`;
        toast('图片已插入', 'success');
      } catch (error) { toast(error.message, 'error'); } finally { busy(button, false); }
    });
  });

  /* ---------------- comments & reports ---------------- */
  async function renderComments() {
    const [reports, commentReports, comments] = await Promise.all([
      req('/api/v1/admin/reports?status=pending&pageSize=100'),
      req('/api/v1/admin/comment-reports?status=pending&pageSize=100'),
      req('/api/v1/admin/comments?pageSize=100')
    ]);
    const manage = can('content.manage');
    const reportRows = (reports.items || []).map(item => `<tr><td class="title-cell"><strong>${escapeHtml(item.post?.title || item.postId)}</strong><span class="sub">${escapeHtml(item.post?.status ? (STATUS[item.post.status]?.[0] || item.post.status) : '')}</span></td><td>${escapeHtml(item.detail || item.reason || '—')}</td><td>${when(item.createdAt)}</td><td><div class="actions">${manage ? `<button class="btn btn--sm btn--danger" type="button" data-report="archive" data-id="${escapeHtml(item.id)}" data-post="${escapeHtml(item.postId)}">下线内容</button><button class="btn btn--sm" type="button" data-report="resolve" data-id="${escapeHtml(item.id)}">已处理</button><button class="btn btn--sm btn--ghost" type="button" data-report="reject" data-id="${escapeHtml(item.id)}">驳回</button>` : ''}<button class="btn btn--sm btn--ghost" type="button" data-post-act="preview" data-id="${escapeHtml(item.postId)}">查看</button></div></td></tr>`).join('');
    const commentReportRows = (commentReports.items || []).map(item => `<tr><td class="title-cell"><strong>${escapeHtml(item.comment?.content || '（评论已删除）')}</strong><span class="sub">${escapeHtml(item.comment?.user?.name || '')}　来自《${escapeHtml(item.post?.title || item.postId)}》</span></td><td>${escapeHtml(item.detail || item.reason || '—')}</td><td>${when(item.createdAt)}</td><td><div class="actions">${manage ? `<button class="btn btn--sm btn--danger" type="button" data-creport="hide" data-id="${escapeHtml(item.id)}" data-comment="${escapeHtml(item.commentId)}">隐藏评论</button><button class="btn btn--sm btn--ghost" type="button" data-creport="reject" data-id="${escapeHtml(item.id)}">驳回</button>` : ''}</div></td></tr>`).join('');
    const commentRows = (comments.items || []).map(item => `<tr data-comment-row="${escapeHtml(`${item.content} ${item.user?.name || ''}`.toLowerCase())}"><td class="title-cell"><strong>${escapeHtml(item.content)}</strong><span class="sub">${item.parentId ? '回复　' : ''}${escapeHtml(item.postId)}</span></td><td>${escapeHtml(item.user?.name || '—')}</td><td>${when(item.createdAt)}</td><td>${tag(item.status === 'deleted' ? 'deleted' : 'published', item.status === 'deleted' ? '已隐藏' : '显示中')}</td><td><div class="actions">${manage ? (item.status === 'deleted' ? `<button class="btn btn--sm" type="button" data-comment-act="restore" data-id="${escapeHtml(item.id)}">恢复</button>` : `<button class="btn btn--sm btn--danger" type="button" data-comment-act="hide" data-id="${escapeHtml(item.id)}">隐藏</button>`) : ''}</div></td></tr>`).join('');
    view.innerHTML = [
      card({ title: '内容举报', hint: `${num(reports.total || 0)} 条待处理`, body: tableHtml(['内容', '举报原因', '时间', '>操作'], reportRows) }),
      card({ title: '评论举报', hint: `${num(commentReports.total || 0)} 条待处理`, body: tableHtml(['评论', '举报原因', '时间', '>操作'], commentReportRows) }),
      card({ title: '全部评论', hint: '最近 100 条', body: `<div class="toolbar"><form class="search" data-search="comments-local">${icon('search')}<input class="input" name="q" type="search" placeholder="按内容或作者筛选"></form></div>${tableHtml(['评论', '作者', '时间', '状态', '>操作'], commentRows)}` })
    ].join('');
  }

  /* ---------------- users ---------------- */
  const userState = { q: '', status: '' };
  async function renderUsers() {
    const query = new URLSearchParams({ pageSize: '100' });
    if (userState.q) query.set('q', userState.q);
    if (userState.status) query.set('status', userState.status);
    const data = await req(`/api/v1/admin/users?${query}`);
    const manage = can('users.manage');
    const rows = (data.items || []).map(user => `<tr><td>${person(user)}<span class="sub">${escapeHtml(user.email || '')}</span></td><td>${when(user.createdAt)}</td><td>${user.lastLoginAt ? escapeHtml(relativeTime(user.lastLoginAt)) : '<span class="sub">—</span>'}</td><td class="num">${num(user.points)}</td><td>${user.membership ? `<span class="tag tag--member">${escapeHtml(user.membership.groupName)}</span><span class="sub">至 ${escapeHtml(dateText(user.membership.endsAt))}</span>` : '<span class="sub">—</span>'}</td><td>${tag(user.status || 'active', user.status === 'disabled' ? '已停用' : '正常')}</td><td><div class="actions">${can('finance.manage') ? `<button class="btn btn--sm" type="button" data-user-act="points" data-id="${escapeHtml(user.id)}" data-name="${escapeHtml(user.name)}">充值</button>` : ''}${can('membership.manage') ? `<button class="btn btn--sm" type="button" data-user-act="grant" data-id="${escapeHtml(user.id)}" data-name="${escapeHtml(user.name)}">开会员</button>` : ''}${can('notifications.manage') ? `<button class="btn btn--sm" type="button" data-user-act="message" data-id="${escapeHtml(user.id)}" data-name="${escapeHtml(user.name)}">发消息</button>` : ''}${manage ? `<button class="btn btn--sm ${user.status === 'disabled' ? '' : 'btn--danger'}" type="button" data-user-act="${user.status === 'disabled' ? 'enable' : 'disable'}" data-id="${escapeHtml(user.id)}" data-name="${escapeHtml(user.name)}">${user.status === 'disabled' ? '启用' : '停用'}</button>` : ''}</div></td></tr>`).join('');
    view.innerHTML = card({
      title: '用户',
      hint: `共 ${num(data.total || 0)} 人`,
      body: `<div class="toolbar"><form class="search" data-search="users">${icon('search')}<input class="input" name="q" type="search" placeholder="搜索用户名、昵称、邮箱或 ID" value="${escapeHtml(userState.q)}"></form><select class="select" data-user-status aria-label="状态"><option value="">全部状态</option><option value="active"${userState.status === 'active' ? ' selected' : ''}>正常</option><option value="disabled"${userState.status === 'disabled' ? ' selected' : ''}>已停用</option></select></div>${tableHtml(['用户', '注册时间', '最近登录', `>${unit()}`, '会员', '状态', '>操作'], rows)}`
    });
  }
  function rechargeDialog(userId = '', name = '') {
    return formDialog({ title: `充值${unit()}`, intro: name ? `为 <strong>${escapeHtml(name)}</strong> 充值，记录不可删除。` : '线下收款后为用户充值，记录不可删除。', fields: [
      { name: 'userId', label: '用户 ID', required: true, value: userId, placeholder: 'user_xxx' },
      { name: 'points', label: `充值数量（${unit()}）`, type: 'number', required: true, min: 1, step: 1 },
      { name: 'source', label: '来源', value: '线下充值', required: true, maxLength: 40 },
      { name: 'note', label: '备注', required: true, placeholder: '例如：微信转账，流水号后四位 1234', maxLength: 200 }
    ], submitText: '确认充值', onSubmit: async data => {
      if (!Number.isInteger(data.points) || data.points < 1) throw new Error('充值数量需为正整数');
      await req('/api/v1/admin/points/recharge', { method: 'POST', body: data });
      toast(`已充值 ${num(data.points)} ${unit()}`, 'success');
      if (['users', 'points'].includes(current?.id)) rerender();
    } });
  }
  async function grantDialog(userId = '', name = '') {
    const [groups, plans] = await Promise.all([loadGroups(), loadPlans()]);
    const activeGroups = groups.filter(group => group.status !== 'archived');
    return formDialog({ title: '手动开通会员', intro: name ? `为 <strong>${escapeHtml(name)}</strong> 开通，操作会记入日志。` : '线下收款后为用户开通会员，操作会记入日志。', fields: [
      { name: 'userId', label: '用户 ID', required: true, value: userId },
      { name: 'groupId', label: '会员等级', type: 'select', required: true, value: activeGroups[0]?.id || '', options: activeGroups.map(group => [group.id, group.name]) },
      { name: 'planId', label: '对应套餐', type: 'select', value: '', options: [['', '不关联套餐'], ...plans.filter(plan => plan.status !== 'archived').map(plan => [plan.id, `${plan.name}（${plan.durationDays} 天）`])] },
      { name: 'durationDays', label: '有效期（天）', type: 'number', min: 1, value: 30, required: true },
      { name: 'note', label: '收款备注', placeholder: '例如：微信转账 2026-10-17', maxLength: 200 }
    ], submitText: '确认开通', onSubmit: async data => {
      await req('/api/v1/admin/memberships/grant', { method: 'POST', body: { ...data, durationDays: Number(data.durationDays || 30) } });
      toast('会员已开通', 'success');
      if (['users', 'members'].includes(current?.id)) rerender();
    } });
  }
  function messageDialog(userId = '', name = '') {
    return formDialog({ title: '发送站内信', intro: name ? `发给 <strong>${escapeHtml(name)}</strong>` : '', fields: [
      { name: 'userIds', label: '用户 ID', required: true, value: userId, hint: '多个用逗号分隔' },
      { name: 'title', label: '标题', required: true, maxLength: 80 },
      { name: 'body', label: '内容', type: 'textarea', rows: 4, required: true, maxLength: 500 }
    ], submitText: '发送', onSubmit: async data => {
      const result = await req('/api/v1/admin/notifications', { method: 'POST', body: { scope: 'users', userIds: data.userIds.split(/[，,\s]+/).filter(Boolean), title: data.title, body: data.body } });
      toast(`已发送给 ${num(result.recipientCount)} 位用户`, 'success');
      if (current?.id === 'messages') rerender();
    } });
  }

  /* ---------------- members ---------------- */
  const memberState = { q: '' };
  async function renderMembers() {
    const [groups, plans, memberships] = await Promise.all([loadGroups(true), loadPlans(true), req('/api/v1/admin/memberships?pageSize=100')]);
    const manage = can('membership.manage');
    const groupName = id => groups.find(group => group.id === id)?.name || id || '—';
    const groupRows = groups.map(group => `<tr><td><strong>${escapeHtml(group.name)}</strong><span class="sub">${escapeHtml(group.code)}　${escapeHtml(group.description || '')}</span></td><td>${(group.permissions || []).map(code => `<span class="tag tag--info" style="margin:2px">${escapeHtml(PERMISSION_OPTIONS.find(([value]) => value === code)?.[1] || code)}</span>`).join('') || '<span class="sub">—</span>'}</td><td class="num">${num(group.initialPoints)}</td><td class="num">${num(group.rank)}</td><td>${tag(group.status)}</td><td><div class="actions">${manage ? `<button class="btn btn--sm" type="button" data-group-edit="${escapeHtml(group.id)}">编辑</button>${group.status !== 'archived' ? `<button class="btn btn--sm btn--ghost" type="button" data-group-archive="${escapeHtml(group.id)}">归档</button>` : ''}` : ''}</div></td></tr>`).join('');
    const planRows = plans.map(plan => `<tr><td><strong>${escapeHtml(plan.name)}</strong><span class="sub">${escapeHtml(plan.description || '')}</span></td><td>${escapeHtml(groupName(plan.groupId))}</td><td class="num">${num(plan.redeemPoints ?? plan.pricePoints)} ${escapeHtml(unit())}</td><td class="num">${num(plan.durationDays)} 天</td><td class="num">${num(plan.initialPoints)}</td><td>${tag(plan.status)}</td><td><div class="actions">${manage ? `<button class="btn btn--sm" type="button" data-plan-edit="${escapeHtml(plan.id)}">编辑</button>${plan.status === 'active' ? `<button class="btn btn--sm btn--ghost" type="button" data-plan-status="disabled" data-id="${escapeHtml(plan.id)}">停售</button>` : plan.status === 'disabled' ? `<button class="btn btn--sm" type="button" data-plan-status="active" data-id="${escapeHtml(plan.id)}">恢复</button>` : ''}` : ''}</div></td></tr>`).join('');
    const q = memberState.q.toLowerCase();
    const memberRows = (memberships.items || []).filter(item => !q || [item.userId, item.user?.name, item.user?.username, item.groupName, item.planName].some(value => String(value || '').toLowerCase().includes(q))).map(item => `<tr><td>${person(item.user, item.userId)}</td><td>${escapeHtml(item.groupName || groupName(item.groupId))}</td><td>${escapeHtml(item.planName || '线下开通')}</td><td>${escapeHtml(dateText(item.startsAt))} 至 ${escapeHtml(dateText(item.endsAt))}</td><td>${tag(item.status)}</td><td><div class="actions">${manage && item.status === 'active' ? `<button class="btn btn--sm btn--danger" type="button" data-revoke="${escapeHtml(item.id)}">撤销</button>` : ''}</div></td></tr>`).join('');
    view.innerHTML = [
      card({ title: '会员套餐', hint: '用户在会员中心看到并用积分开通', tools: manage ? `<button class="btn btn--sm btn--primary" type="button" data-plan-edit="">${icon('plus')}新增套餐</button>` : '', body: tableHtml(['套餐', '会员等级', '开通价格', '有效期', `>赠送${unit()}`, '状态', '>操作'], planRows) }),
      card({ title: '会员等级与权限', hint: '等级决定用户能看哪些内容', tools: manage ? `<button class="btn btn--sm" type="button" data-group-edit="">${icon('plus')}新增等级</button>` : '', body: tableHtml(['等级', '权限', `>首开赠送`, '>排序', '状态', '>操作'], groupRows) }),
      card({ title: '已开通会员', tools: manage ? `<button class="btn btn--sm btn--primary" type="button" data-quick="grant">${icon('member')}手动开通</button>` : '', body: `<div class="toolbar"><form class="search" data-search="members">${icon('search')}<input class="input" name="q" type="search" placeholder="按用户或等级筛选" value="${escapeHtml(memberState.q)}"></form></div>${tableHtml(['用户', '等级', '套餐', '有效期', '状态', '>操作'], memberRows)}` })
    ].join('');
  }
  async function editGroup(id) {
    const group = id ? (await loadGroups()).find(item => item.id === id) : null;
    await formDialog({ title: group ? '编辑会员等级' : '新增会员等级', wide: true, fields: [
      { name: 'name', label: '名称', required: true, value: group?.name || '', maxLength: 40 },
      { name: 'code', label: '编码', required: true, value: group?.code || '', hint: '英文，例如 pro', maxLength: 40 },
      { name: 'description', label: '说明', value: group?.description || '', maxLength: 200, wide: true },
      { name: 'rank', label: '排序', type: 'number', min: 0, value: group?.rank ?? 10 },
      { name: 'initialPoints', label: `首次开通赠送${unit()}`, type: 'number', min: 0, value: group?.initialPoints ?? 0 },
      { name: 'status', label: '状态', type: 'select', value: group?.status || 'active', options: [['active', '启用'], ['disabled', '停用']] },
      { name: 'permissions', label: '权限', type: 'checks', value: group?.permissions || ['content.member.read'], options: PERMISSION_OPTIONS, wide: true }
    ], onSubmit: async data => {
      const body = { ...data, rank: Number(data.rank || 0), initialPoints: Number(data.initialPoints || 0) };
      if (group) await req(`/api/v1/admin/member-groups/${encodeURIComponent(group.id)}`, { method: 'PATCH', body });
      else await req('/api/v1/admin/member-groups', { method: 'POST', body });
      cache.groups = null; toast('会员等级已保存', 'success'); rerender();
    } });
  }
  async function editPlan(id) {
    const [groups, plans] = await Promise.all([loadGroups(), loadPlans()]);
    const plan = id ? plans.find(item => item.id === id) : null;
    await formDialog({ title: plan ? '编辑套餐' : '新增套餐', wide: true, fields: [
      { name: 'name', label: '套餐名称', required: true, value: plan?.name || '', maxLength: 60 },
      { name: 'groupId', label: '会员等级', type: 'select', required: true, value: plan?.groupId || groups[0]?.id || '', options: groups.filter(group => group.status !== 'archived').map(group => [group.id, group.name]) },
      { name: 'redeemPoints', label: `开通价格（${unit()}）`, type: 'number', min: 0, required: true, value: plan?.redeemPoints ?? '' },
      { name: 'durationDays', label: '有效期（天）', type: 'number', min: 1, max: 3650, required: true, value: plan?.durationDays ?? 30 },
      { name: 'initialPoints', label: `开通赠送${unit()}`, type: 'number', min: 0, value: plan?.initialPoints ?? 0 },
      { name: 'priceCents', label: '线下参考价（分）', type: 'number', min: 0, value: plan?.priceCents ?? 0, hint: '仅后台记录' },
      { name: 'description', label: '一句话说明', value: plan?.description || '', maxLength: 200, wide: true },
      { name: 'benefits', label: '权益列表', type: 'textarea', rows: 3, value: (plan?.benefits || []).join('\n'), hint: '每行一条', wide: true },
      { name: 'sort', label: '排序', type: 'number', min: 0, value: plan?.sort ?? plans.length + 1 }
    ], onSubmit: async data => {
      const body = { ...data, redeemPoints: Number(data.redeemPoints || 0), durationDays: Number(data.durationDays || 30), initialPoints: Number(data.initialPoints || 0), priceCents: Number(data.priceCents || 0), sort: Number(data.sort || 0), benefits: String(data.benefits || '').split('\n').map(item => item.trim()).filter(Boolean) };
      if (plan) await req(`/api/v1/admin/member-plans/${encodeURIComponent(plan.id)}`, { method: 'PATCH', body });
      else await req('/api/v1/admin/member-plans', { method: 'POST', body });
      cache.plans = null; toast('套餐已保存', 'success'); rerender();
    } });
  }

  /* ---------------- points & cdkeys ---------------- */
  const cdkeyState = { status: '' };
  async function renderPoints() {
    const [keys, recharges] = await Promise.all([req(`/api/v1/admin/cdkeys?pageSize=200${cdkeyState.status ? `&status=${cdkeyState.status}` : ''}`), req('/api/v1/admin/point-recharges?pageSize=100').catch(() => ({ items: [] }))]);
    const keyItems = (keys.items || []).filter(item => !cdkeyState.status || item.status === cdkeyState.status);
    const keyRows = keyItems.map(item => `<tr><td><code>${escapeHtml(item.code)}</code><span class="sub">${escapeHtml(item.note || '')}</span></td><td class="num">${num(item.redeemPoints ?? item.points)}</td><td>${tag(item.status)}</td><td>${item.redeemedBy ? escapeHtml(item.redeemedBy) : '<span class="sub">—</span>'}<span class="sub">${item.redeemedAt ? escapeHtml(dateText(item.redeemedAt, true)) : ''}</span></td><td>${item.expiresAt ? escapeHtml(dateText(item.expiresAt)) : '<span class="sub">长期</span>'}</td><td>${when(item.createdAt)}</td><td><div class="actions">${item.status === 'unused' ? `<button class="btn btn--sm btn--danger" type="button" data-cdkey-revoke="${escapeHtml(item.id)}">停用</button>` : ''}</div></td></tr>`).join('');
    const rechargeRows = (recharges.items || []).map(item => `<tr><td>${person(item.user, item.userId)}</td><td class="amount plus">+${num(item.points ?? item.delta)}</td><td class="num">${num(item.balanceAfter ?? item.balance)}</td><td>${escapeHtml(item.source || item.reason || '—')}</td><td>${escapeHtml(item.note || '—')}</td><td>${when(item.createdAt)}</td></tr>`).join('');
    view.innerHTML = [
      `<div class="two-col wide-left">${card({ title: '生成兑换码', hint: '兑换码只在生成时完整显示一次，请立即复制', className: 'form-card', body: `<form class="card-body" id="cdkeyForm" novalidate><div class="form-row cols-2">${fieldHtml({ name: 'points', label: `面额（${unit()}）`, type: 'number', min: 1, step: 1, value: 1000, required: true })}${fieldHtml({ name: 'quantity', label: '数量', type: 'number', min: 1, max: 500, value: 1, required: true })}${fieldHtml({ name: 'expiresAt', label: '过期时间', type: 'datetime-local', hint: '留空则长期有效' })}${fieldHtml({ name: 'note', label: '备注', placeholder: '例如：10月微信转账批次', maxLength: 200 })}</div><div class="form-actions"><button class="btn btn--primary" type="submit">${icon('gift')}生成兑换码</button></div></form>` })}
      ${card({ title: `手动充值${unit()}`, body: `<div class="card-body"><p class="hint">适合补发或线下收款后直接到账。每笔充值都会记录操作人，不能删除。</p><div class="form-actions" style="margin-top:14px"><button class="btn btn--money" type="button" data-quick="recharge">${icon('coin')}充值${unit()}</button></div></div>` })}</div>`,
      card({ title: '兑换码', hint: `${num(keyItems.length)} 个`, body: `<div class="toolbar"><div class="status-tabs" role="group">${[['', '全部'], ['unused', '未使用'], ['redeemed', '已兑换'], ['disabled', '已停用'], ['expired', '已过期']].map(([value, label]) => `<button type="button" data-cdkey-status="${value}" aria-pressed="${cdkeyState.status === value}">${label}</button>`).join('')}</div></div>${tableHtml(['兑换码', `>${unit()}`, '状态', '兑换用户', '有效期', '生成时间', '>操作'], keyRows)}` }),
      card({ title: `${unit()}充值记录`, hint: '只读，不可删除', body: tableHtml(['用户', '>变动', '>余额', '来源', '备注', '时间'], rechargeRows) })
    ].join('');
  }

  /* ---------------- withdrawals ---------------- */
  const financeState = { status: 'pending', q: '' };
  let withdrawalItems = [];
  async function renderFinance() {
    const [config, list] = await Promise.all([req('/api/v1/admin/withdrawal-config'), req(`/api/v1/admin/withdrawals?pageSize=300${financeState.status ? `&status=${financeState.status}` : ''}`)]);
    withdrawalItems = list.items || [];
    const q = financeState.q.toLowerCase();
    const rows = withdrawalItems.filter(item => !q || [item.id, item.userId, item.phone, item.user?.name, item.user?.username].some(value => String(value || '').toLowerCase().includes(q))).map(item => `<tr class="is-clickable" data-withdrawal="${escapeHtml(item.id)}"><td>${person(item.user, item.userId)}</td><td class="num">${num(item.points)}</td><td class="num">¥${Number(item.grossAmountRmb || 0).toFixed(2)}<span class="sub">手续费 ¥${Number(item.feeAmountRmb || 0).toFixed(2)}</span></td><td class="num"><strong>¥${Number(item.netAmountRmb || 0).toFixed(2)}</strong></td><td>${escapeHtml({ alipay: '支付宝', wechat: '微信' }[item.channel] || '—')}<span class="sub">${escapeHtml(item.phone || '')}</span></td><td>${tag(item.status, item.status === 'pending' ? '待打款' : item.status === 'paid' ? '已打款' : '已驳回')}</td><td>${when(item.createdAt)}</td><td><div class="actions"><button class="btn btn--sm" type="button" data-withdrawal="${escapeHtml(item.id)}">${item.status === 'pending' ? '处理' : '详情'}</button></div></td></tr>`).join('');
    view.innerHTML = [
      card({ title: '提现规则', hint: '新申请按保存后的规则计算', className: 'form-card', body: `<form class="card-body" id="withdrawConfigForm" novalidate><div class="form-row cols-3">${fieldHtml({ name: 'pointsPerYuan', label: `多少${unit()}兑换 1 元`, type: 'number', min: 0.01, step: 0.01, value: config.pointsPerYuan, required: true })}${fieldHtml({ name: 'withdrawFeePercent', label: '手续费（%）', type: 'number', min: 0, max: 100, step: 0.01, value: config.withdrawFeePercent, required: true })}${fieldHtml({ name: 'minPoints', label: `最低提现${unit()}`, type: 'number', min: 1, step: 1, value: config.minPoints || 1, required: true })}</div><div class="form-actions"><button class="btn btn--primary" type="submit">保存规则</button></div></form>` }),
      card({ title: '提现申请', hint: '打款请使用用户上传的收款码，完成后标记已打款', body: `<div class="toolbar"><div class="status-tabs" role="group">${[['pending', '待打款'], ['paid', '已打款'], ['rejected', '已驳回'], ['', '全部']].map(([value, label]) => `<button type="button" data-withdraw-status="${value}" aria-pressed="${financeState.status === value}">${label}</button>`).join('')}</div><form class="search" data-search="finance">${icon('search')}<input class="input" name="q" type="search" placeholder="用户、手机号、申请编号" value="${escapeHtml(financeState.q)}"></form></div>${tableHtml([`用户`, `>${unit()}`, '>兑换金额', '>应打款', '收款方式', '状态', '申请时间', '>操作'], rows)}` })
    ].join('');
  }
  async function withdrawalDetail(id) {
    const item = withdrawalItems.find(entry => entry.id === id);
    if (!item) return;
    const qr = item.qrCodeUrl ? App.mediaUrl(item.qrCodeUrl) : '';
    const body = `<dl class="detail-grid"><dt>申请编号</dt><dd><code>${escapeHtml(item.id)}</code></dd><dt>用户</dt><dd>${escapeHtml(item.user?.name || item.userId)}　<span class="hint">${escapeHtml(item.userId)}</span></dd><dt>联系手机</dt><dd>${escapeHtml(item.phone || '—')}</dd><dt>收款方式</dt><dd>${escapeHtml({ alipay: '支付宝', wechat: '微信' }[item.channel] || '未注明')}</dd><dt>提现${escapeHtml(unit())}</dt><dd class="num">${num(item.points)}</dd><dt>应打款</dt><dd><strong class="num" style="font-size:20px">¥${Number(item.netAmountRmb || 0).toFixed(2)}</strong>　<span class="hint">兑换 ¥${Number(item.grossAmountRmb || 0).toFixed(2)}，手续费 ¥${Number(item.feeAmountRmb || 0).toFixed(2)}</span></dd><dt>状态</dt><dd>${tag(item.status, item.status === 'pending' ? '待打款' : item.status === 'paid' ? '已打款' : '已驳回')}</dd><dt>申请时间</dt><dd>${escapeHtml(dateText(item.createdAt, true))}</dd>${item.adminNote ? `<dt>处理备注</dt><dd>${escapeHtml(item.adminNote)}</dd>` : ''}</dl><h3 style="margin:18px 0 10px;font-size:15px">收款码</h3>${qr ? `<a href="${escapeHtml(qr)}" target="_blank" rel="noopener"><img src="${escapeHtml(qr)}" alt="用户收款码" style="max-width:260px;border-radius:12px;border:1px solid var(--line)"></a>` : '<p class="hint">用户未上传收款码</p>'}`;
    const actions = [{ label: '关闭', value: null }];
    if (item.status === 'pending') {
      actions.unshift({ label: '驳回并退回积分', className: 'btn--danger', onClick: async () => {
        const reason = await App.prompt({ title: '驳回提现', label: '驳回原因（用户可见）', presets: ['收款码无法识别', '手机号无法联系', '账户存在异常'], maxLength: 200, confirmText: '确认驳回' });
        if (!reason) return false;
        try { await req(`/api/v1/admin/withdrawals/${encodeURIComponent(item.id)}`, { method: 'PATCH', body: { status: 'rejected', reason, note: reason } }); toast('已驳回，积分已退回用户', 'success'); refreshOverview(); rerender(); return true; } catch (error) { toast(error.message, 'error'); return false; }
      } });
      actions.push({ label: '标记已打款', className: 'btn--money', onClick: async () => {
        const note = await App.prompt({ title: '标记已打款', label: '转账流水号或备注', required: false, placeholder: '选填', maxLength: 200, confirmText: '确认已打款' });
        if (note === null) return false;
        try { await req(`/api/v1/admin/withdrawals/${encodeURIComponent(item.id)}`, { method: 'PATCH', body: { status: 'paid', note } }); toast('已标记打款，用户会收到通知', 'success'); refreshOverview(); rerender(); return true; } catch (error) { toast(error.message, 'error'); return false; }
      } });
    }
    await App.modal({ title: '提现详情', body, drawer: true, actions });
  }

  /* ---------------- referral ---------------- */
  async function renderReferral() {
    const [config, relations, commissions] = await Promise.all([req('/api/v1/admin/referral-config'), req('/api/v1/admin/referrals?pageSize=200'), req('/api/v1/admin/referral-commissions?pageSize=200')]);
    const items = commissions.items || [];
    const total = items.filter(item => !['rejected', 'cancelled'].includes(item.status)).reduce((sum, item) => sum + Number(item.commissionPoints || 0), 0);
    const relationRows = (relations.items || []).map(item => `<tr><td>${person(item.child, item.childId)}</td><td>${person(item.parent, item.parentId)}</td><td>${escapeHtml(item.referralCode || '—')}</td><td>${when(item.createdAt)}</td></tr>`).join('');
    const commissionRows = items.map(item => `<tr><td>${person(item.beneficiary, item.beneficiaryId)}</td><td>${person(item.sourceUser, item.sourceUserId)}</td><td>${escapeHtml({ points_recharge: '兑换码充值', membership_redeem: '兑换会员' }[item.sourceType] || item.sourceType)}</td><td class="num">${num(item.basePoints)}</td><td class="num">${Number(item.ratePercent || 0)}%</td><td class="amount plus">+${num(item.commissionPoints)}</td><td>${when(item.createdAt)}</td></tr>`).join('');
    view.innerHTML = [
      `<div class="kpis"><div class="kpi"><span>邀请关系</span><strong>${num(relations.total || 0)}</strong></div><div class="kpi"><span>累计提成</span><strong>${num(total)}</strong><small>${escapeHtml(unit())}</small></div><div class="kpi"><span>提成记录</span><strong>${num(commissions.total || 0)}</strong></div></div>`,
      card({ title: '分销规则', hint: '只计算直属一层：A 邀请 B，B 再邀请 C，A 不获得 C 的提成', className: 'form-card', body: `<form class="card-body" id="referralForm" novalidate><div class="form-row cols-3">${fieldHtml({ name: 'directPercent', label: '直属提成比例（%）', type: 'number', min: 0, max: 100, step: 0.01, value: config.directPercent, required: true })}<div class="field"><span class="label">开关</span>${fieldHtml({ name: 'enabled', label: '启用分销提成', type: 'checkbox', value: config.enabled !== false })}</div></div><p class="hint">直属好友用兑换码充值或兑换会员时，按比例把${escapeHtml(unit())}奖励给邀请人。</p><div class="form-actions"><button class="btn btn--primary" type="submit">保存规则</button></div></form>` }),
      card({ title: '邀请关系', body: tableHtml(['好友', '邀请人', '邀请码', '绑定时间'], relationRows) }),
      card({ title: '提成流水', body: tableHtml(['受益人', '好友', '来源', `>消费${unit()}`, '>比例', '>提成', '时间'], commissionRows) })
    ].join('');
  }

  /* ---------------- check-in ---------------- */
  async function renderCheckin() {
    const [config, stats, board, records] = await Promise.all([req('/api/v1/admin/checkin-config'), req('/api/v1/admin/checkins/stats'), req('/api/v1/admin/checkin-leaderboard?period=month&limit=50'), req('/api/v1/admin/checkins?pageSize=100')]);
    const rewards = config.streakRewards || [];
    const rewardRow = (item = {}) => `<div class="form-row cols-3" data-reward-row style="align-items:end"><div class="field"><label class="label">连续天数</label><input class="input num" data-days type="number" min="2" max="3650" value="${Number(item.days || 7)}"></div><div class="field"><label class="label">额外奖励</label><input class="input num" data-bonus type="number" min="0" value="${Number(item.bonusPoints || 0)}"></div><div><button class="btn btn--ghost" type="button" data-remove-reward>${icon('trash')}删除</button></div></div>`;
    const boardRows = (board.items || []).map(item => `<tr><td class="num">#${item.rank}</td><td>${person({ name: item.name, id: item.userId })}</td><td class="num">${num(item.streak)} 天</td><td class="num">${num(item.days)}</td><td class="num">${num(item.points)}</td></tr>`).join('');
    const recordRows = (records.items || []).map(item => `<tr><td>${person(item.user, item.userId)}</td><td>${escapeHtml(item.checkinDate)}</td><td class="num">${num(item.basePoints)}</td><td class="num">${num(item.bonusPoints)}</td><td class="amount plus">+${num(item.totalPoints)}</td><td class="num">${num(item.streak)} 天</td></tr>`).join('');
    view.innerHTML = [
      `<div class="kpis"><div class="kpi"><span>今日签到</span><strong>${num(stats.todayUsers ?? stats.todayCount)}</strong></div><div class="kpi"><span>累计签到</span><strong>${num(stats.totalCheckins ?? stats.totalCount)}</strong></div><div class="kpi"><span>累计发放</span><strong>${num(stats.totalPoints)}</strong><small>${escapeHtml(unit())}</small></div><div class="kpi"><span>连签中的用户</span><strong>${num(stats.activeStreakUsers)}</strong></div></div>`,
      card({ title: '签到规则', hint: '修改只影响之后的签到', className: 'form-card', body: `<form class="card-body" id="checkinForm" novalidate><div class="form-row cols-3">${fieldHtml({ name: 'dailyPoints', label: `每日签到${unit()}`, type: 'number', min: 0, value: config.dailyPoints, required: true })}${fieldHtml({ name: 'streakBonusPoints', label: '连续签到每日加成', type: 'number', min: 0, value: config.streakBonusPoints || 0, hint: '从第 2 天起' })}${fieldHtml({ name: 'leaderboardDays', label: '排行榜周期', type: 'select', value: config.leaderboardDays || 30, options: [[7, '近 7 天'], [30, '近 30 天'], [90, '近 90 天'], [365, '近 365 天']] })}</div>${fieldHtml({ name: 'enabled', label: '开启每日签到', type: 'checkbox', value: config.enabled !== false })}<div><span class="label" style="font-weight:650">连续签到里程碑奖励</span><div id="rewardRows" style="display:grid;gap:10px;margin-top:10px">${rewards.map(rewardRow).join('') || ''}</div><button class="btn btn--sm" type="button" id="addReward" style="margin-top:10px">${icon('plus')}添加里程碑</button></div><div class="form-actions"><button class="btn btn--primary" type="submit">保存规则</button></div></form>` }),
      `<div class="two-col">${card({ title: '本月排行', body: tableHtml(['>排名', '用户', '>连续', '>次数', `>${unit()}`], boardRows) })}${card({ title: '最近签到', body: tableHtml(['用户', '日期', '>基础', '>加成', '>合计', '>连续'], recordRows) })}</div>`
    ].join('');
    document.querySelector('#addReward').addEventListener('click', () => document.querySelector('#rewardRows').insertAdjacentHTML('beforeend', rewardRow({ days: 7, bonusPoints: 10 })));
  }

  /* ---------------- messages ---------------- */
  async function renderMessages() {
    const [groups, history] = await Promise.all([loadGroups().catch(() => []), req('/api/v1/admin/notifications?pageSize=200')]);
    const batches = new Map();
    for (const item of history.items || []) {
      const key = item.batchId || item.id;
      const entry = batches.get(key) || { ...item, count: 0, read: 0 };
      entry.count += 1; if (item.readAt) entry.read += 1;
      batches.set(key, entry);
    }
    const rows = [...batches.values()].map(item => `<tr><td class="title-cell"><strong>${escapeHtml(item.title)}</strong><span class="sub">${escapeHtml(item.body)}</span></td><td class="num">${num(item.count)}</td><td class="num">${num(item.read)} / ${num(item.count)}</td><td>${escapeHtml(item.type === 'admin_message' ? '后台发送' : item.type)}</td><td>${when(item.createdAt)}</td></tr>`).join('');
    view.innerHTML = [
      card({ title: '发送站内信', className: 'form-card', body: `<form class="card-body" id="messageForm" novalidate><div class="form-row cols-2">${fieldHtml({ name: 'scope', label: '发送给', type: 'select', value: 'all', options: [['all', '全部用户'], ['group', '指定会员等级'], ['users', '指定用户']] })}<div class="field" data-scope="users" hidden>${fieldHtml({ name: 'userIds', label: '用户 ID', hint: '多个用逗号分隔' })}</div><div data-scope="group" hidden>${fieldHtml({ name: 'groupIds', label: '会员等级', type: 'checks', value: [], options: groups.filter(group => group.status === 'active').map(group => [group.id, group.name]) })}</div></div>${fieldHtml({ name: 'title', label: '标题', required: true, maxLength: 80 })}${fieldHtml({ name: 'body', label: '内容', type: 'textarea', rows: 4, required: true, maxLength: 500 })}<div class="form-actions"><button class="btn btn--primary" type="submit">${icon('bell')}发送</button></div></form>` }),
      card({ title: '发送记录', hint: '按批次汇总，包含系统自动通知', body: tableHtml(['消息', '>收件人数', '>已读', '类型', '时间'], rows) })
    ].join('');
    const form = document.querySelector('#messageForm');
    const sync = () => { const scope = form.elements.scope.value; form.querySelectorAll('[data-scope]').forEach(node => { node.hidden = node.dataset.scope !== scope; }); };
    form.elements.scope.addEventListener('change', sync); sync();
  }

  /* ---------------- tags ---------------- */
  async function renderTags() {
    const tags = await loadTags(true);
    const manage = can('content.manage');
    const board = (dimension, title, hint) => card({ title, hint, body: `<div class="card-body"><div class="tag-list">${(tags[dimension] || []).map(name => `<span class="chip">${escapeHtml(name)}${manage ? `<button type="button" data-tag-rename="${escapeHtml(name)}" data-dimension="${dimension}" aria-label="重命名 ${escapeHtml(name)}">${icon('edit')}</button><button type="button" data-tag-delete="${escapeHtml(name)}" data-dimension="${dimension}" aria-label="删除 ${escapeHtml(name)}">${icon('x')}</button>` : ''}</span>`).join('') || '<span class="hint">暂无</span>'}</div>${manage ? `<form class="input-group" data-tag-add="${dimension}" style="margin-top:16px"><input class="input" name="name" maxlength="40" placeholder="新增${escapeHtml(title)}" required><button class="btn" type="submit">添加</button></form>` : ''}</div>` });
    view.innerHTML = `<p class="view-intro">方向和技能会出现在发现页筛选、投稿分类里。重命名会同步更新已有内容。</p><div class="tag-board">${board('project', '方向', '项目 / 赛道')}${board('skill', '技能', '工具 / 方法')}</div>`;
  }

  /* ---------------- admins ---------------- */
  const ROLES = [['content_admin', '内容管理员'], ['finance_admin', '财务管理员'], ['support_admin', '客服管理员'], ['superadmin', '超级管理员']];
  async function renderAdmins() {
    const data = await req('/api/v1/admin/admins');
    const rows = (data.items || []).map(item => `<tr><td><strong>${escapeHtml(item.name)}</strong><span class="sub">@${escapeHtml(item.username)}</span></td><td>${escapeHtml(item.roleLabel)}</td><td>${tag(item.status)}</td><td>${item.lastLoginAt ? escapeHtml(relativeTime(item.lastLoginAt)) : '<span class="sub">从未登录</span>'}</td><td><div class="actions"><button class="btn btn--sm" type="button" data-admin-act="role" data-id="${escapeHtml(item.id)}">改角色</button><button class="btn btn--sm" type="button" data-admin-act="password" data-id="${escapeHtml(item.id)}">重置密码</button>${item.id !== admin?.id ? `<button class="btn btn--sm ${item.status === 'active' ? 'btn--danger' : ''}" type="button" data-admin-act="${item.status === 'active' ? 'disable' : 'enable'}" data-id="${escapeHtml(item.id)}">${item.status === 'active' ? '停用' : '启用'}</button>` : ''}</div></td></tr>`).join('');
    view.innerHTML = card({ title: '管理员', hint: '内容管理员管审核；财务管理员管积分、会员和提现；客服管理员只读并可发站内信', tools: `<button class="btn btn--sm btn--primary" type="button" data-admin-act="create">${icon('plus')}新增管理员</button>`, body: tableHtml(['管理员', '角色', '状态', '最近登录', '>操作'], rows) });
    cache.admins = data.items || [];
  }

  /* ---------------- system ---------------- */
  async function renderSystem() {
    const parts = [];
    if (can('finance.manage')) {
      const config = await req('/api/v1/admin/points/config');
      const contact = config.purchaseContact || {};
      parts.push(card({ title: '积分与购买指引', hint: '用户在会员中心看到这里的客服信息', className: 'form-card', body: `<form class="card-body" id="pointsConfigForm" novalidate><div class="form-row cols-2">${fieldHtml({ name: 'unitName', label: '积分名称', value: config.unitName, required: true, maxLength: 20, hint: '例如：积分、刀币' })}${fieldHtml({ name: 'wechatId', label: '客服微信号', value: contact.wechatId || '', maxLength: 80 })}</div><div class="field"><span class="label">客服二维码</span><div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap"><img class="qr-preview" id="qrPreviewImg" src="${escapeHtml(contact.qrCodeUrl ? App.mediaUrl(contact.qrCodeUrl) : '')}" alt="客服二维码"${contact.qrCodeUrl ? '' : ' hidden'}><div style="display:grid;gap:8px"><input type="hidden" name="qrCodeUrl" value="${escapeHtml(contact.qrCodeUrl || '')}"><button class="btn btn--sm" type="button" id="uploadQr">${icon('image')}上传二维码图片</button><button class="text-btn is-danger" type="button" id="clearQr"${contact.qrCodeUrl ? '' : ' hidden'}>移除</button></div></div></div>${fieldHtml({ name: 'contactNote', label: '购买说明', value: contact.note || '', maxLength: 300 })}<div class="form-row cols-2">${fieldHtml({ name: 'offlineTitle', label: '线下开通标题', value: contact.offlineTitle || '', maxLength: 50 })}${fieldHtml({ name: 'offlineNote', label: '线下开通说明', value: contact.offlineNote || '', maxLength: 500 })}</div><div class="form-actions"><button class="btn btn--primary" type="submit">保存</button></div></form>` }));
    }
    if (can('system.settings')) {
      const smtp = await req('/api/v1/admin/settings/smtp');
      parts.push(card({ title: '邮件发送（SMTP）', hint: smtp.configured ? '<span class="tag tag--ok">已配置，可发送验证码</span>' : '<span class="tag tag--bad">未配置，注册和找回密码收不到验证码</span>', className: 'form-card', body: `<form class="card-body" id="smtpForm" novalidate><div class="form-row cols-2">${fieldHtml({ name: 'host', label: 'SMTP 主机', value: smtp.host || '', required: true, placeholder: 'smtp.qq.com' })}${fieldHtml({ name: 'port', label: '端口', type: 'number', min: 1, max: 65535, value: smtp.port || 465, required: true })}${fieldHtml({ name: 'user', label: '发信邮箱', type: 'email', value: smtp.user || '', required: true })}${fieldHtml({ name: 'pass', label: '授权码', type: 'password', placeholder: '留空表示不修改' })}${fieldHtml({ name: 'from', label: '发件人显示', value: smtp.from || '', placeholder: '月入万刀 <邮箱地址>' })}<div class="field"><span class="label">加密</span>${fieldHtml({ name: 'secure', label: '使用 SSL/TLS', type: 'checkbox', value: smtp.secure !== false })}</div></div><div class="form-actions"><button class="btn btn--primary" type="submit">保存</button></div></form>` }));
    }
    view.innerHTML = parts.join('') || '<div class="card forbidden">没有可修改的系统设置。</div>';
  }

  /* ---------------- logs ---------------- */
  async function renderLogs() {
    const tasks = [req('/api/v1/admin/audit-logs?limit=200')];
    if (can('finance.manage')) tasks.push(req('/api/v1/admin/orders?pageSize=100'), req('/api/v1/admin/tips?pageSize=100'));
    const [audit, orders, tips] = await Promise.all(tasks);
    const ACTIONS = { create: '创建', update: '修改', archive: '归档', delete: '删除', restore: '恢复', login: '登录', revoke: '撤销', redeem: '兑换', refund: '退款', send: '发送', disable: '停用', enable: '启用', rename: '重命名' };
    const auditRows = (audit.items || []).map(item => `<tr><td>${when(item.createdAt)}</td><td>${escapeHtml(item.actorId)}</td><td>${escapeHtml(ACTIONS[item.action] || item.action)}</td><td>${escapeHtml(item.targetType || '—')}<span class="sub">${escapeHtml(item.targetId || '')}</span></td><td><code>${escapeHtml(JSON.stringify(item.detail || {})).slice(0, 220)}</code></td></tr>`).join('');
    const parts = [];
    if (orders) {
      const orderRows = (orders.items || []).map(item => `<tr><td><code>${escapeHtml(item.orderNo || item.id)}</code></td><td>${escapeHtml(item.title || item.kind)}</td><td>${escapeHtml({ post: '内容解锁', membership: '会员兑换', tip: '打赏' }[item.kind] || item.kind)}</td><td class="num">${item.amountPoints != null ? `${num(item.amountPoints)} ${escapeHtml(unit())}` : '—'}</td><td>${tag(item.status)}</td><td>${when(item.createdAt)}</td><td><div class="actions">${item.status === 'paid' && item.paymentProvider === 'points' ? `<button class="btn btn--sm btn--danger" type="button" data-refund="${escapeHtml(item.id)}">退款</button>` : ''}</div></td></tr>`).join('');
      const tipTotal = (tips.items || []).filter(item => item.status === 'paid').reduce((sum, item) => sum + Number(item.points || 0), 0);
      parts.push(card({ title: '订单', hint: `打赏 ${num(tips.total || 0)} 笔，共 ${num(tipTotal)} ${escapeHtml(unit())}`, body: tableHtml(['订单号', '标题', '类型', '>金额', '状态', '时间', '>操作'], orderRows) }));
    }
    parts.push(card({ title: '审计日志', hint: '最近 200 条，只读', body: tableHtml(['时间', '操作人', '动作', '对象', '详情'], auditRows) }));
    view.innerHTML = parts.join('');
  }

  /* =================================================================
     Events
     ================================================================= */
  async function quick(action) {
    if (action === 'post') return editPost(null);
    if (action === 'cdkey') { location.hash = 'points'; return; }
    if (action === 'message') return messageDialog();
    if (action === 'grant') return grantDialog();
    if (action === 'recharge') return rechargeDialog();
  }

  view.addEventListener('click', async event => {
    const target = event.target;
    if (target.closest('[data-reload]')) return rerender();
    const quickButton = target.closest('[data-quick]');
    if (quickButton) return quick(quickButton.dataset.quick);

    // content
    const status = target.closest('[data-content-status]');
    if (status) { contentState.status = status.dataset.contentStatus; return rerender(); }
    const postButton = target.closest('[data-post-act]');
    if (postButton) {
      event.stopPropagation();
      const id = postButton.dataset.id;
      if (postButton.dataset.postAct === 'preview') return previewPost(id).catch(error => toast(error.message, 'error'));
      busy(postButton, true);
      try { const post = await req(`/api/v1/admin/posts/${encodeURIComponent(id)}`); await postAction(postButton.dataset.postAct, post); } catch (error) { toast(error.message, 'error'); } finally { busy(postButton, false); }
      return;
    }
    const row = target.closest('[data-row-post]');
    if (row && !target.closest('button, a')) return previewPost(row.dataset.rowPost).catch(error => toast(error.message, 'error'));

    // reports & comments
    const report = target.closest('[data-report]');
    if (report) {
      const act = report.dataset.report;
      try {
        if (act === 'archive') {
          if (!(await App.confirm({ title: '下线被举报的内容', message: '内容下线后不再公开，举报会标记为已处理。', confirmText: '下线', danger: true }))) return;
          await req(`/api/v1/admin/posts/${encodeURIComponent(report.dataset.post)}`, { method: 'DELETE' });
        }
        await req(`/api/v1/admin/reports/${encodeURIComponent(report.dataset.id)}`, { method: 'PATCH', body: { status: act === 'reject' ? 'rejected' : 'resolved', resolution: act === 'archive' ? '内容已下线' : act === 'reject' ? '不予受理' : '已处理' } });
        toast('举报已处理', 'success'); refreshOverview(); rerender();
      } catch (error) { toast(error.message, 'error'); }
      return;
    }
    const creport = target.closest('[data-creport]');
    if (creport) {
      try {
        if (creport.dataset.creport === 'hide') await req(`/api/v1/admin/comments/${encodeURIComponent(creport.dataset.comment)}`, { method: 'PATCH', body: { status: 'deleted' } });
        await req(`/api/v1/admin/comment-reports/${encodeURIComponent(creport.dataset.id)}/resolve`, { method: 'POST', body: { status: creport.dataset.creport === 'hide' ? 'resolved' : 'rejected', resolution: creport.dataset.creport === 'hide' ? '评论已隐藏' : '不予受理' } });
        toast('举报已处理', 'success'); refreshOverview(); rerender();
      } catch (error) { toast(error.message, 'error'); }
      return;
    }
    const commentAct = target.closest('[data-comment-act]');
    if (commentAct) {
      const hide = commentAct.dataset.commentAct === 'hide';
      if (hide && !(await App.confirm({ title: '隐藏评论', message: '隐藏后用户看不到这条评论及其回复。', confirmText: '隐藏', danger: true }))) return;
      try { await req(`/api/v1/admin/comments/${encodeURIComponent(commentAct.dataset.id)}`, { method: 'PATCH', body: { status: hide ? 'deleted' : 'published' } }); toast(hide ? '评论已隐藏' : '评论已恢复', 'success'); rerender(); } catch (error) { toast(error.message, 'error'); }
      return;
    }

    // users
    const userAct = target.closest('[data-user-act]');
    if (userAct) {
      const { id, name } = userAct.dataset;
      const act = userAct.dataset.userAct;
      if (act === 'points') return rechargeDialog(id, name);
      if (act === 'grant') return grantDialog(id, name);
      if (act === 'message') return messageDialog(id, name);
      if (act === 'disable') {
        const note = await App.prompt({ title: `停用 ${name}`, label: '停用原因（仅后台可见）', presets: ['发布违规内容', '恶意刷积分', '用户申请注销'], maxLength: 200, confirmText: '停用账号' });
        if (!note) return;
        try { await req(`/api/v1/admin/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status: 'disabled', note } }); toast('账号已停用，已登录的设备会被退出', 'success'); rerender(); } catch (error) { toast(error.message, 'error'); }
      }
      if (act === 'enable') {
        try { await req(`/api/v1/admin/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status: 'active' } }); toast('账号已启用', 'success'); rerender(); } catch (error) { toast(error.message, 'error'); }
      }
      return;
    }

    // members
    const groupEdit = target.closest('[data-group-edit]');
    if (groupEdit) return editGroup(groupEdit.dataset.groupEdit);
    const groupArchive = target.closest('[data-group-archive]');
    if (groupArchive) {
      if (!(await App.confirm({ title: '归档会员等级', message: '归档后不能再用于新开通，已开通的会员不受影响。', confirmText: '归档', danger: true }))) return;
      try { await req(`/api/v1/admin/member-groups/${encodeURIComponent(groupArchive.dataset.groupArchive)}`, { method: 'DELETE' }); cache.groups = null; toast('已归档', 'success'); rerender(); } catch (error) { toast(error.message, 'error'); }
      return;
    }
    const planEdit = target.closest('[data-plan-edit]');
    if (planEdit) return editPlan(planEdit.dataset.planEdit);
    const planStatus = target.closest('[data-plan-status]');
    if (planStatus) {
      try { await req(`/api/v1/admin/member-plans/${encodeURIComponent(planStatus.dataset.id)}`, { method: 'PATCH', body: { status: planStatus.dataset.planStatus } }); cache.plans = null; toast(planStatus.dataset.planStatus === 'active' ? '套餐已恢复售卖' : '套餐已停售', 'success'); rerender(); } catch (error) { toast(error.message, 'error'); }
      return;
    }
    const revoke = target.closest('[data-revoke]');
    if (revoke) {
      if (!(await App.confirm({ title: '撤销会员', message: '撤销后该用户立即失去会员权益，已扣除的积分不会自动退回。', confirmText: '撤销', danger: true }))) return;
      try { await req(`/api/v1/admin/memberships/${encodeURIComponent(revoke.dataset.revoke)}`, { method: 'PATCH', body: { status: 'revoked', note: '管理员手动撤销' } }); toast('会员已撤销', 'success'); rerender(); } catch (error) { toast(error.message, 'error'); }
      return;
    }

    // points
    const cdkeyStatus = target.closest('[data-cdkey-status]');
    if (cdkeyStatus) { cdkeyState.status = cdkeyStatus.dataset.cdkeyStatus; return rerender(); }
    const cdkeyRevoke = target.closest('[data-cdkey-revoke]');
    if (cdkeyRevoke) {
      if (!(await App.confirm({ title: '停用兑换码', message: '停用后这个兑换码无法再使用。', confirmText: '停用', danger: true }))) return;
      try { await req(`/api/v1/admin/cdkeys/${encodeURIComponent(cdkeyRevoke.dataset.cdkeyRevoke)}/revoke`, { method: 'POST', body: { reason: '管理员停用' } }); toast('兑换码已停用', 'success'); rerender(); } catch (error) { toast(error.message, 'error'); }
      return;
    }

    // finance
    const wStatus = target.closest('[data-withdraw-status]');
    if (wStatus) { financeState.status = wStatus.dataset.withdrawStatus; return rerender(); }
    const withdrawal = target.closest('[data-withdrawal]');
    if (withdrawal) return withdrawalDetail(withdrawal.dataset.withdrawal);

    // check-in
    const removeReward = target.closest('[data-remove-reward]');
    if (removeReward) { removeReward.closest('[data-reward-row]').remove(); return; }

    // tags
    const tagRename = target.closest('[data-tag-rename]');
    if (tagRename) {
      const name = await App.prompt({ title: '重命名标签', label: '新名称', value: tagRename.dataset.tagRename, maxLength: 40, confirmText: '保存', hint: '已使用该标签的内容会一起更新' });
      if (!name || name === tagRename.dataset.tagRename) return;
      try { const result = await req(`/api/v1/admin/tags/${tagRename.dataset.dimension}/${encodeURIComponent(tagRename.dataset.tagRename)}`, { method: 'PATCH', body: { name } }); toast(`已重命名，更新了 ${num(result.updatedPosts)} 篇内容`, 'success'); cache.tags = null; rerender(); } catch (error) { toast(error.message, 'error'); }
      return;
    }
    const tagDelete = target.closest('[data-tag-delete]');
    if (tagDelete) {
      if (!(await App.confirm({ title: '删除标签', message: `删除「${tagDelete.dataset.tagDelete}」后它不再出现在筛选和投稿里，已有内容保留原标签。`, confirmText: '删除', danger: true }))) return;
      try { await req(`/api/v1/admin/tags/${tagDelete.dataset.dimension}/${encodeURIComponent(tagDelete.dataset.tagDelete)}`, { method: 'DELETE' }); toast('标签已删除', 'success'); cache.tags = null; rerender(); } catch (error) { toast(error.message, 'error'); }
      return;
    }

    // admins
    const adminAct = target.closest('[data-admin-act]');
    if (adminAct) {
      const act = adminAct.dataset.adminAct;
      const record = (cache.admins || []).find(item => item.id === adminAct.dataset.id);
      if (act === 'create') return formDialog({ title: '新增管理员', fields: [{ name: 'username', label: '登录用户名', required: true, maxLength: 24 }, { name: 'name', label: '显示名称', maxLength: 40 }, { name: 'role', label: '角色', type: 'select', value: 'content_admin', options: ROLES }, { name: 'password', label: '初始密码', type: 'password', required: true, hint: '至少 8 位' }], submitText: '创建', onSubmit: async data => { if (data.password.length < 8) throw new Error('密码至少 8 位'); await req('/api/v1/admin/admins', { method: 'POST', body: data }); toast('管理员已创建', 'success'); rerender(); } });
      if (act === 'role' && record) return formDialog({ title: `修改 ${record.name} 的角色`, fields: [{ name: 'role', label: '角色', type: 'select', value: record.role, options: ROLES }], onSubmit: async data => { await req(`/api/v1/admin/admins/${encodeURIComponent(record.id)}`, { method: 'PATCH', body: data }); toast('角色已更新', 'success'); rerender(); } });
      if (act === 'password' && record) return formDialog({ title: `重置 ${record.name} 的密码`, intro: '重置后该管理员需要用新密码重新登录。', fields: [{ name: 'password', label: '新密码', type: 'password', required: true, hint: '至少 8 位' }], submitText: '重置', onSubmit: async data => { if (data.password.length < 8) throw new Error('密码至少 8 位'); await req(`/api/v1/admin/admins/${encodeURIComponent(record.id)}`, { method: 'PATCH', body: data }); toast('密码已重置', 'success'); if (record.id === admin?.id) logout(); } });
      if ((act === 'disable' || act === 'enable') && record) {
        if (act === 'disable' && !(await App.confirm({ title: '停用管理员', message: `停用后 ${record.name} 无法再登录后台。`, confirmText: '停用', danger: true }))) return;
        try { await req(`/api/v1/admin/admins/${encodeURIComponent(record.id)}`, { method: 'PATCH', body: { status: act === 'disable' ? 'disabled' : 'active' } }); toast(act === 'disable' ? '已停用' : '已启用', 'success'); rerender(); } catch (error) { toast(error.message, 'error'); }
      }
      return;
    }

    // system
    if (target.closest('#uploadQr')) {
      const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
      input.addEventListener('change', async () => {
        const file = input.files?.[0]; if (!file) return;
        const button = document.querySelector('#uploadQr'); busy(button, true);
        try { const url = await upload(file); const form = document.querySelector('#pointsConfigForm'); form.elements.qrCodeUrl.value = url; const img = document.querySelector('#qrPreviewImg'); img.src = App.mediaUrl(url); img.hidden = false; document.querySelector('#clearQr').hidden = false; toast('二维码已上传，记得保存', 'success'); } catch (error) { toast(error.message, 'error'); } finally { busy(button, false); }
      });
      input.click();
      return;
    }
    if (target.closest('#clearQr')) { const form = document.querySelector('#pointsConfigForm'); form.elements.qrCodeUrl.value = ''; document.querySelector('#qrPreviewImg').hidden = true; target.closest('#clearQr').hidden = true; return; }

    // logs
    const refund = target.closest('[data-refund]');
    if (refund) {
      if (!(await App.confirm({ title: '退款', message: '积分会退回给买家，并收回内容或会员权益。', confirmText: '确认退款', danger: true }))) return;
      try { await req(`/api/v1/admin/orders/${encodeURIComponent(refund.dataset.refund)}/refund`, { method: 'POST', body: {} }); toast('已退款', 'success'); rerender(); } catch (error) { toast(error.message, 'error'); }
    }
  });

  view.addEventListener('submit', async event => {
    const form = event.target;
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const search = form.dataset.search;
    if (search) {
      const q = form.elements.q.value.trim();
      if (search === 'content') { contentState.q = q; return rerender(); }
      if (search === 'users') { userState.q = q; return rerender(); }
      if (search === 'members') { memberState.q = q; return rerender(); }
      if (search === 'finance') { financeState.q = q; return rerender(); }
      return;
    }
    const tagAdd = form.dataset.tagAdd;
    busy(button, true);
    try {
      if (tagAdd) { await req(`/api/v1/admin/tags/${tagAdd}`, { method: 'POST', body: { name: form.elements.name.value.trim() } }); cache.tags = null; toast('标签已添加', 'success'); return rerender(); }
      const data = readForm(form);
      if (form.id === 'cdkeyForm') {
        if (!(Number.isInteger(data.points) && data.points >= 1)) throw new Error('面额需为正整数');
        const result = await req('/api/v1/admin/cdkeys', { method: 'POST', body: { points: data.points, quantity: data.quantity || 1, expiresAt: data.expiresAt ? new Date(data.expiresAt).toISOString() : undefined, note: data.note } });
        const codes = (result.items || []).map(item => item.code);
        await App.modal({ title: `已生成 ${codes.length} 个兑换码`, body: `<p class="inline-alert">${icon('alert')}<span>兑换码只显示这一次，关闭前请复制保存。</span></p><div class="code-box" style="margin-top:12px">${codes.map(escapeHtml).join('<br>')}</div>`, actions: [{ label: '关闭', value: null }, { label: '复制全部', primary: true, onClick: async () => { toast(await App.copyText(codes.join('\n')) ? '已复制全部兑换码' : '复制失败，请手动选择', 'success'); return false; } }] });
        return rerender();
      }
      if (form.id === 'withdrawConfigForm') { await req('/api/v1/admin/withdrawal-config', { method: 'PATCH', body: data }); toast('提现规则已保存', 'success'); return; }
      if (form.id === 'referralForm') { await req('/api/v1/admin/referral-config', { method: 'PATCH', body: { directPercent: Number(data.directPercent), enabled: data.enabled } }); toast('分销规则已保存', 'success'); return; }
      if (form.id === 'checkinForm') {
        const rewards = [...form.querySelectorAll('[data-reward-row]')].map(row => ({ days: Number(row.querySelector('[data-days]').value), bonusPoints: Number(row.querySelector('[data-bonus]').value) })).filter(item => item.days >= 2);
        const days = rewards.map(item => item.days);
        if (new Set(days).size !== days.length) throw new Error('里程碑天数不能重复');
        await req('/api/v1/admin/checkin-config', { method: 'PATCH', body: { enabled: data.enabled, dailyPoints: Number(data.dailyPoints || 0), streakBonusPoints: Number(data.streakBonusPoints || 0), leaderboardDays: Number(data.leaderboardDays || 30), streakRewards: rewards.sort((a, b) => a.days - b.days) } });
        toast('签到规则已保存', 'success'); return;
      }
      if (form.id === 'messageForm') {
        if (!data.title || !data.body) throw new Error('请填写标题和内容');
        const body = { scope: data.scope, title: data.title, body: data.body };
        if (data.scope === 'users') body.userIds = String(data.userIds || '').split(/[，,\s]+/).filter(Boolean);
        if (data.scope === 'group') body.groupIds = data.groupIds || [];
        if (!(await App.confirm({ title: '发送站内信', message: data.scope === 'all' ? '将发送给全部用户，发送后无法撤回。' : '发送后无法撤回。', confirmText: '发送' }))) return;
        const result = await req('/api/v1/admin/notifications', { method: 'POST', body });
        toast(`已发送给 ${num(result.recipientCount)} 位用户`, 'success'); return rerender();
      }
      if (form.id === 'pointsConfigForm') { const result = await req('/api/v1/admin/points/config', { method: 'PATCH', body: data }); cache.unitName = result.unitName || cache.unitName; toast('已保存', 'success'); return; }
      if (form.id === 'smtpForm') { const result = await req('/api/v1/admin/settings/smtp', { method: 'PATCH', body: { ...data, port: Number(data.port || 465) } }); toast(result.configured ? 'SMTP 已保存，可以发送验证码' : '已保存，但授权码为空，暂时不能发信', result.configured ? 'success' : 'info'); return rerender(); }
    } catch (error) { toast(error.message, 'error'); }
    finally { busy(button, false); }
  });
  view.addEventListener('input', event => {
    const search = event.target.closest('[data-search="comments-local"]');
    if (search) { const q = event.target.value.trim().toLowerCase(); view.querySelectorAll('[data-comment-row]').forEach(row => { row.hidden = Boolean(q) && !row.dataset.commentRow.includes(q); }); }
  });
  view.addEventListener('change', event => { if (event.target.matches('[data-user-status]')) { userState.status = event.target.value; rerender(); } });

  /* ---------------- shell ---------------- */
  const side = document.querySelector('#adminSide');
  const scrim = document.querySelector('#adminScrim');
  function openSide() { side.classList.add('is-open'); scrim.hidden = false; }
  function closeSide() { side.classList.remove('is-open'); scrim.hidden = true; }
  document.querySelector('#menuBtn').addEventListener('click', openSide);
  scrim.addEventListener('click', closeSide);
  document.querySelector('#refreshBtn').addEventListener('click', () => { cache.groups = cache.plans = cache.tags = null; refreshOverview(); rerender(); });
  document.querySelector('#adminLogout').addEventListener('click', async () => { if (await App.confirm({ title: '退出后台', message: '确定退出当前管理员账号吗？', confirmText: '退出' })) logout(); });
  window.addEventListener('hashchange', () => show(location.hash.slice(1)));

  async function boot() {
    try {
      const me = await req('/api/v1/admin/auth/me');
      admin = me.admin;
      try { localStorage.setItem('adminUser', JSON.stringify(admin)); } catch {}
    } catch (error) {
      if (error.status === 401) return;
      if (!admin) { view.innerHTML = errorCard(error); return; }
    }
    document.querySelector('#adminName').textContent = admin?.name || admin?.username || '管理员';
    document.querySelector('#adminRole').textContent = admin?.roleLabel || '管理员';
    await loadUnit();
    await refreshOverview();
    show(LEGACY[location.hash.slice(1)] || location.hash.slice(1) || 'overview');
  }
  boot();
})();
