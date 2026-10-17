/* 会员中心：会员方案、积分开通、兑换码充值、购买指引 */
(function () {
  'use strict';
  const App = window.App;
  const { api, icon, escapeHtml, toast, num, dateText, session } = App;

  const PERMISSION_LABELS = { 'content.member.read': '阅读全部会员专享内容', 'content.pro.read': '阅读高级会员内容', 'content.read': '阅读会员内容', 'content.download': '下载会员资料', 'content.publish': '发布内容', 'content.tip': '积分打赏', 'community.private': '加入私享社群', 'support.priority': '优先客服' };
  let unitName = '积分';
  let balance = null;
  let membership = null;
  let plans = [];
  let contact = {};

  const returnTo = (() => {
    const raw = new URLSearchParams(location.search).get('return');
    if (!raw) return '';
    try { const url = new URL(raw, location.href); return url.origin === location.origin ? url.pathname + url.search : ''; } catch { return ''; }
  })();

  function renderStatus() {
    const node = document.querySelector('#memberStatus');
    if (!session.loggedIn()) { node.innerHTML = `<span>还没有登录</span><a href="${App.loginUrl()}">登录后查看会员状态</a>`; return; }
    const parts = [];
    parts.push(membership ? `当前：<strong>${escapeHtml(membership.planName || membership.groupName || '会员')}</strong>${membership.endsAt ? `，有效期至 <span class="num">${escapeHtml(dateText(membership.endsAt))}</span>` : ''}` : '当前还不是会员');
    if (balance !== null) parts.push(`余额 <span class="num">${num(balance)}</span> ${escapeHtml(unitName)}`);
    // Each part is one flex item, so the gap only falls between parts.
    node.innerHTML = parts.map(part => `<span>${part}</span>`).join('');
    const tag = document.querySelector('#balanceTag');
    if (balance !== null) { tag.hidden = false; tag.innerHTML = `余额 <span class="num">${num(balance)}</span> ${escapeHtml(unitName)}`; }
  }

  function benefits(plan) {
    const list = [];
    (plan.permissions || []).forEach(code => { const label = PERMISSION_LABELS[code]; if (label && !list.includes(label)) list.push(label); });
    (plan.benefits || []).forEach(item => { const text = typeof item === 'string' ? item : item?.name; if (text && !list.includes(text)) list.push(text); });
    const gift = Number(plan.initialPoints ?? plan.giftPoints ?? 0);
    if (gift > 0) list.push(`开通赠送 ${num(gift)} ${unitName}`);
    return list.slice(0, 6);
  }
  function renderPlans() {
    const node = document.querySelector('#plans');
    if (!plans.length) { node.innerHTML = `<div class="sheet panel empty">${icon('member')}<strong>会员方案正在准备中</strong><p>可以先通过兑换码充值${escapeHtml(unitName)}。</p></div>`; return; }
    const featured = plans.reduce((best, plan) => (Number(plan.durationDays || 0) > Number(best?.durationDays || 0) ? plan : best), null);
    node.innerHTML = plans.map(plan => {
      const points = Number(plan.redeemPoints ?? plan.pricePoints ?? 0);
      const days = Number(plan.durationDays || 30);
      const perMonth = days >= 60 && points ? Math.round(points / (days / 30)) : 0;
      const isCurrent = membership && membership.planId === plan.id;
      const isFeatured = plans.length > 1 && plan === featured;
      return `<article class="note note--seal plan${isFeatured ? ' is-featured' : ''}">
        ${isFeatured ? '<span class="tag tag--digest ribbon">更划算</span>' : ''}
        <div class="plan-top"><h2>${escapeHtml(plan.name)}</h2><span class="group">${escapeHtml(plan.groupName || '会员')}</span></div>
        <div><div class="face num">${points > 0 ? num(points) : '—'}<small>${escapeHtml(unitName)}</small></div></div>
        <p class="per">${days >= 365 && days % 365 === 0 ? `${days / 365} 年有效` : `${days} 天有效`}${perMonth ? `，约每月 ${num(perMonth)} ${escapeHtml(unitName)}` : ''}</p>
        ${plan.description ? `<p class="hint">${escapeHtml(plan.description)}</p>` : ''}
        <ul>${benefits(plan).map(item => `<li>${icon('check')}<span>${escapeHtml(item)}</span></li>`).join('')}</ul>
        <button class="btn ${isFeatured ? 'btn--seal' : 'btn--ink'} btn--block" type="button" data-plan="${escapeHtml(plan.id)}" ${points > 0 ? '' : 'disabled'}>${points > 0 ? `${isCurrent ? '续费' : '开通'}：${num(points)} ${escapeHtml(unitName)}` : '请联系客服开通'}</button>
      </article>`;
    }).join('');
  }

  function renderContact() {
    const node = document.querySelector('#contact');
    const wechat = String(contact.wechatId || '').trim();
    const qr = String(contact.qrCodeUrl || contact.wechatQrUrl || '').trim();
    document.querySelector('#contactLine').textContent = contact.note || contact.instructions || '说明你想购买的积分数量。';
    document.querySelector('#offlineLine').textContent = contact.offlineNote || '客服确认收款后发给你一串兑换码。';
    if (!wechat && !qr) { node.hidden = true; return; }
    node.hidden = false;
    node.innerHTML = `${qr ? `<img src="${escapeHtml(App.mediaUrl(qr))}" alt="客服微信二维码">` : ''}<div><strong>${escapeHtml(contact.displayName || '客服微信')}</strong><p class="hint">${qr ? '长按识别二维码添加' : '复制微信号后在微信里搜索添加'}</p>${wechat ? `<div class="wechat">${escapeHtml(wechat)}<button class="btn btn--sm" type="button" id="copyWechat" data-icon="copy">复制</button></div>` : ''}</div>`;
    node.querySelectorAll('[data-icon]').forEach(item => item.insertAdjacentHTML('afterbegin', icon(item.dataset.icon)));
  }

  async function loadRedemptions() {
    const list = document.querySelector('#redeemList');
    if (!session.loggedIn()) return;
    try {
      const body = await api('/api/v1/me/cdkey-redemptions?pageSize=10');
      const items = body.items || [];
      list.innerHTML = items.length ? items.map(item => `<div class="list-row"><span class="main"><strong class="num">${escapeHtml(item.code || '兑换码')}</strong><small>${escapeHtml(dateText(item.createdAt, true))}</small></span><span class="amount plus">+${num(item.points)}</span></div>`).join('') : '<p class="hint">还没有兑换记录。</p>';
    } catch { list.innerHTML = '<p class="hint">兑换记录暂时无法加载。</p>'; }
  }

  async function activate(planId) {
    if (!session.loggedIn()) { App.goLogin(); return; }
    const plan = plans.find(item => String(item.id) === String(planId));
    if (!plan) return;
    const points = Number(plan.redeemPoints ?? plan.pricePoints ?? 0);
    if (balance !== null && balance < points) {
      const go = await App.modal({ title: `${unitName}不足`, body: `<p>开通「${escapeHtml(plan.name)}」需要 <strong class="num">${num(points)}</strong> ${escapeHtml(unitName)}，你现在有 <strong class="num">${num(balance)}</strong> ${escapeHtml(unitName)}。</p><p class="hint" style="margin-top:8px">按下方步骤购买兑换码，充值后再开通。</p>`, actions: [{ label: '知道了', value: false }, { label: '去充值', primary: true, value: true }] });
      if (go) { document.querySelector('#redeem').scrollIntoView({ behavior: 'smooth' }); setTimeout(() => document.querySelector('#codeInput').focus({ preventScroll: true }), 400); }
      return;
    }
    const extend = membership && membership.planId === plan.id;
    if (!(await App.confirm({ title: extend ? '确认续费' : '确认开通', message: `将使用 ${num(points)} ${unitName}${extend ? '续费' : '开通'}「${plan.name}」，有效期 ${plan.durationDays} 天，立即生效。`, confirmText: extend ? '确认续费' : '确认开通' }))) return;
    const button = document.querySelector(`[data-plan="${CSS.escape(String(planId))}"]`);
    button?.classList.add('is-loading');
    try {
      const result = await api(`/api/v1/member/plans/${encodeURIComponent(planId)}/activate`, { method: 'POST', body: { idempotencyKey: `plan_${planId}_${Date.now()}` } });
      sessionStorage.removeItem('iyesh:me');
      const redeemMessage = document.querySelector('#redeemMessage');
      redeemMessage.className = 'hint'; redeemMessage.style.color = ''; redeemMessage.textContent = `兑换成功后${unitName}立即到账，可用于开通会员、解锁内容和打赏。`;
      toast(`已开通${plan.name}${result.giftPoints ? `，赠送 ${num(result.giftPoints)} ${unitName}` : ''}`, 'success');
      await load();
      if (returnTo) document.querySelector('#returnHint').innerHTML = `<div class="inline-alert inline-alert--info" style="margin-top:16px">${icon('check')}<span>会员已生效，可以回去继续阅读了。</span><a class="btn btn--sm btn--primary" href="${escapeHtml(returnTo)}">返回内容</a></div>`;
    } catch (error) { toast(error.message, 'error'); }
    finally { button?.classList.remove('is-loading'); }
  }

  async function redeem(event) {
    event.preventDefault();
    if (!session.loggedIn()) { App.goLogin(); return; }
    const input = document.querySelector('#codeInput');
    const code = input.value.trim();
    const message = document.querySelector('#redeemMessage');
    if (!code) { input.focus(); return; }
    const button = event.target.querySelector('button');
    button.classList.add('is-loading');
    try {
      const result = await api('/api/v1/cdkeys/redeem', { method: 'POST', body: { code } });
      balance = Number(result.balance ?? balance);
      message.className = 'hint'; message.style.color = 'var(--money)';
      message.textContent = `兑换成功，到账 ${num(result.points)} ${result.unitName || unitName}，余额 ${num(balance)}。`;
      input.value = '';
      sessionStorage.removeItem('iyesh:me');
      toast('兑换成功', 'success');
      renderStatus(); loadRedemptions();
    } catch (error) {
      message.className = 'field-error'; message.style.color = '';
      message.textContent = error.message;
    } finally { button.classList.remove('is-loading'); }
  }

  async function load() {
    const requests = [api('/api/v1/points/config', { auth: false }), api('/api/v1/member/plans', { auth: false })];
    if (session.loggedIn()) requests.push(api('/api/v1/member/me'));
    const [config, planBody, member] = await Promise.allSettled(requests);
    if (config.status === 'fulfilled') { unitName = config.value.unitName || unitName; contact = config.value.purchaseContact || {}; }
    if (planBody.status === 'fulfilled') plans = planBody.value.items || [];
    else document.querySelector('#plans').innerHTML = `<div class="sheet panel"><div class="inline-alert inline-alert--error">${icon('alert')}<span>会员方案加载失败</span><button class="btn btn--sm" type="button" id="retryPlans">重试</button></div></div>`;
    if (member?.status === 'fulfilled') { membership = member.value.active || null; balance = Number(member.value.points?.balance ?? 0); }
    renderStatus();
    if (planBody.status === 'fulfilled') renderPlans();
    renderContact();
  }

  document.addEventListener('click', async event => {
    const plan = event.target.closest('[data-plan]');
    if (plan) { activate(plan.dataset.plan); return; }
    if (event.target.closest('#retryPlans')) { load(); return; }
    if (event.target.closest('#copyWechat')) toast(await App.copyText(contact.wechatId) ? '微信号已复制' : '复制失败，请手动输入', 'success');
  });
  document.querySelector('#redeemForm').addEventListener('submit', redeem);
  document.querySelector('#codeInput').addEventListener('input', event => { const caret = event.target.selectionStart; event.target.value = event.target.value.toUpperCase().replace(/\s+/g, ''); try { event.target.setSelectionRange(caret, caret); } catch {} });
  load().then(() => { loadRedemptions(); if (location.hash === '#redeem') setTimeout(() => document.querySelector('#redeem').scrollIntoView({ behavior: 'smooth' }), 200); });
})();
