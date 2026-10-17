const API = window.CONTENT_API_BASE || 'http://127.0.0.1:8787';
const form = document.querySelector('#publishForm');
const message = document.querySelector('#publishMessage');
const submissionCard = document.querySelector('#submissionCard');
const submissionText = document.querySelector('#submissionText');
const saveDraftButton = document.querySelector('#saveDraftBtn');
let postId = new URLSearchParams(location.search).get('id');
const draftStatus = document.querySelector('#draftStatus');
const qualityScore = document.querySelector('#qualityScore');
const qualityBar = document.querySelector('#qualityBar');
const bodyImageInput = document.querySelector('#bodyImageInput');
const bodyInlineUpload = document.querySelector('#bodyInlineUpload');
const bodyImageList = document.querySelector('#bodyImageList');
const bodyPreview = document.querySelector('#bodyPreview');
const bodyPreviewContent = document.querySelector('#bodyPreviewContent');
const uploadMessage = document.querySelector('#uploadMessage');
const mediaCount = document.querySelector('#mediaCount');
const memberPlanField = document.querySelector('#memberPlanField');
const memberPlanOptions = document.querySelector('#memberPlanOptions');
const memberPlanHint = document.querySelector('#memberPlanHint');
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_BODY_IMAGES = 8;
const REQUEST_TIMEOUT_MS = 12000;
let bodyImages = [];
let memberPlans = [];
let selectedMemberPlanIds = [];
let saving = false;
let uploadsInFlight = 0;
const publishViewport = { locked: false, scrollY: 0 };
const isPublishControl = target => target instanceof HTMLElement && Boolean(target.closest('#publishForm')) && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName);
const isPublishTextField = target => {
  if (!isPublishControl(target)) return false;
  if (target.tagName === 'TEXTAREA') return true;
  if (target.tagName !== 'INPUT') return false;
  return !['file', 'checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'date', 'datetime-local', 'month', 'week', 'time'].includes(String(target.type || 'text').toLowerCase());
};
function lockPublishViewport() {
  if (publishViewport.locked || !window.matchMedia('(max-width: 760px)').matches) return;
  publishViewport.scrollY = window.scrollY;
  document.documentElement.classList.add('publish-input-locked');
  document.body.classList.add('publish-input-locked');
  document.body.style.top = `-${publishViewport.scrollY}px`;
  publishViewport.locked = true;
}
function unlockPublishViewport() {
  if (!publishViewport.locked) return;
  const scrollY = publishViewport.scrollY;
  document.documentElement.classList.remove('publish-input-locked');
  document.body.classList.remove('publish-input-locked');
  document.body.style.removeProperty('top');
  window.scrollTo(0, scrollY);
  publishViewport.locked = false;
}
function isAllowedLockedTouch(target) {
  return target instanceof Element && Boolean(target.closest('input,select,textarea,button,a,label'));
}
/* A touch that starts on the page (rather than a form control) would blur the
   field before the browser starts the drag. Cancel that gesture while the
   keyboard is open; buttons, links and other fields keep their normal action. */
document.addEventListener('touchstart', event => {
  if (publishViewport.locked && !isAllowedLockedTouch(event.target)) event.preventDefault();
}, { capture: true, passive: false });
document.addEventListener('touchmove', event => {
  if (publishViewport.locked && !isAllowedLockedTouch(event.target)) event.preventDefault();
}, { capture: true, passive: false });
document.addEventListener('focusin', event => {
  if (!isPublishTextField(event.target)) return;
  /* Mobile Safari/WeChat adjusts scrollY after focus; lock on the next frame
     so the captured offset includes that automatic keyboard adjustment. */
  requestAnimationFrame(() => requestAnimationFrame(lockPublishViewport));
});
document.addEventListener('focusout', event => {
  if (!isPublishTextField(event.target)) return;
  setTimeout(() => { if (!isPublishTextField(document.activeElement)) unlockPublishViewport(); }, 0);
});
window.addEventListener('pagehide', unlockPublishViewport);
window.addEventListener('resize', () => {
  if (!window.matchMedia('(max-width: 760px)').matches) unlockPublishViewport();
});
window.addEventListener('pageshow', () => {
  if (!window.matchMedia('(max-width: 760px)').matches) unlockPublishViewport();
});
/* Keep the document as the scroll surface. Textareas may scroll while they
   have room; once they reach either end, pass the wheel gesture to the page.
   Explicitly forwarding wheel events also avoids clipped preview cards
   swallowing desktop wheel input. */
document.addEventListener('wheel', event => {
  const target = event.target;
  if (!(target instanceof Element) || !target.closest('.publish-page') || event.ctrlKey || !event.deltaY) return;
  if (target instanceof HTMLTextAreaElement && target.closest('#publishForm')) {
    const atTop = target.scrollTop <= 0;
    const atBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 1;
    const movingUp = event.deltaY < 0;
    const movingDown = event.deltaY > 0;
    if (!(movingUp && atTop) && !(movingDown && atBottom) && target.scrollHeight > target.clientHeight) return;
  }
  window.scrollBy(0, event.deltaY);
  event.preventDefault();
}, { passive: false });
const authHeaders = () => { const token = localStorage.getItem('accessToken'); return token ? { Authorization: `Bearer ${token}` } : {}; };
try {
  const currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
  const avatar = document.querySelector('.top-actions .avatar');
  if (avatar && currentUser) { avatar.textContent = String(currentUser.name || currentUser.nickname || '林').slice(0, 1); avatar.title = currentUser.name || currentUser.nickname || '个人中心'; }
} catch {}
function showMessage(text, error = false) { message.textContent = text; message.classList.toggle('error', error); }
function updateQuality() {
  const values = Object.fromEntries(new FormData(form));
  for (const counter of document.querySelectorAll('[data-count-for]')) { const field = counter.dataset.countFor; const limit = form.elements[field]?.maxLength || 0; counter.textContent = `${String(values[field] || '').length} / ${limit}`; }
  const checks = { title: String(values.title || '').trim().length >= 8, platform: true, excerpt: String(values.excerpt || '').trim().length >= 20, content: String(values.content || '').trim().length >= 80 };
  const complete = Object.values(checks).filter(Boolean).length;
  if (qualityScore) qualityScore.textContent = `${complete * 25}%`;
  if (qualityBar) qualityBar.style.width = `${complete * 25}%`;
  for (const [name, done] of Object.entries(checks)) { const item = document.querySelector(`[data-quality="${name}"]`); if (item) { item.classList.toggle('is-done', done); item.querySelector('span').textContent = done ? '✓' : '○'; } }
}
function markUnsaved() { if (draftStatus) { draftStatus.textContent = '有未保存修改'; draftStatus.className = 'draft-status is-editing'; } updateQuality(); renderBodyPreview(); }
function updatePriceField() {
  const input = form.elements.pricePoints;
  const label = input?.closest('label');
  const accessType = form.elements.accessType?.value;
  const enabled = accessType === 'paid';
  if (input) input.disabled = !enabled;
  if (label) label.classList.toggle('is-disabled', !enabled);
  if (memberPlanField) memberPlanField.hidden = accessType !== 'member';
}
function renderMemberPlans(selectedIds = selectedMemberPlanIds) {
  if (!memberPlanOptions) return;
  const selected = new Set((selectedIds || []).map(String));
  selectedMemberPlanIds = [...selected];
  memberPlanOptions.replaceChildren();
  if (!memberPlans.length) {
    if (memberPlanHint) memberPlanHint.textContent = '暂未配置会员等级';
    return;
  }
  if (memberPlanHint) memberPlanHint.textContent = '不选择表示所有会员';
  for (const plan of memberPlans) {
    const label = document.createElement('label');
    label.className = 'plan-option';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = 'memberPlanIds';
    input.value = String(plan.id);
    input.checked = selected.has(String(plan.id));
    label.classList.toggle('is-selected', input.checked);
    const text = document.createElement('span');
    text.textContent = plan.groupName || plan.name || plan.title || '会员等级';
    label.append(input, text);
    memberPlanOptions.append(label);
  }
}
async function loadMemberPlans() {
  if (!memberPlanOptions) return;
  try {
    const response = await fetchWithTimeout(`${API}/api/v1/member/plans`);
    const body = await response.json().catch(() => ({}));
    if (response.ok && Array.isArray(body.items)) {
      memberPlans = body.items.filter(item => item && item.id);
      renderMemberPlans(selectedMemberPlanIds);
    }
  } catch {}
}
function setUploadMessage(text, state = '') { if (uploadMessage) { uploadMessage.textContent = text; uploadMessage.className = `upload-message${state ? ` is-${state}` : ''}`; } }
function uploadErrorMessage(error) {
  const text = String(error?.message || '').trim();
  if (/load failed|failed to fetch|networkerror|network request failed|fetch failed/i.test(text)) {
    const local = ['localhost', '127.0.0.1'].includes(location.hostname);
    return local ? '本地图片服务未启动，请先启动 API（8787）' : '网络连接失败，请检查网络后重试';
  }
  return text || '图片上传失败，请稍后重试';
}
function mediaUrl(url) { return /^https?:\/\//i.test(url) ? url : `${API}${url.startsWith('/') ? '' : '/'}${url}`; }
function normalizeMedia(value) { if (!value) return null; if (typeof value === 'string') return { url: value, name: '' }; return value.url ? { url: value.url, name: value.name || '' } : null; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
function renderBodyPreview() {
  if (!bodyPreview || !bodyPreviewContent) return;
  const text = String(form.elements.content?.value || '').trim();
  const paragraphs = text
    ? text.split(/\n{2,}/).filter(Boolean).map(paragraph => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`).join('')
    : '';
  const images = bodyImages.map((image, index) => {
    const src = image.previewUrl || (image.url ? mediaUrl(image.url) : '');
    if (!src) return '';
    return `<figure class="body-preview-image${image.uploading ? ' is-uploading' : ''}"><img src="${escapeHtml(src)}" alt="正文配图 ${index + 1}">${image.uploading ? '<figcaption>上传中…</figcaption>' : ''}</figure>`;
  }).join('');
  bodyPreviewContent.innerHTML = `${paragraphs}${images}`;
  bodyPreview.hidden = !paragraphs && !images;
}
async function fetchWithTimeout(url, options = {}, timeout = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  catch (error) { if (error.name === 'AbortError') throw new Error('服务响应较慢，请稍后重试'); throw error; }
  finally { clearTimeout(timer); }
}
function renderMedia() {
  if (mediaCount) mediaCount.textContent = `${bodyImages.length} / ${MAX_BODY_IMAGES} 张 · 单张不超过 5MB`;
  if (bodyImageList) bodyImageList.innerHTML = bodyImages.map((image, index) => {
    const src = image.previewUrl || (image.url ? mediaUrl(image.url) : '');
    return `<div class="media-thumb${image.uploading ? ' is-uploading' : ''}">${src ? `<img src="${src}" alt="正文配图 ${index + 1}">` : '<span class="media-thumb-empty">图片处理中</span>'}${image.uploading ? '<span class="media-upload-state">上传中…</span>' : ''}<button type="button" data-remove-image="${index}" aria-label="移除图片"${image.uploading ? ' disabled' : ''}>×</button></div>`;
  }).join('');
  renderBodyPreview();
}
function validateImageFile(file) {
  if (!file || !/^image\/(jpeg|png|webp|gif)$/i.test(file.type)) throw new Error('仅支持 JPG、PNG、WEBP 或 GIF 图片');
  if (file.size > MAX_IMAGE_BYTES) throw new Error('单张图片不能超过 5MB');
}
async function uploadImage(file) {
  validateImageFile(file);
  const formData = new FormData();
  formData.append('files', file);
  const response = await fetchWithTimeout(`${API}/api/v1/uploads`, { method: 'POST', headers: authHeaders(), body: formData });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) { location.href = `login.html?return=${encodeURIComponent(location.href)}`; throw new Error('请先登录后上传图片'); }
  if (!response.ok) throw new Error(body.message || '图片上传失败');
  const uploaded = body.items?.[0];
  if (!uploaded?.url) throw new Error('上传服务未返回图片地址');
  return { url: uploaded.url, name: file.name };
}
async function handleBodyUpload(event) {
  const files = [...(event.target.files || [])]; if (!files.length) return;
  if (bodyImages.length + files.length > MAX_BODY_IMAGES) { setUploadMessage(`正文配图最多 ${MAX_BODY_IMAGES} 张`, 'error'); event.target.value = ''; return; }
  uploadsInFlight += 1;
  try {
    for (const file of files) {
      validateImageFile(file);
      const previewUrl = URL.createObjectURL(file);
      const placeholder = { url: '', name: file.name, previewUrl, uploading: true };
      bodyImages.push(placeholder);
      const placeholderIndex = bodyImages.length - 1;
      renderMedia();
      setUploadMessage(`正在上传 ${file.name}…`);
      try {
        const uploaded = await uploadImage(file);
        bodyImages[placeholderIndex] = { ...uploaded, previewUrl };
        renderMedia();
      } catch (error) {
        bodyImages.splice(placeholderIndex, 1);
        renderMedia();
        throw error;
      }
    }
    markUnsaved(); setUploadMessage(`已上传 ${bodyImages.length} 张正文配图`, 'success');
  } catch (error) { setUploadMessage(uploadErrorMessage(error), 'error'); }
  finally { uploadsInFlight = Math.max(0, uploadsInFlight - 1); event.target.value = ''; }
}
function saveSubmission(post, input) {
  let items = [];
  try { items = JSON.parse(localStorage.getItem('contentSubmissions') || '[]'); } catch { items = []; }
  const user = (() => { try { return JSON.parse(localStorage.getItem('currentUser') || '{}'); } catch { return {}; } })();
  const record = { id: post.id || `local_${Date.now()}`, title: input.title, platform: input.platform, status: post.status || 'pending', submittedAt: post.submittedAt || new Date().toISOString(), userId: user.id || null };
  items = [record, ...(Array.isArray(items) ? items.filter(item => item.id !== record.id) : [])].slice(0, 30);
  localStorage.setItem('contentSubmissions', JSON.stringify(items));
  return record;
}
function fillForm(post) {
  for (const field of ['title', 'platform', 'excerpt', 'content', 'accessType', 'pricePoints']) if (form.elements[field]) form.elements[field].value = post[field] ?? '';
  if (form.elements.platform && post.platform && ![...form.elements.platform.options].some(option => option.value === String(post.platform))) {
    form.elements.platform.add(new Option(String(post.platform), String(post.platform)));
    form.elements.platform.value = String(post.platform);
  }
  if (form.elements.pricePoints) form.elements.pricePoints.value = Number(post.pricePoints ?? post.priceCents ?? 0);
  selectedMemberPlanIds = Array.isArray(post.memberPlanIds) ? post.memberPlanIds.map(String) : [];
  bodyImages = Array.isArray(post.images) ? post.images.map(normalizeMedia).filter(Boolean) : [];
  const heading = document.querySelector('.publish-heading h1');
  if (heading) heading.textContent = '编辑内容';
  if (draftStatus) { draftStatus.textContent = post.status === 'rejected' ? '需要修改' : '编辑中'; draftStatus.className = `draft-status ${post.status === 'rejected' ? 'is-editing' : ''}`; }
  showMessage(`正在编辑《${post.title}》`); updatePriceField(); renderMemberPlans(selectedMemberPlanIds); updateQuality(); renderMedia();
}
async function loadDraft() {
  if (!postId || !localStorage.getItem('accessToken')) return;
  try {
    const response = await fetchWithTimeout(`${API}/api/v1/me/posts/${encodeURIComponent(postId)}`, { headers: authHeaders() });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || '投稿不存在或已无权编辑');
    if (body.status === 'published' || body.status === 'archived') throw new Error('已发布或归档内容不能编辑');
    fillForm(body);
  } catch (error) { showMessage(error.message || '投稿加载失败', true); }
}
async function save(mode) {
  if (saving) return;
  if (uploadsInFlight > 0) return showMessage('图片仍在上传，请稍候再提交', true);
  const data = Object.fromEntries(new FormData(form));
  data.platform = 'YouTube';
  data.pricePoints = Number(data.pricePoints || 0);
  data.memberPlanIds = data.accessType === 'member'
    ? [...form.querySelectorAll('input[name="memberPlanIds"]:checked')].map(input => input.value)
    : [];
  if (data.accessType !== 'paid') data.pricePoints = 0;
  if (!data.title?.trim()) return showMessage('请先填写标题', true);
  if (data.accessType === 'paid' && (!Number.isInteger(data.pricePoints) || data.pricePoints < 1)) return showMessage('积分价格至少为 1', true);
  if (mode === 'pending' && (!data.excerpt && !data.content && !bodyImages.length)) return showMessage('提交审核前请填写摘要、正文或正文配图', true);
  saving = true;
  const isNewPost = !postId;
  const controls = [...form.querySelectorAll('button, input[type="file"]')];
  controls.forEach(control => { control.disabled = true; });
  showMessage(mode === 'draft' ? '正在保存草稿…' : '正在提交…');
  try {
    const method = postId ? 'PATCH' : 'POST';
    const path = postId ? `/api/v1/posts/${encodeURIComponent(postId)}` : '/api/v1/posts';
    const payload = postId ? { ...data, status: mode } : { ...data, ...(mode === 'draft' ? { draft: true } : {}) };
    payload.coverImage = null;
    payload.images = bodyImages.map(image => image.url);
    const response = await fetchWithTimeout(`${API}${path}`, { method, headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) { location.href = `login.html?return=${encodeURIComponent(location.href)}`; return; }
    if (!response.ok) throw new Error(body.message || '保存失败，请稍后重试');
    if (isNewPost && mode === 'draft' && body.id) {
      postId = String(body.id);
      const nextUrl = new URL(location.href);
      nextUrl.searchParams.set('id', postId);
      history.replaceState({}, '', nextUrl);
    }
    const record = saveSubmission(body, data);
    showMessage(mode === 'draft' ? '草稿已保存。' : '提交成功，内容已进入审核队列。');
    if (draftStatus) { draftStatus.textContent = mode === 'draft' ? '草稿已保存' : '已提交审核'; draftStatus.className = 'draft-status is-saved'; }
    submissionText.textContent = `《${record.title}》当前状态：${mode === 'draft' ? '草稿' : '待审核'}`;
    submissionCard.hidden = false;
    if (isNewPost) {
      form.reset();
      /* A fresh submission must not carry uploaded media from the previous
         one. The form reset does not clear these in-memory selections. */
      bodyImages = [];
      selectedMemberPlanIds = [];
      if (mode === 'pending') {
        const nextUrl = new URL(location.href);
        nextUrl.searchParams.delete('id');
        history.replaceState({}, '', nextUrl);
        postId = null;
      }
      renderMemberPlans([]);
      renderMedia();
    }
  } catch (error) { showMessage(error.message || '保存失败，请稍后重试', true); }
  finally { saving = false; controls.forEach(control => { control.disabled = false; }); updatePriceField(); }
}
form.addEventListener('submit', event => { event.preventDefault(); save('pending'); });
saveDraftButton?.addEventListener('click', () => save('draft'));
form.addEventListener('input', markUnsaved);
form.elements.accessType?.addEventListener('change', () => { updatePriceField(); markUnsaved(); });
memberPlanOptions?.addEventListener('change', event => {
  const input = event.target.closest('input[name="memberPlanIds"]');
  if (input) input.closest('.plan-option')?.classList.toggle('is-selected', input.checked);
  selectedMemberPlanIds = [...form.querySelectorAll('input[name="memberPlanIds"]:checked')].map(input => input.value);
  markUnsaved();
});
bodyImageInput?.addEventListener('change', handleBodyUpload);
bodyInlineUpload?.addEventListener('click', () => {
  if (!localStorage.getItem('accessToken')) {
    location.href = `login.html?return=${encodeURIComponent(location.href)}`;
    return;
  }
  bodyImageInput?.click();
});
bodyImageList?.addEventListener('click', event => { const button = event.target.closest('[data-remove-image]'); if (!button) return; bodyImages.splice(Number(button.dataset.removeImage), 1); renderMedia(); markUnsaved(); setUploadMessage('已移除图片'); });
updatePriceField(); updateQuality();
renderMedia();
loadMemberPlans();
loadDraft();
