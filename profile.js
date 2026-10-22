/* 个人中心：资料、积分、会员、签到、投稿、收藏、消息、钱包、邀请、常用筛选 */
(function () {
  'use strict';
  const App = window.App;
  const { api, icon, escapeHtml, toast, relativeTime, dateText, num, accessInfo, avatarHtml, session } = App;
  const isWeChat = /MicroMessenger/i.test(navigator.userAgent);

  const TABS = ['posts', 'favorites', 'messages', 'wallet', 'invite', 'filters'];
  const LEGACY = { overview: 'wallet', activity: 'posts', saved: 'filters', notifications: 'messages' };
  let unitName = '积分';
  let me = null;
  let balance = 0;
  const loaded = new Set();
  const state = { postStatus: '', markType: 'favorite', messageCursor: null, messages: [], ledgerCursor: null, withdrawMethod: 'alipay', withdrawQr: '', withdrawConfig: { pointsPerYuan: 100, withdrawFeePercent: 0, minPoints: 1 }, posts: [] };

  const STATUS = { draft: ['草稿', 'tag--status'], pending: ['审核中', 'tag--pending'], published: ['已发布', 'tag--ok'], rejected: ['未通过', 'tag--bad'], archived: ['已下线', 'tag--status'] };
  const statusTag = status => { const [label, cls] = STATUS[status] || [status || '—', 'tag--status']; return `<span class="tag ${cls}">${escapeHtml(label)}</span>`; };
  const empty = (iconName, title, text = '', action = '') => `<div class="empty">${icon(iconName)}<strong>${escapeHtml(title)}</strong>${text ? `<p>${escapeHtml(text)}</p>` : ''}${action}</div>`;
  const errorBox = (message, retry) => `<div class="inline-alert inline-alert--error">${icon('alert')}<span>${escapeHtml(message || '加载失败')}</span><button class="btn btn--sm" type="button" data-retry="${retry}">重试</button></div>`;

  /* ---------------- header area ---------------- */
  function renderIdentity() {
    const user = me.user || {};
    const membership = me.membership;
    const node = document.querySelector('#identity');
    node.innerHTML = `${avatarHtml(user, window.matchMedia('(min-width: 760px)').matches ? 84 : 68)}
      <div style="min-width:0">
        <h1>${escapeHtml(user.name || '月入万刀用户')}${membership ? `<span class="tag tag--member">${icon('member')}${escapeHtml(membership.planName || membership.groupName || '会员')}</span>` : ''}</h1>
        <p class="sub">${escapeHtml([user.username ? `@${user.username}` : '', user.email || '', user.city || ''].filter(Boolean).join('　') || `ID ${user.id || ''}`)}</p>
        ${user.bio ? `<p class="bio">${escapeHtml(user.bio)}</p>` : ''}
      </div>
      <div class="actions"><button class="btn btn--sm" type="button" id="editProfile" data-icon="edit">编辑资料</button><button class="btn btn--sm btn--ghost" type="button" id="logout">退出登录</button></div>`;
    node.querySelectorAll('[data-icon]').forEach(item => item.insertAdjacentHTML('afterbegin', icon(item.dataset.icon)));
  }
  function renderWallet() {
    document.querySelector('#walletLabel').textContent = `${unitName}余额`;
    document.querySelector('#walletBalance').innerHTML = `${num(balance)}<small>${escapeHtml(unitName)}</small>`;
    document.querySelector('#walletBalance').className = 'face';
    const card = document.querySelector('#memberCard');
    const membership = me.membership;
    if (membership) {
      card.className = 'note note--seal member-card';
      card.innerHTML = `<span class="label">当前会员</span><strong>${escapeHtml(membership.planName || membership.groupName || '会员')}</strong><p>${membership.endsAt ? `有效期至 ${escapeHtml(dateText(membership.endsAt))}` : '长期有效'}，可阅读会员专享内容。</p><a class="btn btn--sm" href="membership.html" style="justify-self:start;margin-top:4px">续费或升级</a>`;
    } else {
      card.className = 'member-card is-none sheet';
      card.innerHTML = `<span class="label">会员</span><strong>还不是会员</strong><p>用${escapeHtml(unitName)}开通会员，解锁全部会员专享打法。</p><a class="btn btn--seal btn--sm" href="membership.html" style="justify-self:start;margin-top:4px">查看会员方案</a>`;
    }
  }

  /* ---------------- check-in ---------------- */
  async function loadCheckin() {
    const node = document.querySelector('#checkin');
    try {
      const data = await api('/api/v1/me/checkin');
      if (data.config && data.config.enabled === false) { node.hidden = true; return; }
      const signed = new Set((data.recentRecords || []).map(record => record.checkinDate));
      const days = [];
      const today = new Date();
      for (let offset = 6; offset >= 0; offset -= 1) {
        const date = new Date(today); date.setDate(date.getDate() - offset);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        days.push(`<i class="${signed.has(key) ? 'on' : ''}${offset === 0 ? ' today' : ''}" title="${key}">${offset === 0 ? '今' : date.getDate()}</i>`);
      }
      const next = (data.config?.streakRewards || []).filter(item => Number(item.days) > Number(data.currentStreak || 0)).sort((a, b) => a.days - b.days)[0];
      node.hidden = false;
      node.innerHTML = `<div class="streak"><span class="face num">${num(data.currentStreak || 0)}</span><span>连续签到天数</span></div>
        <div class="week" aria-label="近 7 天签到">${days.join('')}</div>
        <p class="copy">${data.checkedIn ? `今天已签到，获得 <strong class="num">${num(data.todayReward)}</strong> ${escapeHtml(unitName)}。` : `签到可得 <strong class="num">${num(data.nextReward ?? data.todayReward)}</strong> ${escapeHtml(unitName)}。`}${next ? `连续 ${next.days} 天再奖励 ${num(next.bonusPoints)}。` : ''}</p>
        <button class="btn ${data.checkedIn ? '' : 'btn--money'}" type="button" id="checkinBtn" ${data.checkedIn ? 'disabled' : ''}>${data.checkedIn ? '今日已签到' : '签到'}</button>`;
    } catch (error) { node.hidden = error.status === 404 || error.status === 403; if (!node.hidden) node.innerHTML = `<p class="hint">签到暂时不可用。</p>`; }
  }
  async function doCheckin(button) {
    button.classList.add('is-loading');
    try {
      const result = await api('/api/v1/me/checkin', { method: 'POST', body: {} });
      toast(`签到成功，获得 ${num(result.record?.totalPoints ?? result.todayReward)} ${unitName}`, 'success');
      sessionStorage.removeItem('iyesh:me');
      await Promise.all([loadCheckin(), refreshBalance()]);
      if (loaded.has('wallet')) loadLedger(true);
    } catch (error) {
      if (error.status === 409) { toast('今天已经签到过了'); loadCheckin(); } else toast(error.message, 'error');
    } finally { button.classList.remove('is-loading'); }
  }
  async function refreshBalance() {
    try { const body = await api('/api/v1/me/points?pageSize=1'); balance = Number(body.balance || 0); unitName = body.unitName || unitName; renderWallet(); renderWithdrawEstimate(); } catch {}
  }

  /* ---------------- posts ---------------- */
  async function loadPosts() {
    const list = document.querySelector('#postList');
    list.innerHTML = '<div class="empty"><span class="spinner"></span></div>';
    try {
      const query = new URLSearchParams({ pageSize: '50' });
      if (state.postStatus) query.set('status', state.postStatus);
      const body = await api(`/api/v1/me/posts?${query}`);
      state.posts = (body.items || []).filter(item => item.status !== 'archived' || state.postStatus === 'archived');
      list.innerHTML = state.posts.length ? state.posts.map(post => {
        const editable = ['draft', 'pending', 'rejected'].includes(post.status);
        const when = post.status === 'published' ? `${dateText(post.publishedAt)} 发布` : post.status === 'draft' ? `${relativeTime(post.updatedAt || post.submittedAt)} 编辑` : `${relativeTime(post.submittedAt)} 提交`;
        return `<div class="list-row"><div class="main"><strong>${escapeHtml(post.title || '未命名草稿')}</strong><small>${escapeHtml(when)}${post.status === 'published' ? `　${num(post.counts?.likes)} 赞　${num(post.counts?.comments)} 评论` : ''}</small>${post.status === 'rejected' && post.rejectionReason ? `<p>未通过原因：${escapeHtml(post.rejectionReason)}</p>` : ''}</div>
          <div class="side">${statusTag(post.status)}${editable ? `<a class="btn btn--sm" href="publish.html?id=${encodeURIComponent(post.id)}">编辑</a><button class="icon-btn" type="button" data-archive="${escapeHtml(post.id)}" aria-label="删除投稿">${icon('trash')}</button>` : post.status === 'published' ? `<a class="btn btn--sm" href="detail.html?id=${encodeURIComponent(post.id)}">查看</a>` : ''}</div></div>`;
      }).join('') : empty('edit', state.postStatus ? '这个状态下没有投稿' : '还没有投稿', '把你跑通的打法写下来，审核通过后会出现在发现页。', '<a class="btn btn--primary btn--sm" href="publish.html">写第一篇</a>');
    } catch (error) { list.innerHTML = errorBox(error.message, 'posts'); }
  }

  /* ---------------- favorites ---------------- */
  async function loadMarks() {
    const list = document.querySelector('#markList');
    list.innerHTML = '<div class="empty"><span class="spinner"></span></div>';
    try {
      const body = await api(`/api/v1/me/interactions?type=${state.markType}&pageSize=50`);
      const items = body.items || [];
      const label = { favorite: '收藏', like: '点赞', anchor: '投锚' }[state.markType];
      list.innerHTML = items.length ? items.map(post => `<a class="list-row is-clickable" href="detail.html?id=${encodeURIComponent(post.id)}"><span class="main"><strong>${escapeHtml(post.title)}</strong><small>${escapeHtml((typeof post.author === 'string' ? post.author : post.author?.name) || '')}　${escapeHtml(post.interactedAt ? `${relativeTime(post.interactedAt)}${label}` : relativeTime(post.publishedAt))}</small></span><span class="side">${accessInfo(post, unitName).html}</span></a>`).join('') : empty(state.markType === 'favorite' ? 'star' : state.markType === 'like' ? 'heart' : 'anchor', `还没有${label}的内容`, `在内容详情页点「${label}」，就会出现在这里。`, '<a class="btn btn--sm" href="index.html">去发现</a>');
    } catch (error) { list.innerHTML = errorBox(error.message, 'favorites'); }
  }

  /* ---------------- messages ---------------- */
  function messageTarget(item) {
    if (item.targetType === 'post' && item.targetId) return `detail.html?id=${encodeURIComponent(item.targetId)}`;
    if (['withdrawal', 'points', 'checkin', 'order'].includes(item.targetType)) return '#wallet';
    if (item.targetType === 'membership') return 'membership.html';
    return '';
  }
  function renderMessages() {
    const list = document.querySelector('#messageList');
    list.innerHTML = state.messages.length ? state.messages.map(item => `<div class="list-row is-clickable${item.readAt ? '' : ' is-unread'}" data-message="${escapeHtml(item.id)}" role="button" tabindex="0"><span class="main"><strong>${escapeHtml(item.title || '系统通知')}</strong><p>${escapeHtml(item.body || '')}</p></span><span class="side"><time class="hint">${escapeHtml(relativeTime(item.createdAt))}</time></span></div>`).join('') : empty('bell', '暂时没有消息', '审核结果、打赏和系统通知会出现在这里。');
  }
  async function loadMessages(reset = true) {
    try {
      const query = new URLSearchParams({ pageSize: '20' });
      if (!reset && state.messageCursor) query.set('cursor', state.messageCursor);
      const body = await api(`/api/v1/me/notifications?${query}`);
      state.messages = reset ? (body.items || []) : state.messages.concat(body.items || []);
      state.messageCursor = body.nextCursor || null;
      document.querySelector('#moreMessages').hidden = !body.hasMore;
      document.querySelector('#readAll').disabled = !Number(body.unread || 0);
      App.updateHeader(me.user, Number(body.unread || 0));
      renderMessages();
    } catch (error) { document.querySelector('#messageList').innerHTML = errorBox(error.message, 'messages'); }
  }
  async function openMessage(id) {
    const item = state.messages.find(message => message.id === id);
    if (!item) return;
    if (!item.readAt) {
      try { await api(`/api/v1/me/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' }); item.readAt = new Date().toISOString(); sessionStorage.removeItem('iyesh:me'); App.refreshMe(true); } catch {}
      renderMessages();
    }
    const target = messageTarget(item);
    if (target === '#wallet') activate('wallet');
    else if (target) location.href = target;
  }

  /* ---------------- wallet ---------------- */
  const LEDGER_LABEL = { checkin_reward: '签到奖励', cdkey_redeem: '兑换码充值', admin_recharge: '后台充值', content_purchase: '购买内容', content_sale_received: '内容售出', tip_spend: '打赏作者', tip_received: '收到打赏', membership_redeem: '兑换会员', withdrawal_hold: '提现申请', withdrawal_refund: '提现退回', referral_commission: '邀请提成', membership_gift: '开通赠送' };
  async function loadLedger(reset = true) {
    const list = document.querySelector('#ledgerList');
    try {
      const query = new URLSearchParams({ pageSize: '20' });
      if (!reset && state.ledgerCursor) query.set('cursor', state.ledgerCursor);
      const body = await api(`/api/v1/me/points/ledger?${query}`);
      balance = Number(body.balance ?? balance); renderWallet();
      const items = body.items || [];
      const html = items.map(item => { const delta = Number(item.delta || 0); return `<div class="list-row"><span class="main"><strong>${escapeHtml(item.reason || LEDGER_LABEL[item.type] || '积分变动')}</strong><small>${escapeHtml(dateText(item.createdAt, true))}${item.note ? `　${escapeHtml(item.note)}` : ''}</small></span><span class="amount ${delta > 0 ? 'plus' : 'minus'}">${delta > 0 ? '+' : ''}${num(delta)}</span></div>`; }).join('');
      if (reset) list.innerHTML = html || empty('wallet', `还没有${unitName}记录`, '签到、兑换码充值或收到打赏后会显示在这里。');
      else list.insertAdjacentHTML('beforeend', html);
      const total = Number(body.total || 0);
      const shown = list.querySelectorAll('.list-row').length;
      state.ledgerCursor = String(shown);
      document.querySelector('#moreLedger').hidden = shown >= total;
    } catch (error) { list.innerHTML = errorBox(error.message, 'wallet'); }
  }
  function renderWithdrawEstimate() {
    const config = state.withdrawConfig;
    const points = Math.max(0, Math.floor(Number(document.querySelector('#withdrawPoints')?.value || 0)));
    const gross = points / (config.pointsPerYuan || 100);
    const fee = gross * (config.withdrawFeePercent || 0) / 100;
    document.querySelector('#estGross').textContent = `¥${gross.toFixed(2)}`;
    document.querySelector('#estFee').textContent = `¥${fee.toFixed(2)}`;
    document.querySelector('#estNet').textContent = `¥${Math.max(0, gross - fee).toFixed(2)}`;
    document.querySelector('#estFeeLabel').textContent = `手续费 ${config.withdrawFeePercent || 0}%`;
    document.querySelector('#withdrawAvailable').textContent = `可用 ${num(balance)}，最低 ${num(config.minPoints || 1)}`;
    document.querySelector('#withdrawRate').textContent = `${num(config.pointsPerYuan)} ${unitName} = ¥1`;
  }
  async function loadWithdrawals() {
    const list = document.querySelector('#withdrawList');
    try {
      const body = await api('/api/v1/me/withdrawals?pageSize=30');
      state.withdrawConfig = { pointsPerYuan: Number(body.pointsPerYuan || 100), withdrawFeePercent: Number(body.withdrawFeePercent || 0), minPoints: Number(body.minPoints || 1) };
      balance = Number(body.balance ?? balance);
      renderWithdrawEstimate();
      const label = { pending: ['处理中', 'tag--pending'], paid: ['已打款', 'tag--ok'], completed: ['已打款', 'tag--ok'], rejected: ['已驳回', 'tag--bad'] };
      list.innerHTML = (body.items || []).length ? body.items.map(item => { const [text, cls] = label[item.status] || [item.status, 'tag--status']; return `<div class="list-row"><span class="main"><strong class="num">${num(item.points)} ${escapeHtml(unitName)} → ¥${Number(item.netAmountRmb || 0).toFixed(2)}</strong><small>${escapeHtml(dateText(item.createdAt, true))}${item.status === 'rejected' && (item.rejectReason || item.note) ? `　${escapeHtml(item.rejectReason || item.note)}` : ''}</small></span><span class="side"><span class="tag ${cls}">${escapeHtml(text)}</span></span></div>`; }).join('') : '<p class="hint" style="padding:8px 0">还没有提现记录。</p>';
    } catch (error) { list.innerHTML = errorBox(error.message, 'wallet'); }
  }
  async function loadOrders() {
    const list = document.querySelector('#orderList');
    try {
      const [orders, tips] = await Promise.all([api('/api/v1/orders?pageSize=30'), api('/api/v1/me/tips?pageSize=30')]);
      const rows = [
        ...(orders.items || []).map(item => ({ at: item.createdAt, title: item.title || (item.kind === 'membership' ? '兑换会员' : '购买内容'), detail: item.kind === 'membership' ? '会员' : '内容解锁', amount: -Number(item.amountPoints || 0), status: item.status, href: item.postId ? `detail.html?id=${encodeURIComponent(item.postId)}` : '' })),
        ...(tips.items || []).map(item => ({ at: item.createdAt, title: item.message ? `打赏：${item.message}` : '打赏作者', detail: '打赏', amount: -Number(item.points || item.amountPoints || 0), status: item.status, href: item.postId ? `detail.html?id=${encodeURIComponent(item.postId)}` : '' }))
      ].sort((a, b) => new Date(b.at) - new Date(a.at));
      list.innerHTML = rows.length ? rows.map(row => `<${row.href ? `a href="${row.href}"` : 'div'} class="list-row${row.href ? ' is-clickable' : ''}"><span class="main"><strong>${escapeHtml(row.title)}</strong><small>${escapeHtml(row.detail)}　${escapeHtml(dateText(row.at, true))}${row.status === 'refunded' ? '　已退款' : ''}</small></span><span class="amount minus">${num(row.amount)}</span></${row.href ? 'a' : 'div'}>`).join('') : '<p class="hint" style="padding:8px 0">还没有购买或打赏记录。</p>';
    } catch (error) { list.innerHTML = errorBox(error.message, 'wallet'); }
  }
  async function submitWithdraw(event) {
    event.preventDefault();
    const error = document.querySelector('#withdrawError');
    const fail = message => { error.textContent = message; error.hidden = false; };
    error.hidden = true;
    const points = Number(document.querySelector('#withdrawPoints').value);
    const phone = document.querySelector('#withdrawPhone').value.trim();
    const config = state.withdrawConfig;
    if (!state.withdrawQr) return fail('请先上传收款码');
    if (!Number.isInteger(points) || points < (config.minPoints || 1)) return fail(`提现数量至少 ${num(config.minPoints || 1)} ${unitName}`);
    if (points > balance) return fail(`余额不足，当前可用 ${num(balance)} ${unitName}`);
    if (!/^1[3-9]\d{9}$/.test(phone)) return fail('请填写 11 位手机号');
    const net = (points / config.pointsPerYuan) * (1 - config.withdrawFeePercent / 100);
    if (!(await App.confirm({ title: '确认提现', message: `提现 ${num(points)} ${unitName}，预计到账 ¥${net.toFixed(2)}。提交后积分会先冻结，打款完成后通知你。`, confirmText: '确认提交' }))) return;
    const button = event.target.querySelector('button[type="submit"]');
    button.classList.add('is-loading');
    try {
      await api('/api/v1/me/withdrawals', { method: 'POST', body: { qrCodeUrl: state.withdrawQr, points, phone, channel: state.withdrawMethod } });
      toast('提现申请已提交', 'success');
      event.target.reset(); state.withdrawQr = '';
      document.querySelector('#qrPreview').outerHTML = `<span class="placeholder" id="qrPreview">${icon('qr')}</span>`;
      sessionStorage.removeItem('iyesh:me');
      await Promise.all([loadWithdrawals(), loadLedger(true)]);
    } catch (requestError) { fail(requestError.message); }
    finally { button.classList.remove('is-loading'); }
  }

  /* ---------------- invite ---------------- */
  let inviteData = null;
  async function loadInvite() {
    try {
      inviteData = await api('/api/v1/me/referral');
      const data = inviteData.referral || inviteData;
      const url = data.shareUrl || (data.code ? new URL(`login.html?ref=${encodeURIComponent(data.code)}`, location.href).href : '');
      document.querySelector('#inviteUrl').value = url || '邀请链接暂未生成';
      const qr = url && window.Share ? window.Share.qrCanvas(url, 132, { margin: 6 }) : null;
      const box = document.querySelector('#inviteQr');
      box.innerHTML = '';
      if (qr) box.appendChild(qr); else box.hidden = true;
      const rate = Number(data.directPercent ?? data.rate1 ?? 0);
      document.querySelector('#inviteRate').textContent = rate ? `提成 ${rate}%` : '';
      document.querySelector('#inviteRate').hidden = !rate;
      document.querySelector('#inviteRule').textContent = `好友通过你的链接注册后成为你的直属好友。他用兑换码充值或兑换会员时，你获得${rate ? ` ${rate}% 的` : ''}${unitName}提成（只算直属一层）。`;
      document.querySelector('#inviteCount').textContent = num(data.level1Count || 0);
      document.querySelector('#inviteTotal').textContent = num(data.totalEarningsPoints || 0);
      document.querySelector('#invitePending').textContent = num(data.pendingEarningsPoints || 0);
      const items = data.commissionItems || [];
      document.querySelector('#inviteList').innerHTML = items.length ? items.map(item => `<div class="list-row"><span class="main"><strong>${escapeHtml(item.inviteeName || '好友')}　${escapeHtml({ points_recharge: '充值', membership_redeem: '兑换会员' }[item.sourceType] || '消费')}</strong><small>${escapeHtml(dateText(item.createdAt, true))}</small></span><span class="amount plus">+${num(item.commissionPoints)}</span></div>`).join('') : '<p class="hint" style="padding:8px 0">还没有提成记录。把邀请海报发给朋友吧。</p>';
    } catch (error) { document.querySelector('#inviteList').innerHTML = errorBox(error.message, 'invite'); }
  }

  /* ---------------- filters ---------------- */
  async function loadFilters() {
    const list = document.querySelector('#filterList');
    try {
      const body = await api('/api/v1/saved-filters');
      const items = body.items || [];
      list.innerHTML = items.length ? items.map(item => { const filter = item.filter || {}; const query = new URLSearchParams(); ['keyword', 'project', 'skill', 'date', 'view', 'mode'].forEach(key => { if (filter[key] && filter[key] !== 'all' && filter[key] !== 'normal') query.set(key, filter[key]); }); if (!filter.view && filter.tab === 'digest') query.set('view', 'digest'); return `<div class="list-row"><a class="main" href="index.html${query.toString() ? `?${query}` : ''}"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(dateText(item.createdAt))} 保存</small></a><span class="side"><a class="btn btn--sm" href="index.html${query.toString() ? `?${query}` : ''}">打开</a><button class="icon-btn" type="button" data-delete-filter="${escapeHtml(item.id)}" aria-label="删除 ${escapeHtml(item.name)}">${icon('trash')}</button></span></div>`; }).join('') : empty('sliders', '还没有常用筛选', '在发现页设置好筛选条件后，点「存为常用」。', '<a class="btn btn--sm" href="index.html">去发现页</a>');
    } catch (error) { list.innerHTML = errorBox(error.message, 'filters'); }
  }

  /* ---------------- tabs ---------------- */
  const loaders = {
    posts: loadPosts,
    favorites: loadMarks,
    messages: () => loadMessages(true),
    wallet: () => Promise.all([loadLedger(true), loadWithdrawals(), loadOrders()]),
    invite: loadInvite,
    filters: loadFilters
  };
  function currentTab() {
    const hash = location.hash.slice(1);
    const queryTab = new URLSearchParams(location.search).get('tab') || '';
    return TABS.includes(queryTab) ? queryTab : TABS.includes(hash) ? hash : LEGACY[hash] || 'posts';
  }
  function activate(name, push = true) {
    document.querySelectorAll('[data-tab]').forEach(tab => { const active = tab.dataset.tab === name; tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; if (active && tab.scrollIntoView && push) tab.scrollIntoView({ inline: 'center', block: 'nearest' }); });
    document.querySelectorAll('[data-panel]').forEach(panel => { panel.hidden = panel.dataset.panel !== name; });
    document.querySelectorAll('.tabbar [data-nav]').forEach(link => { const target = name === 'messages' ? 'messages' : 'profile'; if (link.dataset.nav === target) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
    // WeChat may run its external-link safety check again when a hash URL is
    // changed inside its webview. Keep the selected tab in memory there so
    // switching tabs does not look like opening a new external page.
    if (push && !isWeChat && location.hash.slice(1) !== name) history.replaceState(null, '', `#${name}`);
    if (!loaded.has(name)) { loaded.add(name); loaders[name]?.(); }
  }

  /* ---------------- edit profile ---------------- */
  async function editProfile() {
    const user = me.user || {};
    const body = document.createElement('form');
    body.className = 'form-grid';
    body.innerHTML = `<div class="field"><label class="label" for="pfName">昵称</label><input class="input" id="pfName" maxlength="40" required></div>
      <div class="field"><label class="label" for="pfCity">城市 <small>选填</small></label><input class="input" id="pfCity" maxlength="40"></div>
      <div class="field"><label class="label" for="pfBio">简介 <small>选填</small></label><textarea class="textarea" id="pfBio" rows="3" maxlength="200" placeholder="你主要做什么方向？"></textarea></div>
      <p class="field-error" hidden></p>`;
    body.querySelector('#pfName').value = user.name || '';
    body.querySelector('#pfCity').value = user.city || '';
    body.querySelector('#pfBio').value = user.bio || '';
    await App.modal({ title: '编辑资料', body, actions: [{ label: '取消', value: null }, { label: '保存', primary: true, onClick: async () => {
      const error = body.querySelector('.field-error');
      const name = body.querySelector('#pfName').value.trim();
      if (!name) { error.textContent = '昵称不能为空'; error.hidden = false; return false; }
      try {
        const result = await api('/api/v1/me/profile', { method: 'PATCH', body: { name, nickname: name, city: body.querySelector('#pfCity').value.trim(), bio: body.querySelector('#pfBio').value.trim() } });
        me.user = { ...me.user, ...result.profile };
        session.update(me.user);
        sessionStorage.removeItem('iyesh:me');
        renderIdentity(); App.updateHeader(me.user);
        toast('资料已保存', 'success');
      } catch (requestError) { error.textContent = requestError.message; error.hidden = false; return false; }
    } }] });
  }

  /* ---------------- events ---------------- */
  document.addEventListener('click', async event => {
    const tab = event.target.closest('[role="tab"][data-tab]');
    if (tab) { activate(tab.dataset.tab); return; }
    const open = event.target.closest('[data-open-tab]');
    if (open) { activate(open.dataset.openTab); document.querySelector('.profile-tabs').scrollIntoView({ behavior: 'smooth' }); return; }
    if (event.target.closest('#editProfile')) { editProfile(); return; }
    if (event.target.closest('#logout')) {
      if (!(await App.confirm({ title: '退出登录', message: '退出后需要重新登录才能发布和查看会员内容。', confirmText: '退出' }))) return;
      try { await api('/api/v1/auth/logout', { method: 'POST' }); } catch {}
      session.clear(); location.href = 'index.html'; return;
    }
    const checkin = event.target.closest('#checkinBtn');
    if (checkin) { doCheckin(checkin); return; }
    const retry = event.target.closest('[data-retry]');
    if (retry) { loaders[retry.dataset.retry]?.(); return; }
    const status = event.target.closest('#postFilter [data-status]');
    if (status) { state.postStatus = status.dataset.status; document.querySelectorAll('#postFilter [data-status]').forEach(item => item.setAttribute('aria-pressed', String(item === status))); loadPosts(); return; }
    const type = event.target.closest('#markFilter [data-type]');
    if (type) { state.markType = type.dataset.type; document.querySelectorAll('#markFilter [data-type]').forEach(item => item.setAttribute('aria-pressed', String(item === type))); loadMarks(); return; }
    const archive = event.target.closest('[data-archive]');
    if (archive) {
      if (!(await App.confirm({ title: '删除投稿', message: '删除后这篇投稿会下线，且不能恢复。', confirmText: '删除', danger: true }))) return;
      try { await api(`/api/v1/posts/${encodeURIComponent(archive.dataset.archive)}`, { method: 'DELETE' }); toast('投稿已删除', 'success'); loadPosts(); } catch (error) { toast(error.message, 'error'); }
      return;
    }
    const message = event.target.closest('[data-message]');
    if (message) { openMessage(message.dataset.message); return; }
    if (event.target.closest('#readAll')) {
      try { await api('/api/v1/me/notifications/read-all', { method: 'POST', body: {} }); state.messages.forEach(item => { item.readAt = item.readAt || new Date().toISOString(); }); renderMessages(); sessionStorage.removeItem('iyesh:me'); App.updateHeader(me.user, 0); document.querySelector('#readAll').disabled = true; toast('已全部标为已读', 'success'); } catch (error) { toast(error.message, 'error'); }
      return;
    }
    if (event.target.closest('#moreMessages')) { loadMessages(false); return; }
    if (event.target.closest('#moreLedger')) { loadLedger(false); return; }
    const method = event.target.closest('#withdrawMethod [data-method]');
    if (method) { state.withdrawMethod = method.dataset.method; document.querySelectorAll('#withdrawMethod [data-method]').forEach(item => item.setAttribute('aria-pressed', String(item === method))); return; }
    if (event.target.closest('#copyInvite')) { const url = document.querySelector('#inviteUrl').value; toast(await App.copyText(url) ? '邀请链接已复制' : '复制失败，请长按链接复制', 'success'); return; }
    if (event.target.closest('#invitePoster')) {
      const data = inviteData?.referral || inviteData || {};
      const url = document.querySelector('#inviteUrl').value;
      if (!/^https?:/i.test(url)) { toast('邀请链接暂未生成'); return; }
      window.Share.open({ kind: 'invite', title: '邀请好友加入月入万刀', name: me.user?.name, code: data.code, url, shareLink: url });
      return;
    }
    const deleteFilter = event.target.closest('[data-delete-filter]');
    if (deleteFilter) {
      if (!(await App.confirm({ title: '删除常用筛选', message: '确定删除这组筛选吗？', confirmText: '删除', danger: true }))) return;
      try { await api(`/api/v1/saved-filters/${encodeURIComponent(deleteFilter.dataset.deleteFilter)}`, { method: 'DELETE' }); toast('已删除', 'success'); loadFilters(); } catch (error) { toast(error.message, 'error'); }
    }
  });
  document.addEventListener('keydown', event => { if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-message]')) { event.preventDefault(); openMessage(event.target.dataset.message); } });
  document.querySelector('#withdrawForm').addEventListener('submit', submitWithdraw);
  document.querySelector('#withdrawPoints').addEventListener('input', renderWithdrawEstimate);
  document.querySelector('#withdrawQr').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const preview = document.querySelector('#qrPreview');
    preview.innerHTML = '<span class="spinner"></span>';
    try {
      const compressed = await App.compressImage(file, { maxDimension: 1400 });
      const uploaded = await App.uploadImage(compressed);
      state.withdrawQr = uploaded.url;
      preview.outerHTML = `<img id="qrPreview" src="${escapeHtml(App.mediaUrl(uploaded.url))}" alt="收款码预览">`;
    } catch (error) { preview.innerHTML = icon('qr'); toast(error.message, 'error'); }
  });
  window.addEventListener('hashchange', () => activate(currentTab(), false));

  /* ---------------- boot ---------------- */
  async function boot() {
    if (!session.loggedIn()) {
      document.querySelector('#gate').hidden = false;
      document.querySelector('#gateLogin').href = App.loginUrl();
      return;
    }
    document.querySelector('#profile').hidden = false;
    try {
      const [meResult, config] = await Promise.all([api('/api/v1/me'), api('/api/v1/points/config', { auth: false }).catch(() => ({}))]);
      me = meResult;
      unitName = config.unitName || me.points?.unitName || unitName;
      balance = Number(me.points?.balance || 0);
    } catch (error) {
      if (error.status === 401) { document.querySelector('#profile').hidden = true; document.querySelector('#gate').hidden = false; document.querySelector('#gateLogin').href = App.loginUrl(); return; }
      document.querySelector('#identity').innerHTML = errorBox(error.message, 'boot');
      return;
    }
    session.update(me.user || {});
    renderIdentity();
    renderWallet();
    loadCheckin();
    activate(currentTab(), false);
  }
  loaders.boot = boot;
  boot();
})();
