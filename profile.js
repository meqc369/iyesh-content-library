const API = window.CONTENT_API_BASE || 'http://127.0.0.1:8787';
const REQUEST_TIMEOUT_MS = 8000;
let pointUnitName = '积分';
let currentPointsBalance = 0;
let withdrawalConfig = { pointsPerYuan: 100, withdrawFeePercent: 0, minPoints: 1 };
let withdrawalQrUrl = '';
const gate = document.querySelector('#profileGate');
const content = document.querySelector('#profileContent');
const toastEl = document.querySelector('#toast');
const editForm = document.querySelector('#profileEditForm');
const editButton = document.querySelector('#editProfileBtn');
let currentUserData = null;
let currentMemberData = {};
let currentNotifications = [];
let notificationsCursor = null;
let notificationsHasMore = false;
let notificationsPath = null;
const notificationPageSize = 12;
const loadedProfilePanels = new Set();
const authHeaders = () => { const token = localStorage.getItem('accessToken'); return token ? { Authorization: `Bearer ${token}` } : {}; };
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
function toast(message) { toastEl.textContent = message; toastEl.classList.add('show'); window.clearTimeout(toast.timer); toast.timer = window.setTimeout(() => toastEl.classList.remove('show'), 1800); }
async function request(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${API}${path}`, { ...options, signal: controller.signal, headers: { ...authHeaders(), ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) } });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('服务响应较慢，请稍后重试');
    throw error;
  } finally { clearTimeout(timer); }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(body.message || `请求失败 ${response.status}`); error.status = response.status; throw error; }
  return body;
}
function amount(cents) { return `¥${(Number(cents || 0) / 100).toFixed(2)}`; }
function pointsValue(body) { const wallet = body?.wallet || body?.points || body || {}; return Number(wallet.balance ?? wallet.pointsBalance ?? wallet.amount ?? 0); }
async function requestFirst(paths) { let last; for (const path of paths) { try { return await request(path); } catch (error) { last = error; if (![404, 405].includes(error.status)) throw error; } } throw last || new Error('积分服务暂不可用'); }
function statusLabel(status) { return ({ paid: '已支付', pending: '待支付', cancelled: '已取消', refunded: '已退款', expired: '已过期' }[status] || status || '未知'); }
function submissionStatusLabel(status) { return ({ draft: '草稿', pending: '待审核', pending_review: '待审核', published: '已发布', rejected: '已驳回', archived: '已下线' }[status] || status || '待审核'); }
function formatDate(value) { if (!value) return ''; const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('zh-CN'); }
function showError(target, retry) { target.innerHTML = `<div class="profile-error"><span>暂时加载失败，请重试。</span><button type="button">重试</button></div>`; target.querySelector('button')?.addEventListener('click', retry, { once: true }); }
function renderProfile(me, member) {
  const user = me.user || JSON.parse(localStorage.getItem('currentUser') || '{}');
  currentUserData = user;
  currentMemberData = member || {};
  const name = user.name || '月入万刀用户';
  document.querySelector('#profileName').textContent = name;
  document.querySelector('#profileAvatar').textContent = name.slice(0, 1);
  const headerAvatar = document.querySelector('.top-actions .avatar');
  if (headerAvatar) { headerAvatar.textContent = name.slice(0, 1); headerAvatar.title = name; }
  document.querySelector('#profileAvatar').title = user.avatarUrl ? '已设置头像' : name;
  const account = document.querySelector('#profileAccount'); if (account) account.textContent = [user.username ? `@${user.username}` : '', user.email || ''].filter(Boolean).join(' · ') || '月入万刀用户';
  document.querySelector('#profileMeta').textContent = member?.active?.planName ? `ID：${user.id || '—'} · ${member.active.planName}有效` : `ID：${user.id || '—'} · 普通用户`;
  document.querySelector('#membershipStat').textContent = member?.active?.planName || '普通用户';
  const memberships = member?.memberships || [];
  if (member?.active) {
    const permissions = member.active.permissions || member.active.entitlements || member.entitlements || [];
    const permissionText = Array.isArray(permissions) ? permissions.map(item => typeof item === 'string' ? item : item.name || item.label).filter(Boolean).slice(0, 5).join('、') : '';
    document.querySelector('#membershipPanel').innerHTML = `<strong>${escapeHtml(member.active.planName || member.active.groupName || '会员')}</strong><span class="profile-visibility">${escapeHtml(member.active.groupName || '会员组')} · 到期 ${escapeHtml(formatDate(member.active.endsAt || member.active.expiresAt) || '长期有效')}</span>${permissionText ? `<small class="profile-visibility">权限：${escapeHtml(permissionText)}</small>` : ''}`;
  } else document.querySelector('#membershipPanel').innerHTML = '<span class="profile-empty">当前暂无有效会员，联系管理员线下开通后即可获得对应会员组权限。</span>';
  return user;
}
function openEditProfile() {
  if (!editForm || !currentUserData) return;
  editForm.elements.name.value = currentUserData.name || '';
  editForm.elements.bio.value = currentUserData.bio || '';
  editForm.elements.city.value = currentUserData.city || '';
  editForm.hidden = false;
  editButton?.setAttribute('aria-expanded', 'true');
}
function closeEditProfile() { if (editForm) editForm.hidden = true; editButton?.setAttribute('aria-expanded', 'false'); }
function setupProfileTabs() {
  const tabs = [...document.querySelectorAll('[data-profile-tab]')];
  const panels = [...document.querySelectorAll('[data-profile-container]')];
  if (!tabs.length || !panels.length) return;
  tabs.forEach((tab, index) => { if (!tab.id) tab.id = `profile-tab-${tab.dataset.profileTab}`; });
  panels.forEach((panel, index) => { panel.id = panel.id || `profile-panel-${panel.dataset.profileContainer}-${index}`; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', `profile-tab-${panel.dataset.profileContainer}`); });
  tabs.forEach(tab => { tab.setAttribute('aria-controls', panels.filter(panel => panel.dataset.profileContainer === tab.dataset.profileTab).map(panel => panel.id).join(' ')); });
  const activate = (name, updateHash = true) => {
    tabs.forEach(tab => {
      const active = tab.dataset.profileTab === name;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    panels.forEach(panel => { panel.hidden = panel.dataset.profileContainer !== name; });
    if (updateHash) history.replaceState(null, '', `#${name}`);
    if (!content.hidden && localStorage.getItem('accessToken')) void loadProfilePanel(name);
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activate(tab.dataset.profileTab));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].focus();
      activate(tabs[next].dataset.profileTab);
    });
  });
  const initial = tabs.some(tab => tab.dataset.profileTab === location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
  activate(initial, false);
}
async function loadOrders() { const panel = document.querySelector('#ordersPanel'); try { const body = await request('/api/v1/orders'); const items = body.items || []; document.querySelector('#orderStat').textContent = items.length; panel.innerHTML = items.length ? items.slice(0, 8).map(item => `<div class="profile-row"><div><strong>${escapeHtml(item.title || item.kindLabel || item.kind || '内容订单')}</strong><small>${escapeHtml(formatDate(item.createdAt))}</small></div><span class="amount">${item.amountPoints != null ? `${Number(item.amountPoints)} ${escapeHtml(pointUnitName)}` : '线下登记'}</span><span class="profile-status">${escapeHtml(statusLabel(item.status))}</span></div>`).join('') : '<p class="profile-empty">暂无订单。</p>'; } catch { document.querySelector('#orderStat').textContent = '—'; showError(panel, loadOrders); } }
async function loadTips() {
  const panel = document.querySelector('#tipsPanel');
  try {
    const body = await request('/api/v1/me/tips');
    const items = body.items || [];
    panel.innerHTML = items.length ? items.slice(0, 8).map(item => { const points = Number(item.amountPoints ?? item.points ?? item.delta ?? 0); return `<div class="profile-row"><div><strong>${escapeHtml(item.message || '支持作者')}</strong><small>${escapeHtml(formatDate(item.createdAt))}</small></div><span class="amount">${points} ${escapeHtml(pointUnitName)}</span><span class="profile-status">${escapeHtml(statusLabel(item.status))}</span></div>`; }).join('') : '<p class="profile-empty">还没有打赏记录。</p>';
  } catch { panel.innerHTML = '<p class="profile-empty">打赏记录暂时不可用。</p>'; }
}
async function loadPoints() {
  const summary = document.querySelector('#pointsSummary');
  const ledgerPanel = document.querySelector('#pointsLedger');
  try {
    const body = await requestFirst(['/api/v1/me/points', '/api/v1/points/balance', '/api/v1/me/points/balance']);
    const balance = pointsValue(body);
    currentPointsBalance = balance;
    renderWithdrawalBalance();
    const unit = body.unitName || body.unit || body.wallet?.unitName || body.wallet?.unit || '积分'; pointUnitName = unit;
    document.querySelector('#pointsStat').textContent = balance;
    document.querySelector('#pointsUnit').textContent = unit;
    summary.innerHTML = `<strong>${balance}</strong><span>${escapeHtml(unit)} · 管理员线下充值后到账</span>`;
    renderWithdrawalBalance();
    try {
      const ledgerBody = await requestFirst(['/api/v1/me/points/ledger', '/api/v1/me/points/records', '/api/v1/points/ledger']);
      const items = ledgerBody.items || ledgerBody.records || ledgerBody.ledger || [];
      ledgerPanel.innerHTML = items.length ? items.slice(0, 8).map(item => { const delta = Number(item.delta ?? item.amountPoints ?? item.points ?? 0); const label = delta > 0 ? `+${delta}` : String(delta); return `<div class="profile-row"><div><strong>${escapeHtml(item.reason || item.type || '积分变动')}</strong><small>${escapeHtml(formatDate(item.createdAt))}</small></div><span class="amount ${delta < 0 ? 'negative' : ''}">${label} ${escapeHtml(unit)}</span><span class="profile-status">${item.balanceAfter == null ? '' : `余额 ${Number(item.balanceAfter)}`}</span></div>`; }).join('') : '<p class="profile-empty">暂无积分流水。</p>';
    } catch { ledgerPanel.innerHTML = '<p class="profile-empty">暂无积分流水。</p>'; }
  } catch { document.querySelector('#pointsStat').textContent = '—'; summary.innerHTML = '<span class="profile-empty">积分账户暂时不可用，请稍后重试。</span>'; ledgerPanel.innerHTML = ''; }
}

function withdrawalNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function normalizeWithdrawalConfig(body = {}) {
  const config = body.config || body.withdrawal || body;
  const pointsPerYuan = Math.max(0.000001, withdrawalNumber(config.pointsPerYuan ?? config.pointsPerRmb ?? config.pointsToYuan ?? config.exchangePoints, 100));
  return {
    pointsPerYuan,
    withdrawFeePercent: Math.min(100, Math.max(0, withdrawalNumber(config.withdrawFeePercent ?? config.feePercent ?? config.withdrawalFeePercent, 0))),
    minPoints: Math.max(1, Math.floor(withdrawalNumber(config.minPoints ?? config.minimumPoints ?? config.minWithdrawPoints, 1))),
    maxPoints: Math.max(0, Math.floor(withdrawalNumber(config.maxPoints ?? config.maximumPoints ?? config.maxWithdrawPoints, 0))),
    unitName: String(config.unitName || config.unit || pointUnitName || '积分')
  };
}
function formatRmb(value) { return `¥${Math.max(0, Number(value) || 0).toFixed(2)}`; }
function withdrawalStatusLabel(status) { return ({ pending: '待处理', processing: '处理中', reviewing: '审核中', paid: '已打款', completed: '已打款', rejected: '已驳回', failed: '打款失败', cancelled: '已取消' }[String(status || '').toLowerCase()] || status || '待处理'); }
function withdrawalStatusClass(status) { const normalized = String(status || '').toLowerCase(); return normalized === 'paid' || normalized === 'completed' ? 'is-paid' : normalized === 'rejected' || normalized === 'failed' ? 'is-rejected' : ''; }
function profileMediaUrl(value) { if (!value) return ''; return /^https?:\/\//i.test(value) ? value : `${API}${String(value).startsWith('/') ? '' : '/'}${value}`; }
function setWithdrawalMessage(message, error = false) { const el = document.querySelector('#withdrawalMessage'); if (!el) return; el.textContent = message || ''; el.classList.toggle('error', error); }
function renderWithdrawalEstimate() {
  const input = document.querySelector('#withdrawalPointsInput');
  const points = Math.max(0, Math.floor(withdrawalNumber(input?.value, 0)));
  const gross = Number((points / withdrawalConfig.pointsPerYuan).toFixed(2));
  const fee = Number((gross * (withdrawalConfig.withdrawFeePercent / 100)).toFixed(2));
  const net = Number(Math.max(0, gross - fee).toFixed(2));
  const netEl = document.querySelector('#withdrawalNetAmount'); const feeEl = document.querySelector('#withdrawalFeeAmount'); const rateEl = document.querySelector('#withdrawalRateText');
  const feeLabel = document.querySelector('#withdrawalFeeLabel');
  if (netEl) netEl.textContent = formatRmb(net);
  if (feeEl) feeEl.textContent = formatRmb(fee);
  if (feeLabel) feeLabel.textContent = `手续费 ${withdrawalConfig.withdrawFeePercent}%`;
  if (rateEl) rateEl.textContent = `${withdrawalConfig.pointsPerYuan} ${withdrawalConfig.unitName} / ¥1`;
}
function renderWithdrawalBalance() {
  const el = document.querySelector('#withdrawalBalance');
  if (el) el.textContent = `可提现 ${currentPointsBalance.toLocaleString()} ${withdrawalConfig.unitName || pointUnitName}`;
  const input = document.querySelector('#withdrawalPointsInput');
  if (input) { input.max = String(currentPointsBalance); input.min = String(withdrawalConfig.minPoints); }
  renderWithdrawalEstimate();
}
function renderWithdrawalHistory(items = []) {
  const panel = document.querySelector('#withdrawalHistory');
  if (!panel) return;
  panel.innerHTML = items.length ? items.slice(0, 30).map(item => {
    const points = Number(item.points ?? item.amountPoints ?? 0);
    const net = item.netAmountRmb ?? item.netAmountYuan ?? item.amountRmb ?? item.amountYuan;
    const status = withdrawalStatusLabel(item.status);
    return `<div class="withdrawal-record"><div><strong>${points.toLocaleString()} ${escapeHtml(item.unitName || withdrawalConfig.unitName || pointUnitName)}</strong><small>${escapeHtml(formatDate(item.createdAt || item.submittedAt))}${net != null ? ` · 到账 ${escapeHtml(formatRmb(net))}` : ''}</small></div><span class="withdrawal-status ${withdrawalStatusClass(item.status)}">${escapeHtml(status)}</span></div>`;
  }).join('') : '<p class="profile-empty">暂无提现记录。</p>';
}
async function loadWithdrawalConfig() {
  try {
    const body = await request('/api/v1/points/withdrawal-config');
    withdrawalConfig = normalizeWithdrawalConfig(body);
  } catch { withdrawalConfig = normalizeWithdrawalConfig({ unitName: pointUnitName }); }
  renderWithdrawalBalance();
}
async function loadWithdrawalHistory() {
  const panel = document.querySelector('#withdrawalHistory');
  if (!panel) return;
  try {
    const body = await request('/api/v1/me/withdrawals');
    if (body.balance != null) currentPointsBalance = Math.max(0, Number(body.balance) || 0);
    if (body.config) withdrawalConfig = normalizeWithdrawalConfig(body.config);
    renderWithdrawalHistory(body.items || body.withdrawals || body.records || []);
    renderWithdrawalBalance();
  } catch (error) {
    if (error.status === 404) renderWithdrawalHistory([]);
    else panel.innerHTML = '<p class="profile-empty">提现记录暂时不可用。</p>';
  }
}
async function loadWithdrawal() {
  await Promise.all([loadWithdrawalConfig(), loadWithdrawalHistory()]);
}

function referralNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function referralPoints(value) {
  const number = referralNumber(value, 0);
  return Number.isInteger(number) ? number.toLocaleString() : number.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}
function referralRate(value) {
  const number = referralNumber(value, 0);
  if (!number) return '0%';
  const percent = Math.abs(number) <= 1 ? number * 100 : number;
  return `${percent.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}%`;
}
function referralStatusLabel(status) {
  return ({ pending: '待结算', reviewing: '审核中', paid: '已结算', completed: '已结算', rejected: '已驳回', cancelled: '已取消' }[String(status || '').toLowerCase()] || status || '已记录');
}
function referralRecordStateClass(status) {
  const value = String(status || '').toLowerCase();
  return ['pending', 'reviewing'].includes(value) ? 'pending' : ['rejected', 'cancelled'].includes(value) ? 'rejected' : '';
}
function referralShareUrlFrom(data = {}) {
  const code = String(data.code || data.referralCode || data.inviteCode || data.invitationCode || currentUserData?.referralCode || '').trim();
  const supplied = String(data.shareUrl || data.inviteUrl || data.invitationUrl || data.url || '').trim();
  if (supplied) return supplied;
  if (!code) return '';
  try {
    const url = new URL('login.html', window.location.href);
    url.searchParams.set('ref', code);
    return url.href;
  } catch { return `login.html?ref=${encodeURIComponent(code)}`; }
}
function referralQrUrlFrom(data, shareUrl) {
  const supplied = String(data?.qrUrl || data?.qrCodeUrl || data?.qrcodeUrl || data?.inviteQrUrl || '').trim();
  if (supplied) return profileMediaUrl(supplied);
  if (!shareUrl) return '';
  return `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(shareUrl)}`;
}
function referralItems(data = {}) {
  const items = data.commissionItems || data.commissions || data.records || data.items || [];
  return Array.isArray(items) ? items : [];
}
function renderReferralRecords(data = {}) {
  const panel = document.querySelector('#referralRecords');
  if (!panel) return;
  const commissions = referralItems(data).slice(0, 30);
  const invites = Array.isArray(data.invites) ? data.invites : [];
  const directCommissions = commissions.filter(item => referralNumber(item.level ?? item.depth ?? item.relationLevel, 1) <= 1);
  const directInvites = invites.filter(item => referralNumber(item.level ?? item.depth ?? item.relationLevel, 1) <= 1);
  const items = directCommissions.length ? directCommissions : directInvites.map(item => ({ ...item, isInvite: true }));
  panel.innerHTML = items.length ? items.map(item => {
    const name = item.userName || item.username || item.nickname || item.inviteeName || (item.isInvite ? '新用户注册' : '下线消费');
    const points = item.commissionPoints ?? item.rewardPoints ?? item.amountPoints ?? item.points ?? item.commission ?? null;
    const status = item.status || (item.settledAt || item.paidAt ? 'paid' : 'pending');
    const amount = points == null ? (item.isInvite ? '已绑定' : '—') : `${points > 0 ? '+' : ''}${referralPoints(points)} ${String(data.unitName || pointUnitName)}`;
    return `<div class="referral-record"><div><strong>${escapeHtml(name)} · 直属</strong><small>${escapeHtml(formatDate(item.createdAt || item.registeredAt || item.settledAt || item.paidAt))}${item.orderType || item.action ? ` · ${escapeHtml(item.orderType || item.action)}` : ''}</small></div><span class="referral-record-amount ${referralRecordStateClass(status)}">${escapeHtml(amount)}${points != null ? ` · ${escapeHtml(referralStatusLabel(status))}` : ''}</span></div>`;
  }).join('') : '<p class="referral-empty">暂无提成记录。</p>';
}
function renderReferral(data = {}) {
  const panel = document.querySelector('#referralPanel');
  if (!panel) return;
  const shareUrl = referralShareUrlFrom(data);
  const qrUrl = referralQrUrlFrom(data, shareUrl);
  const shareInput = document.querySelector('#referralShareUrl');
  const copyButton = document.querySelector('#copyReferralLinkBtn');
  const shareButton = document.querySelector('#shareReferralBtn');
  const downloadButton = document.querySelector('#downloadReferralQrBtn');
  const qr = document.querySelector('#referralQrImage');
  const qrOpen = document.querySelector('#referralQrOpen');
  if (shareInput) { shareInput.value = shareUrl || '邀请链接暂未生成'; shareInput.dataset.shareUrl = shareUrl; }
  if (copyButton) copyButton.disabled = !shareUrl;
  if (shareButton) shareButton.disabled = !shareUrl;
  if (downloadButton) downloadButton.disabled = !qrUrl;
  if (qr) { qr.hidden = !qrUrl; qr.src = qrUrl; qr.alt = shareUrl ? '专属邀请二维码' : '暂无邀请二维码'; }
  if (qrOpen) { qrOpen.hidden = !qrUrl; qrOpen.href = qrUrl || '#'; }
  const level1 = data.level1Count ?? data.directCount ?? data.firstLevelCount ?? data.level1 ?? 0;
  const total = data.totalEarningsPoints ?? data.totalCommissionPoints ?? data.earningsPoints ?? data.totalEarnings ?? 0;
  const pending = data.pendingEarningsPoints ?? data.pendingCommissionPoints ?? data.pendingEarnings ?? 0;
  const unit = String(data.unitName || data.unit || pointUnitName || '积分');
  const rate1 = data.rate1 ?? data.level1Rate ?? data.directRate ?? data.commissionRate1 ?? 0;
  document.querySelector('#referralUnit')?.replaceChildren(document.createTextNode(`${unit}奖励`));
  document.querySelector('#referralLevel1Count')?.replaceChildren(document.createTextNode(referralPoints(level1)));
  document.querySelector('#referralTotalEarnings')?.replaceChildren(document.createTextNode(`${referralPoints(total)} ${unit}`));
  document.querySelector('#referralPendingEarnings')?.replaceChildren(document.createTextNode(`${referralPoints(pending)} ${unit}`));
  document.querySelector('#referralRate1')?.replaceChildren(document.createTextNode(referralRate(rate1)));
  document.querySelector('#referralRate2')?.replaceChildren(document.createTextNode('仅直属'));
  const rule = document.querySelector('#referralRule');
  if (rule) rule.innerHTML = `好友注册后自动绑定为你的直属下级；好友再邀请他人时，不会进入你的下级。直属提成 <strong>${escapeHtml(referralRate(rate1))}</strong>。`;
  renderReferralRecords({ ...data, unitName: unit });
}
async function copyText(text) {
  if (!text) return false;
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const input = document.createElement('textarea'); input.value = text; input.setAttribute('readonly', ''); input.style.position = 'fixed'; input.style.opacity = '0'; document.body.appendChild(input); input.select(); let copied = false; try { copied = document.execCommand('copy'); } catch {} input.remove(); return copied;
  }
}
function setupReferralActions() {
  const copy = document.querySelector('#copyReferralLinkBtn');
  const share = document.querySelector('#shareReferralBtn');
  const download = document.querySelector('#downloadReferralQrBtn');
  const input = document.querySelector('#referralShareUrl');
  document.querySelector('#referralQrImage')?.addEventListener('error', () => { const qr = document.querySelector('#referralQrImage'); if (qr) qr.hidden = true; if (download) download.disabled = true; });
  copy?.addEventListener('click', async () => { const url = input?.dataset.shareUrl || ''; if (await copyText(url)) toast('邀请链接已复制'); else toast('复制失败，请长按链接复制'); });
  share?.addEventListener('click', async () => {
    const url = input?.dataset.shareUrl || ''; if (!url) return toast('邀请链接暂未生成');
    if (navigator.share) { try { await navigator.share({ title: '月入万刀', text: '加入月入万刀，和我一起分享实战经验。', url }); return; } catch (error) { if (error?.name === 'AbortError') return; } }
    if (await copyText(url)) toast('邀请链接已复制，快分享给好友'); else toast('复制失败，请长按链接复制');
  });
  download?.addEventListener('click', () => {
    const qrUrl = document.querySelector('#referralQrImage')?.src || ''; if (!qrUrl) return toast('二维码暂未生成');
    const link = document.createElement('a'); link.href = qrUrl; link.download = '月入万刀-专属二维码.png'; link.target = '_blank'; link.rel = 'noopener'; document.body.appendChild(link); link.click(); link.remove(); toast('二维码已打开，可长按保存');
  });
}
async function loadReferral() {
  const panel = document.querySelector('#referralPanel');
  if (!panel) return;
  try {
    const body = await request('/api/v1/me/referral');
    const data = body.referral || body;
    if (!referralItems(data).length) {
      try { const commissions = await request('/api/v1/me/referral/commissions'); data.commissionItems = commissions.items || commissions.commissions || commissions.records || []; } catch (error) { if (![404, 405].includes(error.status)) throw error; }
    }
    renderReferral(data);
  } catch (error) {
    if (error.status === 404) renderReferral({ code: currentUserData?.referralCode || '' });
    else panel.innerHTML = '<p class="referral-error">分享数据暂时不可用，请稍后重试。</p>';
  }
}
let checkinState = null;
function checkinDataFromBody(body = {}) {
  const source = body.checkin && typeof body.checkin === 'object' ? body.checkin : body.data && typeof body.data === 'object' && !Array.isArray(body.data) ? body.data : body;
  const summary = source.summary && typeof source.summary === 'object' ? source.summary : body.summary && typeof body.summary === 'object' ? body.summary : null;
  if (!summary) return source;
  return { ...source, ...summary, ranking: source.ranking || body.ranking, leaderboard: source.leaderboard || body.leaderboard, recentRecords: source.recentRecords || body.recentRecords, config: source.config || body.config };
}
function checkinNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function checkinItems(data, keys) {
  for (const key of keys) if (Array.isArray(data?.[key])) return data[key];
  return [];
}
function checkinChecked(data = {}) {
  const today = data.today && typeof data.today === 'object' ? data.today : {};
  return Boolean(data.checkedIn ?? data.todayCheckedIn ?? data.signedToday ?? data.isCheckedIn ?? today.checkedIn ?? today.signed ?? today.isCheckedIn);
}
function checkinRewardValue(data = {}) {
  const today = data.today && typeof data.today === 'object' ? data.today : {};
  const configured = data.config && typeof data.config === 'object' ? data.config : {};
  return checkinNumber(data.todayReward ?? data.rewardPoints ?? data.checkinPoints ?? data.pointsReward ?? today.rewardPoints ?? today.points ?? configured.dailyPoints ?? configured.basePoints ?? configured.dailyReward ?? 0);
}
function checkinStreakValue(data = {}) {
  return checkinNumber(data.currentStreak ?? data.streakDays ?? data.continuousDays ?? data.streak ?? data.today?.streakDays ?? 0);
}
function checkinUnit(data = {}) {
  return String(data.unitName || data.unit || data.pointsUnit || pointUnitName || '积分');
}
function checkinSetMessage(message, error = false) {
  const el = document.querySelector('#checkinMessage');
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('error', error);
}
function renderCheckinRanking(data = {}) {
  const panel = document.querySelector('#checkinRanking');
  if (!panel) return;
  const ranking = checkinItems(data, ['ranking', 'leaderboard', 'rankings', 'topUsers', 'items']).slice(0, 20);
  if (!ranking.length) { panel.innerHTML = '<p class="checkin-empty">暂无排行数据。</p>'; return; }
  const currentId = String(currentUserData?.id || '');
  panel.innerHTML = ranking.map((item, index) => {
    const rank = checkinNumber(item.rank ?? item.position, index + 1);
    const name = item.name || item.userName || item.username || item.nickname || (item.isMe ? '我' : '用户');
    const streak = item.streakDays ?? item.currentStreak ?? item.continuousDays ?? item.days ?? 0;
    const points = item.points ?? item.rewardPoints ?? item.totalPoints ?? null;
    const isMe = Boolean(item.isMe || (currentId && String(item.userId || item.id || '') === currentId));
    const pointsText = points == null ? `${checkinNumber(streak)} 天` : `${referralPoints(points)} ${escapeHtml(checkinUnit(data))}`;
    const rankClass = rank <= 3 ? ` top-${rank}` : '';
    return `<div class="checkin-rank-row${isMe ? ' is-me' : ''}"><span class="checkin-rank${rankClass}">${escapeHtml(rank)}</span><div><strong>${escapeHtml(name)}${isMe ? ' · 我' : ''}</strong><small>连续 ${escapeHtml(streak)} 天</small></div><span class="checkin-rank-points">${pointsText}</span></div>`;
  }).join('');
}
function renderCheckinHistory(data = {}) {
  const panel = document.querySelector('#checkinHistory');
  if (!panel) return;
  const items = checkinItems(data, ['recentRecords', 'history', 'records', 'recent']).slice(0, 12);
  const count = document.querySelector('#checkinHistoryCount');
  if (count) count.textContent = items.length ? `${items.length} 条` : '';
  if (!items.length) { panel.innerHTML = '<p class="checkin-empty">暂无签到记录。</p>'; return; }
  panel.innerHTML = items.map(item => {
    const date = item.date || item.checkinDate || item.createdAt || item.signedAt || item.time;
    const reward = item.rewardPoints ?? item.points ?? item.amountPoints ?? null;
    const streak = item.streakDays ?? item.currentStreak ?? item.continuousDays;
    const detail = [streak != null ? `连续 ${checkinNumber(streak)} 天` : '', reward != null ? `+${referralPoints(reward)} ${escapeHtml(checkinUnit(data))}` : ''].filter(Boolean).join(' · ');
    return `<div class="checkin-history-row"><div><strong>${escapeHtml(item.label || item.title || '每日签到')}</strong><small>${escapeHtml(detail || '已签到')}</small></div><time datetime="${escapeHtml(date || '')}">${escapeHtml(formatDate(date))}</time></div>`;
  }).join('');
}
function renderCheckin(raw = {}) {
  const data = checkinDataFromBody(raw);
  checkinState = data;
  const checkedIn = checkinChecked(data);
  const unit = checkinUnit(data);
  const streak = checkinStreakValue(data);
  const reward = checkinRewardValue(data);
  const total = checkinNumber(data.totalDays ?? data.totalCheckins ?? data.checkinDays ?? data.totalSignedDays ?? data.total ?? 0);
  const best = checkinNumber(data.longestStreak ?? data.bestStreak ?? data.maxStreak ?? data.maxContinuousDays ?? streak);
  const button = document.querySelector('#checkinButton');
  const badge = document.querySelector('#checkinStatusBadge');
  const hint = document.querySelector('#checkinRewardHint');
  const streakEl = document.querySelector('#checkinStreakDays');
  if (streakEl) streakEl.textContent = `${referralPoints(streak)} 天`;
  document.querySelector('#checkinTotalDays')?.replaceChildren(document.createTextNode(`${referralPoints(total)} 天`));
  document.querySelector('#checkinTodayReward')?.replaceChildren(document.createTextNode(`+${referralPoints(reward)} ${unit}`));
  document.querySelector('#checkinBestStreak')?.replaceChildren(document.createTextNode(`${referralPoints(best)} 天`));
  const period = String(data.period || data.leaderboard?.period || '30d').toLowerCase();
  const periodLabel = period === 'week' || period === '7d' ? '本周' : period === 'month' ? '本月' : period === 'all' || period === 'total' ? '累计' : `近${Math.max(1, checkinNumber(period.replace(/\D/g, ''), 30))}天`;
  const periodEl = document.querySelector('#checkinRankingPeriod');
  const myRank = checkinNumber(data.rank ?? data.myRank ?? data.leaderboard?.myRank, 0);
  if (periodEl) periodEl.textContent = myRank > 0 ? `${periodLabel} · 第 ${myRank} 名` : periodLabel;
  if (badge) { badge.textContent = checkedIn ? '今日已签到' : '今日未签到'; badge.classList.toggle('is-done', checkedIn); badge.classList.toggle('is-ready', !checkedIn); }
  if (button) { button.disabled = checkedIn; button.textContent = checkedIn ? '今日已签到' : '立即签到'; }
  const bonus = checkinNumber(data.streakBonus ?? data.bonusPoints ?? data.continuousBonus ?? data.today?.bonusPoints, 0);
  const configuredRewards = Array.isArray(data.config?.streakRewards || data.config?.continuousRewards) ? (data.config.streakRewards || data.config.continuousRewards).filter(item => checkinNumber(item?.days, 0) > streak).sort((a, b) => checkinNumber(a.days) - checkinNumber(b.days)) : [];
  const nextReward = configuredRewards[0];
  const nextHint = nextReward ? `连续 ${checkinNumber(nextReward.days)} 天额外 +${referralPoints(nextReward.bonusPoints ?? nextReward.points ?? 0)} ${unit}` : '连续签到有额外奖励';
  if (hint) hint.textContent = checkedIn ? `今日已获得 ${referralPoints(reward)} ${unit}${bonus > 0 ? `（含连续奖励 ${referralPoints(bonus)}）` : ''}` : `签到领取 ${referralPoints(reward)} ${unit} · ${nextHint}`;
  renderCheckinRanking({ ...data, unitName: unit });
  renderCheckinHistory({ ...data, unitName: unit });
}
function renderCheckinUnavailable(message = '签到服务暂时不可用，请稍后重试。') {
  const badge = document.querySelector('#checkinStatusBadge');
  const button = document.querySelector('#checkinButton');
  if (badge) { badge.textContent = '暂不可用'; badge.classList.remove('is-ready', 'is-done'); }
  if (button) { button.disabled = true; button.textContent = '暂不可用'; }
  checkinSetMessage(message, true);
  document.querySelector('#checkinRanking')?.replaceChildren(Object.assign(document.createElement('p'), { className: 'checkin-empty', textContent: '暂无排行数据。' }));
  document.querySelector('#checkinHistory')?.replaceChildren(Object.assign(document.createElement('p'), { className: 'checkin-empty', textContent: '暂无签到记录。' }));
}
async function loadCheckin() {
  const panel = document.querySelector('#checkinHeading');
  if (!panel) return;
  try {
    const body = await requestFirst(['/api/v1/me/checkin', '/api/v1/me/checkin/status', '/api/v1/checkin/status']);
    const data = checkinDataFromBody(body);
    if (!checkinItems(data, ['ranking', 'leaderboard', 'rankings', 'topUsers']).length) {
      try {
        const rankingBody = await requestFirst(['/api/v1/me/checkin/ranking', '/api/v1/checkin/ranking']);
        const ranking = checkinDataFromBody(rankingBody);
        renderCheckin({ ...body, ...data, ranking: ranking.ranking || ranking.leaderboard || ranking.items || [] });
        return;
      } catch (error) { if (![404, 405].includes(error.status)) throw error; }
    }
    renderCheckin(body);
  } catch (error) {
    renderCheckinUnavailable(error.status === 404 ? '签到功能即将开放。' : '签到服务暂时不可用，请稍后重试。');
  }
}
async function postCheckin() {
  const paths = ['/api/v1/me/checkin', '/api/v1/me/checkin/sign', '/api/v1/checkin/sign'];
  let lastError;
  for (const path of paths) {
    try { return await request(path, { method: 'POST', body: JSON.stringify({}) }); } catch (error) { lastError = error; if (![404, 405].includes(error.status)) throw error; }
  }
  throw lastError || new Error('签到服务暂不可用');
}
function setupCheckin() {
  const button = document.querySelector('#checkinButton');
  if (!button) return;
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    button.disabled = true;
    checkinSetMessage('正在签到…');
    try {
      const body = await postCheckin();
      const data = checkinDataFromBody(body);
      if (Object.keys(data).length > 1) renderCheckin(body); else await loadCheckin();
      checkinSetMessage(body.message || body.notice || `签到成功，获得 ${referralPoints(checkinRewardValue(data))} ${checkinUnit(data)}`);
      await loadPoints();
    } catch (error) {
      if (error.status === 409) checkinSetMessage('今日已签到');
      else checkinSetMessage(error.message || '签到失败，请稍后重试', true);
      await loadCheckin();
    }
  });
}
async function uploadWithdrawalQr(file) {
  if (!file) return '';
  if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) throw new Error('二维码仅支持 JPG、PNG 或 WEBP 图片');
  if (file.size > 5 * 1024 * 1024) throw new Error('二维码图片不能超过 5MB');
  const formData = new FormData(); formData.append('files', file);
  const response = await fetch(`${API}/api/v1/uploads`, { method: 'POST', headers: authHeaders(), body: formData });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || '二维码上传失败');
  const uploaded = body.items?.[0];
  if (!uploaded?.url) throw new Error('上传服务未返回二维码地址');
  return uploaded.url;
}
function setupWithdrawal() {
  const form = document.querySelector('#withdrawalForm'); const qrInput = document.querySelector('#withdrawalQrInput'); const preview = document.querySelector('#withdrawalQrPreview'); const pointsInput = document.querySelector('#withdrawalPointsInput'); const submit = document.querySelector('#withdrawalSubmit');
  if (!form) return;
  pointsInput?.addEventListener('input', renderWithdrawalEstimate);
  qrInput?.addEventListener('change', async () => {
    const file = qrInput.files?.[0]; if (!file) return;
    try {
      setWithdrawalMessage('正在上传二维码…');
      withdrawalQrUrl = await uploadWithdrawalQr(file);
      if (preview) { preview.src = profileMediaUrl(withdrawalQrUrl); preview.hidden = false; }
      setWithdrawalMessage('二维码已上传');
    } catch (error) { withdrawalQrUrl = ''; if (preview) preview.hidden = true; setWithdrawalMessage(error.message || '二维码上传失败', true); qrInput.value = ''; }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const rawPoints = String(pointsInput?.value || '').trim(); const points = Number(rawPoints); const phone = String(form.elements.phone?.value || '').trim();
    if (!withdrawalQrUrl) return setWithdrawalMessage('请上传收款二维码', true);
    if (!/^\d+$/.test(rawPoints) || !Number.isSafeInteger(points) || points < withdrawalConfig.minPoints) return setWithdrawalMessage(`提现积分至少为 ${withdrawalConfig.minPoints} ${withdrawalConfig.unitName}，且必须为整数`, true);
    if (withdrawalConfig.maxPoints > 0 && points > withdrawalConfig.maxPoints) return setWithdrawalMessage(`单次最多提现 ${withdrawalConfig.maxPoints} ${withdrawalConfig.unitName}`, true);
    if (points > currentPointsBalance) return setWithdrawalMessage(`积分余额不足，当前可提现 ${currentPointsBalance} ${withdrawalConfig.unitName}`, true);
    if (!/^1[3-9]\d{9}$/.test(phone)) return setWithdrawalMessage('请输入正确的手机号码', true);
    submit.disabled = true; setWithdrawalMessage('正在提交…');
    try {
      const method = String(form.elements.method?.value || 'alipay');
      await request('/api/v1/me/withdrawals', { method: 'POST', body: JSON.stringify({ qrCodeUrl: withdrawalQrUrl, points, phone, method, channel: method }) });
      setWithdrawalMessage('提现申请已提交'); form.reset(); withdrawalQrUrl = ''; if (preview) { preview.removeAttribute('src'); preview.hidden = true; }
      await Promise.all([loadPoints(), loadWithdrawalHistory()]); renderWithdrawalBalance();
    } catch (error) { setWithdrawalMessage(error.message || '提现申请提交失败', true); }
    finally { submit.disabled = false; }
  });
}

