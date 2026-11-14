/* Present the existing risk model as a compact review without changing its gates. */
(() => {
  'use strict';
  const body = document.getElementById('rangerRiskPreviewBody');
  if (!body || window.__pastureRiskCardReady) return;
  window.__pastureRiskCardReady = true;
  let advancedOpen = false;
  const important = new Set([
    'Account mode', 'Balance', 'Recovery style', 'Losses to cooldown', 'Cooldown',
    'Take profit', 'Maximum run loss', 'Tracked recovery debt', 'Net per winning trade',
    'Executable stake cap', 'Payout estimate',
  ]);
  function enhance() {
    const hero = body.querySelector(':scope > .risk-hero');
    if (!hero || body.querySelector(':scope > .risk-glance-config')) return;
    const blocks = Array.from(body.children).filter(el => el !== hero);
    const config = blocks.find(el => el.querySelector('.risk-settings'));
    const worst = blocks.find(el => el.querySelector('h4')?.textContent.trim() === 'Largest possible loss');
    if (!config || !worst) return;

    const summary = document.createElement('div');
    summary.className = 'risk-glance-config';
    summary.setAttribute('aria-label', 'Settings and estimate basis');
    for (const card of config.querySelectorAll('.risk-config-card')) {
      const label = card.querySelector('span')?.textContent?.trim();
      const value = card.querySelector('strong')?.textContent?.trim();
      if (!important.has(label) || !value) continue;
      const row = document.createElement('p');
      const name = document.createElement('span');
      const detail = document.createElement('strong');
      name.textContent = label;
      detail.textContent = value;
      row.append(name, detail);
      summary.append(row);
    }
    hero.after(summary);

    // Keep material model warnings visible before confirmation. These are the
    // original nodes, so no warning or broker-quote qualification is rewritten.
    const warnings = document.createElement('div');
    warnings.className = 'risk-glance-warnings';
    for (const block of blocks) {
      if (block === worst) continue;
      for (const warning of block.querySelectorAll('.risk-warn')) warnings.append(warning);
    }
    if (warnings.childElementCount) body.append(warnings);
    body.append(worst);
    worst.classList.add('risk-worst-visible');

    const details = document.createElement('details');
    details.className = 'risk-advanced';
    details.open = advancedOpen;
    details.addEventListener('toggle', () => { advancedOpen = details.open; });
    const toggle = document.createElement('summary');
    toggle.textContent = 'Advanced breakdown';
    details.append(toggle);
    for (const block of blocks) if (block !== worst) details.append(block);
    body.append(details);
  }
  new MutationObserver(enhance).observe(body, { childList: true, subtree: true });
  enhance();
})();
