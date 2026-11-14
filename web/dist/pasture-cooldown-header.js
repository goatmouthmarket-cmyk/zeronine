/* Mirror the game cooldown into the dashboard header when the room is embedded. */
(() => {
  'use strict';
  const origin = location.origin;
  const timer = document.getElementById('breakTimer');
  if (timer) {
    if (window.parent === window) return;
    let last = '';
    function send(force = false) {
      const active = timer.classList.contains('visible');
      const time = active ? document.getElementById('breakSeconds')?.textContent?.trim() || '' : '';
      const reason = active ? timer.querySelector('.cooldown-reason')?.textContent?.trim() || 'Cooldown' : '';
      const signature = JSON.stringify([active, time, reason]);
      if (!force && signature === last) return;
      last = signature;
      window.parent.postMessage({ type: 'zeronine:cooldown-header', active, time, reason }, origin);
    }
    window.addEventListener('message', (event) => {
      if (event.origin !== origin || event.source !== window.parent) return;
      if (event.data?.type === 'zeronine:cooldown-header-request') send(true);
      if (event.data?.type === 'zeronine:cooldown-header-ready') document.body.classList.add('cooldown-header-connected');
    });
    new MutationObserver(() => send()).observe(timer, { attributes: true, attributeFilter: ['class'], childList: true, characterData: true, subtree: true });
    send(true);
    return;
  }
  if (window.parent !== window) return;
  let currentFrame = null;
  let indicator = null;
  let value = null;
  function sync() {
    const frame = document.querySelector('iframe.trading-room-frame');
    const header = document.querySelector('.app[data-page="home"] .view-home .header-top');
    if (frame !== currentFrame) {
      currentFrame = frame;
      value = null;
      indicator?.remove();
      indicator = null;
      frame?.contentWindow?.postMessage({ type: 'zeronine:cooldown-header-request' }, origin);
    }
    if (!frame || !header || !value?.active) {
      if (indicator && !indicator.hidden) indicator.hidden = true;
      return;
    }
    if (!indicator || indicator.parentElement !== header) {
      indicator = document.createElement('div');
      indicator.className = 'room-cooldown-indicator';
      indicator.setAttribute('role', 'timer');
      indicator.setAttribute('aria-label', 'Trading cooldown');
      const reason = document.createElement('span');
      reason.className = 'room-cooldown-reason';
      const time = document.createElement('strong');
      time.className = 'room-cooldown-time';
      indicator.append(reason, time);
      header.insertBefore(indicator, header.querySelector('.room-header-play'));
    }
    const reasonNode = indicator.querySelector('.room-cooldown-reason');
    const timeNode = indicator.querySelector('.room-cooldown-time');
    if (reasonNode.textContent !== value.reason) reasonNode.textContent = value.reason;
    if (timeNode.textContent !== value.time) timeNode.textContent = value.time;
    indicator.title = value.reason + ' ' + value.time;
    indicator.hidden = false;
  }
  window.addEventListener('message', (event) => {
    if (event.origin !== origin || event.source !== currentFrame?.contentWindow || event.data?.type !== 'zeronine:cooldown-header') return;
    const data = event.data;
    if (typeof data.active !== 'boolean' || typeof data.time !== 'string' || typeof data.reason !== 'string') return;
    if (data.active && !/^\d+:\d{2}$/.test(data.time)) return;
    value = { active: data.active, time: data.time.slice(0, 12), reason: data.reason.slice(0, 80) || 'Cooldown' };
    sync();
    if (document.querySelector('.app[data-page="home"] .view-home .header-top')) {
      currentFrame.contentWindow.postMessage({ type: 'zeronine:cooldown-header-ready' }, origin);
    }
  });
  new MutationObserver(sync).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('load', (event) => {
    if (event.target === currentFrame) {
      value = null;
      sync();
      currentFrame.contentWindow?.postMessage({ type: 'zeronine:cooldown-header-request' }, origin);
    }
  }, true);
  sync();
})();
