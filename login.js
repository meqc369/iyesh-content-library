const API = window.CONTENT_API_BASE || 'http://127.0.0.1:8787'
const message = document.querySelector('#loginMessage')
function safeReturnUrl(value) {
  try {
    const target = new URL(value || 'index.html', location.href)
    if (target.origin !== location.origin || target.pathname.endsWith('/login.html')) return 'index.html'
    return `${target.pathname}${target.search}${target.hash}`
  } catch { return 'index.html' }
}
const returnUrl = safeReturnUrl(new URLSearchParams(location.search).get('return'))
const referralCode = String(new URLSearchParams(location.search).get('ref') || new URLSearchParams(location.search).get('referralCode') || '').trim().slice(0, 80)
const loginForm = document.querySelector('#loginForm')
const registerForm = document.querySelector('#registerForm')
const resetForm = document.querySelector('#resetForm')
const tabs = [...document.querySelectorAll('.auth-tabs [data-mode]')]
const REQUEST_TIMEOUT_MS = 10000
let codeTimer = null
let resetCodeTimer = null

function showMessage(text, type = '') { message.textContent = text; message.className = `auth-message${type ? ` ${type}` : ''}` }
function userFacingError(error) {
  const text = String(error?.message || '').trim()
  if (/load failed|failed to fetch|networkerror|network request failed/i.test(text)) return '网络连接失败，请检查网络后重试'
  return text || '请求失败，请稍后重试'
}
async function fetchWithTimeout(url, options = {}, timeout = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeout)
  try { return await fetch(url, { ...options, signal: controller.signal }) }
  catch (error) { if (error.name === 'AbortError') throw new Error('服务响应较慢，请稍后重试'); throw error }
  finally { clearTimeout(timer) }
}
async function parseResponse(response) { const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.message || `请求失败 ${response.status}`); return body }
function saveSession(data) { localStorage.setItem('accessToken', data.accessToken); localStorage.setItem('currentUser', JSON.stringify(data.user)); localStorage.setItem('sessionExpiresAt', String(Date.now() + Number(data.expiresInDays || 30) * 86400000)) }
function redirectAfterLogin() { showMessage('登录成功，正在进入月入万刀…', 'success'); setTimeout(() => { location.href = returnUrl }, 450) }
function setMode(mode) {
  const register = mode === 'register'; const reset = mode === 'reset'
  tabs.forEach(tab => { const active = !reset && tab.dataset.mode === mode; tab.classList.toggle('is-active', active); tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active || (reset && tab.dataset.mode === 'login') ? 0 : -1 })
  loginForm.hidden = register || reset; registerForm.hidden = !register; resetForm.hidden = !reset
  document.querySelector('#authTitle').textContent = register ? '创建你的账号' : reset ? '找回登录密码' : '欢迎回来'
  document.querySelector('#authSubtitle').textContent = register ? '用邮箱验证，加入月入万刀社区' : reset ? '验证邮箱后设置一个新密码' : '登录后继续探索月入万刀'
  showMessage('')
  if (reset) resetForm.querySelector('input')?.focus()
}
function startCountdown(button, seconds, timerKind) {
  const timerRef = timerKind === 'reset' ? 'resetCodeTimer' : 'codeTimer'
  clearInterval(timerKind === 'reset' ? resetCodeTimer : codeTimer); button.disabled = true
  const tick = () => { seconds -= 1; button.textContent = seconds > 0 ? `${seconds}s 后重发` : '重新获取'; if (seconds <= 0) { clearInterval(timerKind === 'reset' ? resetCodeTimer : codeTimer); button.disabled = false } }
  tick(); const timer = setInterval(tick, 1000); if (timerRef === 'resetCodeTimer') resetCodeTimer = timer; else codeTimer = timer
}
tabs.forEach(tab => tab.addEventListener('click', () => setMode(tab.dataset.mode)))
loginForm.addEventListener('submit', async event => {
  event.preventDefault(); const button = loginForm.querySelector('button[type="submit"]'); button.disabled = true; showMessage('正在登录…')
  try { const data = await parseResponse(await fetchWithTimeout(`${API}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: loginForm.elements.identifier.value.trim(), password: loginForm.elements.password.value, remember: loginForm.elements.remember.checked }) })); saveSession(data); redirectAfterLogin() } catch (error) { showMessage(userFacingError(error), 'error') } finally { button.disabled = false }
})
async function requestCode(form, button, endpoint, timerKind) {
  const email = form.elements.email.value.trim(); if (!email) { showMessage('请先填写邮箱地址', 'error'); form.elements.email.focus(); return }
  button.disabled = true; showMessage('正在发送验证码…')
  try { const data = await parseResponse(await fetchWithTimeout(`${API}${endpoint}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) })); startCountdown(button, Number(data.retryAfter || 60), timerKind); showMessage('验证码已发送，请检查邮箱（有效期 10 分钟）', 'success') } catch (error) { button.disabled = false; button.textContent = '获取验证码'; showMessage(userFacingError(error), 'error') }
}
document.querySelector('#sendCodeBtn').addEventListener('click', () => requestCode(registerForm, document.querySelector('#sendCodeBtn'), '/api/v1/auth/register/request-code', 'register'))
registerForm.addEventListener('submit', async event => {
  event.preventDefault(); const button = registerForm.querySelector('button[type="submit"]'); const password = registerForm.elements.password.value; if (password !== registerForm.elements.confirmPassword.value) { showMessage('两次输入的密码不一致', 'error'); return }
  button.disabled = true; showMessage('正在创建账号…')
  try { const data = await parseResponse(await fetchWithTimeout(`${API}/api/v1/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: registerForm.elements.username.value.trim(), email: registerForm.elements.email.value.trim(), code: registerForm.elements.code.value.trim(), password, referralCode: referralCode || undefined }) })); saveSession(data); redirectAfterLogin() } catch (error) { showMessage(userFacingError(error), 'error') } finally { button.disabled = false }
})
document.querySelector('#forgotLink').addEventListener('click', event => { event.preventDefault(); setMode('reset'); resetForm.elements.email.value = loginForm.elements.identifier.value.includes('@') ? loginForm.elements.identifier.value.trim() : ''; resetForm.elements.email.focus() })
document.querySelector('#sendResetCodeBtn').addEventListener('click', () => requestCode(resetForm, document.querySelector('#sendResetCodeBtn'), '/api/v1/auth/password-reset/request-code', 'reset'))
resetForm.addEventListener('submit', async event => {
  event.preventDefault(); const button = resetForm.querySelector('button[type="submit"]'); const password = resetForm.elements.password.value; if (password !== resetForm.elements.confirmPassword.value) { showMessage('两次输入的新密码不一致', 'error'); return }
  button.disabled = true; showMessage('正在重置密码…')
  try { await parseResponse(await fetchWithTimeout(`${API}/api/v1/auth/password-reset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: resetForm.elements.email.value.trim(), code: resetForm.elements.code.value.trim(), password }) })); setMode('login'); loginForm.elements.identifier.value = resetForm.elements.email.value.trim(); loginForm.elements.password.value = ''; showMessage('密码已重置，请使用新密码登录', 'success') } catch (error) { showMessage(userFacingError(error), 'error') } finally { button.disabled = false }
})
document.querySelector('#backToLoginBtn').addEventListener('click', () => setMode('login'))