function notificationReadAt(item) { return item?.readAt || (item?.isRead || item?.read ? item.updatedAt || item.readAt || true : null); }
function notificationItems(body) { return Array.isArray(body?.items) ? body.items : Array.isArray(body?.notifications) ? body.notifications : Array.isArray(body?.messages) ? body.messages : []; }
async function fetchNotificationPage(cursor = null) {
  const paths = notificationsPath ? [notificationsPath] : ['/api/v1/me/messages', '/api/v1/me/inbox', '/api/v1/me/notifications'];
  let lastError;
  for (const basePath of paths) {
    const query = new URLSearchParams({ pageSize: String(notificationPageSize) });
    if (cursor) query.set('cursor', cursor);
    try {
      const body = await request(`${basePath}?${query}`);
      notificationsPath = basePath;
      return body;
    } catch (error) {
      lastError = error;
      if (![404, 405].includes(error.status)) throw error;
    }
  }
  throw lastError || new Error('站内信服务暂不可用');
}
function renderNotifications() {
  const panel = document.querySelector('#noticesPanel');
  if (!panel) return;
  panel.innerHTML = currentNotifications.length ? currentNotifications.map(item => {
    const readAt = notificationReadAt(item);
    const message = item.body || item.message || item.content || '';
    return `<button type="button" class="profile-row notification-row ${readAt ? '' : 'is-unread'}" data-notification-id="${escapeHtml(item.id || item.messageId)}"><span><strong>${escapeHtml(item.title || item.subject || '系统通知')}</strong><small>${escapeHtml(message)}</small></span><span></span><span class="profile-status">${escapeHtml(formatDate(item.createdAt || item.sentAt))}</span></button>`;
  }).join('') : '<p class="profile-empty">暂无站内信。</p>';
  const loadMore = document.querySelector('#loadMoreNotificationsBtn');
  if (loadMore) { loadMore.hidden = !notificationsHasMore; loadMore.disabled = false; }
}
function updateNotificationCount(unread) {
  const count = Math.max(0, Number(unread || 0));
  const label = document.querySelector('#noticeCount');
  if (label) label.textContent = `${count} 条未读`;
  const badge = document.querySelector('#headerNoticeCount');
  if (badge) { badge.textContent = count > 99 ? '99+' : String(count); badge.hidden = count === 0; }
  const markAll = document.querySelector('#markAllReadBtn');
  if (markAll) markAll.disabled = count === 0;
}
async function loadNotifications({ reset = true } = {}) {
  const panel = document.querySelector('#noticesPanel');
  try {
    const body = await fetchNotificationPage(reset ? null : notificationsCursor);
    const incoming = notificationItems(body);
    if (reset) currentNotifications = incoming;
    else {
      const known = new Set(currentNotifications.map(item => item.id || item.messageId));
      currentNotifications = currentNotifications.concat(incoming.filter(item => !known.has(item.id || item.messageId)));
    }
    notificationsCursor = body.nextCursor || body.next || null;
    notificationsHasMore = Boolean(body.hasMore ?? notificationsCursor);
    const unread = body.unread ?? body.unreadCount ?? currentNotifications.filter(item => !notificationReadAt(item)).length;
    updateNotificationCount(unread);
    renderNotifications();
  } catch { updateNotificationCount(0); panel.innerHTML = '<p class="profile-empty">站内信暂时不可用，请稍后重试。</p>'; }
}
async function markNotificationRead(notificationId) {
  const item = currentNotifications.find(notification => String(notification.id || notification.messageId) === String(notificationId));
  if (!item || notificationReadAt(item)) return;
  try {
    let updated;
    const bases = notificationsPath ? [notificationsPath] : ['/api/v1/me/messages', '/api/v1/me/notifications'];
    let lastError;
    for (const base of bases) {
      try { updated = await request(`${base}/${encodeURIComponent(notificationId)}/read`, { method: 'PATCH' }); break; } catch (error) { lastError = error; if (![404, 405].includes(error.status)) throw error; }
    }
    if (!updated && lastError) throw lastError;
    Object.assign(item, updated || {}, { readAt: updated?.readAt || new Date().toISOString(), isRead: true });
    updateNotificationCount(currentNotifications.filter(item => !notificationReadAt(item)).length);
    renderNotifications();
  } catch (error) { toast(error.message || '通知状态更新失败'); }
}
async function markAllNotificationsRead() {
  const unread = currentNotifications.filter(item => !notificationReadAt(item));
  if (!unread.length) return toast('没有未读通知');
  const button = document.querySelector('#markAllReadBtn');
  if (button) button.disabled = true;
  try {
    const bases = notificationsPath ? [notificationsPath] : ['/api/v1/me/messages', '/api/v1/me/notifications'];
    let done = false; let lastError;
    for (const base of bases) {
      try { await request(`${base}/read-all`, { method: 'POST', body: JSON.stringify({}) }); done = true; break; } catch (error) { lastError = error; if (![404, 405].includes(error.status)) throw error; }
    }
    if (!done && lastError) throw lastError;
    const readAt = new Date().toISOString(); unread.forEach(item => { item.readAt = readAt; item.isRead = true; });
    updateNotificationCount(0); renderNotifications();
    toast('已全部标记为已读');
  } catch (error) {
    toast(error.message || '通知状态更新失败');
    if (button) button.disabled = false;
  }
}
async function loadSubmissions() {
  const panel = document.querySelector('#submissionsPanel');
  if (!panel) return;
  let items = [];
  try {
    const body = await request('/api/v1/me/posts');
    items = body.items || body.posts || [];
  } catch {
    try { items = JSON.parse(localStorage.getItem('contentSubmissions') || '[]'); } catch { items = []; }
  }
  const userId = currentUserData?.id;
  items = Array.isArray(items) ? items.filter(item => !item.userId || !userId || item.userId === userId).slice(0, 8) : [];
  panel.innerHTML = items.length ? items.map(item => { const editable = ['draft', 'pending', 'rejected'].includes(item.status); const edit = editable && item.id ? `<a class="submission-edit" href="publish.html?id=${encodeURIComponent(item.id)}">编辑</a>` : ''; return `<div class="profile-row"><div><strong>${escapeHtml(item.title || '未命名内容')}</strong><small>${item.submittedAt ? escapeHtml(formatDate(item.submittedAt)) : 'YouTube'}</small></div><span>${edit}</span><span class="profile-status submission-status ${escapeHtml(item.status || 'pending')}">${escapeHtml(submissionStatusLabel(item.status))}</span></div>`; }).join('') : '<p class="profile-empty">暂无投稿记录，去分享你的经验吧。</p>';
}
async function loadFilters() { const panel = document.querySelector('#filtersPanel'); try { const body = await request('/api/v1/saved-filters'); const items = body.items || []; document.querySelector('#filterStat').textContent = `${items.length}/7`; panel.innerHTML = items.length ? items.slice(0, 8).map(item => `<div class="profile-row"><div><strong>${escapeHtml(item.name || '未命名筛选')}</strong><small>${escapeHtml(formatDate(item.createdAt || item.updatedAt))}</small></div><span></span><span class="profile-status">已保存</span></div>`).join('') : '<p class="profile-empty">暂无常用筛选。</p>'; } catch { document.querySelector('#filterStat').textContent = '—'; showError(panel, loadFilters); } }
async function loadProfilePanel(name) {
  if (loadedProfilePanels.has(name)) return;
  const tasks = { overview: [loadPoints, loadWithdrawal, loadReferral, loadCheckin], activity: [loadOrders, loadTips, loadNotifications, loadSubmissions], saved: [loadFilters] }[name] || [];
  loadedProfilePanels.add(name);
  await Promise.all(tasks.map(task => task()));
}
async function load() {
  if (!localStorage.getItem('accessToken')) { gate.hidden = false; content.hidden = true; return; }
  try {
    const [meResult, memberResult] = await Promise.allSettled([request('/api/v1/me'), request('/api/v1/member/me')]);
    if (meResult.status === 'rejected') throw meResult.reason;
    const member = memberResult.status === 'fulfilled' ? memberResult.value : {};
    renderProfile(meResult.value, member);
    gate.hidden = true; content.hidden = false;
    if (memberResult.status === 'rejected') document.querySelector('#membershipPanel').innerHTML = '<span class="profile-empty">会员状态暂时不可用，请稍后重试。</span>';
    try { const config = await request('/api/v1/points/config'); pointUnitName = config.unitName || config.unit || pointUnitName; } catch {}
    const initialPanel = ['overview', 'activity', 'saved'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
    await loadProfilePanel(initialPanel);
  } catch (error) {
    if (error.status === 401) { localStorage.removeItem('accessToken'); localStorage.removeItem('currentUser'); gate.hidden = false; content.hidden = true; return; }
    gate.hidden = true; content.hidden = false; document.querySelector('#profileMeta').textContent = '账户信息暂时不可用'; toast('账户信息加载失败');
  }
}
document.querySelector('#logoutBtn').addEventListener('click', () => { localStorage.removeItem('accessToken'); localStorage.removeItem('currentUser'); toast('已退出登录'); window.setTimeout(() => { location.href = 'index.html'; }, 250); });
document.querySelector('#noticesPanel')?.addEventListener('click', event => { const row = event.target.closest('[data-notification-id]'); if (row) markNotificationRead(row.dataset.notificationId); });
document.querySelector('#markAllReadBtn')?.addEventListener('click', markAllNotificationsRead);
document.querySelector('#refreshNotificationsBtn')?.addEventListener('click', () => loadNotifications({ reset: true }));
document.querySelector('#loadMoreNotificationsBtn')?.addEventListener('click', () => loadNotifications({ reset: false }));
document.querySelector('[data-open-profile-tab="activity"]')?.addEventListener('click', event => { event.preventDefault(); document.querySelector('[data-profile-tab="activity"]')?.click(); document.querySelector('#noticesPanel')?.closest('.notification-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
editButton?.addEventListener('click', openEditProfile);
document.querySelector('#cancelProfileEdit')?.addEventListener('click', closeEditProfile);
editForm?.addEventListener('submit', async event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(editForm));
  try {
    const body = await request('/api/v1/me/profile', { method: 'PATCH', body: JSON.stringify(data) });
    currentUserData = { ...currentUserData, ...body.profile };
    localStorage.setItem('currentUser', JSON.stringify(currentUserData));
    renderProfile({ user: currentUserData }, currentMemberData);
    closeEditProfile();
    toast('资料已保存');
  } catch (error) { toast(error.message || '资料保存失败'); }
});
setupProfileTabs();
setupWithdrawal();
setupReferralActions();
setupCheckin();
load();
