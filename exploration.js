(function () {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const esc = App.escapeHtml;
  const compact = App.compact;
  const dateText = App.dateText;
  let sectorItems = [];
  let resultItems = [];
  let visibleSectorCount = 6;
  let visibleResultCount = 12;

  function metric(value, suffix = '') {
    if (value == null || value === '') return '—';
    return `${compact(value)}${suffix}`;
  }
  function renderLoading() {
    $('#summary').innerHTML = '<div class="explore-summary__loading"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div>';
    $('#sectors').innerHTML = '<div class="explore-empty"><span class="spinner" aria-hidden="true"></span><p>正在整理最新研究结果</p></div>';
    $('#results').innerHTML = '';
  }
  function empty(title, text) {
    return `<div class="explore-empty"><span class="explore-empty__mark" aria-hidden="true">—</span><strong>${esc(title)}</strong><p>${esc(text)}</p></div>`;
  }
  function renderSummary(data) {
    const summary = data.summary || {};
    const cards = [
      ['正在加速', metric(summary.accelerating_channels), '有连续增长信号的频道'],
      ['潜力赛道', metric(summary.potential_sectors), '出现多个成功样本的方向'],
      ['近 7 天新发现', metric(summary.new_channels_7d), '进入研究范围的新频道']
    ];
    $('#summary').innerHTML = cards.map(([label, value, hint], index) => `<article class="explore-stat${index === 0 ? ' explore-stat--accent' : ''}"><span>${esc(label)}</span><strong class="face">${esc(value)}</strong><small>${esc(hint)}</small></article>`).join('');
  }
  function renderSectors(data, reset = true) {
    if (reset) {
      sectorItems = Array.isArray(data.sectors) ? data.sectors : [];
      visibleSectorCount = Math.min(6, sectorItems.length || 6);
    }
    if (!sectorItems.length) { $('#sectors').innerHTML = empty('还没有可展示的赛道', '下一轮研究完成后，这里会出现新的方向信号。'); return; }
    const sectors = sectorItems.slice(0, visibleSectorCount);
    const cards = sectors.map((sector, index) => {
      const examples = Array.isArray(sector.examples) ? sector.examples.slice(0, 2) : [];
      return `<article class="explore-sector"><div class="explore-sector__top"><span class="explore-sector__index">${String(index + 1).padStart(2, '0')}</span><span class="tag tag--${sector.status === 'potential' ? 'paid' : 'info'}">${sector.status === 'potential' ? '潜力方向' : '持续增长'}</span></div><h3>${esc(sector.name)}</h3><div class="explore-sector__metrics"><span><strong class="num">${esc(metric(sector.growingChannelCount))}</strong> 个增长样本</span><span><strong class="num">${esc(metric(sector.channelCount))}</strong> 个频道</span></div>${examples.length ? `<div class="explore-sector__examples">${examples.map(example => `<span title="${esc(example.title)}">${esc(example.title || '频道样本')}</span>`).join('')}</div>` : ''}</article>`;
    }).join('');
    const more = sectorItems.length > visibleSectorCount ? `<div class="explore-more"><button class="btn" type="button" id="showMoreSectors">查看更多赛道（剩余 ${sectorItems.length - visibleSectorCount} 个）</button></div>` : '';
    $('#sectors').innerHTML = cards + more;
    document.querySelector('#showMoreSectors')?.addEventListener('click', () => {
      visibleSectorCount = sectorItems.length;
      renderSectors({ sectors: sectorItems }, false);
    });
  }
  function renderResults(data, reset = true) {
    if (reset) {
      resultItems = Array.isArray(data.items) ? data.items : [];
      visibleResultCount = Math.min(12, resultItems.length || 12);
    }
    if (!resultItems.length) { $('#results').innerHTML = empty('暂时没有成功样本', '研究系统会在下一轮同步后补充新的频道与视频。'); return; }
    const items = resultItems.slice(0, visibleResultCount);
    const cards = items.map(item => {
      const video = item.video || {};
      const href = video.url || item.channelUrl || '#';
      const growth = item.growthLabel || (item.growthStatus === 'accelerating' ? '正在加速' : '成功样本');
      const thumb = video.thumbnailUrl ? `<img src="${esc(video.thumbnailUrl)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : '<span class="explore-result__thumb-empty" aria-hidden="true">YT</span>';
      return `<article class="explore-result"><a class="explore-result__thumb" href="${esc(href)}" target="_blank" rel="noopener" aria-label="打开 ${esc(video.title || item.title || 'YouTube 样本')}">${thumb}</a><div class="explore-result__body"><div class="explore-result__meta"><span class="tag tag--ok">${esc(growth)}</span><span>${esc(item.sectorName || '其他赛道')}</span></div><h3><a href="${esc(href)}" target="_blank" rel="noopener">${esc(video.title || item.title || '未命名样本')}</a></h3><p class="explore-result__channel">${esc(item.title || '未知频道')} · ${metric(item.subscriberCount)} 订阅</p><div class="explore-result__foot"><span>播放 ${metric(video.viewCount)}</span><span>时速 ${metric(item.observedGrowth?.viewsPerHour)}</span></div></div></article>`;
    }).join('');
    const more = resultItems.length > visibleResultCount ? `<div class="explore-more"><button class="btn" type="button" id="showMoreResults">查看更多样本（剩余 ${resultItems.length - visibleResultCount} 个）</button></div>` : '';
    $('#results').innerHTML = cards + more;
    document.querySelector('#showMoreResults')?.addEventListener('click', () => {
      visibleResultCount = Math.min(resultItems.length, visibleResultCount + 12);
      renderResults({ items: resultItems }, false);
    });
  }
  function renderMeta(data) {
    const syncedAt = data.syncedAt ? dateText(data.syncedAt, true) : '';
    const generatedAt = data.sourceGeneratedAt ? dateText(data.sourceGeneratedAt, true) : '';
    const syncHours = Number(data.syncIntervalHours) > 0 ? Number(data.syncIntervalHours) : 4;
    const syncLabel = document.querySelector('[data-sync-interval]');
    if (syncLabel) syncLabel.textContent = `每 ${syncHours} 小时同步一次`;
    $('#syncLabel').textContent = syncedAt ? `最近同步 ${syncedAt}` : (data.status === 'pending' ? '等待首次同步' : '尚未同步');
    $('#sectorUpdated').textContent = generatedAt ? `研究台 ${generatedAt}` : '';
    $('#resultUpdated').textContent = data.sourceRun?.id ? `第 ${data.sourceRun.id} 轮研究` : '';
    $('#footnote').textContent = syncedAt ? `本站缓存于 ${syncedAt} 更新。同步周期 ${syncHours} 小时；外部数据暂时不可用时保留上一次成功结果。` : '数据正在准备中，完成首轮同步后会自动显示。';
  }
  async function load() {
    renderLoading();
    try {
      const data = await App.api('/api/v1/track-discovery', { auth: false, timeout: 16000 });
      renderSummary(data); renderSectors(data); renderResults(data); renderMeta(data);
    } catch (error) {
      $('#summary').innerHTML = '';
      $('#sectors').innerHTML = empty('暂时无法读取研究结果', App.friendlyNetworkError(error));
      $('#results').innerHTML = '';
      $('#syncLabel').textContent = '读取失败';
      $('#footnote').textContent = '请稍后刷新页面重试。';
    }
  }
  load();
})();
