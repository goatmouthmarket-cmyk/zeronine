/*
 * Thin compatibility layer for the pasture HUD.
 * Menu state and notifications now belong to pasture-ui-system.js; this file
 * only keeps the cooldown chip readable and character-attached overlays placed.
 */
(() => {
  'use strict';
  if (window.__pastureUiRefineV1) return;
  window.__pastureUiRefineV1 = true;

  const $ = (id) => document.getElementById(id);
  const ui = () => window.DerivCowsUI;

  const applyLayout = (data) => ui()?.layout?.apply(data);

  /* ---- Cooldown chip: readable label, never under the parent header ---- */
  function enhanceBreakTimer() {
    const timer = $('breakTimer');
    if (!timer || timer.dataset.refined === 'true') return;
    timer.dataset.refined = 'true';
    const strong = $('breakSeconds');
    const label = timer.querySelector('span:not(.hud-drag-handle)');
    if (label && !timer.querySelector('.cooldown-copy')) {
      const copy = document.createElement('span');
      copy.className = 'cooldown-copy';
      const reason = document.createElement('span');
      reason.className = 'cooldown-reason';
      reason.textContent = 'Cooldown';
      copy.appendChild(reason);
      if (strong) copy.appendChild(strong);
      label.replaceWith(copy);
      timer._reasonEl = reason;
    }
  }
  function syncBreakReason() {
    const timer = $('breakTimer');
    const reason = timer && (timer._reasonEl || timer.querySelector('.cooldown-reason'));
    if (!reason) return;
    const cd = $('cooldown');
    const text = cd ? String(cd.textContent || '') : '';
    if (/s\s+/i.test(text) || /\d+s/i.test(text)) {
      const trimmed = text.replace(/^\d+s\s*/i, '').trim();
      const next = trimmed || 'Cooldown';
      if (reason.textContent !== next) reason.textContent = next;
    } else if (!timer.classList.contains('visible') && reason.textContent !== 'Cooldown') {
      // State updates can temporarily write READY while a cooldown is active.
      // Keep its actual reason until the countdown has ended.
      reason.textContent = 'Cooldown';
    }
  }
  enhanceBreakTimer();
  const cooldownNode = $('cooldown');
  if (cooldownNode) new MutationObserver(syncBreakReason).observe(cooldownNode, { childList: true, characterData: true, subtree: true });

  /* ---- Ranger-attached overlays ---- */
  window.__pastureUiRefine = { applyLayout };

  // A saved HUD drag position must not park the cooldown timer off-screen.
  (function rescueTimer() {
    const timer = $('breakTimer');
    if (!timer) return;
    const fix = () => {
      if (document.body.classList.contains('hud-arranging')) return;
      const headerH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dc-header-h')) || 56;
      const rect = timer.getBoundingClientRect();
      if (rect.top < headerH + 2 || rect.bottom < 0 || rect.top > innerHeight) {
        timer.style.removeProperty('left');
        timer.style.removeProperty('right');
        timer.style.removeProperty('bottom');
        timer.style.removeProperty('top');
        timer.style.removeProperty('transform');
      }
    };
    new MutationObserver(fix).observe(timer, { attributes: true, attributeFilter: ['style', 'class'] });
    addEventListener('resize', fix);
    setInterval(fix, 1500);
  })();
})();

