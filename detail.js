/* 内容详情：正文、付费墙、互动、打赏、评论 */
(function () {
  'use strict';
  const App = window.App;
  const { api, icon, escapeHtml, toast, relativeTime, dateText, compact, accessInfo, topicsOf, avatarHtml, session, num } = App;

  const postId = new URLSearchParams(location.search).get('id') || '';
  const article = document.querySelector('#article');
  const rail = document.querySelector('#actionRail');
  const bar = document.querySelector('#actionBar');
  const aside = document.querySelector('#detailAside');
  let post = null;
  let unitName = '积分';
  let comments = [];
  let commentSort = 'latest';
  let commentCursor = null;
  let commentHasMore = false;
  let commentTotal = 0;
  let replyTarget = null;
  let busy = new Set();

  const backLink = () => {
    let sameOrigin = false;
    try { sameOrigin = Boolean(document.referrer) && new URL(document.referrer).origin === location.origin && !/login\.html/.test(document.referrer); } catch {}
    return sameOrigin;
  };

  function setMeta() {
    const title = post?.title || '内容详情';
    const description = post?.excerpt || '月入万刀实战内容';
    document.title = `${title} · 月入万刀`;
    const image = post?.thumbnail ? App.mediaUrl(post.thumbnail) : new URL('assets/iyesh-logo.webp', location.href).href;
    const values = { description, 'og:title': title, 'og:description': description, 'og:url': location.href, 'og:image': image };
    Object.entries(values).forEach(([key, value]) => {
      const attr = key.startsWith('og:') ? 'property' : 'name';
      let meta = document.head.querySelector(`meta[${attr}="${key}"]`);
      if (!meta) { meta = document.createElement('meta'); meta.setAttribute(attr, key); document.head.appendChild(meta); }
      meta.setAttribute('content', value);
    });
  }

  function authorOf(item) { return typeof item.author === 'string' ? { name: item.author } : (item.author || {}); }

  /* ---------------- article ---------------- */
  function paywallHtml() {
    const access = accessInfo(post, unitName);
    if (access.type === 'member') {
      return `<section class="note note--seal paywall paywall--member" aria-label="会员专享">
        <div class="face">会员<small>专享内容</small></div>
        <h2 style="margin-top:14px">${escapeHtml(post.requiredPlanName && post.requiredPlanName !== '会员' ? `开通「${post.requiredPlanName}」后阅读全文` : '开通会员后阅读全文')}</h2>
        <p>会员可阅读全部会员专享打法，有效期内不限次数。</p>
        <div class="actions"><a class="btn btn--seal" href="membership.html?return=${encodeURIComponent(location.pathname + location.search)}">查看会员方案</a>${session.loggedIn() ? '' : `<a class="text-btn" href="${App.loginUrl()}">已是会员？登录</a>`}</div>
      </section>`;
    }
    return `<section class="note paywall" aria-label="积分解锁">
      <div class="face num">${num(access.price)}<small>${escapeHtml(access.unit)}</small></div>
      <h2 style="margin-top:14px">解锁后阅读全文</h2>
      <p>一次解锁，长期可读。积分会直接支持作者。</p>
      <div class="actions"><button class="btn btn--money" type="button" data-action="buy">用 ${num(access.price)} ${escapeHtml(access.unit)}解锁</button><span class="balance" id="balanceHint"></span></div>
    </section>`;
  }

  function renderArticle() {
    const author = authorOf(post);
    const access = accessInfo(post, unitName);
    const topics = topicsOf(post);
    const cover = post.coverImage || '';
    article.setAttribute('aria-busy', 'false');
    article.innerHTML = `
      <a class="back-link" href="index.html" id="backLink">${icon('back')}${backLink() ? '返回' : '发现更多内容'}</a>
      <header class="article-head">
        ${topics.length || post.digest ? `<div class="topics">${post.digest ? '<span class="tag tag--digest">精华</span>' : ''}${topics.map(topic => `<a class="tag tag--info" href="index.html?${new URLSearchParams(topic === post.project ? { project: topic } : { skill: topic })}">#${escapeHtml(topic)}</a>`).join('')}</div>` : ''}
        <h1>${escapeHtml(post.title)}</h1>
        <div class="article-byline">${avatarHtml(author, 40)}<div class="who"><strong>${escapeHtml(author.name || '用户')}</strong><span>${escapeHtml(dateText(post.publishedAt))} 发布</span></div>${access.html}</div>
      </header>
      ${cover ? `<figure class="article-cover"><img src="${escapeHtml(App.mediaUrl(cover))}" alt="${escapeHtml(post.title)}"></figure>` : ''}
      ${post.locked
        ? `${post.excerpt ? `<p class="article-excerpt">${escapeHtml(post.excerpt)}</p>` : ''}${paywallHtml()}`
        : `<div class="prose" id="prose">${post.content || `<p>${escapeHtml(post.excerpt || '')}</p>`}</div>`}
      ${!post.locked && !post.viewer?.isAuthor ? `<section class="note tip-strip"><div class="copy"><strong>觉得有用？给作者一点${escapeHtml(unitName)}</strong><p>打赏会直接进入作者的${escapeHtml(unitName)}账户${post.counts?.tips ? `，已有 ${num(post.counts.tips)} 次打赏` : ''}。</p></div><button class="btn btn--money btn--sm" type="button" data-action="tip">${icon('coin')}打赏作者</button></section>` : ''}
      <p class="article-foot"><button class="text-btn is-muted" type="button" data-action="report">${icon('flag')}举报这篇内容</button></p>
      <section class="comments" id="comments" aria-label="评论">
        <div class="comments-head"><h2>评论</h2><span class="num" id="commentTotal"></span>
          <div class="segmented" role="group" aria-label="评论排序"><button type="button" data-sort="latest" aria-pressed="true">最新</button><button type="button" data-sort="hot" aria-pressed="false">最热</button><button type="button" data-sort="oldest" aria-pressed="false">最早</button></div>
        </div>
        ${post.locked ? `<p class="inline-alert inline-alert--info">${icon('lock')}<span>解锁内容后可以参与评论。</span></p>` : `
        <form class="comment-composer" id="composer">
          <div class="replying" id="replying" hidden><span></span><button class="text-btn" type="button" id="cancelReply">取消回复</button></div>
          <label class="sr-only" for="commentInput">评论内容</label>
          <textarea id="commentInput" maxlength="1000" rows="2" placeholder="${session.loggedIn() ? '说说你的看法，或补充你的经验' : '登录后参与评论'}"></textarea>
          <div class="row"><span class="count num" id="commentCount">0 / 1000</span><button class="btn btn--primary btn--sm" type="submit">发表评论</button></div>
        </form>`}
        <div class="comment-list" id="commentList"></div>
        <div style="display:flex;justify-content:center;padding-top:16px"><button class="btn btn--sm" type="button" id="moreComments" hidden>查看更多评论</button></div>
      </section>`;
    if (!post.locked) {
      const input = article.querySelector('#commentInput');
      App.autoGrow(input);
      input.addEventListener('input', () => { article.querySelector('#commentCount').textContent = `${input.value.length} / 1000`; });
      input.addEventListener('focus', () => { if (!session.loggedIn()) { input.blur(); App.goLogin(); } });
      article.querySelectorAll('.prose img').forEach(image => {
        // Uploads are served from the API origin when it differs from the page origin (local dev, separate API host).
        const raw = image.getAttribute('src') || '';
        if (raw.startsWith('/uploads/')) image.src = App.mediaUrl(raw);
        image.addEventListener('click', () => App.viewImage(image.currentSrc || image.src));
      });
    }
    if (post.locked && post.accessType === 'paid') loadBalance();
  }

  function interactionButtons(kind) {
    const counts = post.counts || {};
    const viewer = post.viewer || {};
    const defs = [
      ['like', 'heart', '点赞', viewer.liked, counts.likes],
      ['favorite', 'star', '收藏', viewer.favorited, counts.favorites],
      ['anchor', 'anchor', '投锚', viewer.anchored, counts.anchors]
    ];
    if (kind === 'rail') {
      return defs.map(([action, iconName, label, active, count]) => `<button class="rail-btn" type="button" data-action="${action}" aria-pressed="${Boolean(active)}" aria-label="${label}"><span class="ring">${icon(iconName)}</span><span class="num">${count ? compact(count) : label}</span></button>`).join('')
        + `<button class="rail-btn" type="button" data-action="comment" aria-label="评论"><span class="ring">${icon('comment')}</span><span class="num">${counts.comments ? compact(counts.comments) : '评论'}</span></button>`
        + `<button class="rail-btn" type="button" data-action="share" aria-label="分享"><span class="ring">${icon('share')}</span><span>分享</span></button>`;
    }
    return `<button class="compose" type="button" data-action="comment">${post.locked ? '解锁后参与评论' : '写评论…'}</button>`
      + defs.map(([action, iconName, label, active, count]) => `<button class="bar-btn" type="button" data-action="${action}" aria-pressed="${Boolean(active)}" aria-label="${label}">${icon(iconName)}<span>${count ? compact(count) : label}</span></button>`).join('')
      + `<button class="bar-btn" type="button" data-action="share" aria-label="分享">${icon('share')}<span>分享</span></button>`;
  }
  function renderActions() {
    rail.innerHTML = interactionButtons('rail');
    bar.innerHTML = interactionButtons('bar');
    bar.hidden = false;
  }

  function renderAside(related = []) {
    const author = authorOf(post);
    aside.innerHTML = `<section class="sheet author-card"><div class="row">${avatarHtml(author, 44)}<div><strong>${escapeHtml(author.name || '用户')}</strong><p class="hint">内容作者</p></div></div>${!post.locked && !post.viewer?.isAuthor ? `<button class="btn btn--sm btn--money" type="button" data-action="tip">${icon('coin')}打赏作者</button>` : ''}</section>
      ${related.length ? `<section class="sheet side-card"><h3>相关内容</h3><div class="list" style="margin-top:6px">${related.map(item => `<a class="list-row" href="detail.html?id=${encodeURIComponent(item.id)}"><span class="main"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(authorOf(item).name || '')}　${escapeHtml(relativeTime(item.publishedAt))}</small></span></a>`).join('')}</div></section>` : ''}`;
  }
  async function loadRelated() {
    try {
      const body = await api('/api/v1/posts/search', { method: 'POST', body: { platformId: 'YouTube', projectId: post.project && post.project !== '未分类' ? post.project : undefined, sort: 'hot', pageSize: 6 } });
      renderAside((body.items || []).filter(item => item.id !== post.id).slice(0, 4));
    } catch { renderAside([]); }
  }

  async function loadBalance() {
    const hint = document.querySelector('#balanceHint');
    if (!hint) return;
    if (!session.loggedIn()) { hint.innerHTML = `<a class="text-btn" href="${App.loginUrl()}">登录</a> 后解锁`; return; }
    try { const body = await api('/api/v1/me/points'); hint.textContent = `当前余额 ${num(body.balance)} ${body.unitName || unitName}`; } catch {}
  }

  /* ---------------- comments ---------------- */
  function commentHtml(item, nested = false) {
    const user = item.user || {};
    const mine = session.user()?.id && user.id === session.user().id;
    return `<div class="comment" data-comment="${escapeHtml(item.id)}">
      ${avatarHtml(user, nested ? 28 : 36)}
      <div class="comment-body">
        <div class="comment-meta"><strong>${escapeHtml(user.name || '用户')}</strong><time datetime="${escapeHtml(item.createdAt || '')}">${escapeHtml(relativeTime(item.createdAt))}</time></div>
        <p class="comment-text">${item.replyTo ? `<span class="reply-to">@${escapeHtml(item.replyTo.name)}</span>` : ''}${escapeHtml(item.content)}</p>
        <div class="comment-actions">${post.locked ? '' : `<button type="button" data-reply="${escapeHtml(item.id)}" data-name="${escapeHtml(user.name || '用户')}">回复</button>`}${mine ? `<button type="button" data-delete-comment="${escapeHtml(item.id)}">删除</button>` : `<button type="button" data-report-comment="${escapeHtml(item.id)}">举报</button>`}</div>
        ${!nested && item.replies?.length ? `<div class="replies">${item.replies.map(reply => commentHtml(reply, true)).join('')}</div>` : ''}
      </div>
    </div>`;
  }
  function renderComments() {
    const list = document.querySelector('#commentList');
    if (!list) return;
    document.querySelector('#commentTotal').textContent = commentTotal ? String(commentTotal) : '';
    list.innerHTML = comments.length ? comments.map(item => commentHtml(item)).join('') : `<div class="empty">${icon('comment')}<p>${post.locked ? '还没有评论。' : '还没有评论，来说第一句吧。'}</p></div>`;
    document.querySelector('#moreComments').hidden = !commentHasMore;
    article.querySelectorAll('[data-sort]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.sort === commentSort)));
  }
  async function loadComments(reset = true) {
    try {
      const query = new URLSearchParams({ sort: commentSort, pageSize: '20', thread: '1' });
      if (!reset && commentCursor) query.set('cursor', commentCursor);
      const body = await api(`/api/v1/posts/${encodeURIComponent(postId)}/comments?${query}`);
      comments = reset ? (body.items || []) : comments.concat(body.items || []);
      commentCursor = body.nextCursor || null;
      commentHasMore = Boolean(body.hasMore);
      commentTotal = Number(body.total ?? comments.length);
      renderComments();
    } catch (error) { if (reset) { comments = []; renderComments(); } toast(error.message, 'error'); }
  }
  function setReply(target) {
    replyTarget = target;
    const banner = document.querySelector('#replying');
    if (!banner) return;
    banner.hidden = !target;
    if (target) banner.querySelector('span').textContent = `回复 @${target.name}`;
    const input = document.querySelector('#commentInput');
    input.placeholder = target ? `回复 @${target.name}` : '说说你的看法，或补充你的经验';
    if (target) { input.focus(); input.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  }
  async function submitComment(event) {
    event.preventDefault();
    if (!session.loggedIn()) { App.goLogin(); return; }
    const input = document.querySelector('#commentInput');
    const content = input.value.trim();
    if (!content) { input.focus(); return; }
    const button = event.target.querySelector('button[type="submit"]');
    button.classList.add('is-loading');
    try {
      const path = replyTarget ? `/api/v1/comments/${encodeURIComponent(replyTarget.id)}/replies` : `/api/v1/posts/${encodeURIComponent(postId)}/comments`;
      await api(path, { method: 'POST', body: { content } });
      input.value = ''; input.dispatchEvent(new Event('input'));
      const wasReply = Boolean(replyTarget);
      setReply(null);
      post.counts = { ...(post.counts || {}), comments: Number(post.counts?.comments || 0) + 1 };
      renderActions();
      if (!wasReply) commentSort = 'latest';
      await loadComments(true);
      toast(wasReply ? '回复已发布' : '评论已发布', 'success');
    } catch (error) {
      if (error.status === 401) { App.goLogin(); return; }
      toast(error.message, 'error');
    } finally { button.classList.remove('is-loading'); }
  }

  /* ---------------- actions ---------------- */
  async function toggle(action) {
    if (!session.loggedIn()) { toast('登录后才能操作'); setTimeout(() => App.goLogin(), 500); return; }
    if (busy.has(action)) return;
    busy.add(action);
    const key = { like: 'liked', favorite: 'favorited', anchor: 'anchored' }[action];
    const countKey = { like: 'likes', favorite: 'favorites', anchor: 'anchors' }[action];
    const active = Boolean(post.viewer?.[key]);
    // Optimistic update, rolled back if the request fails.
    post.viewer = { ...(post.viewer || {}), [key]: !active };
    post.counts = { ...(post.counts || {}), [countKey]: Math.max(0, Number(post.counts?.[countKey] || 0) + (active ? -1 : 1)) };
    renderActions();
    try {
      const result = await api(`/api/v1/posts/${encodeURIComponent(postId)}/${action}`, { method: active ? 'DELETE' : 'POST' });
      post.counts = result.counts || post.counts;
      renderActions();
      if (!active) toast({ like: '已点赞', favorite: '已收藏，可在「我的 › 收藏」找到', anchor: '已投锚' }[action], 'success');
    } catch (error) {
      post.viewer = { ...(post.viewer || {}), [key]: active };
      post.counts = { ...(post.counts || {}), [countKey]: Math.max(0, Number(post.counts?.[countKey] || 0) + (active ? 1 : -1)) };
      renderActions();
      toast(error.message, 'error');
    } finally { busy.delete(action); }
  }

  async function buy() {
    if (!session.loggedIn()) { App.goLogin(); return; }
    const access = accessInfo(post, unitName);
    let balance = null;
    try { balance = Number((await api('/api/v1/me/points')).balance || 0); } catch {}
    if (balance !== null && balance < access.price) {
      const go = await App.modal({ title: `${unitName}不足`, body: `<p>解锁需要 <strong class="num">${num(access.price)}</strong> ${escapeHtml(unitName)}，当前余额 <strong class="num">${num(balance)}</strong> ${escapeHtml(unitName)}。</p><p class="hint" style="margin-top:8px">可以使用兑换码充值，或签到领取${escapeHtml(unitName)}。</p>`, actions: [{ label: '稍后再说', value: false }, { label: `获取${unitName}`, primary: true, value: true }] });
      if (go) location.href = 'membership.html#redeem';
      return;
    }
    const ok = await App.confirm({ title: '确认解锁', message: `将使用 ${num(access.price)} ${unitName}解锁《${post.title}》${balance !== null ? `，解锁后余额 ${num(balance - access.price)} ${unitName}` : ''}。`, confirmText: '确认解锁' });
    if (!ok) return;
    try {
      await api(`/api/v1/posts/${encodeURIComponent(postId)}/purchase`, { method: 'POST', body: { idempotencyKey: `buy_${postId}_${Date.now()}` } });
      sessionStorage.removeItem('iyesh:me');
      toast('解锁成功', 'success');
      await load();
    } catch (error) { toast(error.message, 'error'); }
  }

  async function tip() {
    if (!session.loggedIn()) { App.goLogin(); return; }
    let balance = 0;
    try { balance = Number((await api('/api/v1/me/points')).balance || 0); } catch {}
    const body = document.createElement('div');
    body.innerHTML = `<p class="hint">当前余额 <strong class="num" style="color:var(--ink)">${num(balance)}</strong> ${escapeHtml(unitName)}</p>
      <div class="chip-row" style="margin-top:14px">${[10, 50, 100, 200].map(value => `<button class="chip num" type="button" data-amount="${value}" aria-pressed="${value === 10}">${value}</button>`).join('')}</div>
      <div class="field" style="margin-top:14px"><label class="label" for="tipAmount">打赏数量</label><input class="input num" id="tipAmount" type="number" inputmode="numeric" min="1" step="1" value="10"></div>
      <div class="field" style="margin-top:12px"><label class="label" for="tipMessage">留言 <small>选填</small></label><input class="input" id="tipMessage" maxlength="100" placeholder="写一句感谢"></div>
      <p class="field-error" id="tipError" hidden></p>`;
    body.addEventListener('click', event => {
      const chip = event.target.closest('[data-amount]');
      if (!chip) return;
      body.querySelectorAll('[data-amount]').forEach(item => item.setAttribute('aria-pressed', String(item === chip)));
      body.querySelector('#tipAmount').value = chip.dataset.amount;
    });
    await App.modal({ title: '打赏作者', body, actions: [{ label: '取消', value: null }, { label: '确认打赏', className: 'btn--money', onClick: async () => {
      const amount = Number(body.querySelector('#tipAmount').value);
      const error = body.querySelector('#tipError');
      if (!Number.isInteger(amount) || amount < 1) { error.textContent = `请输入正确的${unitName}数量`; error.hidden = false; return false; }
      if (amount > balance) { error.innerHTML = `${escapeHtml(unitName)}余额不足，<a class="text-btn" href="membership.html#redeem">去充值</a>`; error.hidden = false; return false; }
      try {
        await api('/api/v1/tips', { method: 'POST', body: { postId, points: amount, message: body.querySelector('#tipMessage').value.trim() } });
        sessionStorage.removeItem('iyesh:me');
        post.counts = { ...(post.counts || {}), tips: Number(post.counts?.tips || 0) + 1 };
        toast(`已打赏 ${amount} ${unitName}，谢谢你的支持`, 'success');
      } catch (requestError) { error.textContent = requestError.message; error.hidden = false; return false; }
    } }] });
  }

  async function report() {
    if (!session.loggedIn()) { App.goLogin(); return; }
    const reason = await App.prompt({ title: '举报内容', label: '举报原因', presets: ['广告引流', '抄袭侵权', '内容虚假', '违法违规'], placeholder: '请选择或填写原因', maxLength: 200, confirmText: '提交举报' });
    if (!reason) return;
    try { await api(`/api/v1/posts/${encodeURIComponent(postId)}/report`, { method: 'POST', body: { reason: 'other', detail: reason } }); toast('举报已提交，我们会尽快处理', 'success'); }
    catch (error) { toast(error.message, 'error'); }
  }

  function share() {
    const access = accessInfo(post, unitName);
    window.Share.open({ id: post.id, title: post.title, excerpt: post.excerpt, author: authorOf(post), cover: post.thumbnail || post.coverImage, topics: topicsOf(post), access: { type: access.type, price: access.price, unit: access.unit }, dateText: dateText(post.publishedAt) });
  }

  async function handleAction(action) {
    if (action === 'like' || action === 'favorite' || action === 'anchor') return toggle(action);
    if (action === 'share') return share();
    if (action === 'buy') return buy();
    if (action === 'tip') return tip();
    if (action === 'report') return report();
    if (action === 'comment') {
      const input = document.querySelector('#commentInput');
      if (!input) { document.querySelector('#comments')?.scrollIntoView({ behavior: 'smooth' }); return; }
      if (!session.loggedIn()) { App.goLogin(); return; }
      input.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setTimeout(() => input.focus(), 250);
    }
  }

  document.addEventListener('click', async event => {
    const back = event.target.closest('#backLink');
    if (back && backLink()) { event.preventDefault(); history.back(); return; }
    const actionButton = event.target.closest('[data-action]');
    if (actionButton) { handleAction(actionButton.dataset.action); return; }
    const sort = event.target.closest('[data-sort]');
    if (sort && sort.dataset.sort !== commentSort) { commentSort = sort.dataset.sort; loadComments(true); return; }
    if (event.target.closest('#moreComments')) { loadComments(false); return; }
    if (event.target.closest('#cancelReply')) { setReply(null); return; }
    const reply = event.target.closest('[data-reply]');
    if (reply) { if (!session.loggedIn()) { App.goLogin(); return; } setReply({ id: reply.dataset.reply, name: reply.dataset.name }); return; }
    const del = event.target.closest('[data-delete-comment]');
    if (del) {
      if (!(await App.confirm({ title: '删除评论', message: '删除后，这条评论下的回复也会一起隐藏。', confirmText: '删除', danger: true }))) return;
      try { await api(`/api/v1/comments/${encodeURIComponent(del.dataset.deleteComment)}`, { method: 'DELETE' }); toast('评论已删除', 'success'); await loadComments(true); } catch (error) { toast(error.message, 'error'); }
      return;
    }
    const rep = event.target.closest('[data-report-comment]');
    if (rep) {
      if (!session.loggedIn()) { App.goLogin(); return; }
      const reason = await App.prompt({ title: '举报评论', label: '举报原因', presets: ['广告引流', '辱骂攻击', '虚假信息', '违法违规'], maxLength: 200, confirmText: '提交举报' });
      if (!reason) return;
      try { await api(`/api/v1/comments/${encodeURIComponent(rep.dataset.reportComment)}/report`, { method: 'POST', body: { reason: 'other', detail: reason } }); rep.textContent = '已举报'; rep.disabled = true; toast('举报已提交', 'success'); } catch (error) { toast(error.message, 'error'); }
    }
  });
  document.addEventListener('submit', event => { if (event.target.id === 'composer') submitComment(event); });

  function renderMissing(message, retry = false) {
    article.setAttribute('aria-busy', 'false');
    article.innerHTML = `<a class="back-link" href="index.html">${icon('back')}回到发现</a><div class="sheet empty" style="padding:56px 20px">${icon(retry ? 'alert' : 'file')}<strong>${escapeHtml(message)}</strong><p>${retry ? '可能是网络不稳定，稍后再试一次。' : '它可能已被作者下线，或链接有误。'}</p>${retry ? '<button class="btn btn--sm" type="button" id="retryLoad">重新加载</button>' : '<a class="btn btn--primary btn--sm" href="index.html">看看其他内容</a>'}</div>`;
    article.querySelector('#retryLoad')?.addEventListener('click', load);
    bar.hidden = true; rail.innerHTML = ''; aside.innerHTML = '';
  }

  async function load() {
    if (!postId) { renderMissing('没有找到这篇内容'); return; }
    try { const config = await api('/api/v1/points/config', { auth: false }); unitName = config.unitName || unitName; } catch {}
    try {
      post = await api(`/api/v1/posts/${encodeURIComponent(postId)}`);
    } catch (error) {
      if (error.status === 404) renderMissing('这篇内容不存在或已下线'); else renderMissing('内容加载失败', true);
      return;
    }
    setMeta();
    renderArticle();
    renderActions();
    renderAside([]);
    commentSort = 'latest';
    loadComments(true);
    loadRelated();
  }
  load();
})();
