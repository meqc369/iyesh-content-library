const API = window.CONTENT_API_BASE || 'http://127.0.0.1:8787';
const plansEl = document.querySelector('#plans');
const memberStatusEl = document.querySelector('#memberStatus');
const ordersEl = document.querySelector('#orders');
const toastEl = document.querySelector('#toast');
const purchaseGuideEl = document.querySelector('#purchaseGuide');
const purchaseUnitEl = document.querySelector('#purchaseUnit');
const offlineIconEl = document.querySelector('#offlineIcon');
const offlineTitleEl = document.querySelector('#offlineTitle');
const offlineNoteEl = document.querySelector('#offlineNote');
const redeemForm = document.querySelector('#cdkeyRedeemForm');
const redeemMessageEl = document.querySelector('#redeemMessage');
const params = new URLSearchParams(location.search);
let pointUnitName = '积分';
let purchaseContact = {};
const REQUEST_TIMEOUT_MS = 6500;
const authHeaders = () => { const token = localStorage.getItem('accessToken'); return token ? { Authorization: `Bearer ${token}` } : {}; };
try {
  const currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
  const avatar = document.querySelector('.top-actions .avatar');
  if (avatar && currentUser) { avatar.textContent = String(currentUser.name || currentUser.nickname || '林').slice(0, 1); avatar.title = currentUser.name || currentUser.nickname || '个人中心'; }
} catch {}
function toast(message) { toastEl.textContent = message; toastEl.classList.add('show'); setTimeout(() => toastEl.classList.remove('show'), 1800); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
async function request(path, options = {}) { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS); let response; try { response = await fetch(`${API}${path}`, { ...options, signal: controller.signal, headers: { ...authHeaders(), ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) } }); } catch (error) { if (error.name === 'AbortError') throw new Error('服务响应较慢，请稍后重试'); throw error; } finally { clearTimeout(timer); } const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.message || `请求失败 ${response.status}`); return body; }
function planId(plan) { return plan.id || plan.planId; }
function planBenefits(plan) {
  const values = [];
  const permissionLabels = { 'content.member.read': '查看会员内容', 'content.read': '查看会员内容', 'content.download': '下载资料', 'content.publish': '发布内容', 'content.tip': `${pointUnitName}打赏`, 'community.private': '私享社区', 'support.priority': '优先客服' };
  const permissionNames = plan.permissions || plan.entitlements || plan.features;
  if (Array.isArray(permissionNames)) values.push(...permissionNames.map(value => { const code = typeof value === 'string' ? value : value.name || value.label; return permissionLabels[code] || code; }).filter(Boolean));
  if (Array.isArray(plan.benefits)) values.push(...plan.benefits.map(value => typeof value === 'string' ? value : value.name || value.label).filter(Boolean));
  if (Number(plan.giftPoints ?? plan.initialPoints ?? plan.bonusPoints ?? 0) > 0) values.push(`赠送 ${Number(plan.giftPoints ?? plan.initialPoints ?? plan.bonusPoints)} ${pointUnitName}`);
  return values.slice(0, 6);
}
function contactQrUrl() {
  if (purchaseContact.qrCodeUrl) return purchaseContact.qrCodeUrl;
  if (purchaseContact.wechatId) return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(`微信号:${purchaseContact.wechatId}`)}`;
  return '';
}
function renderPurchaseGuide() {
  const qr = contactQrUrl();
  const wechat = purchaseContact.wechatId ? `客服微信：${purchaseContact.wechatId}` : '请联系管理员获取客服微信';
  const note = purchaseContact.note || '添加客服微信购买兑换码。';
  purchaseUnitEl.textContent = pointUnitName;
  purchaseGuideEl.innerHTML = `${qr ? `<img src="${escapeHtml(qr)}" alt="客服微信二维码"><div class="purchase-guide-copy"><strong>扫码或长按保存二维码</strong><span>${escapeHtml(wechat)}</span><span>${escapeHtml(note)}</span><a href="${escapeHtml(qr)}" target="_blank" rel="noreferrer">打开二维码</a></div>` : `<div class="purchase-guide-copy"><strong>${escapeHtml(wechat)}</strong><span>${escapeHtml(note)}</span></div>`}`;
}
function renderOfflineGuide() {
  const title = String(purchaseContact.offlineTitle || '线下开通').trim() || '线下开通';
  const note = String(purchaseContact.offlineNote || '联系管理员完成收款，确认后立即生效。').trim() || '联系管理员完成收款，确认后立即生效。';
  if (offlineIconEl) offlineIconEl.textContent = title;
  if (offlineTitleEl) offlineTitleEl.textContent = title;
  if (offlineNoteEl) offlineNoteEl.textContent = note;
}
function renderPlans(items) {
  plansEl.innerHTML = items.length ? items.map(plan => {
    const benefits = planBenefits(plan);
    const disabled = ['inactive', 'disabled', 'archived'].includes(String(plan.status || ''));
    const redeemPoints = Number(plan.redeemPoints ?? plan.pricePoints ?? 0);
    return `<article class="plan-card"><div class="plan-top"><h2>${escapeHtml(plan.name || plan.groupName || '会员等级')}</h2><span>${disabled ? '已停用' : '可兑换'}</span></div><p>${escapeHtml(plan.description || '会员专享内容')}</p>${benefits.length ? `<div class="plan-benefits">${benefits.map(value => `<span>${escapeHtml(value)}</span>`).join('')}</div>` : ''}<strong>${redeemPoints > 0 ? `${redeemPoints.toLocaleString()} ${escapeHtml(pointUnitName)}` : '管理员线下开通'}</strong><small>${Number(plan.durationDays || 30)} 天有效 · ${escapeHtml(plan.groupName || '会员等级')}</small><button class="offline-action" data-plan-id="${escapeHtml(String(planId(plan)))}" ${disabled ? 'disabled' : ''}>${disabled ? '暂不可用' : (redeemPoints > 0 ? `使用 ${redeemPoints.toLocaleString()} ${escapeHtml(pointUnitName)}兑换` : '联系管理员开通')}</button></article>`;
  }).join('') : '<div class="detail-card"><p class="sub">暂无可申请的会员等级。</p></div>';
}
function requestActivation(planIdValue) {
  if (!localStorage.getItem('accessToken')) { location.href = `login.html?return=${encodeURIComponent(location.href)}`; return; }
  const plan = plansEl.querySelector(`[data-plan-id="${CSS.escape(String(planIdValue))}"]`)?.closest('.plan-card');
  const name = plan?.querySelector('h2')?.textContent || '该会员等级';
  toast(`已记录意向，请联系管理员开通${name}`);
}
async function redeemPlan(planIdValue, button) {
  if (!localStorage.getItem('accessToken')) { location.href = `login.html?return=${encodeURIComponent(location.href)}`; return; }
  const plan = button?.closest('.plan-card'); const pointsText = plan?.querySelector('strong')?.textContent || '';
  if (!window.confirm(`确认使用 ${pointsText} 开通 ${plan?.querySelector('h2')?.textContent || '该会员等级'}？开通后会立即扣除积分并开始计算有效期。`)) return;
  if (button) button.disabled = true;
  try { await request(`/api/v1/member/plans/${encodeURIComponent(planIdValue)}/activate`, { method: 'POST', body: JSON.stringify({}) }); toast('会员兑换成功'); await load(); }
  catch (error) { toast(error.message || '会员兑换失败'); }
  finally { if (button) button.disabled = false; }
}
async function redeemCdkey(event) {
  event.preventDefault();
  if (!localStorage.getItem('accessToken')) { location.href = `login.html?return=${encodeURIComponent(location.href)}`; return; }
  const form = event.target; const code = String(new FormData(form).get('code') || '').trim(); if (!code) return;
  const button = form.querySelector('button'); button.disabled = true; redeemMessageEl.textContent = '正在兑换…';
  try { const body = await request('/api/v1/cdkeys/redeem', { method: 'POST', body: JSON.stringify({ code }) }); redeemMessageEl.textContent = `兑换成功，到账 ${Number(body.points || 0).toLocaleString()} ${body.unitName || pointUnitName}，当前余额 ${Number(body.balance || 0).toLocaleString()} ${body.unitName || pointUnitName}`; form.reset(); await load(); }
  catch (error) { redeemMessageEl.textContent = error.message || '兑换失败'; }
  finally { button.disabled = false; }
}
async function load() {
  const [configResult, plansResult, memberResult, ordersResult] = await Promise.allSettled([
    request('/api/v1/points/config'), request('/api/v1/member/plans'), request('/api/v1/member/me'), request('/api/v1/orders')
  ])
  if (configResult.status === 'fulfilled') { const config = configResult.value; pointUnitName = config.unitName || config.unit || pointUnitName; purchaseContact = config.purchaseContact || {}; renderPurchaseGuide(); renderOfflineGuide(); } else { renderPurchaseGuide(); renderOfflineGuide(); }
  if (plansResult.status === 'fulfilled') renderPlans(plansResult.value.items || plansResult.value.plans || [])
  else { const error = plansResult.reason; plansEl.innerHTML = `<div class="detail-card load-error"><p class="sub">${escapeHtml(error.message || '会员等级暂时不可用')}</p><button id="retryPlans" class="outline-btn" type="button">重新加载</button></div>`; document.querySelector('#retryPlans')?.addEventListener('click', load, { once: true }); }
  if (memberResult.status === 'fulfilled') { const member = memberResult.value; const current = member.membership || member.member || member; pointUnitName = member.points?.unitName || member.points?.unit || pointUnitName; const points = member.pointsBalance ?? member.points?.balance ?? member.wallet?.balance; memberStatusEl.textContent = current?.planName || current?.groupName ? `当前：${current.planName || current.groupName}${points != null ? ` · ${Number(points)} ${pointUnitName}` : ''}` : `当前为普通用户${points != null ? ` · ${Number(points)} ${pointUnitName}` : ''}`; }
  else memberStatusEl.textContent = localStorage.getItem('accessToken') ? '当前为普通用户' : '请登录查看会员状态'
  if (ordersResult.status === 'fulfilled') { const body = ordersResult.value; const items = body.items || body.orders || []; ordersEl.innerHTML = items.length ? items.slice(0, 8).map(item => `<div class="order-row"><span>${escapeHtml(item.title || item.kindLabel || item.kind || '管理员记录')}</span><span>${item.amountPoints != null ? `${Number(item.amountPoints)} ${escapeHtml(pointUnitName)}` : (item.kind === 'tip' ? `${Number(item.amountPoints || item.points || 0)} ${escapeHtml(pointUnitName)}` : '线下登记')}</span><span class="order-status">${escapeHtml(item.status || 'pending')}</span></div>`).join('') : '<p class="sub">暂无记录。</p>'; }
  else ordersEl.innerHTML = '<p class="sub">登录后查看记录。</p>'
}
plansEl.addEventListener('click', event => { const button = event.target.closest('[data-plan-id]'); if (!button) return; const plan = [...plansEl.querySelectorAll('.plan-card')].find(card => card.contains(button)); const pointsText = plan?.querySelector('strong')?.textContent || ''; if (/管理员线下开通/.test(pointsText)) requestActivation(button.dataset.planId); else redeemPlan(button.dataset.planId, button); });
redeemForm?.addEventListener('submit', redeemCdkey);
load();
