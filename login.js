/* 登录 / 注册 / 找回密码 */
(function () {
  'use strict';
  const App = window.App;
  const { api, session, icon } = App;
  const params = new URLSearchParams(location.search);
  const referralCode = String(params.get('ref') || params.get('referralCode') || '').trim().slice(0, 80);
  const forms = { login: document.querySelector('#loginForm'), register: document.querySelector('#registerForm'), reset: document.querySelector('#resetForm') };
  const message = document.querySelector('#authMessage');
  const timers = {};

  function safeReturn() {
    const raw = params.get('return');
    try {
      const target = new URL(raw || 'index.html', location.href);
      if (target.origin !== location.origin || /\/login\.html$/.test(target.pathname)) return 'index.html';
      // Collapse leading slashes so a path like //evil.com can't become a protocol-relative URL.
      return `/${target.pathname.replace(/^\/+/, '')}${target.search}${target.hash}`;
    } catch { return 'index.html'; }
  }
  function say(text, type = '') { message.textContent = text; message.className = `auth-message${type ? ` is-${type}` : ''}`; }
  function setMode(mode) {
    Object.entries(forms).forEach(([key, form]) => { form.hidden = key !== mode; });
    document.querySelectorAll('#modeTabs [data-mode]').forEach(tab => { const active = tab.dataset.mode === mode || (mode === 'reset' && tab.dataset.mode === 'login'); tab.setAttribute('aria-selected', String(active)); });
    document.querySelector('#modeTabs').hidden = mode === 'reset';
    document.querySelector('#authTitle').textContent = { login: '欢迎回来', register: '创建账号', reset: '找回密码' }[mode];
    document.querySelector('#authSubtitle').textContent = { login: '登录后继续阅读、收藏和发布内容', register: '用邮箱验证，一分钟加入月入万刀', reset: '验证注册邮箱后设置新密码' }[mode];
    say('');
    if (mode === 'reset') { const id = forms.login.elements.identifier.value.trim(); if (id.includes('@')) forms.reset.elements.email.value = id; }
    const first = forms[mode].querySelector('input:not([type="checkbox"])');
    if (first && !window.matchMedia('(pointer: coarse)').matches) first.focus();
  }
  function invalid(form, name, text) {
    const input = form.elements[name];
    const field = input?.closest('.field');
    field?.classList.add('is-invalid');
    say(text, 'error');
    input?.focus();
    return false;
  }
  function clearInvalid(form) { form.querySelectorAll('.field.is-invalid').forEach(field => field.classList.remove('is-invalid')); }
  function done(data, text) {
    session.set(data);
    try { sessionStorage.removeItem('iyesh:me'); } catch {}
    say(text, 'success');
    setTimeout(() => { location.href = safeReturn(); }, 400);
  }
  async function withButton(form, task) {
    const button = form.querySelector('button[type="submit"]');
    button.classList.add('is-loading'); button.disabled = true;
    try { await task(); } catch (error) { say(error.message, 'error'); } finally { button.classList.remove('is-loading'); button.disabled = false; }
  }

  forms.login.addEventListener('submit', event => {
    event.preventDefault();
    const form = forms.login; clearInvalid(form);
    const identifier = form.elements.identifier.value.trim();
    const password = form.elements.password.value;
    if (!identifier) return invalid(form, 'identifier', '请输入用户名或邮箱');
    if (!password) return invalid(form, 'password', '请输入密码');
    withButton(form, async () => {
      say('正在登录…');
      const data = await api('/api/v1/auth/login', { method: 'POST', auth: false, body: { identifier, password, remember: form.elements.remember.checked } });
      done(data, '登录成功，正在跳转…');
    });
  });
  forms.register.addEventListener('submit', event => {
    event.preventDefault();
    const form = forms.register; clearInvalid(form);
    const username = form.elements.username.value.trim();
    const email = form.elements.email.value.trim();
    const code = form.elements.code.value.trim();
    const password = form.elements.password.value;
    if (!/^[a-zA-Z0-9_\-\u4e00-\u9fa5]{3,24}$/.test(username)) return invalid(form, 'username', '用户名需要 3–24 位中文、字母、数字、下划线或短横线');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return invalid(form, 'email', '请输入正确的邮箱地址');
    if (!/^\d{6}$/.test(code)) return invalid(form, 'code', '请输入 6 位验证码');
    if (password.length < 8) return invalid(form, 'password', '密码至少 8 位');
    withButton(form, async () => {
      say('正在创建账号…');
      const data = await api('/api/v1/auth/register', { method: 'POST', auth: false, body: { username, email, code, password, referralCode: referralCode || undefined } });
      done(data, '注册成功，欢迎加入月入万刀');
    });
  });
  forms.reset.addEventListener('submit', event => {
    event.preventDefault();
    const form = forms.reset; clearInvalid(form);
    const email = form.elements.email.value.trim();
    const code = form.elements.code.value.trim();
    const password = form.elements.password.value;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return invalid(form, 'email', '请输入正确的邮箱地址');
    if (!/^\d{6}$/.test(code)) return invalid(form, 'code', '请输入 6 位验证码');
    if (password.length < 8) return invalid(form, 'password', '新密码至少 8 位');
    withButton(form, async () => {
      await api('/api/v1/auth/password-reset', { method: 'POST', auth: false, body: { email, code, password } });
      setMode('login');
      forms.login.elements.identifier.value = email;
      forms.login.elements.password.value = '';
      say('密码已重设，请用新密码登录', 'success');
      forms.login.elements.password.focus();
    });
  });

  async function sendCode(kind, button) {
    const form = kind === 'reset' ? forms.reset : forms.register;
    clearInvalid(form);
    const email = form.elements.email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { invalid(form, 'email', '先填写正确的邮箱地址'); return; }
    button.disabled = true; button.classList.add('is-loading');
    try {
      const data = await api(kind === 'reset' ? '/api/v1/auth/password-reset/request-code' : '/api/v1/auth/register/request-code', { method: 'POST', auth: false, body: { email } });
      button.classList.remove('is-loading');
      let seconds = Number(data.retryAfter || 60);
      clearInterval(timers[kind]);
      const tick = () => { seconds -= 1; button.textContent = seconds > 0 ? `${seconds} 秒后重发` : '重新获取'; if (seconds <= 0) { clearInterval(timers[kind]); button.disabled = false; } };
      tick(); timers[kind] = setInterval(tick, 1000);
      say('验证码已发送，请查看邮箱（10 分钟内有效，没收到可看看垃圾邮件）', 'success');
      form.elements.code.focus();
    } catch (error) {
      button.classList.remove('is-loading'); button.disabled = false;
      say(error.message, 'error');
    }
  }

  document.addEventListener('click', event => {
    const mode = event.target.closest('[data-mode]');
    if (mode) { setMode(mode.dataset.mode); return; }
    const send = event.target.closest('[data-send-code]');
    if (send) { sendCode(send.dataset.sendCode, send); return; }
    const toggle = event.target.closest('[data-toggle-password]');
    if (toggle) {
      const input = toggle.parentElement.querySelector('input');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      toggle.innerHTML = icon(show ? 'eyeoff' : 'eye');
      toggle.setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
    }
  });
  document.querySelectorAll('.auth-form input').forEach(input => input.addEventListener('input', () => input.closest('.field')?.classList.remove('is-invalid')));

  if (referralCode) {
    const notice = document.querySelector('#refNotice');
    notice.hidden = false;
    notice.innerHTML = `${icon('gift')}<span>你收到了好友邀请，注册后会自动绑定邀请关系。</span>`;
    setMode('register');
  } else if (params.get('mode') === 'register') setMode('register');
  else setMode('login');
  if (session.loggedIn() && !referralCode) say('你已登录，可以直接返回继续浏览。');
})();
