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
      chip.textContent = lastState.status || 'Running';
      chip.title = lastState.status || 'Ranger Auto running';
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