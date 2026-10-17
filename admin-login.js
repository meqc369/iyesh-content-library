/* 后台登录 */
(function () {
  'use strict';
  const App = window.App;
  const form = document.querySelector('#adminLoginForm');
  const message = document.querySelector('#adminLoginMessage');
  const say = (text, type = '') => { message.textContent = text; message.className = `auth-message${type ? ` is-${type}` : ''}`; };
  if (new URLSearchParams(location.search).get('expired')) say('登录已过期，请重新登录', 'error');
  try { if (localStorage.getItem('adminAccessToken')) say('你已登录后台，可以直接进入。'); } catch {}

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const username = form.elements.username.value.trim();
    const password = form.elements.password.value;
    if (!username) { say('请输入管理员账号', 'error'); form.elements.username.focus(); return; }
    if (!password) { say('请输入密码', 'error'); form.elements.password.focus(); return; }
    const button = form.querySelector('button[type="submit"]');
    button.classList.add('is-loading'); button.disabled = true;
    say('正在验证…');
    try {
      const data = await App.api('/api/v1/admin/auth/login', { method: 'POST', auth: false, body: { username, password, remember: form.elements.remember.checked } });
      localStorage.setItem('adminAccessToken', data.accessToken);
      localStorage.setItem('adminUser', JSON.stringify(data.admin));
      say(`欢迎，${data.admin?.name || '管理员'}`, 'success');
      setTimeout(() => location.replace('admin.html'), 300);
    } catch (error) { say(error.message, 'error'); }
    finally { button.classList.remove('is-loading'); button.disabled = false; }
  });
  document.addEventListener('click', event => {
    const toggle = event.target.closest('[data-toggle-password]');
    if (!toggle) return;
    const input = toggle.parentElement.querySelector('input');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    toggle.innerHTML = App.icon(show ? 'eyeoff' : 'eye');
  });
})();
