/* Enter opens chat while the pasture has keyboard focus; native form submit sends. */
(() => {
  'use strict';
  if (window.__pastureChatOpenV2) return;
  const panel = document.getElementById('chatPanel');
  const toggle = document.getElementById('chatToggle');
  const input = document.getElementById('chatInput');
  if (!panel || !toggle || !input) return;
  window.__pastureChatOpenV2 = true;

  // Show the feed without summoning the mobile keyboard on page load.
  panel.hidden = false;
  toggle.setAttribute('aria-expanded', 'true');
  input.enterKeyHint = 'send';
  const messages = document.getElementById('chatMessages');
  const form = document.getElementById('chatForm');
  const coarse = window.matchMedia?.('(pointer: coarse)');
  const visibility = document.createElement('button');
  visibility.type = 'button';
  visibility.className = 'chat-visibility-control';
  visibility.setAttribute('aria-controls', 'chatMessages chatForm');
  visibility.setAttribute('aria-expanded', 'true');
  visibility.textContent = 'Hold to hide';
  panel.append(visibility);
  let collapsed = false;
  let fadeTimer = 0;
  let suppressClick = false;
  let holdTimer = 0;
  let startPoint = null;
  let toastFrame = 0;

  function mobileTouch() { return innerWidth <= 999.98 && !!coarse?.matches; }
  function updatePrompt() {
    input.placeholder = mobileTouch() ? 'Tap to chat' : 'Press ↵ to chat';
    visibility.hidden = !mobileTouch();
    if (!mobileTouch() && collapsed) setCollapsed(false);
  }
  function wakeHistory() {
    panel.classList.remove('chat-history-faded');
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => panel.classList.add('chat-history-faded'), 30000);
  }
  function setCollapsed(next) {
    collapsed = !!next;
    panel.classList.toggle('chat-collapsed', collapsed);
    visibility.textContent = collapsed ? 'Hold to show chat' : 'Hold to hide';
    visibility.setAttribute('aria-label', collapsed ? 'Show chat' : 'Hide chat');
    visibility.setAttribute('aria-expanded', String(!collapsed));
    if (messages) messages.hidden = collapsed;
    if (form) form.hidden = collapsed;
    if (collapsed && document.activeElement === input) input.blur();
    if (!collapsed) wakeHistory();
    queueToastCheck();
  }
  function cancelHold() { clearTimeout(holdTimer); holdTimer = 0; startPoint = null; }
  visibility.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch') return;
    cancelHold();
    startPoint = { x: event.clientX, y: event.clientY };
    holdTimer = setTimeout(() => { holdTimer = 0; suppressClick = true; setCollapsed(!collapsed); }, 600);
  });
  visibility.addEventListener('pointermove', event => {
    if (startPoint && Math.hypot(event.clientX - startPoint.x, event.clientY - startPoint.y) > 12) cancelHold();
  });
  visibility.addEventListener('pointerup', () => { cancelHold(); if (suppressClick) setTimeout(() => { suppressClick = false; }, 750); });
  visibility.addEventListener('pointercancel', cancelHold);
  visibility.addEventListener('contextmenu', event => event.preventDefault());
  visibility.addEventListener('click', event => {
    if (suppressClick) { suppressClick = false; event.preventDefault(); return; }
    setCollapsed(!collapsed);
  });
  if (messages) new MutationObserver(wakeHistory).observe(messages, { childList: true, subtree: true, characterData: true });
  input.addEventListener('focus', wakeHistory);
  messages?.addEventListener('pointerdown', wakeHistory, { passive: true });
  form?.addEventListener('submit', wakeHistory);
  coarse?.addEventListener?.('change', updatePrompt);
  window.addEventListener('resize', updatePrompt, { passive: true });
  updatePrompt();
  wakeHistory();

  // Keep the market notification lane readable, and lift chat out of its way
  // while notices are visible. Its own stacking context stays beneath notices.
  function queueToastCheck() {
    if (!toastFrame) toastFrame = requestAnimationFrame(updateToastAvoidance);
  }
  function updateToastAvoidance() {
    toastFrame = 0;
    const lane = document.querySelector('.dc-toast-lane');
    if (!mobileTouch() || !lane || !lane.children.length || panel.hidden) {
      panel.style.removeProperty('--chat-toast-lift');
      return;
    }
    const lift = Number.parseFloat(panel.style.getPropertyValue('--chat-toast-lift')) || 0;
    const box = panel.getBoundingClientRect(), alert = lane.getBoundingClientRect();
    const base = { top: box.top + lift, bottom: box.bottom + lift, left: box.left, right: box.right };
    const overlaps = base.right > alert.left && base.left < alert.right && base.bottom > alert.top && base.top < alert.bottom;
    const safeTop = Math.max(8, Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dc-header-h')) || 0);
    const next = overlaps ? Math.max(0, Math.min(base.bottom - alert.top + 8, base.top - safeTop)) : 0;
    if (Math.abs(next - lift) > 0.5) panel.style.setProperty('--chat-toast-lift', next + 'px');
  }
  const lane = document.querySelector('.dc-toast-lane');
  if (lane) {
    new MutationObserver(queueToastCheck).observe(lane, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(queueToastCheck).observe(lane);
  }
  window.addEventListener('resize', queueToastCheck, { passive: true });
  queueToastCheck();
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
    if (collapsed) setCollapsed(false);
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
