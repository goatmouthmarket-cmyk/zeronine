/* The replay is a recording of the actual pasture canvas, never a reconstruction. */
(() => {
  'use strict';
  if (window.__brainRecordedReplayUI) return;
  window.__brainRecordedReplayUI = true;
  let revision = 0, url = '', account = null;
  const $ = id => document.getElementById(id);
  const line = (tag, className, value) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value;
    return node;
  };
  function clearVideo() {
    const video = $('brainRecordedVideo');
    if (video) { video.onerror = null; video.pause(); video.removeAttribute('src'); video.load(); }
    if (url) URL.revokeObjectURL(url);
    url = '';
    const viewer = $('brainRecordedViewer');
    if (viewer) viewer.hidden = true;
  }
  function box() {
    const pane = $('brainPaneMemory');
    if (!pane) return null;
    let root = $('brainReplayBox');
    if (root?.dataset.recordedReplay === 'true') return root;
    const replacement = document.createElement('section');
    replacement.id = 'brainReplayBox';
    replacement.className = 'brain-memory-card brain-recorded-replays';
    replacement.dataset.recordedReplay = 'true';
    replacement.setAttribute('aria-label', 'Recorded pasture plays');
    replacement.append(line('h3', '', 'Recorded plays'));
    replacement.append(line('p', 'brain-recorded-description', 'New signed-in plays can be recorded on this device. Keep the game open through settlement; interrupted plays may not appear. Earlier plays without recordings cannot be replayed.'));
    replacement.append(line('p', 'brain-recorded-description', 'Up to 12 recordings per account are kept on this device; older recordings are removed automatically. Recording requires browser and storage support.'));
    replacement.append(line('p', 'brain-recorded-description', 'Footage captures the game canvas; interface overlays are not recorded. Results appear separately when available. Clips are limited to 120 seconds or approximately 10 MB and may be partial.'));
    const state = line('p', 'brain-recorded-state', 'Checking recordings…');
    state.id = 'brainRecordedState';
    state.setAttribute('role', 'status');
    replacement.append(state);
    const list = document.createElement('div');
    list.id = 'brainRecordedList';
    list.className = 'brain-recorded-list';
    replacement.append(list);
    const viewer = document.createElement('div');
    viewer.id = 'brainRecordedViewer';
    viewer.className = 'brain-recorded-viewer';
    viewer.hidden = true;
    const caption = line('p', 'brain-recorded-caption', '');
    caption.id = 'brainRecordedCaption';
    const video = document.createElement('video');
    video.id = 'brainRecordedVideo';
    video.controls = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.setAttribute('aria-label', 'Recorded pasture play');
    viewer.append(caption, video);
    replacement.append(viewer);
    if (root) root.replaceWith(replacement);
    else {
      const scene = pane.querySelector('.brain-card-scene');
      pane.insertBefore(replacement, scene ? scene.nextSibling : pane.firstChild);
    }
    return replacement;
  }
  function when(value) {
    const n = Number(value), d = new Date(n);
    return Number.isFinite(n) && !Number.isNaN(d.getTime()) ? d.toLocaleString() : 'Time unavailable';
  }
  function label(row) {
    const mode = String(row.mode || row.accountMode || '').toLowerCase();
    const kind = mode === 'real' ? 'Real account' : mode === 'demo' ? 'Demo account' : mode === 'paper' || mode === 'guest' ? 'Paper practice' : 'Recorded play';
    const status = String(typeof row.outcome === 'object' ? row.outcome?.status || '' : row.outcome || row.status || '').toLowerCase();
    const result = status === 'won' ? 'Won' : status === 'lost' ? 'Lost' : status === 'rejected' ? 'Not placed' : status === 'open' || status === 'pending' ? 'Awaiting result' : 'Result unavailable';
    const details = [row.market, row.direction, row.barrier == null ? null : String(row.barrier)].filter(v => v != null && v !== '').join(' ');
    const settled = status === 'won' || status === 'lost';
    const amount = settled && typeof row.profit === 'number' && Number.isFinite(row.profit) && row.currency
      ? (row.profit >= 0 ? '+' : '') + row.profit.toFixed(2) + ' ' + String(row.currency) : '';
    const stake = settled && typeof row.stake === 'number' && Number.isFinite(row.stake) && row.currency
      ? 'Stake ' + row.stake.toFixed(2) + ' ' + String(row.currency) : '';
    return [kind, result, amount, stake, details, when(row.startedAt)].filter(Boolean).join(' · ');
  }
  async function play(row) {
    const ticket = ++revision;
    clearVideo();
    const state = $('brainRecordedState');
    try {
      const result = await window.__pastureReplay?.get(row.id);
      if (ticket !== revision) return;
      if (!(result?.video instanceof Blob) || !result.video.size) throw new Error('Recording unavailable');
      const viewer = $('brainRecordedViewer'), video = $('brainRecordedVideo'), caption = $('brainRecordedCaption');
      if (!viewer || !video || !caption) return;
      url = URL.createObjectURL(result.video);
      caption.textContent = label(result) + (result.partialReason ? ' · Partial recording: ' + String(result.partialReason) : '');
      video.onerror = () => {
        if (ticket !== revision) return;
        clearVideo();
        if (state) state.textContent = 'This browser could not play the recorded video.';
      };
      video.src = url;
      viewer.hidden = false;
      if (state) state.textContent = 'Recorded play ready. Playback does not place a trade.';
      await video.play().catch(() => {});
    } catch {
      if (ticket === revision && state) state.textContent = 'This recording is unavailable on this device.';
    }
  }
  async function refresh() {
    if (!box()) return;
    const list = $('brainRecordedList'), state = $('brainRecordedState');
    if (!list || !state) return;
    const ticket = ++revision;
    list.replaceChildren();
    if (!window.__pastureReplay || typeof window.__pastureReplay.list !== 'function' || (typeof window.__pastureReplay.supported === 'function' && !window.__pastureReplay.supported())) {
      clearVideo();
      state.textContent = 'Play recording is unavailable in this browser. Earlier plays were not recorded.';
      return;
    }
    try {
      const rows = await window.__pastureReplay.list();
      if (ticket !== revision) return;
      const issue = typeof window.__pastureReplay.status === 'function' ? String(window.__pastureReplay.status() || '') : '';
      if (!Array.isArray(rows) || !rows.length) {
        clearVideo();
        state.textContent = issue || (account?.startsWith('guest:') ? 'Sign in to record plays on this device. Earlier plays without a recording cannot be replayed.' : 'No recorded plays yet. Earlier plays without a recording cannot be replayed.');
        return;
      }
      state.textContent = issue ? 'Choose a recorded play. ' + issue : 'Choose a recorded play. Recordings are stored on this device.';
      for (const row of rows.slice(0, 20)) {
        if (!row || !row.id) continue;
        const button = line('button', 'brain-recorded-item', label(row));
        button.type = 'button';
        button.addEventListener('click', () => play(row));
        list.append(button);
      }
    } catch {
      if (ticket === revision) { clearVideo(); state.textContent = 'Recordings could not be loaded on this device.'; }
    }
  }
  function init() {
    box();
    $('brainTabMemory')?.addEventListener('click', refresh);
    const panel = $('rangerBrainPanel'), pane = $('brainPaneMemory');
    const visibilityChanged = () => {
      if (panel?.hidden || pane?.hidden) { ++revision; clearVideo(); }
      else refresh();
    };
    if (panel) new MutationObserver(visibilityChanged).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
    if (pane) new MutationObserver(visibilityChanged).observe(pane, { attributes: true, attributeFilter: ['hidden'] });
    window.addEventListener('zeronine:replay-updated', refresh);
    window.addEventListener('message', event => {
      if (event.origin !== location.origin || event.source !== parent || event.data?.type !== 'zeronine:room-state') return;
      const state = event.data.state || {};
      const next = String(state.accountId || 'guest') + ':' + String(state.accountMode || '');
      if (next !== account) { account = next; ++revision; clearVideo(); queueMicrotask(refresh); }
    });
    window.addEventListener('pagehide', () => { ++revision; clearVideo(); });
    refresh();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
