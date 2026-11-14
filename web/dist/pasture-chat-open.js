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
  input.placeholder = 'Press ↵ to chat';
  const hud = document.getElementById('playerHud');
  const compactHud = document.getElementById('inspector');
  const compactLevel = document.getElementById('marketHudQuick');
  function alignWithLevelCards() {
    const isCompact = compactLevel && getComputedStyle(compactLevel).display !== 'none';
    const rect = (isCompact ? compactHud : hud)?.getBoundingClientRect();
    if (rect && rect.width > 0 && rect.right > 0 && rect.left < innerWidth) {
      panel.style.setProperty('--chat-hud-width', Math.min(rect.width, innerWidth - 16) + 'px');
      panel.style.setProperty('--chat-hud-right', Math.max(8, innerWidth - rect.right) + 'px');
    } else {
      panel.style.removeProperty('--chat-hud-width');
      panel.style.removeProperty('--chat-hud-right');
    }
  }
  if (hud && typeof ResizeObserver !== 'undefined') new ResizeObserver(alignWithLevelCards).observe(hud);
  if (compactHud && typeof ResizeObserver !== 'undefined') new ResizeObserver(alignWithLevelCards).observe(compactHud);
  if (hud && typeof MutationObserver !== 'undefined') new MutationObserver(alignWithLevelCards).observe(hud, { attributes: true, attributeFilter: ['style', 'class'] });
  if (compactHud && typeof MutationObserver !== 'undefined') new MutationObserver(alignWithLevelCards).observe(compactHud, { attributes: true, attributeFilter: ['style', 'class'] });
  window.addEventListener('resize', alignWithLevelCards, { passive: true });
  alignWithLevelCards();
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
