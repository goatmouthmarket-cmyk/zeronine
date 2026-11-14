(() => {
  'use strict';
  const selector = '.room-header-play';
  let lastState = { running: false, status: '' };

  function mountStatus() {
    const button = document.querySelector(selector);
    if (!button) return;
    let chip = button.querySelector('.room-auto-live-state');
    if (!chip) {
      chip = document.createElement('span');
      chip.className = 'room-auto-live-state';
      chip.setAttribute('role', 'status');
      chip.setAttribute('aria-live', 'polite');
      chip.hidden = true;
      button.appendChild(chip);
    }
    chip.hidden = !lastState.running;
    if (lastState.running) {
      const label = lastState.status || 'Running';
      const title = lastState.status || 'Ranger Auto running';
      if (chip.textContent !== label) chip.textContent = label;
      if (chip.title !== title) chip.title = title;
    }
  }

  document.addEventListener('DOMContentLoaded', mountStatus, { once: true });
  new MutationObserver(mountStatus).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.data?.type !== 'zeronine:room-auto-status') return;
    const room = document.querySelector('iframe[src*="trading-room"]');
    if (room?.contentWindow && event.source !== room.contentWindow) return;
    if (typeof event.data.running !== 'boolean') return;
    lastState = { running: event.data.running, status: String(event.data.status || '') };
    mountStatus();
  });
})();