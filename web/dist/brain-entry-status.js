/* Compact Brain entry feedback. A held setup is only a check, not a purchase. */
(() => {
  'use strict';
  if (window.__brainEntryStatusReady) return;
  window.__brainEntryStatusReady = true;
  const status = document.createElement('div');
  status.className = 'brain-entry-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  status.hidden = true;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const shape = document.createElementNS(ns, 'path');
  svg.append(shape);
  const explanation = document.createElement('span');
  explanation.className = 'brain-entry-explanation';
  status.append(svg, explanation);
  document.body.append(status);
  const states = {
    held: { tone: 'held', path: 'M4 12.5 9.5 18 20 6', text: 'Setup held at the entry check. No trade has been confirmed yet.' },
    stale: { tone: 'waiting', path: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7v5l3 2', text: 'Market feed stale. No trade placed.' },
    changed: { tone: 'rejected', path: 'M5 5l14 14M19 5 5 19', text: 'Setup changed — no trade placed.' },
    moved: { tone: 'rejected', path: 'M5 5l14 14M19 5 5 19', text: 'Setup changed — no trade placed.' },
  };
  let expires = 0;
  let frame = 0;
  function position(now) {
    if (now >= expires) { status.hidden = true; frame = 0; return; }
    const head = window.__zeronineRanger?.head?.();
    if (head && Number.isFinite(head.x) && Number.isFinite(head.y)) {
      const place = window.DerivCowsUI?.placeFloating;
      if (typeof place === 'function') {
        place(status, { x: head.x, y: head.y - (head.r || 10) }, {
          gap: 15, padding: 8, hysteresis: 3000,
          avoid: ['#rangerBrainPanel', '#rangerBrainGlyph', '#rangerBet', '.paper-ranger-bet', '.live-ranger-wait', '#breakTimer', '#healthDock', '#inspector'],
        });
      } else {
        status.style.left = Math.max(8, Math.min(innerWidth - 32, head.x + 18)) + 'px';
        status.style.top = Math.max(8, Math.min(innerHeight - 32, head.y - 35)) + 'px';
      }
    }
    frame = requestAnimationFrame(position);
  }
  window.addEventListener('zeronine:brain-late-entry', event => {
    const state = states[String(event?.detail?.code || '')];
    if (!state) return;
    status.dataset.tone = state.tone;
    status.title = state.text;
    status.hidden = false;
    explanation.textContent = '';
    explanation.textContent = state.text;
    shape.setAttribute('d', state.path);
    expires = performance.now() + 5000;
    if (!frame) frame = requestAnimationFrame(position);
  });
})();
