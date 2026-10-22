/* 发布内容编辑器
   正文由“文字段落 + 图片”块组成，序列化为纯文本（图片写作 ![说明](/uploads/x)）。
   不锁定视口、不拦截滚动和触摸：每个文本框随内容自动增高，页面始终是唯一的
   滚动容器，手机键盘弹出时底部操作栏自动隐藏。 */
(function () {
  'use strict';
  const App = window.App;
  const { api, icon, escapeHtml, toast, session, num } = App;

  const MAX_IMAGES = 20;
  const PRICE_PRESETS = [50, 100, 200, 500, 990];
  const params = new URLSearchParams(location.search);
  let postId = params.get('id') || '';
  const storageKey = () => `iyesh:draft:${postId || 'new'}`;

  const els = {
    layout: document.querySelector('#layout'),
    gate: document.querySelector('#gate'),
    notices: document.querySelector('#notices'),
    title: document.querySelector('#titleInput'),
    excerpt: document.querySelector('#excerptInput'),
    blocks: document.querySelector('#blocks'),
    file: document.querySelector('#fileInput'),
    saveState: document.querySelector('#saveState'),
    bar: document.querySelector('#publishBar'),
    checklist: document.querySelector('#checklist'),
    price: document.querySelector('#priceInput')
  };

  const state = {
    blocks: [],
    project: '',
    skill: '',
    accessType: 'free',
    pricePoints: 0,
    planIds: [],
    cover: '',
    status: 'new',
    dirty: false,
    saving: false,
    serverSavedAt: null
  };
  let tags = { project: [], skill: [] };
  let plans = [];
  let unitName = '积分';
  let lastText = null;       // last focused text block id + caret
  let uid = 0;
  const nextId = () => `b${++uid}`;

  /* ---------------- model <-> content ---------------- */
  const IMAGE_LINE = /^!\[([^\]\n]{0,120})\]\((\/uploads\/[A-Za-z0-9][A-Za-z0-9._-]*)\)$/;
  function parseContent(content, images = []) {
    const blocks = [];
    let buffer = [];
    const flush = () => { if (buffer.length) { blocks.push({ id: nextId(), type: 'text', text: buffer.join('\n').replace(/^\n+|\n+$/g, '') }); buffer = []; } };
    const used = new Set();
    for (const line of String(content || '').replace(/\r\n?/g, '\n').split('\n')) {
      const image = line.trim().match(IMAGE_LINE);
      if (image) { flush(); used.add(image[2]); blocks.push({ id: nextId(), type: 'image', url: image[2], caption: image[1] || '', status: 'done' }); }
      else buffer.push(line);
    }
    flush();
    images.filter(url => url && !used.has(url)).forEach(url => blocks.push({ id: nextId(), type: 'image', url, caption: '', status: 'done' }));
    return normalizeBlocks(blocks);
  }
  // Keep a text block before/after images so there is always somewhere to type.
  function normalizeBlocks(blocks) {
    const result = [];
    blocks.forEach(block => {
      if (block.type === 'text' && result.length && result[result.length - 1].type === 'text') { result[result.length - 1].text = [result[result.length - 1].text, block.text].filter(Boolean).join('\n\n'); return; }
      result.push(block);
    });
    if (!result.length || result[0].type !== 'text') result.unshift({ id: nextId(), type: 'text', text: '' });
    if (result[result.length - 1].type !== 'text') result.push({ id: nextId(), type: 'text', text: '' });
    return result;
  }
  function serialize() {
    const parts = [];
    for (const block of state.blocks) {
      if (block.type === 'text') { const text = block.text.trimEnd(); if (text.trim()) parts.push(text); }
      else if (block.url) parts.push(`![${(block.caption || '').replace(/[\]\n]/g, ' ').trim().slice(0, 120)}](${block.url})`);
    }
    return parts.join('\n\n');
  }
  const imageBlocks = () => state.blocks.filter(block => block.type === 'image');
  const uploadedImages = () => imageBlocks().filter(block => block.url).map(block => block.url);
  const uploading = () => imageBlocks().some(block => block.status === 'uploading');
  function bodyText() { return state.blocks.filter(block => block.type === 'text').map(block => block.text).join('\n').replace(/^\s*(#{2,3}|[-•*]|\d{1,3}[.、)]|>)\s*/gm, '').replace(/\*\*/g, '').replace(/\s+/g, ''); }

  /* ---------------- rendering ---------------- */
  function textBlockHtml(block, index) {
    const placeholder = index === 0 ? '从这里开始写正文：背景、具体步骤、数据结果和踩过的坑' : '继续写…';
    return `<div class="block block-text" data-block="${block.id}"><label class="sr-only" for="ta-${block.id}">正文段落</label><textarea id="ta-${block.id}" rows="${index === 0 ? 4 : 1}" placeholder="${placeholder}">${escapeHtml(block.text)}</textarea></div>`;
  }
  function imageBlockHtml(block) {
    const src = block.preview || App.mediaUrl(block.url);
    const isCover = state.cover && block.url && state.cover === block.url;
    const position = imageBlocks().indexOf(block);
    return `<div class="block block-image${block.status === 'uploading' ? ' is-uploading' : ''}${block.status === 'error' ? ' is-error' : ''}" data-block="${block.id}">
      <figure>
        ${src ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(block.caption || '正文图片')}">` : ''}
        ${isCover ? '<span class="cover-flag">封面</span>' : ''}
        <div class="img-tools">
          ${block.status === 'done' ? `<button type="button" data-img="cover" aria-pressed="${isCover}" aria-label="${isCover ? '取消封面' : '设为封面'}">${icon('image')}${isCover ? '已设封面' : '设为封面'}</button>` : ''}
          ${block.status === 'error' ? `<button type="button" data-img="retry" aria-label="重新上传">${icon('refresh')}重试</button>` : ''}
          <button type="button" data-img="up" aria-label="上移" ${position <= 0 ? 'disabled' : ''}>${icon('up')}</button>
          <button type="button" data-img="down" aria-label="下移" ${position >= imageBlocks().length - 1 ? 'disabled' : ''}>${icon('down')}</button>
          <button type="button" data-img="remove" aria-label="删除图片">${icon('trash')}</button>
        </div>
        ${block.status === 'uploading' ? `<div class="progress"><span style="width:${Math.round((block.progress || 0.05) * 100)}%"></span></div>` : ''}
        ${block.status === 'error' ? `<div class="error">${escapeHtml(block.error || '上传失败')}</div>` : ''}
      </figure>
      ${block.status !== 'error' ? `<input class="caption" type="text" maxlength="60" value="${escapeHtml(block.caption || '')}" placeholder="图片说明（选填）" aria-label="图片说明">` : ''}
    </div>`;
  }
  function renderBlocks(focusId, caret) {
    let textIndex = 0;
    els.blocks.innerHTML = state.blocks.map(block => block.type === 'text' ? textBlockHtml(block, textIndex++) : imageBlockHtml(block)).join('');
    els.blocks.querySelectorAll('textarea').forEach(area => App.autoGrow(area));
    if (focusId) {
      const area = els.blocks.querySelector(`[data-block="${focusId}"] textarea`);
      if (area) { area.focus({ preventScroll: false }); const pos = caret ?? area.value.length; try { area.setSelectionRange(pos, pos); } catch {} }
    }
    updateStats();
  }
  function updateImageBlock(block) {
    const node = els.blocks.querySelector(`[data-block="${block.id}"]`);
    if (!node) return;
    if (block.status === 'uploading') { const bar = node.querySelector('.progress span'); if (bar) bar.style.width = `${Math.round((block.progress || 0.05) * 100)}%`; return; }
    node.outerHTML = imageBlockHtml(block);
    updateStats();
  }
  function updateStats() {
    const titleLength = els.title.value.length;
    document.querySelector('#titleCount').textContent = `标题 ${titleLength}/120`;
    document.querySelector('#excerptCount').textContent = `摘要 ${els.excerpt.value.length}/300`;
    document.querySelector('#wordCount').textContent = `正文 ${num(bodyText().length)} 字`;
    document.querySelector('#imageCount').textContent = `图片 ${imageBlocks().length}/${MAX_IMAGES}`;
    renderChecklist();
  }
  function checks() {
    const title = els.title.value.trim();
    const words = bodyText().length;
    const images = uploadedImages().length;
    return [
      { key: 'title', label: title.length >= 5 ? '标题已填写' : '写一个至少 5 个字的标题', done: title.length >= 5, required: true },
      { key: 'body', label: words >= 30 || images ? `正文 ${num(words)} 字${images ? `，${images} 张图片` : ''}` : '正文至少写 30 字，或添加图片', done: words >= 30 || images > 0, required: true },
      { key: 'project', label: state.project ? `方向：${state.project}` : '选一个内容方向（推荐）', done: Boolean(state.project) },
      { key: 'excerpt', label: els.excerpt.value.trim() ? '已填写摘要' : state.accessType === 'free' ? '摘要可留空，列表会自动截取正文' : '付费或会员内容建议写摘要', done: Boolean(els.excerpt.value.trim()) || state.accessType === 'free' },
      { key: 'price', label: state.accessType === 'paid' ? (state.pricePoints >= 1 ? `价格 ${num(state.pricePoints)} ${unitName}` : '设置解锁价格') : state.accessType === 'member' ? '会员可读' : '免费公开', done: state.accessType !== 'paid' || state.pricePoints >= 1, required: state.accessType === 'paid' }
    ];
  }
  function renderChecklist() {
    els.checklist.innerHTML = checks().map(item => `<li class="${item.done ? 'is-done' : ''}"><span class="mark">${icon('check')}</span><span>${escapeHtml(item.label)}</span></li>`).join('');
  }
  function setSaveState(kind, text) {
    els.saveState.className = `save-state${kind ? ` is-${kind}` : ''}`;
    els.saveState.querySelector('.text').textContent = text;
  }

  function renderChips(target, list, selected, key) {
    target.innerHTML = [['', '不选'], ...list.map(name => [name, name])].map(([value, label]) => `<button class="chip" type="button" data-${key}="${escapeHtml(value)}" aria-pressed="${String(selected === value)}">${escapeHtml(label)}</button>`).join('');
  }
  function renderSettings() {
    renderChips(document.querySelector('#projectChips'), tags.project, state.project, 'project');
    renderChips(document.querySelector('#skillChips'), tags.skill, state.skill, 'skill');
    document.querySelectorAll('input[name="accessType"]').forEach(input => { input.checked = input.value === state.accessType; input.closest('.access-option').classList.toggle('is-checked', input.checked); });
    document.querySelector('#memberExtra').hidden = state.accessType !== 'member';
    document.querySelector('#paidExtra').hidden = state.accessType !== 'paid';
    document.querySelector('#planChips').innerHTML = plans.length ? plans.map(plan => `<button class="chip" type="button" data-plan="${escapeHtml(plan.id)}" aria-pressed="${state.planIds.includes(String(plan.id))}">${escapeHtml(plan.name)}</button>`).join('') : '<span class="hint">暂无可选套餐，所有会员可看</span>';
    document.querySelector('#pricePresets').innerHTML = PRICE_PRESETS.map(value => `<button class="chip" type="button" data-price="${value}" aria-pressed="${state.pricePoints === value}">${value}</button>`).join('');
    if (document.activeElement !== els.price) els.price.value = state.pricePoints && !PRICE_PRESETS.includes(state.pricePoints) ? state.pricePoints : (state.pricePoints || '');
    document.querySelector('#priceUnit').textContent = unitName;
    document.querySelector('#paidDesc').textContent = `读者用${unitName}购买，${unitName}归你`;
    renderChecklist();
  }

  /* ---------------- local autosave ---------------- */
  function snapshot() {
    return { title: els.title.value, excerpt: els.excerpt.value, content: serialize(), images: uploadedImages(), project: state.project, skill: state.skill, accessType: state.accessType, pricePoints: state.pricePoints, planIds: state.planIds, cover: state.cover, savedAt: Date.now() };
  }
  const saveLocal = App.debounce(() => {
    const data = snapshot();
    if (!data.title.trim() && !data.content.trim() && !data.excerpt.trim()) return;
    try { localStorage.setItem(storageKey(), JSON.stringify(data)); } catch {}
    if (state.dirty) setSaveState('dirty', '已暂存到本机');
  }, 600);
  function readLocal() { try { return JSON.parse(localStorage.getItem(storageKey()) || 'null'); } catch { return null; } }
  function clearLocal() { try { localStorage.removeItem(storageKey()); localStorage.removeItem('iyesh:draft:new'); } catch {} }
  let applying = false;
  function markDirty() { if (applying) { updateStats(); return; } state.dirty = true; setSaveState('dirty', '有未保存的修改'); saveLocal(); updateStats(); }
  function applySnapshot(data) {
    applying = true;
    els.title.value = data.title || '';
    els.excerpt.value = data.excerpt || '';
    state.blocks = parseContent(data.content || '', data.images || []);
    state.project = data.project || '';
    state.skill = data.skill || '';
    state.accessType = ['free', 'member', 'paid'].includes(data.accessType) ? data.accessType : 'free';
    state.pricePoints = Number(data.pricePoints || 0);
    state.planIds = (data.planIds || data.memberPlanIds || []).map(String);
    state.cover = data.cover || data.coverImage || '';
    els.title.dispatchEvent(new Event('input'));
    els.excerpt.dispatchEvent(new Event('input'));
    renderBlocks();
    renderSettings();
    applying = false;
  }

  /* ---------------- formatting ---------------- */
  function activeTextArea() {
    if (document.activeElement && document.activeElement.matches?.('#blocks textarea')) return document.activeElement;
    if (lastText) { const area = els.blocks.querySelector(`[data-block="${lastText.id}"] textarea`); if (area) return area; }
    return els.blocks.querySelector('textarea');
  }
  function applyFormat(kind) {
    const area = activeTextArea();
    if (!area) return;
    const value = area.value;
    let start = area.selectionStart ?? value.length;
    let end = area.selectionEnd ?? value.length;
    if (document.activeElement !== area && lastText && lastText.id === area.closest('[data-block]').dataset.block) { start = lastText.start; end = lastText.end; }
    if (kind === 'bold') {
      const selected = value.slice(start, end) || '加粗文字';
      area.value = `${value.slice(0, start)}**${selected}**${value.slice(end)}`;
      area.focus(); area.setSelectionRange(start + 2, start + 2 + selected.length);
    } else {
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const lineEndIndex = value.indexOf('\n', end);
      const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
      const lines = value.slice(lineStart, lineEnd).split('\n');
      const prefixes = { heading: () => '## ', list: () => '- ', ordered: index => `${index + 1}. `, quote: () => '> ' };
      const strip = line => line.replace(/^\s*(#{2,3}\s+|[-•*]\s+|\d{1,3}[.、)]\s*|>\s?)/, '');
      const pattern = { heading: /^\s*#{2,3}\s+/, list: /^\s*[-•*]\s+/, ordered: /^\s*\d{1,3}[.、)]\s*/, quote: /^\s*>\s?/ }[kind];
      const allApplied = lines.every(line => pattern.test(line));
      const next = lines.map((line, index) => allApplied ? strip(line) : `${prefixes[kind](index)}${strip(line)}`).join('\n');
      area.value = `${value.slice(0, lineStart)}${next}${value.slice(lineEnd)}`;
      area.focus();
      const caret = lineStart + next.length;
      area.setSelectionRange(caret, caret);
    }
    area.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /* ---------------- images ---------------- */
  function insertImageBlocks(files) {
    const room = MAX_IMAGES - imageBlocks().length;
    if (room <= 0) { toast(`最多插入 ${MAX_IMAGES} 张图片`, 'error'); return; }
    const picked = [...files].filter(file => /^image\//i.test(file.type) || /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(file.name || '')).slice(0, room);
    if (!picked.length) { toast('请选择图片文件', 'error'); return; }
    if (files.length > room) toast(`已达上限，只添加了 ${picked.length} 张`);
    // Insert at the caret: split the current text block in two around the images.
    let index = state.blocks.length - 1;
    let tail = null;
    if (lastText) {
      const blockIndex = state.blocks.findIndex(block => block.id === lastText.id);
      if (blockIndex >= 0) {
        const block = state.blocks[blockIndex];
        const caret = Math.min(lastText.end ?? block.text.length, block.text.length);
        const before = block.text.slice(0, caret).trimEnd();
        const after = block.text.slice(caret).replace(/^\s+/, '');
        block.text = before;
        index = blockIndex;
        if (after) tail = { id: nextId(), type: 'text', text: after };
      }
    }
    const created = picked.map(file => ({ id: nextId(), type: 'image', url: '', caption: '', status: 'uploading', progress: 0.03, file, preview: URL.createObjectURL(file) }));
    state.blocks.splice(index + 1, 0, ...created, ...(tail ? [tail] : []));
    state.blocks = normalizeBlocks(state.blocks);
    const after = state.blocks[state.blocks.indexOf(created[created.length - 1]) + 1];
    lastText = after ? { id: after.id, start: 0, end: 0 } : lastText;
    renderBlocks();
    markDirty();
    els.blocks.querySelector(`[data-block="${created[0].id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    uploadQueue(created);
  }
  let queue = Promise.resolve();
  function uploadQueue(blocks) {
    blocks.forEach(block => { queue = queue.then(() => uploadBlock(block)); });
    queue.then(() => { if (!uploading()) setSaveState('dirty', '图片已上传，记得保存'); });
  }
  async function uploadBlock(block) {
    if (!state.blocks.includes(block)) return;
    block.status = 'uploading'; block.progress = 0.05; block.error = '';
    updateImageBlock(block);
    try {
      const file = await App.compressImage(block.file);
      block.progress = 0.15; updateImageBlock(block);
      const uploaded = await App.uploadImage(file, ratio => { block.progress = 0.15 + ratio * 0.85; updateImageBlock(block); });
      block.url = new URL(uploaded.url, location.href).pathname.startsWith('/uploads/') ? new URL(uploaded.url, location.href).pathname : uploaded.url;
      block.status = 'done';
      delete block.file;
      updateImageBlock(block);
      markDirty();
    } catch (error) {
      if (error.status === 401) { toast('登录已过期，请重新登录后再上传', 'error'); }
      block.status = 'error'; block.error = error.message || '上传失败';
      updateImageBlock(block);
    }
  }
  function moveImage(block, direction) {
    const images = imageBlocks();
    const position = images.indexOf(block);
    const target = images[position + direction];
    if (!target) return;
    const a = state.blocks.indexOf(block); const b = state.blocks.indexOf(target);
    state.blocks[a] = target; state.blocks[b] = block;
    state.blocks = normalizeBlocks(state.blocks);
    renderBlocks();
    els.blocks.querySelector(`[data-block="${block.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    markDirty();
  }

  /* ---------------- save & submit ---------------- */
  function payload(mode) {
    const accessType = state.accessType;
    return {
      title: els.title.value.trim() || (mode === 'draft' ? '未命名草稿' : ''),
      excerpt: els.excerpt.value.trim(),
      content: serialize(),
      images: uploadedImages(),
      coverImage: state.cover && uploadedImages().includes(state.cover) ? state.cover : null,
      platform: 'YouTube',
      project: state.project || '未分类',
      skill: state.skill || '未分类',
      accessType,
      pricePoints: accessType === 'paid' ? state.pricePoints : 0,
      memberPlanIds: accessType === 'member' ? state.planIds : []
    };
  }
  function showFieldError(target, message) {
    toast(message, 'error');
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (target?.focus) setTimeout(() => target.focus({ preventScroll: true }), 300);
  }
  function validate(mode) {
    if (uploading()) { toast('图片还在上传，请稍候', 'error'); return false; }
    if (imageBlocks().some(block => block.status === 'error')) { showFieldError(els.blocks.querySelector('.block-image.is-error'), '有图片上传失败，请重试或删除'); return false; }
    if (mode === 'draft') {
      if (!els.title.value.trim() && !serialize().trim()) { showFieldError(els.title, '先写点内容再保存草稿'); return false; }
      return true;
    }
    const title = els.title.value.trim();
    if (title.length < 5) { showFieldError(els.title, title ? '标题至少 5 个字' : '请填写标题'); return false; }
    if (bodyText().length < 30 && !uploadedImages().length) { showFieldError(els.blocks.querySelector('textarea'), '正文至少写 30 字，或添加图片'); return false; }
    if (state.accessType === 'paid' && !(Number.isInteger(state.pricePoints) && state.pricePoints >= 1)) {
      const error = document.querySelector('#priceError'); error.textContent = `请设置解锁价格（至少 1 ${unitName}）`; error.hidden = false;
      showFieldError(els.price, '请设置解锁价格'); return false;
    }
    return true;
  }
  async function save(mode) {
    if (state.saving) return;
    if (!session.loggedIn()) { App.goLogin(); return; }
    if (!validate(mode)) return;
    if (mode === 'draft' && state.status === 'pending' && !(await App.confirm({ title: '存为草稿', message: '这篇内容正在审核，存为草稿会把它撤出审核队列。确定吗？', confirmText: '存为草稿' }))) return;
    if (mode === 'pending') {
      const ok = await App.confirm({ title: '提交审核', message: state.accessType === 'free' ? '提交后进入审核，通过后会公开在发现页。审核期间仍可修改。' : `提交后进入审核，通过后读者需要${state.accessType === 'paid' ? `用 ${num(state.pricePoints)} ${unitName}解锁` : '开通会员'}才能阅读全文。`, confirmText: '确认提交' });
      if (!ok) return;
    }
    state.saving = true;
    const buttons = document.querySelectorAll(`[data-cmd="${mode === 'draft' ? 'draft' : 'submit'}"]`);
    buttons.forEach(button => button.classList.add('is-loading'));
    setSaveState('', mode === 'draft' ? '正在保存…' : '正在提交…');
    try {
      const body = payload(mode);
      let result;
      if (postId) result = await api(`/api/v1/posts/${encodeURIComponent(postId)}`, { method: 'PATCH', body: { ...body, status: mode } });
      else result = await api('/api/v1/posts', { method: 'POST', body: mode === 'draft' ? { ...body, draft: true } : body });
      const wasNew = !postId;
      if (result.id) postId = String(result.id);
      state.dirty = false;
      state.status = mode;
      if (mode === 'draft') {
        if (wasNew) { try { localStorage.removeItem('iyesh:draft:new'); } catch {} const url = new URL(location.href); url.searchParams.set('id', postId); history.replaceState(null, '', url); }
        try { localStorage.setItem(storageKey(), JSON.stringify({ ...snapshot(), synced: true })); } catch {}
        setSaveState('saved', `草稿已保存 ${new Date().toTimeString().slice(0, 5)}`);
        document.querySelector('#pageTitle').textContent = '编辑草稿';
        toast('草稿已保存，可在「我的 › 投稿」继续编辑', 'success');
      } else {
        clearLocal();
        showDone(result.title || body.title);
      }
    } catch (error) {
      if (error.status === 401) { toast('登录已过期，内容已暂存在本机，请重新登录', 'error'); setTimeout(() => App.goLogin(), 900); return; }
      setSaveState('dirty', '保存失败，内容已暂存在本机');
      toast(error.message, 'error');
    } finally {
      state.saving = false;
      buttons.forEach(button => button.classList.remove('is-loading'));
    }
  }
  function showDone(title) {
    els.layout.hidden = true; els.bar.hidden = true; els.notices.innerHTML = '';
    document.querySelector('.publish-top .actions').hidden = true;
    document.querySelector('#pageTitle').textContent = '发布内容';
    setSaveState('saved', '已提交');
    els.notices.innerHTML = `<section class="sheet publish-done"><span class="seal">${icon('check')}</span><h2>已提交审核</h2><p>《${escapeHtml(title)}》正在审核，通过后会出现在发现页，结果会通过站内信通知你。</p><div class="actions"><a class="btn btn--primary" href="profile.html?tab=posts">查看我的投稿</a><a class="btn" href="publish.html">再写一篇</a></div></section>`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function preview() {
    const resolve = url => { const block = imageBlocks().find(item => item.url === url); return block?.preview || App.mediaUrl(url); };
    const pending = imageBlocks().filter(block => !block.url && block.preview).map(block => `<figure><img src="${escapeHtml(block.preview)}" alt=""></figure>`).join('');
    const body = `<article class="preview-sheet"><h1>${escapeHtml(els.title.value.trim() || '未填写标题')}</h1>${els.excerpt.value.trim() ? `<p class="article-excerpt">${escapeHtml(els.excerpt.value.trim())}</p>` : ''}<div class="prose">${App.renderContent(serialize(), { resolve }) || '<p class="hint">正文还是空的。</p>'}${pending}</div></article>`;
    App.modal({ title: '预览', body, wide: true, actions: [{ label: '继续编辑', value: null }] });
  }

  /* ---------------- events ---------------- */
  els.title.addEventListener('input', markDirty);
  els.excerpt.addEventListener('input', markDirty);
  App.autoGrow(els.title); App.autoGrow(els.excerpt);
  els.title.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); els.excerpt.focus(); } });
  els.excerpt.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); els.blocks.querySelector('textarea')?.focus(); } });

  const rememberCaret = event => {
    const area = event.target.closest?.('#blocks textarea');
    if (area) lastText = { id: area.closest('[data-block]').dataset.block, start: area.selectionStart, end: area.selectionEnd };
  };
  ['focusin', 'keyup', 'click', 'select', 'input'].forEach(type => els.blocks.addEventListener(type, rememberCaret));
  els.blocks.addEventListener('input', event => {
    const area = event.target.closest('textarea');
    if (area) { const block = state.blocks.find(item => item.id === area.closest('[data-block]').dataset.block); if (block) block.text = area.value; markDirty(); return; }
    const caption = event.target.closest('.caption');
    if (caption) { const block = state.blocks.find(item => item.id === caption.closest('[data-block]').dataset.block); if (block) block.caption = caption.value; markDirty(); }
  });
  els.blocks.addEventListener('keydown', event => {
    const area = event.target.closest('textarea');
    if (!area || event.key !== 'Backspace' || area.selectionStart !== 0 || area.selectionEnd !== 0) return;
    // Backspace at the very start of an empty paragraph removes it.
    const id = area.closest('[data-block]').dataset.block;
    const index = state.blocks.findIndex(block => block.id === id);
    const texts = state.blocks.filter(block => block.type === 'text');
    if (area.value || texts.length <= 1 || index <= 0) return;
    event.preventDefault();
    state.blocks.splice(index, 1);
    state.blocks = normalizeBlocks(state.blocks);
    const previous = [...state.blocks.slice(0, index)].reverse().find(block => block.type === 'text');
    renderBlocks(previous?.id);
    markDirty();
  });
  els.blocks.addEventListener('paste', event => {
    const files = [...(event.clipboardData?.files || [])].filter(file => file.type.startsWith('image/'));
    if (!files.length) return;
    event.preventDefault();
    rememberCaret(event);
    insertImageBlocks(files);
  });
  els.blocks.addEventListener('click', async event => {
    const button = event.target.closest('[data-img]');
    if (!button) return;
    const block = state.blocks.find(item => item.id === button.closest('[data-block]').dataset.block);
    if (!block) return;
    const action = button.dataset.img;
    if (action === 'remove') {
      if (block.status === 'done' && !(await App.confirm({ title: '删除图片', message: '确定从正文里删除这张图片吗？', confirmText: '删除', danger: true }))) return;
      if (state.cover === block.url) state.cover = '';
      state.blocks.splice(state.blocks.indexOf(block), 1);
      state.blocks = normalizeBlocks(state.blocks);
      renderBlocks(); markDirty();
    }
    if (action === 'up') moveImage(block, -1);
    if (action === 'down') moveImage(block, 1);
    if (action === 'cover') { state.cover = state.cover === block.url ? '' : block.url; renderBlocks(); markDirty(); toast(state.cover ? '已设为封面' : '已取消封面'); }
    if (action === 'retry' && block.file) uploadQueue([block]);
  });
  ['dragover', 'drop'].forEach(type => document.querySelector('.editor').addEventListener(type, event => {
    if (!event.dataTransfer || ![...event.dataTransfer.types].includes('Files')) return;
    event.preventDefault();
    if (type === 'drop') insertImageBlocks(event.dataTransfer.files);
  }));
  els.file.addEventListener('change', () => { if (els.file.files?.length) insertImageBlocks(els.file.files); els.file.value = ''; });
  document.querySelector('.editor-toolbar').addEventListener('mousedown', event => { if (event.target.closest('[data-format]')) event.preventDefault(); });
  document.querySelector('.editor-toolbar').addEventListener('click', event => { const button = event.target.closest('[data-format]'); if (button) applyFormat(button.dataset.format); });

  document.addEventListener('click', event => {
    const cmd = event.target.closest('[data-cmd]')?.dataset.cmd;
    if (!cmd) return;
    if (cmd === 'image') { if (imageBlocks().length >= MAX_IMAGES) { toast(`最多插入 ${MAX_IMAGES} 张图片`, 'error'); return; } els.file.click(); }
    if (cmd === 'add-text') {
      const last = state.blocks[state.blocks.length - 1];
      if (last.type === 'text' && !last.text.trim()) { renderBlocks(last.id); return; }
      const block = { id: nextId(), type: 'text', text: '' };
      state.blocks.push(block); renderBlocks(block.id);
    }
    if (cmd === 'draft') save('draft');
    if (cmd === 'submit') save('pending');
    if (cmd === 'preview') preview();
  });

  document.querySelector('.settings').addEventListener('click', event => {
    const project = event.target.closest('[data-project]');
    if (project) { state.project = project.dataset.project; renderSettings(); markDirty(); return; }
    const skill = event.target.closest('[data-skill]');
    if (skill) { state.skill = skill.dataset.skill; renderSettings(); markDirty(); return; }
    const plan = event.target.closest('[data-plan]');
    if (plan) { const id = plan.dataset.plan; state.planIds = state.planIds.includes(id) ? state.planIds.filter(item => item !== id) : [...state.planIds, id]; renderSettings(); markDirty(); return; }
    const price = event.target.closest('[data-price]');
    if (price) { state.pricePoints = Number(price.dataset.price); els.price.value = ''; document.querySelector('#priceError').hidden = true; renderSettings(); markDirty(); }
  });
  document.querySelectorAll('input[name="accessType"]').forEach(input => input.addEventListener('change', () => { state.accessType = input.value; if (input.value === 'paid' && !state.pricePoints) state.pricePoints = 100; renderSettings(); markDirty(); }));
  els.price.addEventListener('input', () => {
    const value = Number(els.price.value);
    state.pricePoints = Number.isInteger(value) && value > 0 ? Math.min(value, 1000000) : 0;
    document.querySelector('#priceError').hidden = true;
    document.querySelectorAll('[data-price]').forEach(chip => chip.setAttribute('aria-pressed', String(Number(chip.dataset.price) === state.pricePoints)));
    renderChecklist(); markDirty();
  });

  document.querySelector('#exitBtn').addEventListener('click', async event => {
    event.preventDefault();
    if (state.dirty && !(await App.confirm({ title: '离开编辑', message: '内容已暂存在本机，下次打开发布页可以恢复。确定离开吗？', confirmText: '离开' }))) return;
    let sameOrigin = false;
    try { sameOrigin = document.referrer && new URL(document.referrer).origin === location.origin && !/login\.html/.test(document.referrer); } catch {}
    if (sameOrigin && history.length > 1) history.back(); else location.href = postId ? 'profile.html?tab=posts' : 'index.html';
  });
  window.addEventListener('beforeunload', event => { if (uploading() || (state.dirty && state.saving)) { event.preventDefault(); event.returnValue = ''; } });

  /* ---------------- boot ---------------- */
  function notice(html, type = '') { els.notices.insertAdjacentHTML('beforeend', `<div class="inline-alert${type ? ` inline-alert--${type}` : ''} restore-banner">${html}</div>`); }
  function offerRestore(local, server) {
    if (!local || local.synced) return;
    if (server && local.title === (server.title || '') && local.content === (server.content || '') && local.excerpt === (server.excerpt || '')) return;
    const localTime = Number(local.savedAt || 0);
    const serverTime = server ? new Date(server.updatedAt || server.submittedAt || 0).getTime() : 0;
    if (server && localTime <= serverTime + 2000) return;
    const content = `${local.title || ''}${local.content || ''}`.trim();
    if (!content) return;
    notice(`${icon('clock')}<span>本机有一份 ${escapeHtml(App.relativeTime(localTime))} 的未提交内容${local.title ? `《${escapeHtml(local.title.slice(0, 20))}》` : ''}。</span><button class="btn btn--sm" type="button" id="restoreLocal">恢复</button><button class="text-btn is-muted" type="button" id="dropLocal">丢弃</button>`);
    document.querySelector('#restoreLocal').addEventListener('click', event => { applySnapshot(local); state.dirty = true; setSaveState('dirty', '已恢复本机内容，记得保存'); event.target.closest('.inline-alert').remove(); });
    document.querySelector('#dropLocal').addEventListener('click', event => { try { localStorage.removeItem(storageKey()); } catch {} event.target.closest('.inline-alert').remove(); });
  }
  async function boot() {
    if (!session.loggedIn()) {
      els.gate.hidden = false;
      document.querySelector('#gateLogin').href = App.loginUrl();
      document.querySelector('.publish-top .actions').hidden = true;
      els.saveState.hidden = true;
      return;
    }
    els.layout.hidden = false;
    els.bar.hidden = false;
    state.blocks = normalizeBlocks([]);
    renderBlocks();
    const [tagResult, planResult, configResult] = await Promise.allSettled([
      Promise.all([api('/api/v1/tags?dimension=project', { auth: false }), api('/api/v1/tags?dimension=skill', { auth: false })]),
      api('/api/v1/member/plans', { auth: false }),
      api('/api/v1/points/config', { auth: false })
    ]);
    if (tagResult.status === 'fulfilled') tags = { project: (tagResult.value[0].items || []).map(item => item.name), skill: (tagResult.value[1].items || []).map(item => item.name) };
    if (planResult.status === 'fulfilled') plans = (planResult.value.items || []).filter(plan => plan && plan.id);
    if (configResult.status === 'fulfilled') unitName = configResult.value.unitName || unitName;
    renderSettings();

    let server = null;
    if (postId) {
      try {
        server = await api(`/api/v1/me/posts/${encodeURIComponent(postId)}`);
        if (['published', 'archived'].includes(server.status)) {
          els.layout.hidden = true; els.bar.hidden = true; document.querySelector('.publish-top .actions').hidden = true;
          notice(`${icon('alert')}<span>${server.status === 'published' ? '这篇内容已发布，发布后的修改请联系管理员。' : '这篇内容已下线，不能再编辑。'}</span><a class="btn btn--sm" href="${server.status === 'published' ? `detail.html?id=${encodeURIComponent(postId)}` : 'profile.html?tab=posts'}">${server.status === 'published' ? '查看内容' : '返回投稿'}</a>`, 'info');
          return;
        }
        applySnapshot({ ...server, planIds: server.memberPlanIds, cover: server.coverImage, project: server.project === '未分类' ? '' : server.project, skill: server.skill === '未分类' ? '' : server.skill });
        state.status = server.status;
        document.querySelector('#pageTitle').textContent = server.status === 'draft' ? '编辑草稿' : '修改投稿';
        setSaveState('saved', server.status === 'pending' ? '审核中，可继续修改' : server.status === 'rejected' ? '未通过审核' : '草稿已同步');
        if (server.status === 'rejected') notice(`${icon('alert')}<span><strong>未通过审核：</strong>${escapeHtml(server.rejectionReason || '内容需要调整')}。修改后可以重新提交。</span>`, 'error');
        if (server.status === 'pending') notice(`${icon('clock')}<span>这篇内容正在审核。修改后点「提交审核」会重新排队。</span>`, 'info');
      } catch (error) {
        notice(`${icon('alert')}<span>${escapeHtml(error.status === 404 ? '没有找到这篇投稿，已为你打开一篇新内容。' : error.message)}</span>`, 'error');
        postId = '';
        history.replaceState(null, '', location.pathname);
      }
    }
    offerRestore(readLocal(), server);
    state.dirty = false;
    updateStats();
    if (!postId && !els.title.value) setTimeout(() => { if (!window.matchMedia('(pointer: coarse)').matches) els.title.focus(); }, 100);
  }
  boot();
})();
