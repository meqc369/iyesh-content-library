const API = window.CONTENT_API_BASE || 'http://127.0.0.1:8787'
const message = document.querySelector('#message')
let adminToken = localStorage.getItem('adminAccessToken') || ''
let memberGroups = []
let memberPlans = []
let membershipItems = []
let cdkeyItems = []
let pointUnitName = '积分'
let notificationItems = []
let withdrawalItems = []
let withdrawalConfig = { pointsPerYuan: 100, withdrawFeePercent: 0 }
let referralConfig = { directPercent: 0, secondPercent: 0 }
let referralItems = []
let referralCommissionItems = []
let referralRelationMeta = {}
let referralCommissionMeta = {}
let checkinConfig = { enabled: true, dailyPoints: 10, streakRewards: [], leaderboardDays: 30 }
let checkinStats = {}
let checkinLeaderboardItems = []
let checkinRecordItems = []
let activeAdminPanel = 'overview'
const loadedAdminPanels = new Set()
const ADMIN_TIMEOUT_MS = 7000

function headers(json = false) {
  return { ...(json ? { 'content-type': 'application/json' } : {}), ...(adminToken ? { 'x-admin-token': adminToken } : {}) }
}
async function request(path, options = {}) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), ADMIN_TIMEOUT_MS)
  let response
  try { response = await fetch(`${API}${path}`, { ...options, signal: controller.signal, headers: { ...headers(Boolean(options.body)), ...(options.headers || {}) } }) } catch (error) { if (error.name === 'AbortError') throw new Error('服务响应较慢，请稍后重试'); throw error } finally { clearTimeout(timer) }
  const body = await response.json().catch(() => ({}))
  if (response.status === 401 && adminToken) { localStorage.removeItem('adminAccessToken'); localStorage.removeItem('adminUser'); location.replace('admin-login.html'); throw new Error('管理员登录已过期') }
  if (!response.ok) { const error = new Error(body.message || `请求失败 ${response.status}`); error.status = response.status; throw error }
  return body
}
async function requestFirst(paths, options = {}) {
  let lastError
  for (const path of paths) {
    try { return await request(path, options) } catch (error) { lastError = error; if (error.status !== 404) throw error }
  }
  throw lastError || new Error('接口不可用')
}
function showError(error) { message.textContent = error.message; message.style.color = '#c45757' }
function showSuccess(text) { message.textContent = text; message.style.color = '#378b5b' }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])) }
function formatDate(value) { return value ? new Date(value).toLocaleString('zh-CN') : '—' }
function listValue(value) { return Array.isArray(value) ? value : String(value || '').split(/[,\n]/).map(item => item.trim()).filter(Boolean) }
function emptyRow(colspan, text = '暂无记录') { return `<tr><td class="admin-empty" colspan="${colspan}">${escapeHtml(text)}</td></tr>` }
function statusBadge(status) {
  const value = String(status || 'active')
  const label = { active: '启用', published: '已发布', paid: '已打款', completed: '已结算', pending: '待处理', reviewing: '审核中', unused: '未使用', disabled: '停用', archived: '已归档', revoked: '已撤销', redeemed: '已兑换', expired: '已过期', rejected: '已驳回', cancelled: '已取消' }[value] || value
  const tone = ['active', 'published', 'paid', 'completed'].includes(value) ? 'success' : ['pending', 'reviewing', 'unused'].includes(value) ? 'warning' : ['disabled', 'archived', 'revoked', 'redeemed', 'expired', 'rejected', 'cancelled'].includes(value) ? 'muted' : ''
  return `<span class="admin-badge ${tone}">${escapeHtml(label)}</span>`
}
function storedAdminPermissions() {
  try { return new Set(JSON.parse(localStorage.getItem('adminUser') || 'null')?.permissions || []) } catch { return new Set() }
}
function canAdmin(permission) {
  const permissions = storedAdminPermissions()
  if (permissions.has('*') || permissions.has(permission)) return true
  const [resource, action] = String(permission || '').split('.')
  return action === 'read' && permissions.has(`${resource}.manage`)
}
function canReferralAdmin() { return canAdmin('referral.manage') || canAdmin('finance.manage') }
function canCheckinAdmin() { return canAdmin('checkin.manage') || canAdmin('finance.manage') || canAdmin('system.settings') }
function adminPanelPermission(name) {
  if (name === 'referral') return canReferralAdmin()
  if (name === 'checkin') return canCheckinAdmin()
  return canAdmin(({ overview: 'dashboard.read', content: 'content.read', members: 'membership.read', finance: 'finance.manage', messages: 'notifications.manage', system: 'system.settings', logs: 'system.audit' })[name] || 'dashboard.read')
}
function applyAdminPermissionVisibility() {
  const tabPermissions = { overview: 'dashboard.read', content: 'content.read', members: 'membership.read', finance: 'finance.manage', referral: 'referral.manage', checkin: 'checkin.manage', messages: 'notifications.manage', system: 'system.settings', logs: 'system.audit' }
  document.querySelectorAll('[data-admin-tab]').forEach(tab => {
    const allowed = tab.dataset.adminTab === 'referral' ? canReferralAdmin() : tab.dataset.adminTab === 'checkin' ? canCheckinAdmin() : canAdmin(tabPermissions[tab.dataset.adminTab] || 'dashboard.read')
    tab.hidden = !allowed
    tab.disabled = !allowed
  })
  const hide = (selector, permission) => { const node = document.querySelector(selector); if (node && !canAdmin(permission)) (node.closest('.admin-subsection,.admin-list') || node).hidden = true }
  hide('#adminForm', 'system.admins')
  hide('#pointsConfigForm', 'finance.manage')
  hide('#pointsRechargeForm', 'finance.manage')
  hide('#cdkeyForm', 'finance.manage')
  hide('#withdrawalConfigForm', 'finance.manage')
  const referralForm = document.querySelector('#referralConfigForm')
  if (referralForm && !canReferralAdmin()) (referralForm.closest('.admin-list') || referralForm).hidden = true
  hide('#planForm', 'membership.manage')
  hide('#groupForm', 'membership.manage')
  hide('#membershipGrantForm', 'membership.manage')
  hide('#smtpForm', 'system.settings')
}
function setupAdminTabs() {
  applyAdminPermissionVisibility()
  const tabs = [...document.querySelectorAll('[data-admin-tab]')].filter(tab => !tab.hidden);
  const panels = [...document.querySelectorAll('[data-admin-panel]')];
  const regions = panels.filter(panel => !panel.matches('h2,p,form'));
  const workbench = document.querySelector('.admin-workbench');
  if (!tabs.length) return;
  tabs.forEach(tab => { if (!tab.id) tab.id = `admin-tab-${tab.dataset.adminTab}`; });
  regions.forEach((panel, index) => { panel.id = panel.id || `admin-panel-${panel.dataset.adminPanel}-${index}`; panel.setAttribute('role', 'region'); panel.setAttribute('aria-labelledby', `admin-tab-${panel.dataset.adminPanel}`); });
  tabs.forEach(tab => { tab.setAttribute('aria-controls', regions.filter(panel => panel.dataset.adminPanel === tab.dataset.adminTab).map(panel => panel.id).join(' ')); });
  const activate = (name, updateHash = true) => {
    activeAdminPanel = name
    tabs.forEach(tab => {
      const active = tab.dataset.adminTab === name;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    panels.forEach(panel => { panel.hidden = panel.dataset.adminPanel !== name || !adminPanelPermission(panel.dataset.adminPanel); });
    if (workbench) workbench.hidden = !['members', 'system'].includes(name);
    if (updateHash) history.replaceState(null, '', `#${name}`);
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => { activate(tab.dataset.adminTab); if (adminToken) void loadAdminPanel(tab.dataset.adminTab); });
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].focus();
      activate(tabs[next].dataset.adminTab); if (adminToken) void loadAdminPanel(tabs[next].dataset.adminTab);
    });
  });
  const initial = tabs.some(tab => tab.dataset.adminTab === location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
  activate(initial, false);
}
function collectGroupPermissions(form) {
  const picked = [...form.querySelectorAll('input[name="permission"]:checked')].map(input => input.value)
  const custom = String(form.elements.customPermissions?.value || '').split(/[,\n]/).map(item => item.trim()).filter(Boolean)
  return [...new Set([...picked, ...custom])].slice(0, 30)
}
function setGroupPermissions(values) {
  const permissions = new Set(listValue(values))
  document.querySelectorAll('#groupForm input[name="permission"]').forEach(input => { input.checked = permissions.has(input.value) })
  const known = new Set([...document.querySelectorAll('#groupForm input[name="permission"]')].map(input => input.value))
  const custom = [...permissions].filter(permission => !known.has(permission))
  document.querySelector('#groupForm [name="customPermissions"]').value = custom.join(', ')
}
function resetGroupForm() {
  const form = document.querySelector('#groupForm')
  form.reset(); form.elements.id.value = ''; form.elements.rank.value = 10; form.elements.giftPoints.value = 0; form.elements.status.value = 'active'; setGroupPermissions([])
  form.querySelector('button[type="submit"]').textContent = '新增分组'; document.querySelector('#cancelGroupEdit').hidden = true
}
function updateGrantOptions() {
  const groupSelect = document.querySelector('#grantGroupId')
  const planSelect = document.querySelector('#grantPlanId')
  const selectedGroup = groupSelect.value
  groupSelect.innerHTML = memberGroups.length ? `<option value="">请选择会员等级</option>${memberGroups.filter(group => group.status !== 'archived').map(group => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.name)} · ${escapeHtml(group.code || group.id)}</option>`).join('')}` : '<option value="">暂无会员分组</option>'
  if (selectedGroup && memberGroups.some(group => group.id === selectedGroup)) groupSelect.value = selectedGroup
  const groupId = groupSelect.value
  const plans = memberPlans.filter(plan => plan.status !== 'archived' && (!groupId || plan.groupId === groupId))
  planSelect.innerHTML = `<option value="">不关联套餐</option>${plans.map(plan => `<option value="${escapeHtml(plan.id)}">${escapeHtml(plan.name)} · ${Number(plan.durationDays || 0)} 天</option>`).join('')}`
}
function updatePlanFormOptions() {
  const select = document.querySelector('#planGroupId')
  if (!select) return
  const selected = select.value
  select.innerHTML = `<option value="">请选择会员分组</option>${memberGroups.filter(group => group.status !== 'archived').map(group => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.name)} · ${escapeHtml(group.code || group.id)}</option>`).join('')}`
  if (selected && memberGroups.some(group => group.id === selected)) select.value = selected
}
function updatePostPlanOptions() {
  const select = document.querySelector('#adminPostPlanId')
  if (!select) return
  const selected = select.value
  select.innerHTML = `<option value="">不限定套餐</option>${memberPlans.filter(plan => plan.status !== 'archived').map(plan => `<option value="${escapeHtml(plan.id)}">${escapeHtml(plan.name)} · ${Number(plan.durationDays || 0)} 天</option>`).join('')}`
  if (selected && memberPlans.some(plan => plan.id === selected)) select.value = selected
}
function renderGroups(groups) {
  memberGroups = groups
  renderNotificationGroups()
  updatePlanFormOptions()
  updateGrantOptions()
  document.querySelector('#groupRows').innerHTML = groups.length ? groups.map(group => {
    const permissions = listValue(group.permissions || group.permissionCodes || group.permissionKeys)
    const permissionText = permissions.length ? permissions.map(permission => `<span class="admin-badge">${escapeHtml(permission)}</span>`).join(' ') : '<span class="admin-message">未配置</span>'
    const giftPoints = Number(group.giftPoints ?? group.welcomePoints ?? group.initialPoints ?? 0)
    return `<tr><td>${escapeHtml(group.code || group.id)}</td><td><strong>${escapeHtml(group.name)}</strong><br><span class="admin-message">${escapeHtml(group.description || '—')}</span></td><td>${giftPoints.toLocaleString()} ${escapeHtml(pointUnitName)}</td><td>${permissionText}</td><td>${Number(group.rank || 0)}</td><td>${statusBadge(group.status)}</td><td><div class="admin-actions"><button data-edit-group="${escapeHtml(group.id)}">编辑</button><button data-archive-group="${escapeHtml(group.id)}" data-danger="true" ${group.status === 'archived' ? 'disabled' : ''}>归档</button></div></td></tr>`
  }).join('') : emptyRow(7, '暂无会员分组')
}
function renderPlans(plans) {
  memberPlans = plans
  updatePostPlanOptions()
  updateGrantOptions()
  document.querySelector('#planRows').innerHTML = plans.length ? plans.map(plan => {
    const group = memberGroups.find(item => item.id === plan.groupId)
    const giftPoints = Number(plan.giftPoints ?? plan.welcomePoints ?? plan.initialPoints ?? 0)
    const redeemPoints = Number(plan.redeemPoints ?? plan.pricePoints ?? 0)
    return `<tr><td><strong>${escapeHtml(plan.name)}</strong><br><span class="admin-message">${escapeHtml(plan.description || '—')}</span></td><td>${escapeHtml(group?.name || plan.groupId || '—')}</td><td>${redeemPoints > 0 ? `${redeemPoints.toLocaleString()} ${escapeHtml(pointUnitName)}` : '未配置'}</td><td>${Number(plan.durationDays || 0)} 天</td><td>${giftPoints.toLocaleString()} ${escapeHtml(pointUnitName)}</td><td>${statusBadge(plan.status)}</td></tr>`
  }).join('') : emptyRow(6, '暂无套餐')
}
function renderMemberships(items) {
  membershipItems = items
  const query = String(document.querySelector('#membershipQuery').value || '').trim().toLowerCase()
  const filtered = items.filter(item => !query || [item.userId, item.user?.id, item.user?.name, item.groupName, item.planName].some(value => String(value || '').toLowerCase().includes(query)))
  document.querySelector('#membershipRows').innerHTML = filtered.length ? filtered.map(item => {
    const active = ['active', 'pending'].includes(String(item.status || 'active'))
    return `<tr><td>${escapeHtml(item.user?.name || item.userName || item.userId)}</td><td>${escapeHtml(item.groupName || item.groupId || '—')}</td><td>${escapeHtml(item.planName || item.planId || '线下开通')}</td><td>${formatDate(item.startsAt)}<br>至 ${formatDate(item.endsAt)}</td><td>${statusBadge(item.status)}</td><td>${active ? `<button data-revoke-membership="${escapeHtml(item.id)}">撤销</button>` : '<span class="admin-message">—</span>'}</td></tr>`
  }).join('') : emptyRow(6, query ? '没有匹配的会员记录' : '暂无会员记录')
}
function renderPointRows(items) {
  document.querySelector('#pointRows').innerHTML = items.length ? items.map(item => `<tr><td>${escapeHtml(item.user?.name || item.userName || item.userId)}</td><td><strong>+${Number(item.points ?? item.amount ?? item.delta ?? 0).toLocaleString()} ${escapeHtml(pointUnitName)}</strong></td><td>${Number(item.balance ?? item.balanceAfter ?? 0).toLocaleString()}</td><td>${escapeHtml(item.source || item.kind || '线下充值')}</td><td>${escapeHtml(item.note || item.remark || '—')}</td><td>${escapeHtml(item.actorName || item.adminId || item.operator || '管理员')}</td><td>${formatDate(item.createdAt)}</td></tr>`).join('') : emptyRow(7, '暂无积分充值记录')
}
function renderAuditRows(items) {
  document.querySelector('#auditRows').innerHTML = items.length ? items.map(item => `<tr><td>${formatDate(item.createdAt)}</td><td>${escapeHtml(item.actorName || item.actorId || '管理员')}</td><td>${escapeHtml(item.action || '—')}</td><td>${escapeHtml(item.targetType || '—')}</td><td>${escapeHtml(item.targetId || '—')}</td><td><code>${escapeHtml(typeof item.detail === 'string' ? item.detail : JSON.stringify(item.detail || {}))}</code></td></tr>`).join('') : emptyRow(6, '暂无系统日志')
}
function renderCdkeys(items) {
  cdkeyItems = items
  const rows = items.map(item => {
    const disabled = item.status !== 'unused'
    return `<tr><td><code>${escapeHtml(item.code)}</code></td><td><strong>${Number(item.redeemPoints ?? item.points ?? 0).toLocaleString()}</strong> ${escapeHtml(pointUnitName)}</td><td>${statusBadge(item.status)}</td><td>${escapeHtml(item.batchId || '—')}</td><td>${escapeHtml(item.redeemedBy || '—')}</td><td>${formatDate(item.redeemedAt)}</td><td>${formatDate(item.expiresAt)}</td><td>${disabled ? '<span class="admin-message">—</span>' : `<button data-revoke-cdkey="${escapeHtml(item.id)}" data-danger="true">停用</button>`}</td></tr>`
  })
  document.querySelector('#cdkeyRows').innerHTML = rows.length ? rows.join('') : emptyRow(8, '暂无兑换码')
}
function renderAdmins(items) {
  const rows = document.querySelector('#adminRows')
  if (!rows) return
  rows.innerHTML = items.length ? items.map(item => `<tr><td><strong>${escapeHtml(item.username)}</strong></td><td>${escapeHtml(item.name || '—')}</td><td>${escapeHtml(item.roleLabel || item.role)}</td><td>${statusBadge(item.status)}</td><td>${formatDate(item.lastLoginAt)}</td><td>${item.status === 'active' && item.username !== 'admin' ? `<button data-disable-admin="${escapeHtml(item.id)}" data-danger="true">停用</button>` : '<span class="admin-message">—</span>'}</td></tr>`).join('') : emptyRow(6, '暂无管理员记录')
}
function syncNotificationAudience() {
  const scope = document.querySelector('#notificationScope')?.value || 'all'
  const recipients = document.querySelector('#notificationRecipientsLabel')
  const groups = document.querySelector('#notificationGroupsLabel')
  if (recipients) recipients.hidden = scope !== 'users'
  if (groups) groups.hidden = scope !== 'group'
  const input = document.querySelector('#notificationRecipients')
  if (input) input.required = scope === 'users'
}
function renderNotificationGroups() {
  const select = document.querySelector('#notificationGroups')
  if (!select) return
  select.innerHTML = memberGroups.filter(group => group.status !== 'archived').map(group => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.name)} · ${escapeHtml(group.code || group.id)}</option>`).join('') || '<option value="">暂无会员分组</option>'
}
function renderNotifications(items) {
  notificationItems = items
  const rows = document.querySelector('#notificationRows')
  if (!rows) return
  rows.innerHTML = items.length ? items.slice(0, 200).map(item => `<tr><td><code>${escapeHtml(item.recipientId || item.userId || '—')}</code></td><td><strong>${escapeHtml(item.title || '系统通知')}</strong><br><span class="admin-message">${escapeHtml(item.body || '')}</span></td><td>${item.readAt ? '<span class="admin-badge muted">已读</span>' : '<span class="admin-badge warning">未读</span>'}</td><td><code>${escapeHtml(item.batchId || '系统')}</code></td><td>${formatDate(item.createdAt)}</td></tr>`).join('') : emptyRow(5, '暂无发送记录')
}
function adminMediaUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (/^(?:https?:|data:|blob:)/i.test(raw)) return raw
  return `${API}${raw.startsWith('/') ? raw : `/${raw}`}`
}
function withdrawalApplicant(item) {
  return item.user?.name || item.userName || item.username || item.userId || '—'
}
function withdrawalAmount(item, field, fallback = 0) {
  const value = Number(item?.[field])
  return Number.isFinite(value) ? value : Number(fallback || 0)
}
function renderWithdrawals(items) {
  withdrawalItems = Array.isArray(items) ? items : []
  const rows = document.querySelector('#withdrawalRows')
  if (!rows) return
  const query = String(document.querySelector('#withdrawalQuery')?.value || '').trim().toLowerCase()
  const status = String(document.querySelector('#withdrawalStatusFilter')?.value || '')
  const filtered = withdrawalItems.filter(item => {
    if (status && String(item.status || 'pending') !== status) return false
    if (!query) return true
    return [item.id, item.requestNo, item.userId, withdrawalApplicant(item), item.phone, item.contactPhone].some(value => String(value || '').toLowerCase().includes(query))
  })
  rows.innerHTML = filtered.length ? filtered.map(item => {
    const points = withdrawalAmount(item, 'points')
    const gross = withdrawalAmount(item, 'grossAmountRmb', withdrawalAmount(item, 'amountRmb', 0))
    const fee = withdrawalAmount(item, 'feeAmountRmb')
    const net = withdrawalAmount(item, 'netAmountRmb', Math.max(0, gross - fee))
    const phone = item.phone || item.contactPhone || '—'
    const pending = String(item.status || 'pending') === 'pending'
    const detailButton = `<button data-view-withdrawal="${escapeHtml(item.id)}">查看详情</button>`
    const actions = pending ? `<div class="admin-actions">${detailButton}<button data-pay-withdrawal="${escapeHtml(item.id)}">标记已打款</button><button data-reject-withdrawal="${escapeHtml(item.id)}" data-danger="true">驳回</button></div>` : detailButton
    return `<tr><td><strong>${escapeHtml(withdrawalApplicant(item))}</strong><br><span class="admin-message">${escapeHtml(item.userId || item.requestNo || item.id || '—')}</span></td><td><strong>${points.toLocaleString()}</strong> ${escapeHtml(pointUnitName)}</td><td>¥${gross.toFixed(2)}</td><td>¥${fee.toFixed(2)}</td><td><strong>¥${net.toFixed(2)}</strong></td><td>${escapeHtml(phone)}</td><td>${statusBadge(item.status || 'pending')}</td><td>${formatDate(item.createdAt || item.submittedAt)}</td><td>${actions}</td></tr>`
  }).join('') : emptyRow(9, query || status ? '没有匹配的提现记录' : '暂无提现申请')
}
function referralNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}
function firstReferralNumber(values, fallback = 0) {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue
    const number = Number(value)
    if (Number.isFinite(number)) return number
  }
  return fallback
}
function referralPercent(value) {
  const number = referralNumber(value, 0)
  const percent = Math.abs(number) <= 1 && number !== 0 ? number * 100 : number
  return `${percent.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}%`
}
function normalizeReferralConfig(raw) {
  const config = raw?.config || raw || {}
  const direct = firstReferralNumber([config.directPercent, config.rate1, config.level1Rate, config.directRate, config.commissionRate1, config.firstLevelRate], 0)
  return { ...config, directPercent: direct, secondPercent: 0, rate1: direct, level1Rate: direct, rate2: 0, level2Rate: 0 }
}
function referralPerson(item, type = 'user') {
  if (!item) return '—'
  const nested = type === 'parent' ? (item.parent || item.referrer || item.upline || item.sponsor || item.beneficiary || item.beneficiaryUser) : (item.user || item.invitee || item.child || item.member || item.sourceUser || item.sourceUserAccount)
  if (nested) return nested.name || nested.username || nested.nickname || nested.id || '—'
  const keys = type === 'parent' ? ['parentName', 'referrerName', 'uplineName', 'sponsorName', 'beneficiaryName', 'referrerId', 'parentId', 'uplineId', 'beneficiaryId'] : ['userName', 'username', 'nickname', 'inviteeName', 'childName', 'sourceUserName', 'userId', 'inviteeId', 'sourceUserId']
  return keys.map(key => item[key]).find(value => String(value || '').trim()) || '—'
}
function referralStatusLabel(status) {
  const value = String(status || 'active').toLowerCase()
  if (value === 'bound') return 'active'
  if (value === 'settled' || value === 'completed') return 'paid'
  if (value === 'unsettled' || value === 'review') return 'pending'
  return value
}
function referralCommissionBadge(status) {
  const value = referralStatusLabel(status || 'paid')
  const label = { pending: '待结算', paid: '已结算', rejected: '已驳回', cancelled: '已取消' }[value] || value
  const tone = value === 'paid' ? 'success' : value === 'pending' ? 'warning' : ['rejected', 'cancelled'].includes(value) ? 'muted' : ''
  return `<span class="admin-badge ${tone}">${escapeHtml(label)}</span>`
}
function renderReferralStats() {
  const rows = document.querySelector('#referralStats')
  if (!rows) return
  const relations = referralItems
  const commissions = referralCommissionItems
  const levelOf = item => referralNumber(item.level ?? item.depth ?? item.relationLevel ?? item.referralLevel, 1)
  const relationSummary = referralRelationMeta.summary || referralRelationMeta.stats || {}
  const commissionSummary = referralCommissionMeta.summary || referralCommissionMeta.stats || {}
  const direct = firstReferralNumber([relationSummary.directCount, relationSummary.level1Count, referralRelationMeta.directCount, referralRelationMeta.level1Count], relations.filter(item => levelOf(item) === 1).length)
  const second = firstReferralNumber([relationSummary.secondCount, relationSummary.level2Count, referralRelationMeta.secondCount, referralRelationMeta.level2Count], relations.filter(item => levelOf(item) === 2).length)
  const commissionPoints = firstReferralNumber([commissionSummary.totalCommissionPoints, commissionSummary.commissionPoints, referralCommissionMeta.totalCommissionPoints], commissions.reduce((sum, item) => sum + referralNumber(item.commissionPoints ?? item.rewardPoints ?? item.amountPoints ?? item.commission ?? item.pointsEarned, 0), 0))
  const pendingPoints = firstReferralNumber([commissionSummary.pendingCommissionPoints, commissionSummary.pendingPoints, referralCommissionMeta.pendingCommissionPoints], commissions.filter(item => ['pending', 'reviewing', 'unsettled'].includes(String(item.status || '').toLowerCase())).reduce((sum, item) => sum + referralNumber(item.commissionPoints ?? item.rewardPoints ?? item.amountPoints ?? item.commission ?? item.pointsEarned, 0), 0))
  const total = firstReferralNumber([relationSummary.total, referralRelationMeta.total, referralRelationMeta.count], relations.length)
  const cards = [
    ['邀请关系', total],
    ['直属下级', direct],
    ['二级关系（固定0）', second],
    ['累计提成', `${commissionPoints.toLocaleString()} ${pointUnitName}`],
    ['待结算', `${pendingPoints.toLocaleString()} ${pointUnitName}`]
  ]
  rows.innerHTML = cards.map(([label, value]) => `<div class="admin-stat"><strong>${typeof value === 'number' ? value.toLocaleString() : escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`).join('')
}
function renderReferralConfig() {
  const form = document.querySelector('#referralConfigForm')
  if (!form) return
  const direct = referralConfig.directPercent ?? referralConfig.rate1 ?? referralConfig.level1Rate ?? referralConfig.directRate ?? 0
  form.elements.directPercent.value = referralNumber(direct, 0) <= 1 && referralNumber(direct, 0) !== 0 ? referralNumber(direct, 0) * 100 : referralNumber(direct, 0)
  form.elements.secondPercent.value = '0%（不计入）'
}
function renderReferrals(items) {
  referralItems = Array.isArray(items) ? items : []
  const rows = document.querySelector('#referralRows')
  if (!rows) return
  const query = String(document.querySelector('#referralQuery')?.value || '').trim().toLowerCase()
  const level = String(document.querySelector('#referralLevelFilter')?.value || '')
  const status = String(document.querySelector('#referralStatusFilter')?.value || '')
  const levelOf = item => referralNumber(item.level ?? item.depth ?? item.relationLevel ?? item.referralLevel, 1)
  const filtered = referralItems.filter(item => {
    const itemLevel = levelOf(item)
    const itemStatus = referralStatusLabel(item.status || item.relationStatus || 'active')
    if (level && String(itemLevel) !== level) return false
    if (status && itemStatus !== status) return false
    if (!query) return true
    return [item.id, item.userId, item.parentId, item.referrerId, referralPerson(item), referralPerson(item, 'parent')].some(value => String(value || '').toLowerCase().includes(query))
  })
  rows.innerHTML = filtered.length ? filtered.map(item => {
    const itemLevel = levelOf(item)
    const itemStatus = referralStatusLabel(item.status || item.relationStatus || 'active')
    const levelBadge = `<span class="referral-level ${itemLevel === 2 ? 'second' : ''}">${itemLevel === 2 ? '二级关系' : '直属下级'}</span>`
    return `<tr><td><strong>${escapeHtml(referralPerson(item))}</strong><br><span class="admin-message">${escapeHtml(item.userId || item.inviteeId || item.childId || '—')}</span></td><td><strong>${escapeHtml(referralPerson(item, 'parent'))}</strong><br><span class="admin-message">${escapeHtml(item.parentId || item.referrerId || item.uplineId || '—')}</span></td><td>${levelBadge}</td><td>${statusBadge(itemStatus)}</td><td>${formatDate(item.createdAt || item.boundAt || item.registeredAt)}</td></tr>`
  }).join('') : emptyRow(5, query || level || status ? '没有匹配的邀请关系' : '暂无邀请关系')
  renderReferralStats()
}
function renderReferralCommissions(items) {
  referralCommissionItems = Array.isArray(items) ? items : []
  const rows = document.querySelector('#referralCommissionRows')
  if (!rows) return
  const query = String(document.querySelector('#commissionQuery')?.value || '').trim().toLowerCase()
  const status = String(document.querySelector('#commissionStatusFilter')?.value || '')
  const filtered = referralCommissionItems.filter(item => {
    const itemStatus = referralStatusLabel(item.status || 'paid')
    if (status && itemStatus !== status) return false
    if (!query) return true
    return [item.id, item.userId, item.referrerId, item.beneficiaryId, item.sourceUserId, item.sourceId, item.source, item.orderNo, referralPerson(item), referralPerson(item, 'parent')].some(value => String(value || '').toLowerCase().includes(query))
  })
  rows.innerHTML = filtered.length ? filtered.map(item => {
    const sourceRaw = item.sourceLabel || item.sourceTypeLabel || item.orderTypeLabel || item.sourceType || item.orderType || item.kind || item.source || 'points_recharge'
    const source = { points_recharge: '积分充值', membership_redeem: '兑换会员', member_redeem: '兑换会员', recharge: '积分充值' }[String(sourceRaw)] || sourceRaw
    const consumed = referralNumber(item.consumePoints ?? item.purchasePoints ?? item.amountPoints ?? item.sourcePoints ?? item.pointsSpent ?? item.purchaseAmountPoints ?? item.orderPoints ?? item.basePoints ?? item.points, 0)
    const commission = referralNumber(item.commissionPoints ?? item.rewardPoints ?? item.amountCommission ?? item.commission ?? item.pointsEarned, 0)
    const rate = item.rate ?? item.percent ?? item.ratePercent ?? item.commissionRate ?? item.directPercent ?? referralConfig.directPercent
    const itemStatus = String(item.status || 'paid').toLowerCase()
    const amountClass = ['pending', 'reviewing', 'unsettled'].includes(itemStatus) ? 'pending' : ['rejected', 'cancelled'].includes(itemStatus) ? 'rejected' : ''
    return `<tr><td><strong>${escapeHtml(referralPerson(item, 'parent'))}</strong><br><span class="admin-message">${escapeHtml(item.referrerId || item.parentId || '—')}</span></td><td><strong>${escapeHtml(referralPerson(item))}</strong><br><span class="admin-message">${escapeHtml(item.userId || item.inviteeId || '—')}</span></td><td>${escapeHtml(source)}</td><td>${consumed.toLocaleString()} ${escapeHtml(pointUnitName)}</td><td>${escapeHtml(referralPercent(rate))}</td><td><span class="referral-amount ${amountClass}">${commission > 0 ? '+' : ''}${commission.toLocaleString()} ${escapeHtml(pointUnitName)}</span></td><td>${referralCommissionBadge(itemStatus)}</td><td>${formatDate(item.createdAt || item.settledAt || item.paidAt)}</td></tr>`
  }).join('') : emptyRow(8, query || status ? '没有匹配的提成流水' : '暂无提成流水')
  renderReferralStats()
}
function checkinNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}
function checkinRewardsFrom(config) {
  const raw = config?.streakRewards || config?.streakBonuses || config?.consecutiveRewards || config?.consecutiveBonusRules
  if (Array.isArray(raw)) return raw.map(item => ({ days: checkinNumber(item.days ?? item.streakDays ?? item.consecutiveDays, 0), bonusPoints: checkinNumber(item.bonusPoints ?? item.points ?? item.rewardPoints ?? item.bonus, 0) })).filter(item => item.days > 0 && item.bonusPoints >= 0).sort((a, b) => a.days - b.days)
  const bonus = checkinNumber(config?.streakBonusPoints ?? config?.consecutiveBonusPoints, 0)
  if (bonus > 0) return [{ days: checkinNumber(config?.streakBonusDays ?? config?.consecutiveDays, 7), bonusPoints: bonus }]
  return []
}
function renderCheckinRewardRows(rewards = []) {
  const container = document.querySelector('#checkinRewardRows')
  if (!container) return
  const items = Array.isArray(rewards) ? rewards : []
  container.innerHTML = items.length ? items.map((item, index) => `<div class="checkin-reward-row" data-checkin-reward-row><label>连续天数<input data-checkin-days type="number" min="2" max="3650" step="1" value="${checkinNumber(item.days, 7)}" required aria-label="连续签到天数"></label><label>额外积分<input data-checkin-bonus type="number" min="0" max="1000000" step="1" value="${checkinNumber(item.bonusPoints, 0)}" required aria-label="连续签到额外积分"></label><button type="button" data-remove-checkin-reward="${index}" aria-label="删除此规则">删除</button></div>`).join('') : '<p class="admin-message">暂无连续奖励，点击“新增规则”添加</p>'
}
function readCheckinRewardRows() {
  return [...document.querySelectorAll('#checkinRewardRows [data-checkin-reward-row]')].map(row => ({ days: Number(row.querySelector('[data-checkin-days]')?.value || 0), bonusPoints: Number(row.querySelector('[data-checkin-bonus]')?.value || 0) }))
}
function renderCheckinConfig() {
  const form = document.querySelector('#checkinConfigForm')
  if (!form) return
  form.elements.enabled.checked = checkinConfig.enabled !== false
  form.elements.dailyPoints.value = checkinNumber(checkinConfig.dailyPoints ?? checkinConfig.checkinPoints ?? checkinConfig.basePoints, 10)
  form.elements.streakBonusPoints.value = checkinNumber(checkinConfig.streakBonusPoints ?? checkinConfig.continuousBonusPoints, 0)
  form.elements.leaderboardDays.value = String(checkinNumber(checkinConfig.leaderboardDays ?? checkinConfig.rankingDays, 30))
  renderCheckinRewardRows(checkinRewardsFrom(checkinConfig))
}
function renderCheckinStats(stats = {}) {
  const rows = document.querySelector('#checkinStats')
  if (!rows) return
  const summary = stats.summary || stats.stats || stats.overview || stats
  const today = checkinNumber(summary.todayCount ?? summary.todaySigned ?? summary.todayUsers ?? summary.today, 0)
  const total = checkinNumber(summary.totalCount ?? summary.totalCheckins ?? summary.count, 0)
  const points = checkinNumber(summary.totalPoints ?? summary.pointsAwarded ?? summary.rewardPoints, 0)
  const streakUsers = checkinNumber(summary.activeStreakUsers ?? summary.streakUsers ?? summary.continuousUsers, 0)
  const cards = [['今日签到', today], ['累计签到', total], ['发放积分', `${points.toLocaleString()} ${pointUnitName}`], ['连续签到用户', streakUsers]]
  rows.innerHTML = cards.map(([label, value]) => `<div class="admin-stat"><strong>${typeof value === 'number' ? value.toLocaleString() : escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`).join('')
}
function renderCheckinLeaderboard(items = []) {
  checkinLeaderboardItems = Array.isArray(items) ? items : []
  const rows = document.querySelector('#checkinLeaderboardRows')
  if (!rows) return
  rows.innerHTML = checkinLeaderboardItems.length ? checkinLeaderboardItems.slice(0, 200).map((item, index) => {
    const rank = checkinNumber(item.rank ?? item.position, index + 1)
    const name = item.userName || item.username || item.nickname || item.user?.name || item.user?.username || item.userId || '用户'
    const streak = checkinNumber(item.streak ?? item.currentStreak ?? item.consecutiveDays, 0)
    const count = checkinNumber(item.days ?? item.checkinDays ?? item.checkinCount ?? item.totalDays, 0)
    const points = checkinNumber(item.totalPoints ?? item.points ?? item.rewardPoints, 0)
    return `<tr><td><strong>#${rank}</strong></td><td><strong>${escapeHtml(name)}</strong><br><span class="admin-message">${escapeHtml(item.userId || item.user?.id || '—')}</span></td><td><span class="checkin-streak">连续 ${streak} 天</span></td><td>${count.toLocaleString()} 次</td><td><span class="checkin-points">${points.toLocaleString()} ${escapeHtml(pointUnitName)}</span></td><td>${formatDate(item.lastCheckinAt || item.checkedAt || item.updatedAt)}</td></tr>`
  }).join('') : emptyRow(6, '暂无签到排行')
}
function renderCheckinRecords(items = []) {
  checkinRecordItems = Array.isArray(items) ? items : []
  const rows = document.querySelector('#checkinRecordRows')
  if (!rows) return
  const query = String(document.querySelector('#checkinRecordQuery')?.value || '').trim().toLowerCase()
  const filtered = checkinRecordItems.filter(item => !query || [item.id, item.userId, item.userName, item.username, item.checkinDate, item.date, item.createdAt].some(value => String(value || '').toLowerCase().includes(query)))
  rows.innerHTML = filtered.length ? filtered.slice(0, 300).map(item => {
    const name = item.userName || item.username || item.nickname || item.user?.name || item.userId || '用户'
    const base = checkinNumber(item.basePoints ?? item.dailyPoints ?? item.points, 0)
    const bonus = checkinNumber(item.bonusPoints ?? item.streakBonusPoints ?? item.extraPoints, 0)
    const total = checkinNumber(item.totalPoints ?? item.rewardPoints ?? item.pointsAwarded, base + bonus)
    const streak = checkinNumber(item.streak ?? item.consecutiveDays, 0)
    return `<tr><td><strong>${escapeHtml(name)}</strong><br><span class="admin-message">${escapeHtml(item.userId || item.user?.id || '—')}</span></td><td>${escapeHtml(item.checkinDate || item.date || (item.createdAt ? new Date(item.createdAt).toLocaleDateString('zh-CN') : '—'))}</td><td>${base.toLocaleString()} ${escapeHtml(pointUnitName)}</td><td>${bonus.toLocaleString()} ${escapeHtml(pointUnitName)}</td><td><span class="checkin-points">+${total.toLocaleString()} ${escapeHtml(pointUnitName)}</span></td><td>${streak} 天</td><td>${formatDate(item.createdAt || item.checkedAt)}</td></tr>`
  }).join('') : emptyRow(7, query ? '没有匹配的签到记录' : '暂无签到记录')
}
function showWithdrawalDetail(item) {
  const dialog = document.querySelector('#withdrawalDialog')
  const detail = document.querySelector('#withdrawalDetail')
  if (!dialog || !detail || !item) return
  const points = withdrawalAmount(item, 'points')
  const gross = withdrawalAmount(item, 'grossAmountRmb', withdrawalAmount(item, 'amountRmb', 0))
  const fee = withdrawalAmount(item, 'feeAmountRmb')
  const net = withdrawalAmount(item, 'netAmountRmb', Math.max(0, gross - fee))
  const qr = adminMediaUrl(item.qrCodeUrl || item.paymentQrCodeUrl || item.paymentQr)
  detail.innerHTML = `<h2>提现详情</h2><dl class="admin-detail-grid"><dt>申请编号</dt><dd>${escapeHtml(item.requestNo || item.id || '—')}</dd><dt>用户</dt><dd>${escapeHtml(withdrawalApplicant(item))} <span class="admin-message">${escapeHtml(item.userId || '')}</span></dd><dt>收款手机</dt><dd>${escapeHtml(item.phone || item.contactPhone || '—')}</dd><dt>提现积分</dt><dd>${points.toLocaleString()} ${escapeHtml(pointUnitName)}</dd><dt>兑换金额</dt><dd>¥${gross.toFixed(2)}</dd><dt>手续费</dt><dd>¥${fee.toFixed(2)}</dd><dt>预计到账</dt><dd><strong>¥${net.toFixed(2)}</strong></dd><dt>状态</dt><dd>${statusBadge(item.status || 'pending')}</dd><dt>申请时间</dt><dd>${formatDate(item.createdAt || item.submittedAt)}</dd><dt>处理备注</dt><dd>${escapeHtml(item.note || item.adminNote || item.rejectReason || '—')}</dd></dl><div class="withdrawal-qr"><h3>收款二维码</h3>${qr ? `<a href="${escapeHtml(qr)}" target="_blank" rel="noopener"><img src="${escapeHtml(qr)}" alt="用户收款二维码"></a>` : '<p class="admin-message">未上传二维码</p>'}</div>`
  if (typeof dialog.showModal === 'function') dialog.showModal()
  else dialog.setAttribute('open', '')
}
function renderComments(items) {
  const rows = document.querySelector('#commentRows')
  if (!rows) return
  rows.innerHTML = items.length ? items.slice(0, 300).map(comment => {
    const deleted = String(comment.status || 'published') === 'deleted'
    const author = comment.user?.name || comment.user?.username || comment.userId || '用户'
    return `<tr><td><code>${escapeHtml(comment.id)}</code></td><td>${escapeHtml(comment.content || '—')}</td><td>${escapeHtml(author)}</td><td>${formatDate(comment.createdAt)}</td><td>${statusBadge(deleted ? 'archived' : 'published')}</td><td>${deleted ? `<button data-restore-comment="${escapeHtml(comment.id)}">恢复</button>` : `<button data-delete-comment="${escapeHtml(comment.id)}" data-danger="true">隐藏</button>`}</td></tr>`
  }).join('') : emptyRow(6, '暂无评论')
}
async function loadNotifications() {
  try { const body = await request('/api/v1/admin/notifications?pageSize=200'); renderNotifications(body.items || []) } catch { renderNotifications([]) }
}
async function loadAdmins() {
  try { const body = await request('/api/v1/admin/admins'); renderAdmins(body.items || []) } catch { renderAdmins([]) }
}
async function loadOverview() {
  const overview = await request('/api/v1/admin/overview')
  const statLabels = { posts: '内容', publishedPosts: '已发布内容', pendingPosts: '待审核内容', reports: '待处理举报', tags: '标签', comments: '评论', plans: '套餐', memberGroups: '启用会员组', memberships: '有效会员', orders: '订单', paidOrders: '已支付订单', revenueCents: '收入（分）', tipsCents: '历史打赏金额（分）', tipsPoints: '打赏积分', points: '积分余额', pointsAccounts: '积分账户', pointsInCirculation: '流通积分', pointsTransactions: '积分流水', auditLogs: '审计日志', recharges: '积分充值次数' }
  document.querySelector('#stats').innerHTML = Object.entries(overview).map(([name, value]) => `<div class="admin-stat"><strong>${Number(value).toLocaleString()}</strong><span>${statLabels[name] || name}</span></div>`).join('')
  await loadAdmins()
}
async function loadContent() {
  const [postData, reportData, commentReportData, commentData] = await Promise.all([request('/api/v1/admin/posts'), request('/api/v1/admin/reports?status=pending'), request('/api/v1/admin/comment-reports?status=pending'), request('/api/v1/admin/comments?pageSize=300')])
  document.querySelector('#postRows').innerHTML = (postData.items || []).map(post => { const access = post.accessType === 'member' ? '会员专享' : post.accessType === 'paid' ? `积分 ${Number(post.pricePoints ?? post.priceCents ?? 0).toLocaleString()} ${pointUnitName}` : '免费'; const moderation = post.status === 'pending' ? `<button data-publish="${escapeHtml(post.id)}">通过</button><button data-reject="${escapeHtml(post.id)}">驳回</button>` : ''; return `<tr><td>${escapeHtml(post.title)}</td><td>${escapeHtml(post.platform)}</td><td>${escapeHtml(access)}</td><td>${statusBadge(post.status || 'published')}</td><td>${moderation}<button data-archive="${escapeHtml(post.id)}" ${post.status === 'archived' ? 'disabled' : ''}>归档</button></td></tr>` }).join('') || emptyRow(5, '暂无内容')
  const reports = reportData.items || []
  document.querySelector('#reportRows').innerHTML = reports.length ? reports.map(report => `<tr><td>${escapeHtml(report.post?.title || report.postId)}</td><td>${escapeHtml(report.reason)}</td><td>${escapeHtml(report.detail || '—')}</td><td>${formatDate(report.createdAt)}</td><td><button data-resolve-report="${escapeHtml(report.id)}">处理</button><button data-reject-report="${escapeHtml(report.id)}">驳回</button></td></tr>`).join('') : emptyRow(5, '暂无待处理举报')
  const commentReports = commentReportData.items || []
  document.querySelector('#commentReportRows').innerHTML = commentReports.length ? commentReports.map(report => `<tr><td>${escapeHtml(report.comment?.content?.slice(0, 80) || report.commentId)}</td><td>${escapeHtml(report.post?.title || report.postId)}</td><td>${escapeHtml(report.reason)}</td><td>${formatDate(report.createdAt)}</td><td><button data-resolve-comment-report="${escapeHtml(report.id)}">处理</button><button data-reject-comment-report="${escapeHtml(report.id)}">驳回</button></td></tr>`).join('') : emptyRow(5, '暂无待处理评论举报')
  renderComments(commentData.items || [])
}
async function loadAdminPanel(name, force = false) {
  if (!force && loadedAdminPanels.has(name)) return
  if (name === 'overview') await loadOverview()
  if (name === 'content') await loadContent()
  if (name === 'members') await Promise.all([loadMonetization(), loadMemberships(), loadPointLedger()])
  if (name === 'finance') await Promise.all([loadWithdrawalConfig(), loadWithdrawals()])
  if (name === 'referral') await Promise.all([loadReferralConfig(), loadReferrals(), loadReferralCommissions()])
  if (name === 'checkin') await Promise.all([loadCheckinConfig(), loadCheckinStats(), loadCheckinRecords()])
  if (name === 'messages') await Promise.all([loadNotifications(), loadMonetization()])
  if (name === 'system') await loadMonetization()
  if (name === 'logs') await Promise.all([loadMonetization(), loadAuditLogs()])
  loadedAdminPanels.add(name)
}
async function load() {
  try { await loadAdminPanel(activeAdminPanel, true); showSuccess('数据已加载') } catch (error) { showError(error) }
}
document.querySelector('#loadBtn').addEventListener('click', load)
document.querySelector('#logoutBtn').addEventListener('click', () => { localStorage.removeItem('adminAccessToken'); localStorage.removeItem('adminUser'); location.replace('admin-login.html') })
document.querySelector('#adminForm').addEventListener('submit', async event => {
  event.preventDefault()
  try { const data = Object.fromEntries(new FormData(event.target)); await request('/api/v1/admin/admins', { method: 'POST', body: JSON.stringify(data) }); event.target.reset(); await loadAdmins(); showSuccess('管理员已新增') } catch (error) { showError(error) }
})
document.querySelector('#adminRows').addEventListener('click', async event => {
  const id = event.target.dataset.disableAdmin; if (!id || !confirm('停用后该管理员将无法登录，确定继续吗？')) return
  try { await request(`/api/v1/admin/admins/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status: 'disabled' }) }); await loadAdmins(); showSuccess('管理员已停用') } catch (error) { showError(error) }
})

document.querySelector('#postForm').addEventListener('submit', async event => {
  event.preventDefault()
  try { const data = Object.fromEntries(new FormData(event.target)); data.digest = data.digest === 'on'; data.pricePoints = Number(data.pricePoints || 0); await request('/api/v1/admin/posts', { method: 'POST', body: JSON.stringify(data) }); event.target.reset(); await load(); showSuccess('内容已发布') } catch (error) { showError(error) }
})

document.querySelector('#groupForm').addEventListener('submit', async event => {
  event.preventDefault()
  try {
    const form = event.target; const data = Object.fromEntries(new FormData(form)); const id = data.id
    data.rank = Number(data.rank || 0); data.giftPoints = Math.max(0, Number(data.giftPoints || 0)); data.permissions = collectGroupPermissions(form); delete data.permission; delete data.customPermissions; delete data.id
    const path = id ? `/api/v1/admin/member-groups/${encodeURIComponent(id)}` : '/api/v1/admin/member-groups'
    await request(path, { method: id ? 'PATCH' : 'POST', body: JSON.stringify(data) }); resetGroupForm(); await loadMonetization(); showSuccess(id ? '会员分组已更新' : '会员分组已新增')
  } catch (error) { showError(error) }
})
document.querySelector('#cancelGroupEdit').addEventListener('click', resetGroupForm)
document.querySelector('#groupRows').addEventListener('click', async event => {
  const editId = event.target.dataset.editGroup
  if (editId) {
    const group = memberGroups.find(item => item.id === editId); if (!group) return
    const form = document.querySelector('#groupForm'); form.elements.id.value = group.id; form.elements.code.value = group.code || ''; form.elements.name.value = group.name || ''; form.elements.description.value = group.description || ''; form.elements.rank.value = Number(group.rank || 0); form.elements.giftPoints.value = Number(group.giftPoints ?? group.welcomePoints ?? group.initialPoints ?? 0); form.elements.status.value = group.status || 'active'; setGroupPermissions(group.permissions || group.permissionCodes || []); form.querySelector('button[type="submit"]').textContent = '保存分组'; document.querySelector('#cancelGroupEdit').hidden = false; form.scrollIntoView({ behavior: 'smooth', block: 'center' }); return
  }
  const archiveId = event.target.dataset.archiveGroup
  if (!archiveId || !confirm('归档后该会员等级不再用于新开通，确定继续吗？')) return
  try { await request(`/api/v1/admin/member-groups/${encodeURIComponent(archiveId)}`, { method: 'DELETE' }); await loadMonetization(); showSuccess('会员分组已归档') } catch (error) { showError(error) }
})

document.querySelector('#planForm').addEventListener('submit', async event => {
  event.preventDefault()
  try { const data = Object.fromEntries(new FormData(event.target)); data.priceCents = Number(data.priceCents || 0); data.redeemPoints = Number(data.redeemPoints || 0); data.durationDays = Number(data.durationDays || 30); data.giftPoints = Number(data.giftPoints || 0); await request('/api/v1/admin/member-plans', { method: 'POST', body: JSON.stringify(data) }); event.target.reset(); await loadMonetization(); showSuccess('会员套餐已新增') } catch (error) { showError(error) }
})
document.querySelector('#tagForm').addEventListener('submit', async event => {
  event.preventDefault()
  try { const data = Object.fromEntries(new FormData(event.target)); await request(`/api/v1/admin/tags/${data.dimension}`, { method: 'POST', body: JSON.stringify({ name: data.name }) }); event.target.reset(); await load(); showSuccess('标签已新增') } catch (error) { showError(error) }
})

document.querySelector('#membershipGrantForm').addEventListener('submit', async event => {
  event.preventDefault()
  try {
    const data = Object.fromEntries(new FormData(event.target)); data.durationDays = Number(data.durationDays || 30); if (!data.startsAt) delete data.startsAt
    await requestFirst(['/api/v1/admin/memberships/grant', '/api/v1/admin/memberships'], { method: 'POST', body: JSON.stringify(data) })
    event.target.reset(); event.target.elements.durationDays.value = 30; await Promise.all([loadMemberships(), loadAuditLogs(), load()]); showSuccess('会员已手动开通')
  } catch (error) { showError(error) }
})
document.querySelector('#pointsConfigForm').addEventListener('submit', async event => {
  event.preventDefault()
  try { const data = Object.fromEntries(new FormData(event.target)); const body = await request('/api/v1/admin/points/config', { method: 'PATCH', body: JSON.stringify(data) }); pointUnitName = body.unitName || body.unit || pointUnitName; await loadMonetization(); showSuccess('积分与购买配置已保存') } catch (error) { showError(error) }
})
document.querySelector('#smtpForm').addEventListener('submit', async event => {
  event.preventDefault()
  try {
    const data = Object.fromEntries(new FormData(event.target)); data.port = Number(data.port || 465); data.secure = data.secure === 'on'
    const body = await request('/api/v1/admin/settings/smtp', { method: 'PATCH', body: JSON.stringify(data) })
    document.querySelector('#smtpMessage').textContent = body.configured ? 'SMTP 已保存并可发送验证码' : '配置已保存，但授权码为空，暂时不能发信'; showSuccess('SMTP 配置已保存')
  } catch (error) { showError(error) }
})
document.querySelector('#pointsRechargeForm').addEventListener('submit', async event => {
  event.preventDefault()
  try {
    const data = Object.fromEntries(new FormData(event.target)); data.points = Number(data.points || 0)
    await requestFirst(['/api/v1/admin/points/recharge', '/api/v1/admin/point-recharges', '/api/v1/admin/points/ledger'], { method: 'POST', body: JSON.stringify(data) })
    event.target.reset(); event.target.elements.source.value = '线下充值'; await Promise.all([loadPointLedger(), loadAuditLogs(), load()]); showSuccess('积分已充值')
  } catch (error) { showError(error) }
})
document.querySelector('#cdkeyForm').addEventListener('submit', async event => {
  event.preventDefault()
  try {
    const data = Object.fromEntries(new FormData(event.target)); data.points = Number(data.points || 0); data.quantity = Number(data.quantity || 1)
    if (data.expiresAt) data.expiresAt = new Date(data.expiresAt).toISOString(); else delete data.expiresAt
    const body = await request('/api/v1/admin/cdkeys', { method: 'POST', body: JSON.stringify(data) })
    const codes = (body.items || []).map(item => item.code).filter(Boolean)
    document.querySelector('#cdkeyMessage').innerHTML = codes.length ? `已生成 ${codes.length} 个兑换码，请复制后发给已付款用户：<br><code>${codes.map(escapeHtml).join('<br>')}</code>` : '兑换码已生成'
    event.target.reset(); event.target.elements.points.value = 1000; event.target.elements.quantity.value = 1
    await Promise.all([loadCdkeys(), loadAuditLogs()]); showSuccess('兑换码已生成')
  } catch (error) { showError(error) }
})

document.querySelector('#postRows').addEventListener('click', async event => {
  const publishId = event.target.dataset.publish; const rejectId = event.target.dataset.reject
  if (publishId || rejectId) { try { await request(`/api/v1/admin/posts/${encodeURIComponent(publishId || rejectId)}`, { method: 'PATCH', body: JSON.stringify({ status: publishId ? 'published' : 'rejected' }) }); await load() } catch (error) { showError(error) }; return }
  const id = event.target.dataset.archive; if (!id) return
  try { await request(`/api/v1/admin/posts/${encodeURIComponent(id)}`, { method: 'DELETE' }); await load() } catch (error) { showError(error) }
})
document.querySelector('#reportRows').addEventListener('click', async event => { const reportId = event.target.dataset.resolveReport || event.target.dataset.rejectReport; if (!reportId) return; try { await request(`/api/v1/admin/reports/${encodeURIComponent(reportId)}`, { method: 'PATCH', body: JSON.stringify({ status: event.target.dataset.resolveReport ? 'resolved' : 'rejected', resolution: event.target.dataset.resolveReport ? '已处理' : '不予受理' }) }); await load() } catch (error) { showError(error) } })
document.querySelector('#commentReportRows').addEventListener('click', async event => { const reportId = event.target.dataset.resolveCommentReport || event.target.dataset.rejectCommentReport; if (!reportId) return; try { await request(`/api/v1/admin/comment-reports/${encodeURIComponent(reportId)}/resolve`, { method: 'POST', body: JSON.stringify({ status: event.target.dataset.resolveCommentReport ? 'resolved' : 'rejected', resolution: event.target.dataset.resolveCommentReport ? '已处理' : '不予受理' }) }); await load() } catch (error) { showError(error) } })
document.querySelector('#commentRows')?.addEventListener('click', async event => {
  const id = event.target.dataset.deleteComment || event.target.dataset.restoreComment
  if (!id) return
  const status = event.target.dataset.deleteComment ? 'deleted' : 'published'
  if (status === 'deleted' && !confirm('隐藏后用户将看不到这条评论，确定继续吗？')) return
  try { await request(`/api/v1/admin/comments/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status }) }); await loadContent(); showSuccess(status === 'deleted' ? '评论已隐藏' : '评论已恢复') } catch (error) { showError(error) }
})
document.querySelector('#refreshComments')?.addEventListener('click', loadContent)
document.querySelector('#membershipQuery').addEventListener('input', () => renderMemberships(membershipItems))
document.querySelector('#refreshMemberships').addEventListener('click', loadMemberships)
document.querySelector('#refreshAudit').addEventListener('click', loadAuditLogs)
document.querySelector('#grantGroupId').addEventListener('change', updateGrantOptions)
document.querySelector('#membershipRows').addEventListener('click', async event => {
  const id = event.target.dataset.revokeMembership; if (!id || !confirm('撤销后该会员将无法继续使用等级权益，确定继续吗？')) return
  try { await request(`/api/v1/admin/memberships/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status: 'revoked', note: '管理员手动撤销' }) }); await Promise.all([loadMemberships(), loadAuditLogs(), load()]); showSuccess('会员已撤销') } catch (error) { showError(error) }
})
document.querySelector('#cdkeyRows').addEventListener('click', async event => {
  const id = event.target.dataset.revokeCdkey
  if (!id || !confirm('停用后该兑换码将无法使用，确定继续吗？')) return
  try { await request(`/api/v1/admin/cdkeys/${encodeURIComponent(id)}/revoke`, { method: 'POST', body: JSON.stringify({ reason: '管理员停用' }) }); await Promise.all([loadCdkeys(), loadAuditLogs()]); showSuccess('兑换码已停用') } catch (error) { showError(error) }
})
document.querySelector('#notificationScope')?.addEventListener('change', syncNotificationAudience)
document.querySelector('#refreshNotifications')?.addEventListener('click', loadNotifications)
document.querySelector('#notificationForm')?.addEventListener('submit', async event => {
  event.preventDefault()
  const form = event.target
  try {
    const data = Object.fromEntries(new FormData(form))
    data.scope = String(data.scope || 'all')
    if (data.scope === 'users') data.userIds = String(data.userIds || '').split(/[，,\n]/).map(value => value.trim()).filter(Boolean)
    else delete data.userIds
    if (data.scope === 'group') data.groupIds = [...form.querySelectorAll('#notificationGroups option:checked')].map(option => option.value).filter(Boolean)
    else delete data.groupIds
    delete data.userIdsInput
    const result = await request('/api/v1/admin/notifications', { method: 'POST', body: JSON.stringify(data) })
    form.reset(); syncNotificationAudience(); renderNotificationGroups()
    const notice = document.querySelector('#notificationMessage')
    if (notice) notice.textContent = `已发送给 ${Number(result.recipientCount || 0).toLocaleString()} 位用户`
    await Promise.all([loadNotifications(), loadAuditLogs()])
    showSuccess('站内信已发送')
  } catch (error) { showError(error) }
})
document.querySelector('#withdrawalConfigForm')?.addEventListener('submit', async event => {
  event.preventDefault()
  try {
    const data = Object.fromEntries(new FormData(event.target))
    data.pointsPerYuan = Number(data.pointsPerYuan)
    data.withdrawFeePercent = Number(data.withdrawFeePercent)
    const body = await request('/api/v1/admin/withdrawal-config', { method: 'PATCH', body: JSON.stringify(data) })
    withdrawalConfig = { ...withdrawalConfig, ...(body.config || body) }
    renderWithdrawalConfig()
    const notice = document.querySelector('#withdrawalConfigMessage')
    if (notice) notice.textContent = '提现设置已保存，新申请将按新比例计算'
    showSuccess('提现设置已保存')
  } catch (error) { showError(error) }
})
document.querySelector('#refreshWithdrawals')?.addEventListener('click', loadWithdrawals)
document.querySelector('#withdrawalStatusFilter')?.addEventListener('change', loadWithdrawals)
document.querySelector('#withdrawalQuery')?.addEventListener('input', () => renderWithdrawals(withdrawalItems))
document.querySelector('#withdrawalRows')?.addEventListener('click', async event => {
  const viewId = event.target.dataset.viewWithdrawal
  if (viewId) { showWithdrawalDetail(withdrawalItems.find(item => String(item.id) === String(viewId))); return }
  const payId = event.target.dataset.payWithdrawal
  const rejectId = event.target.dataset.rejectWithdrawal
  const id = payId || rejectId
  if (!id) return
  const item = withdrawalItems.find(candidate => String(candidate.id) === String(id))
  if (!item) return
  if (payId) {
    if (!confirm('确认已向该用户转账？标记后用户会看到“已打款”。')) return
    const note = prompt('可填写转账流水号或备注（可选）', '')
    if (note === null) return
    try { await request(`/api/v1/admin/withdrawals/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status: 'paid', note }) }); await Promise.all([loadWithdrawals(), loadAuditLogs()]); showSuccess('提现已标记为已打款') } catch (error) { showError(error) }
    return
  }
  const note = prompt('请输入驳回原因（将记录在提现记录中）', '')
  if (note === null) return
  if (!note.trim()) { showError(new Error('请填写驳回原因')); return }
  try { await request(`/api/v1/admin/withdrawals/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status: 'rejected', note: note.trim(), reason: note.trim() }) }); await Promise.all([loadWithdrawals(), loadAuditLogs()]); showSuccess('提现申请已驳回') } catch (error) { showError(error) }
})
document.querySelector('#referralConfigForm')?.addEventListener('submit', async event => {
  event.preventDefault()
  try {
    const directPercent = Number(event.target.elements.directPercent.value)
    if (!Number.isFinite(directPercent) || directPercent < 0 || directPercent > 100) throw new Error('直属提成比例需在 0% 到 100% 之间')
    const body = await request('/api/v1/admin/referral-config', { method: 'PATCH', body: JSON.stringify({ directPercent, rate1: directPercent, level1Rate: directPercent, secondPercent: 0, rate2: 0, level2Rate: 0 }) })
    referralConfig = normalizeReferralConfig(body.config || body)
    renderReferralConfig()
    const notice = document.querySelector('#referralConfigMessage')
    if (notice) notice.textContent = `直属提成比例已更新为 ${referralPercent(directPercent)}，二级关系不计提成`
    showSuccess('分销设置已保存')
  } catch (error) { showError(error) }
})
document.querySelector('#refreshReferrals')?.addEventListener('click', loadReferrals)
document.querySelector('#refreshReferralCommissions')?.addEventListener('click', loadReferralCommissions)
document.querySelector('#referralLevelFilter')?.addEventListener('change', () => renderReferrals(referralItems))
document.querySelector('#referralStatusFilter')?.addEventListener('change', () => renderReferrals(referralItems))
document.querySelector('#referralQuery')?.addEventListener('input', () => renderReferrals(referralItems))
document.querySelector('#commissionStatusFilter')?.addEventListener('change', () => renderReferralCommissions(referralCommissionItems))
document.querySelector('#commissionQuery')?.addEventListener('input', () => renderReferralCommissions(referralCommissionItems))
document.querySelector('#checkinConfigForm')?.addEventListener('submit', async event => {
  event.preventDefault()
  try {
    const form = event.target
    const rewards = readCheckinRewardRows().filter(item => Number.isInteger(item.days) && item.days >= 2 && Number.isFinite(item.bonusPoints) && item.bonusPoints >= 0).sort((a, b) => a.days - b.days)
    const dailyPoints = Number(form.elements.dailyPoints.value || 0)
    const streakBonusPoints = Number(form.elements.streakBonusPoints.value || 0)
    const leaderboardDays = Number(form.elements.leaderboardDays.value || 30)
    if (!Number.isInteger(dailyPoints) || dailyPoints < 0) throw new Error('每日签到积分必须是非负整数')
    if (!Number.isInteger(streakBonusPoints) || streakBonusPoints < 0) throw new Error('连续签到每日额外积分必须是非负整数')
    if (!rewards.every((item, index) => index === 0 || item.days > rewards[index - 1].days)) throw new Error('连续奖励天数不能重复，且需递增')
    const body = await request('/api/v1/admin/checkin-config', { method: 'PATCH', body: JSON.stringify({ enabled: form.elements.enabled.checked, dailyPoints, checkinPoints: dailyPoints, streakRewards: rewards, streakBonuses: rewards, streakBonusPoints, leaderboardDays, timezone: 'Asia/Shanghai' }) })
    checkinConfig = { ...checkinConfig, ...(body.config || body), dailyPoints, streakRewards: rewards, streakBonusPoints, leaderboardDays }
    renderCheckinConfig()
    const notice = document.querySelector('#checkinConfigMessage')
    if (notice) notice.textContent = `签到规则已保存：每日 ${dailyPoints.toLocaleString()} ${pointUnitName}，连续奖励 ${rewards.length} 条`
    showSuccess('签到规则已保存')
  } catch (error) { showError(error) }
})
document.querySelector('#addCheckinReward')?.addEventListener('click', () => {
  const current = readCheckinRewardRows().filter(item => item.days > 0 && item.bonusPoints >= 0)
  const days = current.length ? Math.max(...current.map(item => item.days)) + 7 : 3
  renderCheckinRewardRows([...current, { days, bonusPoints: 5 }])
})
document.querySelector('#checkinRewardRows')?.addEventListener('click', event => {
  const button = event.target.closest('[data-remove-checkin-reward]')
  if (!button) return
  const index = Number(button.dataset.removeCheckinReward)
  if (!Number.isInteger(index)) return
  renderCheckinRewardRows(readCheckinRewardRows().filter((_, rowIndex) => rowIndex !== index))
})
document.querySelector('#refreshCheckinStats')?.addEventListener('click', () => loadCheckinStats())
document.querySelector('#checkinLeaderboardPeriod')?.addEventListener('change', () => loadCheckinStats())
document.querySelector('#refreshCheckinRecords')?.addEventListener('click', loadCheckinRecords)
document.querySelector('#checkinRecordQuery')?.addEventListener('input', () => renderCheckinRecords(checkinRecordItems))
setupAdminTabs()
syncNotificationAudience()

async function loadMonetization() {
  try { const config = await request('/api/v1/admin/points/config'); pointUnitName = config.unitName || config.unit || '积分'; const input = document.querySelector('#pointsConfigForm [name="unitName"]'); if (input) input.value = pointUnitName; const contact = config.purchaseContact || {}; for (const [name, value] of [['wechatId', contact.wechatId], ['qrCodeUrl', contact.qrCodeUrl], ['contactNote', contact.note], ['offlineTitle', contact.offlineTitle], ['offlineNote', contact.offlineNote]]) { const field = document.querySelector(`#pointsConfigForm [name="${name}"]`); if (field) field.value = value || '' } } catch { pointUnitName = '积分' }
  await Promise.allSettled([
    (async () => { try { const smtp = await request('/api/v1/admin/settings/smtp'); const form = document.querySelector('#smtpForm'); form.elements.host.value = smtp.host || ''; form.elements.port.value = smtp.port || 465; form.elements.user.value = smtp.user || ''; form.elements.from.value = smtp.from || ''; form.elements.secure.checked = smtp.secure !== false; document.querySelector('#smtpMessage').textContent = smtp.configured ? '当前 SMTP 已配置' : '当前 SMTP 尚未配置授权码' } catch { document.querySelector('#smtpMessage').textContent = 'SMTP 配置读取失败' } })(),
    (async () => { try { const body = await request('/api/v1/admin/member-groups'); renderGroups(body.items || body.groups || []) } catch { renderGroups([]); document.querySelector('#groupRows').innerHTML = emptyRow(7, '分组接口暂不可用') } })(),
    (async () => { try { const body = await request('/api/v1/admin/member-plans'); renderPlans(body.items || body.plans || []) } catch { renderPlans([]); document.querySelector('#planRows').innerHTML = emptyRow(6, '套餐接口暂不可用') } })(),
    (async () => { try { const body = await request('/api/v1/admin/orders'); const orders = body.items || body.orders || []; document.querySelector('#orderRows').innerHTML = orders.length ? orders.slice(0, 30).map(order => `<tr><td>${escapeHtml(order.orderNo || order.id)}</td><td>${escapeHtml(order.kindLabel || order.kind || '订单')}</td><td>${order.amountPoints != null ? `${Number(order.amountPoints).toLocaleString()} ${escapeHtml(pointUnitName)}` : '线下登记'}</td><td>${statusBadge(order.status || 'pending')}</td><td>${formatDate(order.createdAt)}</td></tr>`).join('') : emptyRow(5, '暂无订单') } catch { document.querySelector('#orderRows').innerHTML = emptyRow(5, '订单接口暂不可用') } })(),
    (async () => { try { const body = await request('/api/v1/admin/tips'); const tips = body.items || body.tips || []; document.querySelector('#tipSummary').textContent = `打赏记录 ${tips.length} 条，累计 ${tips.reduce((sum, tip) => sum + Number(tip.points || tip.amountPoints || 0), 0).toLocaleString()} ${pointUnitName}` } catch { document.querySelector('#tipSummary').textContent = '打赏接口暂不可用' } })(),
    loadCdkeys()
  ])
}
async function loadCdkeys() {
  try { const body = await request('/api/v1/admin/cdkeys?pageSize=200'); renderCdkeys(body.items || body.cdkeys || []) } catch { renderCdkeys([]); document.querySelector('#cdkeyRows').innerHTML = emptyRow(8, '兑换码接口暂不可用') }
}
async function loadMemberships() {
  try { const body = await request('/api/v1/admin/memberships'); renderMemberships(body.items || body.memberships || []) } catch { renderMemberships([]); document.querySelector('#membershipRows').innerHTML = emptyRow(6, '会员记录接口暂不可用') }
}
async function loadPointLedger() {
  try { const body = await requestFirst(['/api/v1/admin/point-recharges', '/api/v1/admin/points/ledger']); renderPointRows(body.items || body.records || body.ledger || []) } catch { renderPointRows([]); document.querySelector('#pointRows').innerHTML = emptyRow(7, '积分记录接口暂不可用') }
}
async function loadAuditLogs() {
  try { const limit = Math.min(500, Math.max(10, Number(document.querySelector('#auditLimit').value || 100))); const body = await request(`/api/v1/admin/audit-logs?limit=${limit}`); renderAuditRows(body.items || body.logs || []) } catch { renderAuditRows([]); document.querySelector('#auditRows').innerHTML = emptyRow(6, '系统日志接口暂不可用') }
}
function renderWithdrawalConfig() {
  const form = document.querySelector('#withdrawalConfigForm')
  if (!form) return
  const points = Number(withdrawalConfig.pointsPerYuan ?? withdrawalConfig.pointsPerRmb ?? withdrawalConfig.pointsPerCny ?? 100)
  const fee = Number(withdrawalConfig.withdrawFeePercent ?? withdrawalConfig.feePercent ?? 0)
  form.elements.pointsPerYuan.value = Number.isFinite(points) ? points : 100
  form.elements.withdrawFeePercent.value = Number.isFinite(fee) ? fee : 0
}
async function loadWithdrawalConfig() {
  try {
    const body = await request('/api/v1/admin/withdrawal-config')
    withdrawalConfig = body.config || body
    renderWithdrawalConfig()
    const notice = document.querySelector('#withdrawalConfigMessage')
    if (notice) notice.textContent = `当前比例：${Number(withdrawalConfig.pointsPerYuan ?? 100)} 积分 / 元，手续费：${Number(withdrawalConfig.withdrawFeePercent ?? 0)}%`
  } catch (error) {
    withdrawalConfig = { pointsPerYuan: 100, withdrawFeePercent: 0 }
    renderWithdrawalConfig()
    const notice = document.querySelector('#withdrawalConfigMessage')
    if (notice) notice.textContent = error.status === 404 ? '提现设置接口尚未启用' : '提现设置读取失败'
  }
}
async function loadWithdrawals() {
  try {
    const status = String(document.querySelector('#withdrawalStatusFilter')?.value || '')
    const query = status ? `?status=${encodeURIComponent(status)}&pageSize=300` : '?pageSize=300'
    const body = await request(`/api/v1/admin/withdrawals${query}`)
    renderWithdrawals(body.items || body.withdrawals || [])
  } catch (error) {
    renderWithdrawals([])
    const rows = document.querySelector('#withdrawalRows')
    if (rows) rows.innerHTML = emptyRow(9, error.status === 404 ? '提现接口尚未启用' : '提现记录读取失败')
  }
}
async function loadReferralConfig() {
  try {
    const body = await request('/api/v1/admin/referral-config')
    referralConfig = normalizeReferralConfig(body.config || body)
    renderReferralConfig()
    const direct = referralConfig.directPercent ?? referralConfig.rate1 ?? referralConfig.level1Rate ?? referralConfig.directRate ?? 0
    const notice = document.querySelector('#referralConfigMessage')
    if (notice) notice.textContent = `当前直属提成：${referralPercent(direct)}；二级关系不计提成`
  } catch (error) {
    referralConfig = { directPercent: 0, secondPercent: 0 }
    renderReferralConfig()
    const notice = document.querySelector('#referralConfigMessage')
    if (notice) notice.textContent = error.status === 404 ? '分销设置接口尚未启用' : '分销设置读取失败'
  }
}
async function loadReferrals() {
  try {
    const body = await request('/api/v1/admin/referrals?pageSize=300')
    referralRelationMeta = body || {}
    renderReferrals(body.items || body.referrals || body.records || [])
  } catch (error) {
    referralRelationMeta = {}
    renderReferrals([])
    const rows = document.querySelector('#referralRows')
    if (rows) rows.innerHTML = emptyRow(5, error.status === 404 ? '邀请关系接口尚未启用' : '邀请关系读取失败')
  }
}
async function loadReferralCommissions() {
  try {
    const body = await request('/api/v1/admin/referral-commissions?pageSize=300')
    referralCommissionMeta = body || {}
    renderReferralCommissions(body.items || body.commissions || body.records || [])
  } catch (error) {
    referralCommissionMeta = {}
    renderReferralCommissions([])
    const rows = document.querySelector('#referralCommissionRows')
    if (rows) rows.innerHTML = emptyRow(8, error.status === 404 ? '提成流水接口尚未启用' : '提成流水读取失败')
  }
}
async function loadCheckinConfig() {
  try {
    const body = await request('/api/v1/admin/checkin-config')
    checkinConfig = { ...checkinConfig, ...(body.config || body) }
    renderCheckinConfig()
    const notice = document.querySelector('#checkinConfigMessage')
    if (notice) notice.textContent = `每日签到 ${checkinNumber(checkinConfig.dailyPoints ?? checkinConfig.checkinPoints, 0).toLocaleString()} ${pointUnitName}，连续奖励 ${checkinRewardsFrom(checkinConfig).length} 条`
  } catch (error) {
    renderCheckinConfig()
    const notice = document.querySelector('#checkinConfigMessage')
    if (notice) notice.textContent = error.status === 404 ? '签到设置接口尚未启用' : '签到设置读取失败'
  }
}
async function loadCheckinStats() {
  try {
    const period = String(document.querySelector('#checkinLeaderboardPeriod')?.value || checkinConfig.leaderboardDays || 30)
    let body = {}
    try { body = await request(`/api/v1/admin/checkins?period=${encodeURIComponent(period)}&pageSize=100`) } catch (error) { if (error.status !== 404) throw error }
    checkinStats = body || {}
    renderCheckinStats(body.summary || body.stats || body)
    let ranking = body
    try { ranking = await request(`/api/v1/admin/checkin-leaderboard?period=${encodeURIComponent(period)}&limit=100`) } catch (error) { if (error.status !== 404) throw error }
    renderCheckinLeaderboard(ranking.items || ranking.leaderboard || ranking.ranking || ranking.records || [])
  } catch (error) {
    checkinStats = {}
    renderCheckinStats({})
    renderCheckinLeaderboard([])
    const rows = document.querySelector('#checkinLeaderboardRows')
    if (rows) rows.innerHTML = emptyRow(6, error.status === 404 ? '签到排行榜接口尚未启用' : '签到排行读取失败')
  }
}
async function loadCheckinRecords() {
  try {
    const query = String(document.querySelector('#checkinRecordQuery')?.value || '').trim()
    const suffix = query ? `?q=${encodeURIComponent(query)}&query=${encodeURIComponent(query)}&pageSize=300` : '?pageSize=300'
    const body = await request(`/api/v1/admin/checkins${suffix}`)
    renderCheckinRecords(body.items || body.records || body.checkins || [])
  } catch (error) {
    renderCheckinRecords([])
    const rows = document.querySelector('#checkinRecordRows')
    if (rows) rows.innerHTML = emptyRow(7, error.status === 404 ? '签到记录接口尚未启用' : '签到记录读取失败')
  }
}
const storedAdmin = JSON.parse(localStorage.getItem('adminUser') || 'null')
if (!adminToken) {
  location.replace('admin-login.html')
} else {
  if (storedAdmin) document.querySelector('#adminSession').textContent = `${storedAdmin.name || storedAdmin.username} · ${storedAdmin.roleLabel || storedAdmin.role || '管理员'}`
  load()
}
