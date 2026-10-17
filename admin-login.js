const API = window.CONTENT_API_BASE || 'http://127.0.0.1:8787'
const form = document.querySelector('#adminLoginForm')
const message = document.querySelector('#adminLoginMessage')
const REQUEST_TIMEOUT_MS = 10000
function showMessage(text, type = '') { message.textContent = text; message.className = `admin-login-message${type ? ` ${type}` : ''}` }
async function fetchWithTimeout(url, options = {}, timeout = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeout)
  try { return await fetch(url, { ...options, signal: controller.signal }) }
  catch (error) { if (error.name === 'AbortError') throw new Error('服务响应较慢，请稍后重试'); throw error }
  finally { clearTimeout(timer) }
}
async function parseResponse(response) { const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.message || `请求失败 ${response.status}`); return body }
form.addEventListener('submit', async event => {
  event.preventDefault(); const button = form.querySelector('button[type="submit"]'); button.disabled = true; showMessage('正在验证管理员账号…')
  try {
    const data = await parseResponse(await fetchWithTimeout(`${API}/api/v1/admin/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: form.elements.username.value.trim(), password: form.elements.password.value, remember: form.elements.remember.checked }) }))
    localStorage.setItem('adminAccessToken', data.accessToken); localStorage.setItem('adminUser', JSON.stringify(data.admin)); showMessage(`登录成功，正在进入${data.admin?.roleLabel || '后台'}…`, 'success'); setTimeout(() => { location.href = 'admin.html' }, 250)
  } catch (error) { showMessage(error.message) } finally { button.disabled = false }
})
