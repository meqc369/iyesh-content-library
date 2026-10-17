(function () {
  const sheetId = 'shareSheet';
  let lastFocus = null;
  let previousOverflow = '';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function normalizeMeta(meta = {}) {
    const title = String(meta.title || document.title || '月入万刀').trim();
    const excerpt = String(meta.excerpt || meta.description || '发现一篇值得收藏的实战内容。').trim();
    const platform = String(meta.platform || '').trim();
    const author = String(meta.author || '').trim();
    const url = new URL(meta.url || location.href, location.href).href;
    const cover = String(meta.cover || '').trim();
    const context = author;
    const suppliedText = String(meta.shareText || '').trim();
    const text = [suppliedText || [title, excerpt, context].filter(Boolean).join('\n'), url].filter(Boolean).join('\n');
    return { title, excerpt, platform, author, url, cover, context, text, shareText: suppliedText };
  }

  // Use the server-rendered preview endpoint when a post id is available. A
  // crawler such as WeChat can then read OG metadata before opening the H5
  // detail page, which produces a real title/summary/thumbnail card.
  function shareUrlForPost(postId) {
    const id = String(postId || '').trim();
    if (!id) return new URL(location.href, location.href).href;
    const apiOrigin = window.CONTENT_API_BASE || location.origin;
    return new URL(`/share/${encodeURIComponent(id)}`, apiOrigin).href;
  }

  function ensureSheet() {
    let sheet = document.getElementById(sheetId);
    if (sheet) return sheet;
    sheet = document.createElement('div');
    sheet.id = sheetId;
    sheet.className = 'share-sheet';
    sheet.hidden = true;
    sheet.innerHTML = `
      <div class="share-sheet-backdrop" data-share-close></div>
      <section class="share-dialog" role="dialog" aria-modal="true" aria-labelledby="shareSheetTitle">
        <button class="share-close" type="button" data-share-close aria-label="关闭分享面板">×</button>
        <div class="share-dialog-head">
          <span class="share-eyebrow">SHARE</span>
          <h2 id="shareSheetTitle">分享这篇内容</h2>
          <p>带上标题和摘要，转发更清楚。</p>
        </div>
        <article class="share-preview" aria-label="分享预览">
          <div class="share-preview-visual" data-share-cover aria-hidden="true"><span data-share-mark>月</span></div>
          <div class="share-preview-copy"><h3 data-share-title></h3><p data-share-excerpt></p><span class="share-preview-meta" data-share-meta></span></div>
        </article>
        <div class="share-actions" role="group" aria-label="分享方式">
          <button type="button" class="share-action share-action-primary" data-share-action="native"><span class="share-action-icon">↗</span><span><strong>转发给好友</strong><small>系统分享</small></span></button>
          <button type="button" class="share-action" data-share-action="moments"><span class="share-action-icon">◎</span><span><strong>分享到朋友圈</strong><small>复制朋友圈文案</small></span></button>
          <button type="button" class="share-action" data-share-action="text"><span class="share-action-icon">Aa</span><span><strong>复制分享文案</strong><small>标题 · 摘要 · 链接</small></span></button>
          <button type="button" class="share-action" data-share-action="link"><span class="share-action-icon">⌁</span><span><strong>复制链接</strong><small>只复制地址</small></span></button>
        </div>
        <p class="share-hint" data-share-hint>在微信中选择“分享到朋友圈”即可发布。</p>
      </section>`;
    document.body.appendChild(sheet);
    sheet.addEventListener('click', handleClick);
    return sheet;
  }

  function updateMeta(meta) {
    const sheet = ensureSheet();
    const visual = sheet.querySelector('[data-share-cover]');
    const mark = sheet.querySelector('[data-share-mark]');
    const cover = meta.cover;
    visual.style.backgroundImage = '';
    visual.classList.remove('has-cover');
    if (/^(https?:|data:image\/|\/)/i.test(cover)) {
      visual.style.backgroundImage = `linear-gradient(180deg, transparent 35%, rgba(7,17,39,.68)), url("${cover.replace(/"/g, '%22')}")`;
      visual.classList.add('has-cover');
    }
    mark.textContent = (meta.title || '月').slice(0, 1);
    sheet.querySelector('[data-share-title]').textContent = meta.title;
    sheet.querySelector('[data-share-excerpt]').textContent = meta.excerpt;
    sheet.querySelector('[data-share-meta]').textContent = meta.context || new URL(meta.url).hostname;
    sheet.dataset.sharePayload = JSON.stringify(meta);
  }

  function close() {
    const sheet = document.getElementById(sheetId);
    if (!sheet || sheet.hidden) return;
    sheet.hidden = true;
    document.body.classList.remove('share-sheet-open');
    document.body.style.overflow = previousOverflow;
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
  }

  function open(meta = {}) {
    const sheet = ensureSheet();
    updateMeta(normalizeMeta(meta));
    lastFocus = document.activeElement;
    previousOverflow = document.body.style.overflow;
    sheet.hidden = false;
    document.body.classList.add('share-sheet-open');
    document.body.style.overflow = 'hidden';
    window.requestAnimationFrame(() => sheet.querySelector('.share-close')?.focus());
  }

  async function copy(value) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
    const input = document.createElement('textarea');
    input.value = value;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed'; input.style.opacity = '0';
    document.body.appendChild(input); input.select();
    const copied = document.execCommand('copy');
    input.remove();
    if (!copied) throw new Error('copy failed');
  }

  function notify(message) {
    if (typeof window.toast === 'function') window.toast(message);
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    window.clearTimeout(toast.__shareTimer);
    toast.__shareTimer = window.setTimeout(() => toast.classList.remove('show'), 1900);
  }

  async function handleAction(action) {
    const sheet = document.getElementById(sheetId);
    let meta;
    try { meta = JSON.parse(sheet?.dataset.sharePayload || '{}'); } catch { meta = {}; }
    if (!meta.url) return;
    if (action === 'native') {
      if (navigator.share) {
        close();
        try { await navigator.share({ title: meta.title, text: [meta.excerpt, meta.context].filter(Boolean).join('\n'), url: meta.url }); } catch (error) { if (error?.name !== 'AbortError') notify('系统分享暂时不可用'); }
        return;
      }
      try { await copy(meta.text); notify('分享文案已复制，可以粘贴给好友'); } catch { notify('复制失败，请长按页面地址分享'); }
      return;
    }
    if (action === 'moments') {
      try { await copy(meta.text); notify('朋友圈文案已复制，打开微信粘贴即可'); } catch { notify('复制失败，请稍后重试'); }
      return;
    }
    if (action === 'text') {
      try { await copy(meta.text); notify('分享文案已复制'); } catch { notify('复制失败，请稍后重试'); }
      return;
    }
    if (action === 'link') {
      try { await copy(meta.url); notify('链接已复制'); } catch { notify('复制失败，请稍后重试'); }
    }
  }

  function handleClick(event) {
    const closeTarget = event.target.closest('[data-share-close]');
    if (closeTarget) { close(); return; }
    const action = event.target.closest('[data-share-action]')?.dataset.shareAction;
    if (action) { event.preventDefault(); handleAction(action); }
  }

  document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  window.openShareSheet = open;
  window.closeShareSheet = close;
  window.shareUrlForPost = shareUrlForPost;
}());
