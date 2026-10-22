/* 月入万刀 · 分享与海报
   Opens a share sheet with a poster drawn on <canvas> and exported as an
   <img>, so people can long-press to save it or let WeChat recognise the QR
   code. QR codes are generated locally (assets/vendor/qrcode.js). */
(function () {
  'use strict';
  const App = window.App;
  const FONT = '-apple-system, BlinkMacSystemFont, "PingFang SC", "HarmonyOS Sans SC", "MiSans", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
  const NUM_FONT = '"Bricolage", "DIN Alternate", "Helvetica Neue", Arial, sans-serif';
  const isWeChat = /MicroMessenger/i.test(navigator.userAgent);
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function webBase() { return new URL('.', location.href).href; }
  function postUrl(id) { return new URL(`detail.html?id=${encodeURIComponent(String(id || ''))}`, webBase()).href; }
  // Social crawlers read Open Graph tags from the server-rendered /share/ page.
  function shareLinkFor(id) {
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    // The public share page must stay on the page's own origin. Using the API
    // origin here can turn a rich preview into a plain cross-domain URL when
    // the API is hosted separately.
    return local ? postUrl(id) : `${location.origin}/share/${encodeURIComponent(String(id || ''))}`;
  }

  /* ---------------- QR ---------------- */
  function qrMatrix(text) {
    if (typeof window.qrcode !== 'function') return null;
    const qr = window.qrcode(0, 'M');
    qr.addData(String(text));
    qr.make();
    return qr;
  }
  function drawQr(ctx, text, x, y, size, color = '#142033') {
    const qr = qrMatrix(text);
    if (!qr) return false;
    const count = qr.getModuleCount();
    const cell = size / count;
    ctx.fillStyle = color;
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        if (qr.isDark(row, col)) ctx.fillRect(x + col * cell, y + row * cell, Math.ceil(cell * 100) / 100 + 0.35, Math.ceil(cell * 100) / 100 + 0.35);
      }
    }
    return true;
  }
  /* A crisp QR <canvas> for pages (invite card, customer-service contact). */
  function qrCanvas(text, size = 160, { margin = 10, dark = '#142033', light = '#ffffff' } = {}) {
    const ratio = Math.min(3, window.devicePixelRatio || 1);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = Math.round(size * ratio);
    canvas.style.width = canvas.style.height = `${size}px`;
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    ctx.fillStyle = light; ctx.fillRect(0, 0, size, size);
    if (!drawQr(ctx, text, margin, margin, size - margin * 2, dark)) return null;
    return canvas;
  }
  function qrDataUrl(text, size = 240, options) { const canvas = qrCanvas(text, size, options); return canvas ? canvas.toDataURL('image/png') : ''; }

  /* ---------------- canvas helpers ---------------- */
  function loadImg(src, timeout = 5000) {
    return new Promise(resolve => {
      if (!src) return resolve(null);
      const image = new Image();
      let done = false;
      const finish = value => { if (!done) { done = true; resolve(value); } };
      try { if (new URL(src, location.href).origin !== location.origin) image.crossOrigin = 'anonymous'; } catch {}
      image.onload = () => finish(image);
      image.onerror = () => finish(null);
      setTimeout(() => finish(null), timeout);
      image.src = src;
    });
  }
  function roundRect(ctx, x, y, w, h, r) {
    const radius = typeof r === 'number' ? { tl: r, tr: r, br: r, bl: r } : r;
    ctx.beginPath();
    ctx.moveTo(x + radius.tl, y);
    ctx.lineTo(x + w - radius.tr, y); ctx.quadraticCurveTo(x + w, y, x + w, y + radius.tr);
    ctx.lineTo(x + w, y + h - radius.br); ctx.quadraticCurveTo(x + w, y + h, x + w - radius.br, y + h);
    ctx.lineTo(x + radius.bl, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - radius.bl);
    ctx.lineTo(x, y + radius.tl); ctx.quadraticCurveTo(x, y, x + radius.tl, y);
    ctx.closePath();
  }
  /* Line-wrap for canvas. Latin words and numbers ("10 万", "YouTube") stay
     whole; CJK text breaks between characters. */
  function wrap(ctx, text, maxWidth, maxLines) {
    const tokens = String(text || '').replace(/\s+/g, ' ').trim().match(/[A-Za-z0-9][A-Za-z0-9.,:%+#@&'_/-]*|\s|./gu) || [];
    const lines = [];
    let line = '';
    let truncated = false;
    const pushChars = token => {
      for (const char of Array.from(token)) {
        if (ctx.measureText(line + char).width > maxWidth && line) { lines.push(line); line = char; if (lines.length === maxLines) { truncated = true; return; } }
        else line += char;
      }
    };
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (!line && token === ' ') continue;
      if (ctx.measureText(line + token).width <= maxWidth) { line += token; continue; }
      if (ctx.measureText(token).width > maxWidth) { pushChars(token); if (truncated) break; continue; }
      lines.push(line.replace(/\s+$/, ''));
      line = token === ' ' ? '' : token;
      if (lines.length === maxLines) { truncated = true; break; }
    }
    if (!truncated) { if (line) lines.push(line); if (lines.length <= maxLines) return lines; }
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1] || '';
    while (last && ctx.measureText(`${last}…`).width > maxWidth) last = Array.from(last).slice(0, -1).join('');
    kept[maxLines - 1] = `${last.replace(/\s+$/, '')}…`;
    return kept;
  }
  function coverFit(ctx, image, x, y, w, h) {
    const ratio = Math.max(w / image.naturalWidth, h / image.naturalHeight);
    const sw = w / ratio; const sh = h / ratio;
    ctx.drawImage(image, (image.naturalWidth - sw) / 2, (image.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
  }
  const TONES = ['#2c62db', '#1b7550', '#9a6511', '#6b4fbf', '#b34a5c'];
  function toneFor(seed) { let hash = 0; for (const char of String(seed || '')) hash = (hash * 31 + char.charCodeAt(0)) >>> 0; return TONES[hash % TONES.length]; }

  async function drawBand(ctx, W, bandH, assets) {
    ctx.fillStyle = '#13213b';
    ctx.fillRect(0, 0, W, bandH);
    ctx.save();
    if (assets.waves) { ctx.globalAlpha = 0.45; ctx.drawImage(assets.waves, -20, bandH * 0.35, W + 40, bandH * 0.75); }
    if (assets.rosette) { ctx.globalAlpha = 0.55; ctx.drawImage(assets.rosette, W - 190, -110, 330, 330); }
    ctx.restore();
    const fade = ctx.createLinearGradient(0, 0, W, 0);
    fade.addColorStop(0, 'rgba(19,33,59,1)'); fade.addColorStop(.55, 'rgba(19,33,59,.6)'); fade.addColorStop(1, 'rgba(19,33,59,.05)');
    ctx.fillStyle = fade; ctx.fillRect(0, 0, W, bandH);
    // Brand mark
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, 22, 24, 34, 34, 9); ctx.fill();
    if (assets.logo) ctx.drawImage(assets.logo, 25, 27, 28, 28);
    else { ctx.fillStyle = '#13213b'; ctx.font = `700 18px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText('月', 39, 47); ctx.textAlign = 'left'; }
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 17px ${FONT}`;
    ctx.fillText('月入万刀', 66, 47);
  }

  function accessBadge(meta) {
    const access = meta.access || {};
    if (access.type === 'paid') return { text: `${App.num(access.price)} ${access.unit || '积分'}`, bg: '#e6f2ea', fg: '#145c3e', foot: `${App.num(access.price)} ${access.unit || '积分'}解锁全文` };
    if (access.type === 'member') return { text: '会员专享', bg: '#faf0dc', fg: '#9a6511', foot: '会员专享，开通后阅读全文' };
    return { text: '免费阅读', bg: '#eef0eb', fg: '#364256', foot: '免费阅读全文' };
  }

  async function sharedAssets() {
    const [logo, rosette, waves, corner] = await Promise.all([
      loadImg(new URL('assets/iyesh-logo.webp', webBase()).href),
      loadImg(new URL('assets/guilloche-rosette.svg', webBase()).href),
      loadImg(new URL('assets/guilloche-waves.svg', webBase()).href),
      loadImg(new URL('assets/guilloche-corner.svg', webBase()).href)
    ]);
    try { await document.fonts?.load(`700 30px ${NUM_FONT}`); } catch {}
    return { logo, rosette, waves, corner };
  }

  async function drawPostPoster(meta) {
    const W = 375; const S = 3;
    const assets = await sharedAssets();
    const cover = meta.cover ? await loadImg(App.mediaUrl(meta.cover)) : null;
    const measure = document.createElement('canvas').getContext('2d');
    const innerW = 339 - 44;
    measure.font = `700 21px ${FONT}`;
    const titleLines = wrap(measure, meta.title || '月入万刀内容', innerW, 3);
    measure.font = `400 14px ${FONT}`;
    const excerptLines = meta.excerpt ? wrap(measure, meta.excerpt, innerW, cover ? 3 : 4) : [];
    const topics = (meta.topics || []).slice(0, 3);
    const coverH = cover ? 186 : 0;
    const cardH = coverH + 22 + (topics.length ? 24 : 0) + titleLines.length * 31 + (excerptLines.length ? 10 + excerptLines.length * 24 : 0) + 22 + 34 + 22;
    const bandH = 170; const cardY = 96;
    const noteY = cardY + cardH + 16; const noteH = 128;
    const H = noteY + noteH + 40;

    const canvas = document.createElement('canvas');
    canvas.width = W * S; canvas.height = H * S;
    const ctx = canvas.getContext('2d');
    ctx.scale(S, S);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#f4f5f1'; ctx.fillRect(0, 0, W, H);
    await drawBand(ctx, W, bandH, assets);

    const badge = accessBadge(meta);
    ctx.font = `700 12px ${FONT}`;
    const badgeW = ctx.measureText(badge.text).width + 20;
    ctx.fillStyle = badge.bg; roundRect(ctx, W - 22 - badgeW, 29, badgeW, 24, 7); ctx.fill();
    ctx.fillStyle = badge.fg; ctx.fillText(badge.text, W - 12 - badgeW, 45.5);

    // Card
    const x = 18; const w = 339;
    ctx.save();
    ctx.shadowColor = 'rgba(20, 32, 51, .16)'; ctx.shadowBlur = 26; ctx.shadowOffsetY = 10;
    ctx.fillStyle = '#ffffff'; roundRect(ctx, x, cardY, w, cardH, 18); ctx.fill();
    ctx.restore();
    let cursor = cardY;
    if (cover) {
      ctx.save(); roundRect(ctx, x, cardY, w, coverH, { tl: 18, tr: 18, br: 0, bl: 0 }); ctx.clip();
      coverFit(ctx, cover, x, cardY, w, coverH); ctx.restore();
      cursor += coverH;
    }
    cursor += 22;
    const left = x + 22;
    if (topics.length) {
      ctx.font = `600 13px ${FONT}`; ctx.fillStyle = '#2c62db';
      ctx.fillText(topics.map(topic => `#${topic}`).join('   '), left, cursor + 12);
      cursor += 24;
    }
    ctx.font = `700 21px ${FONT}`; ctx.fillStyle = '#142033';
    titleLines.forEach((line, index) => ctx.fillText(line, left, cursor + 22 + index * 31));
    cursor += titleLines.length * 31;
    if (excerptLines.length) {
      cursor += 10;
      ctx.font = `400 14px ${FONT}`; ctx.fillStyle = '#667085';
      excerptLines.forEach((line, index) => ctx.fillText(line, left, cursor + 17 + index * 24));
      cursor += excerptLines.length * 24;
    }
    cursor += 22;
    ctx.strokeStyle = '#e3e6df'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(left, cursor - 8); ctx.lineTo(x + w - 22, cursor - 8); ctx.stroke();
    // Author
    const authorName = meta.author?.name || '月入万刀作者';
    ctx.fillStyle = toneFor(meta.author?.id || authorName);
    ctx.beginPath(); ctx.arc(left + 15, cursor + 17, 15, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.font = `700 14px ${FONT}`; ctx.textAlign = 'center';
    ctx.fillText(App.initial(authorName), left + 15, cursor + 22);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#142033'; ctx.font = `600 14px ${FONT}`;
    ctx.fillText(wrap(ctx, authorName, 150, 1)[0], left + 40, cursor + 14);
    ctx.fillStyle = '#959dab'; ctx.font = `400 12px ${FONT}`;
    ctx.fillText(meta.dateText || '月入万刀', left + 40, cursor + 31);

    drawNote(ctx, assets, { x, y: noteY, w, h: noteH, url: meta.url, title: '长按识别二维码', line2: badge.foot, line3: hostLabel(meta.url) });
    ctx.fillStyle = '#959dab'; ctx.font = `400 11px ${FONT}`; ctx.textAlign = 'center';
    ctx.fillText('月入万刀  把经验变成可复用的增长', W / 2, H - 16);
    ctx.textAlign = 'left';
    return canvas;
  }

  function hostLabel(url) { try { return new URL(url).host; } catch { return 'iyesh.com'; } }

  function drawNote(ctx, assets, { x, y, w, h, url, title, line2, line3 }) {
    const fill = ctx.createLinearGradient(x, y, x + w, y + h);
    fill.addColorStop(0, '#f1f8f3'); fill.addColorStop(1, '#e6f2ea');
    ctx.fillStyle = fill; roundRect(ctx, x, y, w, h, 18); ctx.fill();
    ctx.save(); roundRect(ctx, x, y, w, h, 18); ctx.clip();
    if (assets.corner) { ctx.globalAlpha = .5; ctx.drawImage(assets.corner, x + w - 110, y - 100, 230, 230); }
    ctx.restore();
    ctx.strokeStyle = '#cfe3d6'; ctx.lineWidth = 1; roundRect(ctx, x + .5, y + .5, w - 1, h - 1, 18); ctx.stroke();
    ctx.save(); ctx.setLineDash([4, 3]); ctx.strokeStyle = 'rgba(27,117,80,.32)'; roundRect(ctx, x + 6, y + 6, w - 12, h - 12, 13); ctx.stroke(); ctx.restore();
    const qrSize = 96;
    ctx.fillStyle = '#ffffff'; roundRect(ctx, x + 16, y + (h - qrSize - 8) / 2, qrSize + 8, qrSize + 8, 10); ctx.fill();
    drawQr(ctx, url, x + 20, y + (h - qrSize) / 2, qrSize);
    const tx = x + 16 + qrSize + 8 + 18;
    ctx.fillStyle = '#142033'; ctx.font = `700 17px ${FONT}`;
    ctx.fillText(title, tx, y + 50);
    ctx.fillStyle = '#145c3e'; ctx.font = `600 13px ${FONT}`;
    ctx.fillText(wrap(ctx, line2, w - (tx - x) - 16, 1)[0], tx, y + 74);
    ctx.fillStyle = '#5f7f70'; ctx.font = `400 12px ${NUM_FONT}`;
    ctx.fillText(line3, tx, y + 96);
  }

  async function drawInvitePoster(meta) {
    const W = 375; const S = 3;
    const assets = await sharedAssets();
    const H = 600;
    const canvas = document.createElement('canvas');
    canvas.width = W * S; canvas.height = H * S;
    const ctx = canvas.getContext('2d');
    ctx.scale(S, S);
    ctx.fillStyle = '#f4f5f1'; ctx.fillRect(0, 0, W, H);
    await drawBand(ctx, W, 300, assets);
    ctx.fillStyle = '#b9c8e6'; ctx.font = `400 14px ${FONT}`;
    ctx.fillText(`${meta.name || '你的朋友'} 邀请你加入`, 22, 118);
    ctx.fillStyle = '#ffffff'; ctx.font = `750 30px ${FONT}`;
    ['把经验，变成', '可复用的增长'].forEach((line, index) => ctx.fillText(line, 22, 162 + index * 42));
    const x = 18; const w = 339; const y = 266; const h = 160;
    ctx.save(); ctx.shadowColor = 'rgba(20,32,51,.16)'; ctx.shadowBlur = 26; ctx.shadowOffsetY = 10;
    ctx.fillStyle = '#ffffff'; roundRect(ctx, x, y, w, h, 18); ctx.fill(); ctx.restore();
    const items = ['YouTube 出海实战打法，持续更新', '会员内容、积分打赏与签到奖励', '发布你的方法与案例，获得收益'];
    items.forEach((item, index) => {
      const cy = y + 40 + index * 42;
      ctx.fillStyle = '#1b7550'; ctx.beginPath(); ctx.arc(x + 30, cy - 5, 9, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x + 25.5, cy - 5); ctx.lineTo(x + 28.5, cy - 2); ctx.lineTo(x + 34.5, cy - 8.5); ctx.stroke();
      ctx.fillStyle = '#142033'; ctx.font = `500 15px ${FONT}`; ctx.fillText(item, x + 50, cy);
    });
    drawNote(ctx, assets, { x, y: y + h + 16, w, h: 128, url: meta.url, title: '长按识别二维码', line2: meta.code ? `邀请码 ${meta.code}` : '注册即可加入', line3: hostLabel(meta.url) });
    ctx.fillStyle = '#959dab'; ctx.font = `400 11px ${FONT}`; ctx.textAlign = 'center';
    ctx.fillText('月入万刀  iyesh.com', W / 2, H - 16);
    return canvas;
  }

  function canvasToUrl(canvas) {
    try { return canvas.toDataURL('image/jpeg', 0.92); } catch { return ''; }
  }

  /* ---------------- sheet ---------------- */
  function normalize(meta = {}) {
    const id = meta.id || meta.postId || '';
    const url = meta.url || (id ? postUrl(id) : location.href);
    return {
      kind: meta.kind || 'post',
      id,
      title: String(meta.title || document.title || '月入万刀').trim(),
      excerpt: String(meta.excerpt || '').trim(),
      author: typeof meta.author === 'string' ? { name: meta.author } : (meta.author || {}),
      cover: meta.cover || '',
      topics: meta.topics || [],
      access: meta.access || { type: 'free' },
      dateText: meta.dateText || '',
      url,
      shareLink: meta.shareLink || (id ? shareLinkFor(id) : url),
      name: meta.name, code: meta.code
    };
  }
  function shareText(meta) {
    if (meta.kind === 'invite') return `${meta.name || '我'}邀请你加入月入万刀，一起把经验变成可复用的增长。\n${meta.url}`;
    return [`《${meta.title}》`, meta.excerpt, meta.shareLink].filter(Boolean).join('\n');
  }

  async function open(input = {}) {
    const meta = normalize(input);
    const touch = window.matchMedia('(pointer: coarse)').matches;
    const body = document.createElement('div');
    body.className = 'share-body';
    body.innerHTML = `
      <div class="poster-frame" aria-live="polite"><div class="poster-loading"><span class="spinner"></span><span>正在生成海报</span></div></div>
      <p class="share-hint">${touch ? (isWeChat ? '长按海报可发送给朋友、保存或识别二维码' : '长按海报保存到相册') : '可下载海报，或复制链接发送给朋友'}</p>
      <div class="share-actions" role="group" aria-label="分享方式">
        <button type="button" data-share="save"><span class="ico">${App.icon('download')}</span>保存海报</button>
        <button type="button" data-share="link"><span class="ico">${App.icon('link')}</span>复制链接</button>
        <button type="button" data-share="text"><span class="ico">${App.icon('copy')}</span>复制文案</button>
        <button type="button" data-share="native"${navigator.share ? '' : ' hidden'}><span class="ico">${App.icon('share')}</span>更多方式</button>
      </div>`;
    if (!navigator.share) body.querySelector('.share-actions').style.gridTemplateColumns = 'repeat(3, 1fr)';
    let posterUrl = '';
    App.modal({ title: meta.kind === 'invite' ? '邀请好友' : '分享内容', body, className: 'share-modal', onOpen: async () => {
      try {
        const canvas = meta.kind === 'invite' ? await drawInvitePoster(meta) : await drawPostPoster(meta);
        posterUrl = canvasToUrl(canvas);
        const frame = body.querySelector('.poster-frame');
        if (!posterUrl) throw new Error('poster');
        frame.innerHTML = `<img class="poster-img" src="${posterUrl}" alt="${App.escapeHtml(meta.title)} 分享海报">`;
      } catch {
        body.querySelector('.poster-frame').innerHTML = '<div class="poster-loading">海报生成失败，可以复制链接分享</div>';
      }
    } });
    body.addEventListener('click', async event => {
      const action = event.target.closest('[data-share]')?.dataset.share;
      if (!action) return;
      if (action === 'link') { App.toast(await App.copyText(meta.shareLink) ? '链接已复制' : '复制失败，请长按海报分享', 'success'); return; }
      if (action === 'text') { App.toast(await App.copyText(shareText(meta)) ? '分享文案已复制' : '复制失败，请稍后重试', 'success'); return; }
      if (action === 'native') {
        try { await navigator.share({ title: meta.title, text: meta.excerpt || meta.title, url: meta.shareLink }); } catch (error) { if (error?.name !== 'AbortError') App.toast('系统分享暂不可用'); }
        return;
      }
      if (action === 'save') {
        if (!posterUrl) { App.toast('海报还在生成，请稍候'); return; }
        if (isWeChat || isIOS) { App.toast('请长按海报图片保存'); return; }
        const link = document.createElement('a');
        link.href = posterUrl; link.download = `月入万刀-${meta.title.slice(0, 20)}.jpg`;
        document.body.appendChild(link); link.click(); link.remove();
        App.toast('海报已下载', 'success');
      }
    });
  }

  window.Share = { open, postUrl, shareLinkFor, qrCanvas, qrDataUrl, drawPostPoster, drawInvitePoster };
  // Compatibility with older page scripts.
  window.openShareSheet = open;
  window.shareUrlForPost = shareLinkFor;
})();
