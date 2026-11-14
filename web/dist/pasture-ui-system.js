/*
 * Deriv Cows UI system.
 * Owns: stacking layers, one-major-menu state, one notification lane and the
 * collision-aware placement service used by character-attached overlays.
 * Loaded before the legacy refinement and Brain layers, which delegate here.
 */
(() => {
  'use strict';
  if (window.DerivCowsUI) return;

  const $ = (id) => document.getElementById(id);
  const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const docEl = document.documentElement;

  const state = {
    menu: null,
    modal: null,
    headerH: 56,
    bottomNavH: 0,
    viewport: { w: innerWidth, h: innerHeight },
    lastMenuRect: null,
    toasts: [],
    queue: [],
    version: 1,
  };

  const subscribers = new Set();
  function emit(type, detail) {
    state.version += 1;
    for (const fn of subscribers) {
      try { fn(type, detail || {}, state); } catch {}
    }
    try {
      window.dispatchEvent(new CustomEvent('dc:ui', { detail: { type, ...(detail || {}) } }));
    } catch {}
  }

  /* ---------------------------------------------------------------- layout */

  function setToken(name, value) {
    docEl.style.setProperty(name, value);
  }

  function applyLayout(data) {
    if (!data || typeof data !== 'object') return;
    if (Number.isFinite(data.headerHeight)) {
      state.headerH = Math.max(0, Math.min(160, Math.round(data.headerHeight)));
      setToken('--dc-header-h', state.headerH + 'px');
      setToken('--pasture-header-h', state.headerH + 'px');
    }
    if (Number.isFinite(data.bottomNavHeight)) {
      state.bottomNavH = Math.max(0, Math.min(120, Math.round(data.bottomNavHeight)));
      setToken('--dc-bottom-nav-h', state.bottomNavH + 'px');
      setToken('--pasture-bottom-nav-h', state.bottomNavH + 'px');
    }
    positionLane();
    emit('layout', { headerH: state.headerH, bottomNavH: state.bottomNavH });
  }

  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.source !== parent) return;
    const message = event.data || {};
    if (message.type === 'zeronine:room-layout') applyLayout(message);
  });
  try { parent.postMessage({ type: 'zeronine:room-layout-request' }, location.origin); } catch {}

  window.addEventListener('resize', () => {
    state.viewport = { w: innerWidth, h: innerHeight };
    positionLane();
    emit('resize', state.viewport);
  }, { passive: true });

  /* ------------------------------------------------------------- menu state */

  const menuSpecs = new Map();
  let syncing = false;
  let previousMenu = null;

  const menuObserver = new MutationObserver(() => syncMenus());
  const modalObserver = new MutationObserver(() => syncModal());

  function isOpen(spec) {
    const root = spec && spec.root;
    if (!root || !root.isConnected) return false;
    if (root.hidden) return false;
    if (root.getAttribute('aria-hidden') === 'true') return false;
    const display = getComputedStyle(root).display;
    return display !== 'none';
  }

  function register(spec) {
    if (!spec || !spec.id) return null;
    if (menuSpecs.has(spec.id)) return menuSpecs.get(spec.id);
    const root = typeof spec.root === 'string' ? $(spec.root) : spec.root;
    if (!root) return null;
    const item = {
      major: spec.major !== false,
      modal: spec.modal === true,
      open: spec.open || (() => {}),
      close: spec.close || (() => {}),
      ...spec,
      root,
    };
    root.classList.add('dc-menu');
    root.dataset.dcMenu = spec.id;
    if (item.major && !root.hasAttribute('role')) root.setAttribute('role', 'dialog');
    if (item.major) root.setAttribute('aria-modal', 'false');
    menuSpecs.set(spec.id, item);
    menuObserver.observe(root, { attributes: true, attributeFilter: ['hidden', 'class', 'style', 'aria-hidden'] });
    if (item.modal) {
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-modal', 'true');
      modalObserver.observe(root, { attributes: true, attributeFilter: ['hidden', 'class', 'style', 'aria-hidden'] });
    }
    return item;
  }

  function openSpecs() {
    return [...menuSpecs.values()].filter(isOpen);
  }

  function syncMenus() {
    if (syncing) return;
    syncing = true;
    try {
      const open = openSpecs().filter((spec) => spec.major);
      let current = open.find((spec) => spec.id === previousMenu) || (open.length ? open[open.length - 1] : null);
      if (open.length > 1) {
        // A legacy control opened a second menu; the newest one wins.
        current = open.find((spec) => spec.id !== previousMenu) || open[0];
        for (const spec of open) {
          if (spec.id === current.id) continue;
          try { spec.close(); } catch {}
        }
      }
      state.menu = current ? current.id : null;
      state.lastMenuRect = current ? current.root.getBoundingClientRect() : null;
      previousMenu = state.menu;
      document.body.dataset.dcMenu = state.menu || '';
      docEl.dataset.dcMenu = state.menu || '';
      positionLane();
      emit('menu', { menu: state.menu });
      if (!state.menu) flush();
    } finally {
      syncing = false;
    }
  }

  function syncModal() {
    const open = [...menuSpecs.values()].filter((spec) => spec.modal && isOpen(spec));
    state.modal = open.length ? open[0].id : null;
    document.body.dataset.dcModal = state.modal ? 'true' : 'false';
    docEl.dataset.dcModal = state.modal ? 'true' : 'false';
    positionLane();
    emit('modal', { modal: state.modal });
    if (!state.modal) flush();
  }

  function closeMajors(exceptId) {
    for (const spec of menuSpecs.values()) {
      if (!spec.major || spec.id === exceptId || !isOpen(spec)) continue;
      try { spec.close(); } catch {}
    }
  }

  function openMenu(id) {
    const spec = menuSpecs.get(id);
    if (!spec) return false;
    closeMajors(id);
    try { spec.open(); } catch {}
    setTimeout(syncMenus, 0);
    setTimeout(() => focusInto(spec), 50);
    return true;
  }

  function closeMenu(id) {
    const spec = menuSpecs.get(id);
    if (!spec) return false;
    try { spec.close(); } catch {}
    setTimeout(syncMenus, 0);
    return true;
  }

  function toggleMenu(id) {
    const spec = menuSpecs.get(id);
    if (!spec) return false;
    return isOpen(spec) ? closeMenu(id) : openMenu(id);
  }

  function focusInto(spec) {
    if (!spec || !isOpen(spec)) return;
    const root = spec.root;
    const target = root.querySelector('[autofocus], button, input, select, textarea, [tabindex="0"]');
    if (target) {
      try { target.focus({ preventScroll: true }); } catch {}
    }
    if (spec.modal) {
      try { root.scrollIntoView({ block: 'nearest' }); } catch {}
    }
  }

  // Escape closes the modal first, then the open menu. Never touches a trade.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (state.modal) {
      event.preventDefault();
      closeMenu(state.modal);
      return;
    }
    if (state.menu) {
      event.preventDefault();
      closeMenu(state.menu);
    }
  }, true);

  // Keep keyboard focus inside a modal confirmation.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab' || !state.modal) return;
    const spec = menuSpecs.get(state.modal);
    if (!spec) return;
    const focusable = [...spec.root.querySelectorAll('button, [href], input, select, textarea, [tabindex="0"]')]
      .filter((el) => !el.disabled && el.getClientRects().length);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, true);

  /* Adapters for the menus that already exist in the pasture. */
  register({
    id: 'brain',
    root: 'rangerBrainPanel',
    open: () => window.__zeronineBrainMenu && window.__zeronineBrainMenu.open(),
    close: () => $('rangerBrainClose')?.click(),
  });
  register({
    id: 'auto',
    root: 'rangerAutoHud',
    open: () => {
      const toggle = $('rangerAutoToggle');
      const hud = $('rangerAutoHud');
      if (toggle && hud && hud.hidden) toggle.click();
    },
    close: () => {
      const toggle = $('rangerAutoToggle');
      const hud = $('rangerAutoHud');
      if (toggle && hud && !hud.hidden) toggle.click();
    },
  });
  register({
    id: 'ghost',
    root: 'ghostTraderPanel',
    open: () => {
      const shortcut = $('ghostPanelShortcut');
      const panel = $('ghostTraderPanel');
      if (shortcut && panel && panel.hidden) shortcut.click();
    },
    close: () => {
      const panel = $('ghostTraderPanel');
      if (panel && !panel.hidden) $('ghostPanelClose')?.click();
    },
  });
  register({
    id: 'chat',
    root: 'chatPanel',
    major: false,
    open: () => {
      const panel = $('chatPanel');
      if (panel && panel.hidden) $('chatToggle')?.click();
    },
    close: () => {
      const panel = $('chatPanel');
      if (panel && !panel.hidden) $('chatToggle')?.click();
    },
  });
  register({
    id: 'risk-preview',
    root: 'rangerAutoRiskPreview',
    major: false,
    modal: true,
    close: () => $('rangerRiskPreviewClose')?.click(),
  });
  register({
    id: 'run-report',
    root: 'rangerAutoRunReport',
    major: false,
    close: () => $('rangerAutoReportClose')?.click(),
  });

  /* --------------------------------------------------------- notifications */

  const lane = document.createElement('div');
  lane.className = 'dc-toast-lane';
  lane.dataset.side = 'right';
  lane.setAttribute('aria-live', 'polite');
  lane.setAttribute('aria-relevant', 'additions text');
  lane.setAttribute('role', 'status');

  document.body.append(lane);

  const TYPES = {
    success: { icon: '✓', title: 'Done' },
    warning: { icon: '!', title: 'Heads up' },
    error: { icon: '!', title: 'Problem' },
    info: { icon: 'i', title: 'Update' },
    trade_result: { icon: '✓', title: 'Trade result' },
    paper_result: { icon: '◇', title: 'Paper result' },
    research: { icon: '◎', title: 'Research' },
    automation: { icon: '↻', title: 'Automation' },
  };

  const notifications = {
    active: [],
    queue: [],
    recent: new Map(),
    history: [],
  };

  function maxToasts() {
    return innerWidth <= 999 ? 2 : 3;
  }

  function isCoveredByMenu() {
    const rect = state.lastMenuRect;
    if (!rect) return false;
    const laneRect = lane.getBoundingClientRect();
    const overlapX = Math.max(0, Math.min(laneRect.right, rect.right) - Math.max(laneRect.left, rect.left));
    const overlapY = Math.max(0, Math.min(laneRect.bottom, rect.bottom) - Math.max(laneRect.top, rect.top));
    return overlapX * overlapY > 400;
  }

  // The pasture draws its joystick on the canvas; these are the actual DOM
  // controls parked along the bottom edge that a lane must never cover.
  function bottomChromeTop() {
    let top = innerHeight - 90;
    ['#inspector', '#pastureChat', '#healthDock', '#mobileControls', '.mobileZoom', '#mobileNav'].forEach((sel) => {
      const el = document.querySelector(sel);
      if (!el) return;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return;
      const rect = el.getBoundingClientRect();
      if (rect.height < 8 || rect.top < innerHeight * 0.45) return;
      top = Math.min(top, rect.top);
    });
    return top;
  }

  function positionLane() {
    state.viewport = { w: innerWidth, h: innerHeight };
    const anchor = rectOf('#inspector .target-icon');
    const desktopInline = innerWidth > 999 && Boolean(anchor);
    const rightSpace = anchor ? innerWidth - anchor.right - 16 : innerWidth - 24;
    const flipLeft = desktopInline && rightSpace < 210;
    const width = desktopInline
      ? Math.min(330, Math.max(180, flipLeft ? anchor.left - 18 : rightSpace))
      : Math.min(330, Math.max(0, innerWidth - 24));
    const left = desktopInline
      ? (flipLeft ? Math.max(8, anchor.left - width - 8) : Math.min(innerWidth - width - 8, anchor.right + 8))
      : Math.max(8, Math.min(innerWidth - width - 8, anchor ? anchor.left : 8));
    const below = !desktopInline && anchor && anchor.top < state.headerH + 150;
    const floor = desktopInline
      ? innerHeight - state.headerH - 8
      : Math.max(state.headerH + 90, anchor ? anchor.top - 8 : bottomChromeTop());
    lane.dataset.side = 'left';
    lane.style.left = left + 'px';
    lane.style.right = 'auto';
    lane.style.width = desktopInline ? width + 'px' : '';
    lane.style.maxHeight = Math.max(80, Math.min(innerHeight * 0.38, desktopInline ? floor - state.headerH - 16 : below ? innerHeight - anchor.bottom - 16 : floor - state.headerH - 16)) + 'px';
    const inlineTop = desktopInline ? anchor.top + (anchor.height - lane.offsetHeight) / 2 : 0;
    lane.style.top = desktopInline
      ? Math.max(state.headerH + 8, Math.min(innerHeight - lane.offsetHeight - 8, inlineTop)) + 'px'
      : below ? anchor.bottom + 8 + 'px' : 'auto';
    lane.style.bottom = desktopInline || below ? 'auto' : Math.max(8, innerHeight - floor) + 'px';
    const available = desktopInline ? floor - state.headerH - 16 : below ? innerHeight - anchor.bottom - 16 : floor - state.headerH - 16;
    lane.dataset.room = !state.menu && available >= 80 ? 'true' : 'false';
  }

  function pruneRecent(now) {
    for (const [key, at] of notifications.recent) {
      if (now - at > 5000) notifications.recent.delete(key);
    }
  }

  function normalize(input, fallbackMessage) {
    if (input && typeof input === 'object') {
      const type = TYPES[input.type] ? input.type : 'info';
      return {
        type,
        title: input.title || TYPES[type].title,
        message: String(input.message || ''),
        detail: input.detail ? String(input.detail) : '',
        node: input.node || null,
        key: input.key || '',
        ms: Number.isFinite(input.ms) ? Math.max(1200, input.ms) : (type === 'error' ? 6500 : 3600),
      };
    }
    return { type: 'info', title: TYPES.info.title, message: String(fallbackMessage || input || ''), detail: '', node: null, key: '', ms: 3600 };
  }

  function classifyLegacy(message, paperTrade) {
    const text = String(message || '');
    if (paperTrade) {
      const won = paperTrade.status === 'won';
      const lost = paperTrade.status === 'lost';
      const profit = paperTrade.profit;
      const market = String(paperTrade.market || paperTrade.symbol || '').trim();
      const direction = String(paperTrade.direction || '').toUpperCase();
      const side = direction === 'OVER' || direction === 'UNDER' ? direction : '';
      const barrier = Number.isInteger(paperTrade.barrier) && paperTrade.barrier >= 0 && paperTrade.barrier <= 9 ? String(paperTrade.barrier) : '';
      const detail = typeof profit === 'number' && Number.isFinite(profit) ? 'Virtual P&L ' + (profit >= 0 ? '+' : '') + profit.toFixed(2) : 'Virtual P&L unavailable';
      return {
        type: 'paper_result',
        title: won ? 'PAPER · WIN' : lost ? 'PAPER · LOSS' : 'PAPER · RESULT',
        message: [market, [side, barrier].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || 'Practice result recorded',
        detail,
        ms: 5200,
        key: 'paper:' + (paperTrade.id || text) + ':' + String(paperTrade.status || ''),
      };
    }
    if (/won|win\b|\+\$|profit/i.test(text)) return { type: 'trade_result', title: 'Trade won', ms: 5200 };
    if (/lost|loss\b/i.test(text)) return { type: 'trade_result', title: 'Trade lost', ms: 5200 };
    if (/error|failed|rejected|unavailable|offline|not submitted/i.test(text)) {
      return { type: /offline|unavailable/i.test(text) ? 'warning' : 'error', title: 'Notice', ms: 6000 };
    }
    if (/replay|research|scout|brain|lesson/i.test(text)) return { type: 'research', title: 'Research' };
    if (/auto|automation|armed|cooldown/i.test(text)) return { type: 'automation', title: 'Automation' };
    return { type: 'info', title: 'Update' };
  }

  function renderToast(item) {
    const el = document.createElement('div');
    el.className = 'dc-toast';
    el.dataset.type = item.type;
    el.tabIndex = 0;

    const icon = document.createElement('span');
    icon.className = 'dc-toast-icon';
    icon.textContent = TYPES[item.type].icon;
    icon.setAttribute('aria-hidden', 'true');

    const body = document.createElement('div');
    body.className = 'dc-toast-body';
    const title = document.createElement('strong');
    title.textContent = item.title;
    body.appendChild(title);
    if (item.node) {
      body.appendChild(item.node);
    } else {
      const message = document.createElement('span');
      message.textContent = item.message;
      body.appendChild(message);
      if (item.detail) {
        const detail = document.createElement('span');
        detail.className = 'dc-toast-detail';
        detail.textContent = ' · ' + item.detail;
        body.appendChild(detail);
      }
    }

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'dc-toast-close';
    close.setAttribute('aria-label', 'Dismiss notification');
    close.textContent = '×';

    el.append(icon, body, close);

    const record = { el, type: item.type, item };
    let timer = 0;
    const dismiss = () => {
      clearTimeout(timer);
      el.classList.add('exiting');
      setTimeout(() => {
        el.remove();
        notifications.active = notifications.active.filter((row) => row !== record);
        positionLane();
        emit('toast', { action: 'dismiss', type: item.type });
        flush();
      }, reduceMotion() ? 0 : 170);
    };
    close.addEventListener('click', dismiss);
    const start = () => { clearTimeout(timer); timer = setTimeout(dismiss, item.ms); };
    const stop = () => clearTimeout(timer);
    el.addEventListener('mouseenter', stop);
    el.addEventListener('mouseleave', start);
    el.addEventListener('focusin', stop);
    el.addEventListener('focusout', start);
    start();

    lane.appendChild(el);
    notifications.active.push(record);
    positionLane();
    emit('toast', { action: 'show', type: item.type });
  }

  function renderCritical(item) {
    const el = document.createElement('div');
    el.className = 'dc-critical';
    el.dataset.type = item.type;
    el.setAttribute('role', 'alert');

    // The character bubble and this banner would otherwise repeat one error.
    const bubble = document.querySelector('#rangerBrainBubble');
    if (bubble && !bubble.hidden && item.message) {
      const shown = (bubble.textContent || '').trim();
      if (shown && (shown.includes(item.message.slice(0, 48)) || item.message.includes(shown.slice(0, 48)))) {
        bubble.hidden = true;
        bubble.classList.remove('visible');
      }
    }

    const icon = document.createElement('span');
    icon.className = 'dc-critical-icon';
    icon.textContent = TYPES[item.type].icon;
    icon.setAttribute('aria-hidden', 'true');

    const body = document.createElement('div');
    body.className = 'dc-critical-body';
    const title = document.createElement('strong');
    title.textContent = item.title;
    const message = document.createElement('span');
    message.textContent = item.message;
    body.append(title, message);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'dc-critical-close';
    close.setAttribute('aria-label', 'Dismiss critical notice');
    close.textContent = '×';

    el.append(icon, body, close);
    lane.prepend(el);
    const timer = setTimeout(() => dismissCritical(el), Math.max(item.ms, 8000));
    close.addEventListener('click', (event) => { event.stopPropagation(); dismissCritical(el); });
    el.addEventListener('click', () => dismissCritical(el));
    function dismissCritical(node) {
      clearTimeout(timer);
      node.classList.add('exiting');
      setTimeout(() => node.remove(), reduceMotion() ? 0 : 160);
    }
  }

  function flush() {
    if (!state.menu && !state.modal) {
      while (notifications.active.length < maxToasts() && notifications.queue.length) {
        renderToast(notifications.queue.shift());
      }
      return;
    }
    // A menu is open: only fill space when the lane is not under it.
    if (innerWidth > 999 && isCoveredByMenu()) return;
    while (notifications.active.length < maxToasts() && notifications.queue.length) {
      renderToast(notifications.queue.shift());
    }
  }

  function enqueue(item) {
    const now = Date.now();
    pruneRecent(now);
    const key = item.key || item.message.trim().toLowerCase().replace(/\s+/g, ' ');
    if (notifications.recent.has(key)) return;
    notifications.recent.set(key, now);

    notifications.history.push({ type: item.type, title: item.title, message: item.message, at: now });
    if (notifications.history.length > 60) notifications.history.shift();

    if (item.type === 'error') {
      // A critical error stays reachable even while a confirmation is open.
      renderCritical(item);
      emit('toast', { action: 'critical', type: item.type });
      return;
    }

    if (state.modal) {
      notifications.queue.push(item);
      emit('toast', { action: 'queued', type: item.type });
      return;
    }

    if (notifications.active.length >= maxToasts()) {
      const low = notifications.active.find((row) => row.type === 'info' || row.type === 'research');
      if (low && (item.type === 'trade_result' || item.type === 'paper_result' || item.type === 'warning')) {
        low.el.querySelector('.dc-toast-close')?.click();
      }
      if (notifications.active.length >= maxToasts()) {
        notifications.queue.push(item);
        emit('toast', { action: 'queued', type: item.type });
        return;
      }
    }

    if (isCoveredByMenu() || (innerWidth <= 999 && lane.dataset.room === 'false')) {
      notifications.queue.push(item);
      emit('toast', { action: 'queued', type: item.type });
      return;
    }

    renderToast(item);
  }

  function notifyEvent(input) {
    const item = normalize(input);
    if (!item.message && !item.node) return;
    enqueue(item);
  }

  function notifyLegacy(message, paperTrade) {
    const text = String(message || '');
    // The paper hourglass already shows an open trade; keep the result as one notice.
    if (paperTrade?.status === 'open') return;
    // Routine background refreshes belong in history, not on screen.
    if (/^(refresh|refreshed|sync|synced|updated|saved)\b/i.test(text)) {
      notifications.history.push({ type: 'info', title: 'Background', message: text, at: Date.now() });
      return;
    }
    // The Ranger's own bubble already says this; a second card is noise.
    const bubble = document.querySelector('#rangerBrainBubble');
    if (bubble && !bubble.hidden && text) {
      const shown = (bubble.textContent || '').trim();
      if (shown && (shown.includes(text.slice(0, 48)) || text.includes(shown.slice(0, 48)))) {
        notifications.history.push({ type: 'info', title: 'Brain', message: text, at: Date.now() });
        return;
      }
    }
    const base = classifyLegacy(message, paperTrade);
    enqueue(normalize(paperTrade ? base : { ...base, message: text }, text));
  }

  const legacyNotify = typeof window.notify === 'function' ? window.notify : null;
  window.notify = function systemNotify(message, paperTrade) {
    try {
      notifyLegacy(message, paperTrade);
    } catch {
      if (legacyNotify) {
        try { legacyNotify.call(this, message, paperTrade); } catch {}
      }
    }
  };

  // Trade results should be one compact toast. The ranger bubble keeps the
  // detailed breakdown, so no duplicate long-form toast is created here.
  window.notify.event = notifyEvent;
  window.notify.history = () => notifications.history.slice();
  window.notify.clearHistory = () => { notifications.history.length = 0; };

  /* ---------------------------------------------------- floating placement */

  function rectOf(ref) {
    if (!ref) return null;
    const el = typeof ref === 'string' ? document.querySelector(ref) : ref;
    if (!el || el.hidden) return null;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? r : null;
  }

  function overlapArea(a, b) {
    const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
    const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    return x * y;
  }

  const floatingPlacements = new WeakMap();
  function placeFloating(element, anchor, options) {
    if (!element || !anchor) return null;
    const opts = options || {};
    const gap = Number.isFinite(opts.gap) ? opts.gap : 12;
    const pad = Number.isFinite(opts.padding) ? opts.padding : 8;
    const avoid = (opts.avoid || ['#rangerBrainPanel', '#breakTimer', '#rangerBrainGlyph', '#mobileControls', '#playerHud', '#healthDock'])
      .map(rectOf)
      .filter(Boolean);

    const width = element.offsetWidth || 236;
    const height = element.offsetHeight || 130;
    const topLimit = Math.max(pad, state.headerH + 8);
    const bottomLimit = innerHeight - pad;
    const rightLimit = innerWidth - pad;
    const ax = Number(anchor.x) || innerWidth / 2;
    const ay = Number(anchor.y) || innerHeight / 2;

    const candidates = [
      { left: ax + gap, top: ay - height / 2, rank: 0 },
      { left: ax - width - gap, top: ay - height / 2, rank: 1 },
      { left: ax - width / 2, top: ay - height - gap - 20, rank: 2 },
      { left: ax - width / 2, top: ay + gap + 20, rank: 3 },
    ];

    let best = null;
    let previous = null;
    const previousRank = floatingPlacements.get(element);
    for (const candidate of candidates) {
      const box = {
        left: Math.max(pad, Math.min(rightLimit - width, candidate.left)),
        top: Math.max(topLimit, Math.min(bottomLimit - height, candidate.top)),
      };
      const rect = { left: box.left, top: box.top, right: box.left + width, bottom: box.top + height };
      let score = candidate.rank * 8;
      for (const zone of avoid) score += overlapArea(rect, zone) * 40;
      const rawPenalty = Math.abs(candidate.left - box.left) + Math.abs(candidate.top - box.top);
      score += rawPenalty * 6;
      const placement = { ...box, score, rank: candidate.rank };
      if (candidate.rank === previousRank) previous = placement;
      if (!best || score < best.score) best = placement;
    }

    if (!best) return null;
    // Keep an attached bubble on the same side through small scoring changes;
    // switch when another placement avoids a meaningful obstruction.
    const hysteresis = Math.max(0, Number(opts.hysteresis) || 0);
    if (hysteresis && previous && previous.score <= best.score + hysteresis) best = previous;
    if (hysteresis) floatingPlacements.set(element, best.rank);
    element.style.left = best.left + 'px';
    element.style.top = best.top + 'px';
    element.style.transform = 'none';
    element.style.right = 'auto';
    element.style.bottom = 'auto';
    element.dataset.dcPlaced = 'true';
    return { left: best.left, top: best.top, width, height };
  }

  /* --------------------------------------------------------------- public */

  window.DerivCowsUI = {
    version: '1',
    state,
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    layout: { apply: applyLayout, refresh: () => applyLayout({ headerHeight: state.headerH, bottomNavHeight: state.bottomNavH }) },
    menus: {
      register,
      open: openMenu,
      close: closeMenu,
      toggle: toggleMenu,
      isOpen: (id) => {
        const spec = menuSpecs.get(id);
        return spec ? isOpen(spec) : false;
      },
      list: () => [...menuSpecs.keys()],
      closeAll: () => closeMajors(null),
    },
    notifications: {
      notify: notifyEvent,
      history: () => notifications.history.slice(),
      clear: () => { notifications.history.length = 0; },
      active: () => notifications.active.map((row) => row.item.type),
      queued: () => notifications.queue.length,
      flush: () => flush(),
    },
    placeFloating,
    layer(name) {
      return getComputedStyle(docEl).getPropertyValue('--dc-z-' + name).trim();
    },
  };

  function addSheetCloseControls() {
    const heads = [
      ['auto', document.querySelector('#rangerAutoHud .ranger-auto-heading')],
      ['chat', document.querySelector('#chatPanel > header')],
    ];
    for (const [id, head] of heads) {
      if (!head || head.querySelector('.dc-menu-close')) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'dc-menu-close';
      button.dataset.dcClose = id;
      button.setAttribute('aria-label', id === 'auto' ? 'Close Ranger Auto' : 'Close pasture chat');
      button.textContent = '×';
      button.addEventListener('click', () => closeMenu(id));
      head.appendChild(button);
    }
  }

  // State observers start after the initial DOM is ready.
  addSheetCloseControls();
  syncMenus();
  syncModal();
  positionLane();
  emit('ready');
})();

