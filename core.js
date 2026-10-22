/* 月入万刀 · shared front-end runtime.
   Loaded on every user-facing page after api-config.js. Exposes window.App:
   request helpers, session, toasts, dialogs (no window.prompt/confirm, which
   WeChat and some Android browsers suppress), icons, formatting, image
   compression and the shared header / tab bar behaviour. */
(function () {
  'use strict';

  const API = window.CONTENT_API_BASE || (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) ? 'http://127.0.0.1:8787' : location.origin);

  /* ---------------- icons ---------------- */
  const ICONS = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    discover: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
    member: '<path d="M3 8.5 7.5 12 12 5l4.5 7L21 8.5 19 18H5z"/><path d="M5 21h14"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    bell: '<path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
    heart: '<path d="M12 20s-7.5-4.4-9-9.3C2 7.4 4.2 4.5 7.4 4.5c2 0 3.6 1.1 4.6 2.7 1-1.6 2.6-2.7 4.6-2.7 3.2 0 5.4 2.9 4.4 6.2C19.5 15.6 12 20 12 20Z"/>',
    star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1.1 5.8L12 16.8l-5.3 2.8 1.1-5.8-4.3-4.1 5.9-.8z"/>',
    anchor: '<circle cx="12" cy="5" r="2"/><path d="M12 7v14M8 11h8"/><path d="M4 14a8 8 0 0 0 16 0"/>',
    comment: '<path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4A8 8 0 1 1 20 12Z"/>',
    share: '<path d="M12 15V3M8 7l4-4 4 4"/><path d="M20 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5"/>',
    back: '<path d="M15 5 8 12l7 7"/>',
    next: '<path d="m9 5 7 7-7 7"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
    rows: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    cards: '<rect x="4" y="4" width="16" height="7" rx="2"/><rect x="4" y="14" width="16" height="6" rx="2"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
    heading: '<path d="M6 4v16M18 4v16M6 12h12"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
    ordered: '<path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 5h1.5v4M4 9h3M4 14.5c.5-.8 2.8-.8 2.8.6 0 1.1-2.8 1.9-2.8 3.4h3"/>',
    quote: '<path d="M9 7H5v6h4v-6M19 7h-4v6h4v-6"/><path d="M9 13c0 3-2 4-4 4M19 13c0 3-2 4-4 4"/>',
    bold: '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>',
    text: '<path d="M5 6h14M12 6v13M9 19h6"/>',
    eye: '<path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z"/><circle cx="12" cy="12" r="3"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
    up: '<path d="m6 15 6-6 6 6"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.5"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    wallet: '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 10h18M16 15h2"/><path d="M6 6V5a2 2 0 0 1 2-2h9"/>',
    gift: '<rect x="3" y="8" width="18" height="5" rx="1"/><path d="M5 13v8h14v-8M12 8v13M12 8c-1-3-5-4-5-1.5S12 8 12 8s5-.5 5-1.5S13 5 12 8"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.8-3.5L4 9M4 4v5h5M4 13a8 8 0 0 0 14.8 3.5L20 15M20 20v-5h-5"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    coin: '<circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.8 0-3 .9-3 2s1.2 1.7 3 2 3 .9 3 2-1.2 2-3 2c-1.4 0-2.5-.5-3-1.5M12 6v2M12 16v2"/>',
    moments: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/>',
    qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 14v.01M17 21h4v-4M14 18v3"/>',
    sparkle: '<path d="M12 3c.5 4.5 2.5 6.5 7 7-4.5.5-6.5 2.5-7 7-.5-4.5-2.5-6.5-7-7 4.5-.5 6.5-2.5 7-7Z"/>',
    eyeoff: '<path d="M3 3l18 18M10.6 5.1A9.7 9.7 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-3 3.9M6.6 6.6C3.9 8.3 2.5 12 2.5 12S6 19 12 19c1.6 0 3-.4 4.2-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.5-5.5 6.5-5.5s5.5 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5c2 .6 3.3 2.5 3.8 5.5"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>'
  };
  function icon(name, cls = '') {
    return `<svg class="icon${cls ? ` ${cls}` : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;
  }

  /* ---------------- text & formatting ---------------- */
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }
  function num(value) { const number = Number(value || 0); return Number.isFinite(number) ? number.toLocaleString('zh-CN') : '0'; }
  function compact(value) {
    const number = Number(value || 0);
    if (number >= 100000000) return `${(number / 100000000).toFixed(1).replace(/\.0$/, '')}亿`;
    if (number >= 10000) return `${(number / 10000).toFixed(1).replace(/\.0$/, '')}万`;
    return String(Math.max(0, Math.round(number)));
  }
  function toDate(value) { if (!value) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; }
  function relativeTime(value) {
    const date = toDate(value);
    if (!date) return '';
    const diff = (Date.now() - date.getTime()) / 1000;
    if (diff < 60) return '刚刚';
    if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
    if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`;
    const now = new Date();
    return date.getFullYear() === now.getFullYear() ? `${date.getMonth() + 1}月${date.getDate()}日` : `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  }
  function dateText(value, withTime = false) {
    const date = toDate(value);
    if (!date) return '';
    const pad = n => String(n).padStart(2, '0');
    const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    return withTime ? `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}` : day;
  }
  function initial(name) { const text = String(name || '').trim(); return text ? Array.from(text)[0].toUpperCase() : '月'; }
  function tone(seed) { let hash = 0; for (const char of String(seed || '')) hash = (hash * 31 + char.charCodeAt(0)) >>> 0; return String((hash % 5) + 1); }
  function avatarHtml(user = {}, size) {
    const name = user.name || user.nickname || user.username || '';
    const style = size ? ` style="--size:${size}px"` : '';
    const url = user.avatarUrl ? mediaUrl(user.avatarUrl) : '';
    return `<span class="avatar" data-tone="${tone(user.id || name)}"${style} aria-hidden="true">${url ? `<img src="${escapeHtml(url)}" alt="" loading="lazy">` : escapeHtml(initial(name))}</span>`;
  }
  function mediaUrl(url) {
    const raw = String(url || '').trim();
    if (!raw) return '';
    if (/^(https?:|data:|blob:)/i.test(raw)) return raw;
    return `${API}${raw.startsWith('/') ? '' : '/'}${raw}`;
  }

  /* ---------------- session ---------------- */
  const session = {
    token() { try { return localStorage.getItem('accessToken') || ''; } catch { return ''; } },
    user() { try { return JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch { return null; } },
    set(data) {
      try {
        localStorage.setItem('accessToken', data.accessToken);
        localStorage.setItem('currentUser', JSON.stringify(data.user || {}));
        localStorage.setItem('sessionExpiresAt', String(Date.now() + Number(data.expiresInDays || 30) * 86400000));
      } catch {}
    },
    update(user) { try { localStorage.setItem('currentUser', JSON.stringify({ ...(session.user() || {}), ...user })); } catch {} },
    clear() { try { ['accessToken', 'currentUser', 'sessionExpiresAt'].forEach(key => localStorage.removeItem(key)); sessionStorage.removeItem('iyesh:me'); } catch {} },
    loggedIn() { return Boolean(session.token()); }
  };
  function loginUrl(returnTo = location.href) {
    const url = new URL('login.html', location.href);
    try { const target = new URL(returnTo, location.href); if (target.origin === location.origin) url.searchParams.set('return', `/${target.pathname.replace(/^\/+/, '')}${target.search}${target.hash}`); } catch {}
    return url.pathname + url.search;
  }
  function goLogin(returnTo) { location.href = loginUrl(returnTo); }

  /* ---------------- requests ---------------- */
  class ApiError extends Error { constructor(message, status, body) { super(message); this.status = status; this.body = body; } }
  function friendlyNetworkError(error) {
    const text = String(error?.message || '');
    if (error?.name === 'AbortError' || /timeout/i.test(text)) return '服务响应较慢，请稍后重试';
    if (/load failed|failed to fetch|networkerror|network request failed|fetch failed/i.test(text)) return '网络连接失败，请检查网络后重试';
    return text || '请求失败，请稍后重试';
  }
  async function api(path, options = {}) {
    const { method = 'GET', body, timeout = 12000, auth = true, headers = {}, raw = false } = options;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const finalHeaders = { ...headers };
    if (auth && session.token()) finalHeaders.Authorization = `Bearer ${session.token()}`;
    let payload = body;
    if (body !== undefined && !(body instanceof FormData) && typeof body !== 'string') { payload = JSON.stringify(body); finalHeaders['content-type'] = 'application/json'; }
    let response;
    try {
      response = await fetch(`${API}${path}`, { method, body: payload, headers: finalHeaders, signal: controller.signal, credentials: 'omit' });
    } catch (error) {
      throw new ApiError(friendlyNetworkError(error), 0);
    } finally { clearTimeout(timer); }
    if (raw) return response;
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && auth && session.token()) {
      // An expired or revoked token: forget it so the UI shows the signed-out state.
      session.clear();
      updateHeader(null);
    }
    if (!response.ok) throw new ApiError(data.message || `请求失败（${response.status}）`, response.status, data);
    return data;
  }

  /* ---------------- toasts ---------------- */
  let toastStack;
  function toast(message, type = 'info', duration = 2200) {
    if (!message) return;
    if (!toastStack) { toastStack = document.createElement('div'); toastStack.className = 'toast-stack'; toastStack.setAttribute('role', 'status'); toastStack.setAttribute('aria-live', 'polite'); document.body.appendChild(toastStack); }
    const node = document.createElement('div');
    node.className = `toast toast--${type}`;
    node.innerHTML = `${type === 'success' ? icon('check') : type === 'error' ? icon('alert') : ''}<span>${escapeHtml(message)}</span>`;
    // Only the latest message stays on screen: older toasts leave right away
    // so they never pile up over sheets, action bars or each other.
    toastStack.querySelectorAll('.toast:not(.is-leaving)').forEach(old => { old.classList.add('is-leaving'); setTimeout(() => old.remove(), 220); });
    toastStack.appendChild(node);
    setTimeout(() => { node.classList.add('is-leaving'); setTimeout(() => node.remove(), 220); }, duration);
  }

  /* ---------------- dialogs ---------------- */
  let openModals = 0;
  function modal({ title = '', body = '', actions = [], wide = false, onOpen, dismissible = true, className = '', drawer = false } = {}) {
    return new Promise(resolve => {
      const root = document.createElement('div');
      root.className = `modal-root${drawer ? ' modal-root--drawer' : ''}`;
      const titleId = `modal-${Math.random().toString(36).slice(2, 8)}`;
      root.innerHTML = `<div class="modal-backdrop" data-close></div><section class="modal${wide ? ' modal--wide' : ''}${className ? ` ${className}` : ''}" role="dialog" aria-modal="true" ${title ? `aria-labelledby="${titleId}"` : ''}><header class="modal-head">${title ? `<h2 id="${titleId}">${escapeHtml(title)}</h2>` : ''}${dismissible ? `<button class="icon-btn" type="button" data-close aria-label="关闭">${icon('x')}</button>` : ''}</header><div class="modal-body"></div>${actions.length ? '<footer class="modal-actions"></footer>' : ''}</section>`;
      const bodyEl = root.querySelector('.modal-body');
      if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
      const footer = root.querySelector('.modal-actions');
      const previousFocus = document.activeElement;
      let settled = false;
      const close = value => {
        if (settled) return;
        settled = true;
        const sheet = root.querySelector('.modal');
        sheet.classList.add('is-closing');
        setTimeout(() => {
          root.remove();
          openModals = Math.max(0, openModals - 1);
          if (!openModals) document.body.classList.remove('modal-open');
          if (previousFocus && typeof previousFocus.focus === 'function') { try { previousFocus.focus({ preventScroll: true }); } catch {} }
        }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180);
        document.removeEventListener('keydown', onKey);
        resolve(value);
      };
      const api = { close, root, body: bodyEl };
      actions.forEach(action => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `btn ${action.className || (action.primary ? 'btn--primary' : '')}`;
        button.textContent = action.label;
        button.addEventListener('click', async () => {
          if (!action.onClick) return close(action.value);
          button.classList.add('is-loading');
          try { const result = await action.onClick(api); if (result !== false) close(result === undefined ? action.value : result); }
          finally { button.classList.remove('is-loading'); }
        });
        footer.appendChild(button);
      });
      const onKey = event => {
        if (event.key === 'Escape' && dismissible) close(null);
        if (event.key === 'Tab') {
          const focusable = [...root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(el => !el.disabled && el.offsetParent !== null);
          if (!focusable.length) return;
          const first = focusable[0]; const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      };
      root.addEventListener('click', event => { if (dismissible && event.target.closest('[data-close]')) close(null); });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(root);
      openModals += 1;
      document.body.classList.add('modal-open');
      if (onOpen) onOpen(api);
      requestAnimationFrame(() => {
        const target = root.querySelector('[autofocus]') || root.querySelector('.modal-body input, .modal-body textarea') || root.querySelector('.modal-actions .btn--primary, .modal-actions .btn');
        if (target && !(target.matches('input, textarea') && window.matchMedia('(pointer: coarse)').matches)) { try { target.focus({ preventScroll: true }); } catch {} }
      });
    });
  }
  function confirmDialog({ title = '确认操作', message = '', confirmText = '确定', cancelText = '取消', danger = false } = {}) {
    return modal({ title, body: message ? `<p>${escapeHtml(message)}</p>` : '', actions: [{ label: cancelText, value: false }, { label: confirmText, value: true, className: danger ? 'btn--danger' : 'btn--primary' }] }).then(Boolean);
  }
  function promptDialog({ title = '', label = '', placeholder = '', value = '', multiline = false, required = true, maxLength = 500, confirmText = '确定', presets = [], inputType = 'text', hint = '' } = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    wrap.innerHTML = `${label ? `<label class="label" for="promptInput">${escapeHtml(label)}</label>` : ''}${presets.length ? `<div class="chip-row">${presets.map(item => `<button type="button" class="chip" data-preset="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join('')}</div>` : ''}${multiline ? `<textarea id="promptInput" class="textarea" rows="4" maxlength="${maxLength}" placeholder="${escapeHtml(placeholder)}"></textarea>` : `<input id="promptInput" class="input" type="${inputType}" maxlength="${maxLength}" placeholder="${escapeHtml(placeholder)}">`}${hint ? `<p class="hint">${escapeHtml(hint)}</p>` : ''}<p class="field-error" hidden></p>`;
    const input = wrap.querySelector('#promptInput');
    input.value = value;
    wrap.addEventListener('click', event => {
      const chip = event.target.closest('[data-preset]');
      if (!chip) return;
      wrap.querySelectorAll('[data-preset]').forEach(item => item.setAttribute('aria-pressed', String(item === chip)));
      input.value = chip.dataset.preset;
      input.focus();
    });
    return modal({
      title,
      body: wrap,
      actions: [{ label: '取消', value: null }, { label: confirmText, primary: true, onClick: () => {
        const text = input.value.trim();
        const error = wrap.querySelector('.field-error');
        if (required && !text) { error.textContent = '请填写内容'; error.hidden = false; wrap.classList.add('is-invalid'); input.focus(); return false; }
        return text;
      } }]
    });
  }

  /* ---------------- clipboard ---------------- */
  async function copyText(text) {
    if (!text) return false;
    try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch {}
    const input = document.createElement('textarea');
    input.value = text; input.setAttribute('readonly', ''); input.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
    document.body.appendChild(input); input.select(); input.setSelectionRange(0, text.length);
    let ok = false; try { ok = document.execCommand('copy'); } catch {}
    input.remove();
    return ok;
  }

  /* ---------------- images ---------------- */
  const ACCEPTED_IMAGE = /^image\/(jpeg|png|webp|gif|heic|heif)$/i;
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => resolve({ image, url });
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('无法读取这张图片，请换一张试试')); };
      image.src = url;
    });
  }
  /* Phone photos are often 5–20 MB. Downscale to ≤2400px JPEG/WebP in the
     browser so uploads stay fast on mobile data and pass the 5 MB limit. GIFs
     are sent untouched to keep their animation. */
  async function compressImage(file, { maxDimension = 2400, maxBytes = 4.5 * 1024 * 1024, quality = 0.86 } = {}) {
    if (!file) throw new Error('请选择图片');
    const type = String(file.type || '').toLowerCase();
    if (type && !ACCEPTED_IMAGE.test(type) && !type.startsWith('image/')) throw new Error('仅支持 JPG、PNG、WEBP 或 GIF 图片');
    if (type === 'image/gif') { if (file.size > 5 * 1024 * 1024) throw new Error('GIF 动图不能超过 5MB'); return file; }
    if ((type === 'image/jpeg' || type === 'image/png' || type === 'image/webp') && file.size <= 1.5 * 1024 * 1024) {
      // Small images are already fine; still check dimensions cheaply.
      try { const { image, url } = await loadImage(file); URL.revokeObjectURL(url); if (Math.max(image.naturalWidth, image.naturalHeight) <= maxDimension) return file; } catch { return file; }
    }
    const { image, url } = await loadImage(file);
    try {
      const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d');
      const keepAlpha = type === 'image/png' || type === 'image/webp';
      if (!keepAlpha) { context.fillStyle = '#fff'; context.fillRect(0, 0, width, height); }
      context.drawImage(image, 0, 0, width, height);
      const toBlob = (mime, q) => new Promise(done => canvas.toBlob(done, mime, q));
      let mime = keepAlpha ? 'image/webp' : 'image/jpeg';
      let blob = await toBlob(mime, quality);
      if (!blob || (keepAlpha && blob.type !== 'image/webp')) { mime = keepAlpha ? 'image/png' : 'image/jpeg'; blob = await toBlob(mime, quality); }
      let q = quality;
      while (blob && blob.size > maxBytes && q > 0.5 && mime !== 'image/png') { q -= 0.12; blob = await toBlob(mime, q); }
      if (!blob) throw new Error('图片处理失败，请换一张试试');
      if (blob.size > 5 * 1024 * 1024) throw new Error('图片过大，请裁剪后再上传');
      const extension = mime === 'image/webp' ? 'webp' : mime === 'image/png' ? 'png' : 'jpg';
      const name = String(file.name || 'image').replace(/\.[^.]+$/, '') + `.${extension}`;
      try { return new File([blob], name, { type: mime }); } catch { blob.name = name; return blob; }
    } finally { URL.revokeObjectURL(url); }
  }
  /* Upload one file with progress (XHR gives upload progress; fetch does not). */
  function uploadImage(file, onProgress) {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append('files', file, file.name || 'image.jpg');
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API}/api/v1/uploads`);
      if (session.token()) xhr.setRequestHeader('Authorization', `Bearer ${session.token()}`);
      xhr.timeout = 60000;
      xhr.upload.onprogress = event => { if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total); };
      xhr.onload = () => {
        let body = {};
        try { body = JSON.parse(xhr.responseText || '{}'); } catch {}
        if (xhr.status === 401) { reject(new ApiError('登录已过期，请重新登录', 401, body)); return; }
        if (xhr.status < 200 || xhr.status >= 300) { reject(new ApiError(body.message || '图片上传失败', xhr.status, body)); return; }
        const item = body.items?.[0];
        if (!item?.url) { reject(new ApiError('上传服务未返回图片地址', xhr.status, body)); return; }
        resolve(item);
      };
      xhr.onerror = () => reject(new ApiError('网络连接失败，图片未上传', 0));
      xhr.ontimeout = () => reject(new ApiError('上传超时，请检查网络后重试', 0));
      xhr.send(form);
    });
  }
  function viewImage(src) {
    const viewer = document.createElement('div');
    viewer.className = 'viewer';
    viewer.innerHTML = `<img src="${escapeHtml(src)}" alt="查看大图"><button type="button" aria-label="关闭">${icon('x')}</button>`;
    const close = () => { viewer.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = event => { if (event.key === 'Escape') close(); };
    viewer.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(viewer);
  }

  /* ---------------- header & tab bar ---------------- */
  function updateHeader(user, unread = 0) {
    document.querySelectorAll('[data-account]').forEach(link => {
      if (user) {
        link.innerHTML = avatarHtml(user);
        link.href = 'profile.html';
        link.setAttribute('aria-label', `${user.name || '我的'} 的个人中心`);
        link.classList.remove('btn', 'btn--sm', 'btn--ink');
      } else {
        link.textContent = '登录';
        link.href = loginUrl();
        link.setAttribute('aria-label', '登录或注册');
        link.classList.add('btn', 'btn--sm', 'btn--ink');
      }
    });
    document.querySelectorAll('[data-unread]').forEach(badge => {
      badge.textContent = unread > 99 ? '99+' : String(unread);
      badge.hidden = !user || !unread;
    });
  }
  async function refreshMe(force = false) {
    if (!session.loggedIn()) { updateHeader(null); return null; }
    const cached = (() => { try { return JSON.parse(sessionStorage.getItem('iyesh:me') || 'null'); } catch { return null; } })();
    if (!force && cached && Date.now() - cached.at < 60000) { updateHeader(cached.user, cached.unread); return cached; }
    updateHeader(session.user(), cached?.unread || 0);
    try {
      const me = await api('/api/v1/me');
      const entry = { at: Date.now(), user: me.user, unread: Number(me.unreadNotifications || 0), membership: me.membership, points: me.points };
      try { sessionStorage.setItem('iyesh:me', JSON.stringify(entry)); } catch {}
      session.update(me.user || {});
      updateHeader(me.user, entry.unread);
      return entry;
    } catch (error) {
      if (error.status === 401) { updateHeader(null); return null; }
      return cached;
    }
  }
  function markNav() {
    const page = document.body.dataset.page;
    document.querySelectorAll('[data-nav]').forEach(link => { if (link.dataset.nav === page) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
  }
  /* Hide fixed bottom bars while the on-screen keyboard is up so they never
     cover the field being edited (iOS keeps fixed elements above the keyboard). */
  function watchKeyboard() {
    const isText = el => el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'file', 'button', 'submit', 'range', 'color'].includes(el.type)) || el.isContentEditable);
    if (!window.matchMedia('(pointer: coarse)').matches) return;
    document.addEventListener('focusin', event => { if (isText(event.target)) document.body.classList.add('keyboard-open'); });
    document.addEventListener('focusout', () => { setTimeout(() => { if (!isText(document.activeElement)) document.body.classList.remove('keyboard-open'); }, 80); });
  }
  function track(name, data = {}) { try { if (window.__iyeshTrack) window.__iyeshTrack(name, data); } catch {} }
  function trackPageView() {
    if (document.body.hasAttribute('data-skip-me')) return;
    let visitorId = '';
    try {
      visitorId = localStorage.getItem('iyesh:analyticsVisitor') || (crypto.randomUUID ? crypto.randomUUID() : `v_${Date.now()}_${Math.random().toString(36).slice(2)}`);
      localStorage.setItem('iyesh:analyticsVisitor', visitorId);
    } catch { visitorId = `v_${Date.now()}_${Math.random().toString(36).slice(2)}`; }
    const payload = JSON.stringify({ path: `${location.pathname}${location.search ? location.search.slice(0, 120) : ''}`, referrer: document.referrer || '', visitorId, device: window.matchMedia?.('(pointer: coarse)').matches ? 'mobile' : 'desktop' });
    try {
      const beacon = new Blob([payload], { type: 'text/plain;charset=UTF-8' });
      if (navigator.sendBeacon?.(`${API}/api/v1/analytics/visit`, beacon)) return;
    } catch {}
    fetch(`${API}/api/v1/analytics/visit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload, keepalive: true }).catch(() => {});
  }

  /* ---------------- misc ---------------- */
  function debounce(fn, wait = 250) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); }; }
  /* Auto-growing textareas: the page stays the only scroll surface. A shared
     ResizeObserver re-measures a field when it becomes visible or its width
     changes (rotation, sidebar breakpoints). */
  const growers = new WeakMap();
  const growWidths = new WeakMap();
  const growObserver = 'ResizeObserver' in window ? new ResizeObserver(entries => {
    entries.forEach(entry => {
      const width = Math.round(entry.contentRect.width);
      if (!width || growWidths.get(entry.target) === width) return;
      growWidths.set(entry.target, width);
      growers.get(entry.target)?.();
    });
  }) : null;
  function autoGrow(textarea) {
    if (!textarea) return () => {};
    if (growers.has(textarea)) { growers.get(textarea)(); return growers.get(textarea); }
    const resize = () => {
      if (!textarea.isConnected || textarea.offsetWidth === 0) return;
      const borders = textarea.offsetHeight - textarea.clientHeight;
      const scrollY = window.scrollY;
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight + Math.max(0, borders)}px`;
      // Collapsing to "auto" can shorten the document for a frame; keep the
      // reader where they were instead of jumping.
      if (window.scrollY !== scrollY) window.scrollTo(0, scrollY);
    };
    growers.set(textarea, resize);
    textarea.addEventListener('input', resize);
    if (growObserver) growObserver.observe(textarea); else window.addEventListener('resize', resize);
    resize();
    return resize;
  }
  function accessInfo(post = {}, unitName = '积分') {
    const type = post.accessType || (post.memberOnly ? 'member' : Number(post.pricePoints || 0) > 0 ? 'paid' : 'free');
    const unit = post.priceUnitName || unitName;
    if (type === 'member') return { type, label: post.requiredPlanName && post.requiredPlanName !== '会员' ? `会员 · ${post.requiredPlanName}` : '会员专享', html: `<span class="tag tag--member">${icon('member')}${escapeHtml(post.requiredPlanName && post.requiredPlanName !== '会员' ? post.requiredPlanName : '会员')}</span>` };
    if (type === 'paid') { const price = Number(post.pricePoints ?? post.priceCents ?? 0); return { type, price, unit, label: `${num(price)} ${unit}`, html: `<span class="tag tag--paid"><span class="num">${num(price)}</span>${escapeHtml(unit)}</span>` }; }
    return { type: 'free', label: '免费', html: '<span class="tag tag--free">免费</span>' };
  }
  function topicsOf(post = {}) { return [post.project, post.skill].map(value => String(value || '').trim()).filter(value => value && value !== '未分类'); }

  /* Mirror of the server renderer (server/index.mjs › contentHtml) so the
     editor preview matches what readers will see. */
  const INLINE_IMAGE = /^!\[([^\]\n]{0,120})\]\(([^)\s]+)\)$/;
  function inlineText(value) {
    const text = String(value ?? '');
    let html = ''; let last = 0;
    const fmt = part => escapeHtml(part).replace(/\*\*([^*\n]{1,200})\*\*/g, '<strong>$1</strong>');
    for (const match of text.matchAll(/https?:\/\/[^\s<>"'，。！？、；：）)\]】]+/g)) {
      const url = match[0].replace(/[.,;:!?]+$/, '');
      html += fmt(text.slice(last, match.index)) + `<a href="${escapeHtml(url)}" target="_blank" rel="nofollow noopener noreferrer">${escapeHtml(url)}</a>${escapeHtml(match[0].slice(url.length))}`;
      last = match.index + match[0].length;
    }
    return html + fmt(text.slice(last));
  }
  function renderContent(content, { resolve = url => mediaUrl(url) } = {}) {
    const html = [];
    const groups = [
      [/^\s*[-•*]\s+/, items => `<ul>${items.map(item => `<li>${inlineText(item)}</li>`).join('')}</ul>`],
      [/^\s*\d{1,3}[.、)]\s*/, items => `<ol>${items.map(item => `<li>${inlineText(item)}</li>`).join('')}</ol>`],
      [/^\s*>\s?/, items => `<blockquote>${items.map(inlineText).join('<br>')}</blockquote>`]
    ];
    const HEADING = /^\s*(#{2,3})\s+([\s\S]+)$/;
    for (const block of String(content || '').replace(/\r\n?|[\u2028\u2029\u0085]/g, '\n').split(/\n{2,}/)) {
      const lines = block.split('\n').map(line => line.trimEnd()).filter(line => line.trim());
      let index = 0;
      while (index < lines.length) {
        const line = lines[index];
        const image = line.trim().match(INLINE_IMAGE);
        if (image) { html.push(`<figure><img src="${escapeHtml(resolve(image[2]))}" alt="${escapeHtml(image[1] || '正文配图')}" loading="lazy" decoding="async">${image[1] ? `<figcaption>${escapeHtml(image[1])}</figcaption>` : ''}</figure>`); index += 1; continue; }
        const heading = line.match(HEADING);
        if (heading) { html.push(`<h${heading[1].length}>${inlineText(heading[2])}</h${heading[1].length}>`); index += 1; continue; }
        const group = groups.find(([pattern]) => pattern.test(line));
        if (group) { const items = []; while (index < lines.length && group[0].test(lines[index]) && !INLINE_IMAGE.test(lines[index].trim())) { items.push(lines[index].replace(group[0], '')); index += 1; } html.push(group[1](items)); continue; }
        const paragraph = [];
        while (index < lines.length && !INLINE_IMAGE.test(lines[index].trim()) && !HEADING.test(lines[index]) && !groups.some(([pattern]) => pattern.test(lines[index]))) { paragraph.push(lines[index]); index += 1; }
        if (!paragraph.length) { paragraph.push(lines[index]); index += 1; }
        html.push(`<p>${paragraph.map(inlineText).join('<br>')}</p>`);
      }
    }
    return html.join('');
  }

  window.App = { renderContent, API, icon, escapeHtml, num, compact, relativeTime, dateText, initial, avatarHtml, mediaUrl, session, loginUrl, goLogin, api, ApiError, toast, modal, confirm: confirmDialog, prompt: promptDialog, copyText, compressImage, uploadImage, viewImage, refreshMe, updateHeader, debounce, autoGrow, accessInfo, topicsOf, track, friendlyNetworkError };

  document.querySelectorAll('[data-icon]').forEach(node => { node.insertAdjacentHTML('afterbegin', icon(node.dataset.icon)); });
  markNav();
  watchKeyboard();
  trackPageView();
  if (!document.body.hasAttribute('data-skip-me')) refreshMe();
})();
