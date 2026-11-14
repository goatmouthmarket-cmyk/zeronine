/* Enter opens chat while the pasture has keyboard focus; native form submit sends. */
(() => {
  'use strict';
  const panel = document.getElementById('chatPanel');
  const toggle = document.getElementById('chatToggle');
  const input = document.getElementById('chatInput');
  if (!panel || !toggle || !input) return;

  // Show the feed without summoning the mobile keyboard on page load.
  panel.hidden = false;
  toggle.setAttribute('aria-expanded', 'true');
  input.enterKeyHint = 'send';
  const status = document.getElementById('chatStatus');
  if (status) {
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    // Keep connection errors available to assistive technology without a header.
    document.getElementById('pastureChat')?.append(status);
    status.classList.add('pasture-chat-status');
  }

  function dialogOpen() {
    return Array.from(document.querySelectorAll('dialog[open], [role="dialog"]:not([hidden]), [aria-modal="true"]'))
      .some((el) => el !== panel && el.getClientRects().length > 0);
  }
  function focusChat() {
    if (dialogOpen()) return false;
    panel.hidden = false;
    input.focus();
    return true;
  }

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented) return;
    const target = event.target;
    if (!(target === document.body || target === document.documentElement || target?.id === 'game')) return;
    if (focusChat()) event.preventDefault();
  });
  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.source !== window.parent || event.data?.type !== 'zeronine:focus-chat') return;
    focusChat();
  });
})();
