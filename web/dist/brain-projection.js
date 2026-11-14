/* Connect the open field journal to its moving in-game Brain control. */
(() => {
  'use strict';
  const panel = document.getElementById('rangerBrainPanel');
  const glyph = document.getElementById('rangerBrainGlyph');
  if (!panel || !glyph || window.__brainProjectionReady) return;
  window.__brainProjectionReady = true;
  glyph.classList.add('brain-glyph-enter');
  setTimeout(() => glyph.classList.remove('brain-glyph-enter'), 500);
  const ns = 'http://www.w3.org/2000/svg';
  const beam = document.createElementNS(ns, 'svg');
  beam.id = 'brainProjection';
  beam.setAttribute('aria-hidden', 'true');
  beam.setAttribute('focusable', 'false');
  beam.setAttribute('hidden', '');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('class', 'brain-projection-path');
  beam.append(path);
  document.body.append(beam);
  let frame = 0;
  let lastDraw = 0;
  function place(now) {
    if (panel.hidden) { frame = 0; return; }
    if (now - lastDraw >= 32) {
      lastDraw = now;
      const source = glyph.getBoundingClientRect();
      const target = panel.getBoundingClientRect();
      if (source.width && source.height && target.width && target.height) {
        const x = source.left + source.width / 2;
        const y = source.top + source.height / 2;
        let tx = Math.max(target.left, Math.min(target.right, x));
        const ty = Math.max(target.top, Math.min(target.bottom, y));
        const belowRanger = ty > y + 10 && Math.abs(tx - x) < source.width;
        if (belowRanger) {
          // A bottom sheet sits under the ranger: arc beside the face, never
          // draw a line straight down across the character.
          const offset = x > target.left + 68 ? -50 : 50;
          tx = Math.max(target.left + 12, Math.min(target.right - 12, x + offset));
        }
        const distance = Math.hypot(tx - x, ty - y);
        beam.setAttribute('viewBox', `0 0 ${innerWidth} ${innerHeight}`);
        if (distance > 12) {
          // Start outside the icon so the line does not cover its artwork.
          const inset = Math.min(distance, Math.max(source.width, source.height) * 0.6);
          const sx = x + (tx - x) * inset / distance;
          const sy = y + (ty - y) * inset / distance;
          if (belowRanger) {
            const side = tx < x ? -1 : 1;
            const startX = x + side * inset;
            path.setAttribute('d', `M ${startX} ${y} Q ${tx} ${y + 8} ${tx} ${ty}`);
          } else {
            path.setAttribute('d', `M ${sx} ${sy} L ${tx} ${ty}`);
          }
          beam.style.visibility = 'visible';
        } else {
          beam.style.visibility = 'hidden';
        }
        panel.style.transformOrigin = `${Math.max(0, Math.min(target.width, x - target.left))}px ${Math.max(0, Math.min(target.height, y - target.top))}px`;
      } else {
        beam.style.visibility = 'hidden';
      }
    }
    frame = requestAnimationFrame(place);
  }
  function sync() {
    if (panel.hidden) {
      beam.setAttribute('hidden', '');
      panel.classList.remove('brain-projecting');
      glyph.classList.remove('brain-glyph-project');
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      return;
    }
    beam.removeAttribute('hidden');
    panel.classList.add('brain-projecting');
    glyph.classList.add('brain-glyph-project');
    lastDraw = 0;
    if (!frame) frame = requestAnimationFrame(place);
  }
  new MutationObserver(sync).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  sync();
})();
