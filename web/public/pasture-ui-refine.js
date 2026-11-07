(() => {
  if (window.__pastureUiRefineV1) return;
  window.__pastureUiRefineV1 = true;

  const $ = (id) => document.getElementById(id);
  const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isMobile = () => window.matchMedia && matchMedia('(max-width: 700px)').matches;

  /* ---- Parent layout info (header/balance safe area) ---- */
  function applyLayout(data) {
    if (!data || typeof data !== 'object') return;
    const root = document.documentElement;
    if (Number.isFinite(data.headerHeight)) root.style.setProperty('--pasture-header-h', Math.max(0, Math.min(140, data.headerHeight)) + 'px');
    if (Number.isFinite(data.bottomNavHeight)) root.style.setProperty('--pasture-bottom-nav-h', Math.max(0, Math.min(120, data.bottomNavHeight)) + 'px');
  }
  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.source !== parent) return;
    const m = event.data || {};
    if (m.type === 'zeronine:room-layout') applyLayout(m);
  });
  // Ask parent for layout; safe defaults are in CSS.
  try { parent.postMessage({ type: 'zeronine:room-layout-request' }, location.origin); } catch {}

  /* ---- Cooldown timer chip enhancement ---- */
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
      const r = text.replace(/^\d+s\s*/i, '').trim();
      reason.textContent = r ? r : 'Cooldown';
    } else if (timer.classList.contains('visible')) {
      reason.textContent = 'Cooldown';
    }
  }
  enhanceBreakTimer();
  const cooldownNode = $('cooldown');
  if (cooldownNode) new MutationObserver(syncBreakReason).observe(cooldownNode, { childList: true, characterData: true, subtree: true });

  /* ---- Toast manager (replaces centered single toast) ---- */
  const stack = document.createElement('div');
  stack.className = 'pasture-toast-stack';
  stack.setAttribute('aria-live', 'polite');
  stack.setAttribute('aria-relevant', 'additions text');
  document.body.appendChild(stack);

  const recent = new Map(); // key -> ts
  let queue = [];
  let showing = [];
  const TOAST_MS = 3600;
  const CRITICAL_MS = 6500;

  function iconFor(type) {
    return ({ success: '✓', trade_result: '✓', error: '!', warning: '!', info: 'i', research: 'i' })[type] || 'i';
  }
  function classify(message, paperTrade) {
    const m = String(message || '');
    if (paperTrade) return paperTrade.status === 'lost' ? { type: 'warning', title: 'Paper result' } : { type: 'trade_result', title: paperTrade.status === 'won' ? 'Paper win' : 'Paper trade' };
    if (/won|win\b|\+\$/i.test(m)) return { type: 'trade_result', title: 'Trade result' };
    if (/lost|loss\b|error|failed|unavailable|rejected|offline|stale|not submitted/i.test(m)) return { type: /stale|offline|unavailable|rejected|not submitted|failed|error/i.test(m) ? 'warning' : 'trade_result', title: /error|failed/i.test(m) ? 'Notice' : 'Trade result' };
    if (/replay|research|scout|brain/i.test(m)) return { type: 'research', title: 'Research' };
    return { type: 'info', title: 'Update' };
  }
  function pruneRecent(now) {
    for (const [k, t] of recent) if (now - t > 4000) recent.delete(k);
  }
  function renderToast(item) {
    const el = document.createElement('div');
    el.className = 'pasture-toast';
    el.dataset.type = item.type;
    el.tabIndex = 0;
    const ic = document.createElement('span'); ic.className = 'pasture-toast-icon'; ic.textContent = iconFor(item.type);
    const body = document.createElement('div'); body.className = 'pasture-toast-body';
    if (item.title) { const s = document.createElement('strong'); s.textContent = item.title; body.appendChild(s); }
    if (item.node) body.appendChild(item.node); else body.appendChild(document.createTextNode(item.message));
    const close = document.createElement('button'); close.type = 'button'; close.className = 'pasture-toast-close'; close.setAttribute('aria-label', 'Dismiss'); close.textContent = '×';
    el.append(ic, body, close);
    let timer = 0;
    const dismiss = () => {
      clearTimeout(timer);
      el.classList.add('exiting');
      setTimeout(() => { el.remove(); showing = showing.filter(s => s.el !== el); flushQueue(); }, reduceMotion() ? 0 : 180);
    };
    close.addEventListener('click', dismiss);
    const start = () => { clearTimeout(timer); timer = setTimeout(dismiss, item.ms); };
    const stop = () => clearTimeout(timer);
    el.addEventListener('mouseenter', stop); el.addEventListener('mouseleave', start);
    el.addEventListener('focusin', stop); el.addEventListener('focusout', start);
    start();
    stack.appendChild(el);
    showing.push({ el, type: item.type });
  }
  function flushQueue() {
    const max = isMobile() ? 2 : 3;
    while (showing.length < max && queue.length) renderToast(queue.shift());
  }
  function enqueue(item) {
    const max = isMobile() ? 2 : 3;
    // Critical/warning can replace low-priority info when full.
    if (showing.length >= max && (item.type === 'error' || item.type === 'warning' || item.type === 'trade_result')) {
      const victim = showing.find(s => s.type === 'info' || s.type === 'research');
      if (victim) { victim.el.querySelector('.pasture-toast-close')?.click(); }
    }
    if (showing.length < max) renderToast(item); else if (item.type !== 'info') queue.push(item);
  }

  const prevNotify = typeof window.notify === 'function' ? window.notify : null;
  window.notify = function refinedNotify(message, paperTrade) {
    enhanceBreakTimer();
    try {
      const now = Date.now();
      pruneRecent(now);
      const key = String(message || '') + '|' + (paperTrade ? paperTrade.status + ':' + (paperTrade.id || '') : '');
      if (recent.has(key)) return;
      recent.set(key, now);
      const c = classify(message, paperTrade);
      let node = null;
      if (paperTrade && typeof createPaperTradeDetails === 'function') {
        try { node = createPaperTradeDetails(paperTrade); } catch {}
      }
      enqueue({ message: String(message || ''), node, type: c.type, title: c.title, ms: c.type === 'error' ? CRITICAL_MS : TOAST_MS });
    } catch (err) {
      if (prevNotify) try { prevNotify.call(this, message, paperTrade); } catch {}
    }
  };

  /* ---- One major mobile menu at a time ---- */
  const majorPanels = () => [
    { id: 'rangerAutoHud', open: () => $('rangerAutoHud') && !$('rangerAutoHud').hidden, close: () => { const t = $('rangerAutoToggle'); if (t && t.getAttribute('aria-expanded') === 'true') t.click(); } },
    { id: 'rangerBrainPanel', open: () => $('rangerBrainPanel') && !$('rangerBrainPanel').hidden, close: () => $('rangerBrainClose')?.click() },
    { id: 'ghostTraderPanel', open: () => $('ghostTraderPanel') && !$('ghostTraderPanel').hidden, close: () => $('ghostPanelClose')?.click() },
  ];
  function closeOtherMajors(exceptId) {
    if (!isMobile()) return;
    for (const p of majorPanels()) if (p.id !== exceptId && p.open()) { try { p.close(); } catch {} }
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('#rangerAutoToggle')) setTimeout(() => closeOtherMajors('rangerAutoHud'), 0);
    if (e.target.closest && e.target.closest('#rangerBrainGlyph')) setTimeout(() => closeOtherMajors('rangerBrainPanel'), 0);
    if (e.target.closest && (e.target.closest('#ghostPanelShortcut') || e.target.closest('#ghostPanelClose'))) setTimeout(() => { if ($('ghostTraderPanel') && !$('ghostTraderPanel').hidden) closeOtherMajors('ghostTraderPanel'); }, 0);
  }, true);

  /* ---- Ranger-attached overlay positioning (hourglass + bubble) ---- */
  function rangerHeadScreen() {
    const hook = window.__zeronineRanger;
    if (!hook) return null;
    try {
      const head = typeof hook.head === 'function' ? hook.head() : null;
      if (head && Number.isFinite(head.x) && Number.isFinite(head.y)) return head;
      const p = typeof hook.screen === 'function' ? hook.screen() : null;
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return { x: p.x, y: p.y - 46, r: 11 };
    } catch {}
    return null;
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function placeAttached() {
    const head = rangerHeadScreen();
    const hour = document.querySelector('.live-ranger-wait');
    const brain = $('rangerBrainGlyph');
    const brainOpen = $('rangerBrainPanel') && !$('rangerBrainPanel').hidden;
    if (!head) return;
    // Cluster: brain on crown/side, hourglass opposite/above to avoid overlap.
    if (hour && !hour.hidden) {
      const hourW = 24, hourH = 24;
      const x = head.x + (brain && !brain.hidden ? 18 : 0);
      const y = head.y - (Number.isFinite(head.r) ? head.r + 8 : 18);
      hour.style.left = clamp(x, hourW / 2 + 4, innerWidth - hourW / 2 - 4) + 'px';
      hour.style.top = clamp(y, hourH + 8, innerHeight - 8) + 'px';
      hour.style.transform = 'translate(-50%, -100%)';
    }
  }
  // Improve bubble placement when legacy positionRangerBet runs.
  const origPos = window.positionRangerBet;
  window.__pasturePlaceBubble = function placeBubble(el) {
    if (!el || el.getAttribute('aria-hidden') === 'true') return;
    const head = rangerHeadScreen();
    const w = el.offsetWidth || 160, h = el.offsetHeight || 70;
    const pad = 8;
    const candidates = head ? [
      { x: head.x, y: head.y - (head.r || 11) - 10, anchor: 'bottom' }, // above
      { x: head.x + w * 0.35, y: head.y - (head.r || 11) - 4, anchor: 'bottom' },
      { x: head.x - w * 0.35, y: head.y - (head.r || 11) - 4, anchor: 'bottom' },
      { x: head.x, y: head.y + 38, anchor: 'top' },
    ] : [{ x: innerWidth / 2, y: innerHeight * 0.35, anchor: 'bottom' }];
    function score(c) {
      let left = c.anchor === 'bottom' ? c.x - w / 2 : c.x - w / 2;
      let top = c.anchor === 'bottom' ? c.y - h : c.y;
      left = clamp(left, pad, innerWidth - w - pad);
      top = clamp(top, pad, innerHeight - h - pad);
      // Penalize overlap with protected zones (timer, brain, hourglass).
      let penalty = 0;
      const rects = [$('.live-ranger-wait'), $('#rangerBrainGlyph'), $('#breakTimer.visible') || ($('#breakTimer')?.classList.contains('visible') ? $('#breakTimer') : null)].filter(Boolean);
      for (const r of rects) {
        const b = r.getBoundingClientRect();
        const ox = Math.max(0, Math.min(left + w, b.right) - Math.max(left, b.left));
        const oy = Math.max(0, Math.min(top + h, b.bottom) - Math.max(top, b.top));
        penalty += ox * oy;
      }
      // Prefer higher (above head) when clear.
      return { left, top, s: penalty + (c.anchor === 'top' ? 1200 : 0) };
    }
    let best = null;
    for (const c of candidates) { const s = score(c); if (!best || s.s < best.s) best = s; }
    if (best) { el.style.left = best.left + 'px'; el.style.top = best.top + 'px'; el.style.transform = 'none'; }
  };
  // Override legacy camera-based bubble placement with head-anchored collision-aware placement.
  window.positionRangerBet = function refinedPositionRangerBet(cam) {
    const el = document.getElementById('rangerBet');
    if (!el || !window.rangerBet) return;
    try { window.__pasturePlaceBubble(el); } catch {}
  };
  (function raf() {
    try { placeAttached(); const b = $('rangerBet'); if (b && b.classList.contains('visible')) window.__pasturePlaceBubble(b); } catch {}
    requestAnimationFrame(raf);
  })();

  // Expose for debugging/manual checks
  window.__pastureUiRefine = { applyLayout, placeAttached };
})();
// Rescue: saved HUD drag positions must not trap the cooldown timer under the header.
(function rescueTimer(){
  const t = document.getElementById('breakTimer');
  if (!t) return;
  const fix = () => {
    if (document.body.classList.contains('hud-arranging')) return;
    const headerH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--pasture-header-h')) || 56;
    const r = t.getBoundingClientRect();
    if (r.top < headerH + 2 || r.bottom < 0 || r.top > innerHeight) {
      t.style.removeProperty('left'); t.style.removeProperty('right'); t.style.removeProperty('bottom');
      // keep top controlled by CSS !important; remove inline top if present
      t.style.removeProperty('top'); t.style.removeProperty('transform');
    }
  };
  new MutationObserver(fix).observe(t, { attributes: true, attributeFilter: ['style','class'] });
  addEventListener('resize', fix);
  setInterval(fix, 1500);
})();
