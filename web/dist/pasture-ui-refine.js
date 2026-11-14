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
  function rangerHeadScreen() {
    const hook = window.__zeronineRanger;
    if (!hook) return null;
    try {
      const head = typeof hook.head === 'function' ? hook.head() : null;
      if (head && Number.isFinite(head.x) && Number.isFinite(head.y)) return head;
      const point = typeof hook.screen === 'function' ? hook.screen() : null;
      if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) return { x: point.x, y: point.y - 46, r: 11 };
    } catch {}
    return null;
  }

  function placeAttached() {
    const head = rangerHeadScreen();
    if (!head) return;
    const hour = document.querySelector('.live-ranger-wait');
    if (hour && !hour.hidden && ui()?.placeFloating) {
      ui().placeFloating(hour, { x: head.x + 22, y: head.y - 8 }, {
        gap: 8,
        padding: 6,
        avoid: ['#rangerBrainGlyph', '#rangerBrainBubble', '#breakTimer', '#rangerBrainPanel'],
      });
    }
  }

  // The legacy camera-based bubble position is replaced by the shared
  // collision service so the bubble never covers the ranger or the timer.
  window.__pasturePlaceBubble = function placeBubble(el) {
    if (!el || el.getAttribute('aria-hidden') === 'true') return;
    const head = rangerHeadScreen();
    if (!head || !ui()?.placeFloating) return;
    ui().placeFloating(el, { x: head.x, y: head.y - (head.r || 11) }, {
      gap: 10,
      padding: 8,
      hysteresis: 12000,
      avoid: ['#rangerBrainGlyph', '#rangerBrainBubble', '#breakTimer', '#liveRangerWait', '#rangerAutoHud', '#rangerBrainPanel'],
    });
  };

  window.positionRangerBet = function positionRangerBet() {
    const el = document.getElementById('rangerBet');
    if (!el || !window.rangerBet) return;
    try { window.__pasturePlaceBubble(el); } catch {}
  };

  (function frame() {
    try {
      placeAttached();
    } catch {}
    requestAnimationFrame(frame);
  })();

  window.__pastureUiRefine = { applyLayout, placeAttached };

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

