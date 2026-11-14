/* Observe the existing report lifecycle without caching account or Brain data. */
(() => {
  'use strict';
  const panel = document.getElementById('rangerBrainPanel');
  const glyph = document.getElementById('rangerBrainGlyph');
  const pane = document.getElementById('brainPaneMind');
  if (!panel || !glyph || !pane || window.__brainLoadingReady) return;
  window.__brainLoadingReady = true;
  let resolved = (document.getElementById('brainUpdated')?.textContent || '').trim() !== 'Not loaded';
  const mask = document.createElement('div');
  mask.className = 'brain-loading-mask';
  mask.setAttribute('role', 'status');
  mask.setAttribute('aria-live', 'polite');
  mask.hidden = true;
  const label = document.createElement('span');
  label.className = 'brain-loading-label';
  label.textContent = 'Reading practice results…';
  mask.append(label);
  for (let i = 0; i < 3; i++) {
    const block = document.createElement('span');
    block.className = 'brain-loading-block';
    block.setAttribute('aria-hidden', 'true');
    mask.append(block);
  }
  pane.prepend(mask);
  function sync() {
    const busy = !panel.hidden && glyph.classList.contains('computing');
    panel.setAttribute('aria-busy', String(busy));
    mask.hidden = !busy || resolved;
  }
  document.addEventListener('zeronine:brain-report', () => { resolved = true; sync(); });
  new MutationObserver(sync).observe(glyph, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(sync).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  sync();
})();
