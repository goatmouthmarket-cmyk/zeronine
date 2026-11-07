(() => {
  if (window.__pastureBrainRefineV1) return;
  window.__pastureBrainRefineV1 = true;
  const $ = (id) => document.getElementById(id);
  const reduce = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function pct(v) { return Number.isFinite(v) ? (v * 100).toFixed(1) + '%' : '--'; }
  function plainVerdict(v) {
    if (v === 'favorable') return 'worth watching (paper evidence is in my favor)';
    if (v === 'unfavorable') return 'not performing well in paper tests';
    if (v === 'mixed') return 'still checking — results look mixed';
    return 'I need more practice before calling it';
  }
  function friendlyMind(report) {
    if (!report) return 'I cannot read my notes right now.';
    if (report.mind === 'paper_hunting') return 'Looking for high-edge setups';
    if (report.mind === 'waiting') return 'Waiting for favorable market hours';
    if (report.mind === 'offline' || !report.outcomes) return 'Watching and collecting paper experience';
    return 'Studying recent setups and learning from paper outcomes';
  }

  async function fetchReport() {
    try {
      const r = await fetch('/api/ranger-brain/status', { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } });
      if (!r.ok) return null;
      const p = await r.json();
      return p && p.report ? p.report : null;
    } catch { return null; }
  }

  let paperMemories = [];
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.source !== parent) return;
    const m = e.data || {};
    if (m.type !== 'zeronine:room-state') {
      return;
    }
    const s = m.state || {};
    const fromSim = (s.paperSimulation && Array.isArray(s.paperSimulation.recentTrades)) ? s.paperSimulation.recentTrades : [];
    const fromList = Array.isArray(s.paperTrades) ? s.paperTrades : [];
    const merged = [...fromSim, ...fromList].filter(t => t && (t.status === 'won' || t.status === 'lost'));
    if (merged.length) paperMemories = merged.slice(0, 12);
    renderMemoryReplay();
  });

  function renderThinking(report) {
    const state = $('brainSuggestionState');
    const why = $('brainSuggestionWhy');
    const ev = $('brainSuggestionEvidence');
    const card = $('brainSuggestionCard');
    if (!state || !why) return;

    // Ensure visual dashboard container exists inside card
    let visualBox = $('brainThinkingVisuals');
    if (!visualBox && card) {
      visualBox = document.createElement('div');
      visualBox.id = 'brainThinkingVisuals';
      card.insertBefore(visualBox, why);
    }

    if (!report) {
      state.textContent = 'Watching and learning from paper results.';
      why.textContent = 'I will explain a suggestion here when I can read real evidence. Suggestions are paper-research observations, not permission to place trades.';
      if (ev) ev.textContent = 'I compare completed paper outcomes against the break-even mark for the same setup. I only speak up when stored evidence supports it.';
      card?.setAttribute('data-state', 'learning');
      if (visualBox) visualBox.innerHTML = '';
      return;
    }

    const best = report.bestHour;
    const cur = report.currentHour;
    const outcomes = Number(report.outcomes) || 0;
    const target = Number(report.evidenceTarget) || 100;
    const winRate = Number(report.winRate);
    const breakeven = Number(report.breakeven);

    let label = 'Keep studying';
    let pulseClass = 'pulse-blue';
    if (report.mind === 'paper_hunting' && best && best.verdict === 'favorable') {
      label = 'Worth watching';
      pulseClass = 'pulse-green';
    } else if (report.mind === 'waiting' || (cur && cur.verdict === 'unfavorable')) {
      label = 'Wait for better conditions';
      pulseClass = 'pulse-amber';
    } else if (!outcomes || outcomes < Math.max(10, target * 0.25)) {
      label = 'Still exploring';
      pulseClass = 'pulse-blue';
    } else if (report.verdict === 'insufficient_evidence' || report.verdict === 'no_separable_edge') {
      label = 'No reliable edge yet';
      pulseClass = 'pulse-amber';
    }

    state.innerHTML = `<span class="brain-pulse-dot ${pulseClass}" aria-hidden="true"></span> <strong>${label}</strong> — ${friendlyMind(report)}`;

    // Build visual animated gauge & cards
    if (visualBox) {
      const winPct = Number.isFinite(winRate) ? Math.min(100, Math.max(0, winRate * 100)) : 0;
      const bePct = Number.isFinite(breakeven) ? Math.min(100, Math.max(0, breakeven * 100)) : 50;
      const progressPct = Math.min(100, Math.round((outcomes / Math.max(1, target)) * 100));

      visualBox.innerHTML = `
        <div class="brain-visual-grid">
          <div class="brain-visual-stat">
            <span class="brain-visual-stat-label">Paper Win Rate</span>
            <span class="brain-visual-stat-value" style="color: ${winRate >= breakeven ? '#17673b' : '#9c3822'}">
              ${pct(winRate)} <small style="font-size:9px;color:#7a6246;font-weight:700">req ${pct(breakeven)}</small>
            </span>
          </div>
          <div class="brain-visual-stat">
            <span class="brain-visual-stat-label">Evidence Progress</span>
            <span class="brain-visual-stat-value">
              ${outcomes} <small style="font-size:9px;color:#7a6246;font-weight:700">/ ${target} (${progressPct}%)</small>
            </span>
          </div>
        </div>
        <div class="brain-visual-gauge-card">
          <div class="brain-gauge-header">
            <span>Win Rate vs Break-even</span>
            <strong>${winRate >= breakeven ? 'POSITIVE EDGE' : 'BELOW TARGET'}</strong>
          </div>
          <div class="brain-gauge-track" title="Win Rate: ${pct(winRate)}, Break-even: ${pct(breakeven)}">
            <div class="brain-gauge-bar" style="width: ${winPct}%"></div>
            <div class="brain-gauge-target" style="left: ${bePct}%" title="Break-even target"></div>
          </div>
          <div class="brain-gauge-subtext">
            <span>0%</span>
            <span style="color:#c93b3b;font-weight:800">Target ${pct(breakeven)}</span>
            <span>100%</span>
          </div>
        </div>
      `;
    }

    const parts = [];
    if (best) parts.push(`Strongest studied hour (UTC): ${best.label} — ${plainVerdict(best.verdict)}${Number.isFinite(best.winRate) ? `, ${pct(best.winRate)} wins` : ''} over ${best.outcomes || 0} completed paper outcomes.`);
    if (cur) parts.push(`Right now (${cur.label} UTC): ${plainVerdict(cur.verdict)} based on ${cur.outcomes || 0} completed paper outcomes.`);
    if (Number.isFinite(winRate) && Number.isFinite(breakeven)) parts.push(`Overall paper win rate ${pct(winRate)} vs break-even ${pct(breakeven)} (${outcomes} completed outcomes).`);
    parts.push('This is a paper-research suggestion, not permission to place demo or real trades.');
    why.textContent = parts.join(' ');
    if (ev) ev.textContent = `Evidence: ${outcomes} of ${target} completed paper outcomes for ${report.market || 'this market'} (lookback ${report.lookbackDays || '?'} days). I only separate hours from break-even when stored evidence supports it.`;
    card?.setAttribute('data-state', label.toLowerCase().includes('watch') ? 'watch' : label.toLowerCase().includes('wait') ? 'wait' : 'learning');
  }

  function decorateLessons() {
    const list = $('brainLessons');
    if (!list) return;
    list.querySelectorAll('li').forEach((li) => {
      if (li.dataset.refined) return;
      li.dataset.refined = '1';
      const small = li.querySelector('small');
      const meta = small ? small.textContent || '' : '';
      const chip = document.createElement('span');
      chip.className = 'brain-lesson-chip';
      const lower = meta.toLowerCase();
      chip.textContent = /validated/.test(lower) ? 'Supported by evidence' : /provisional/.test(lower) ? 'Still verifying' : 'Exploring pattern';
      li.insertBefore(chip, small || null);
      if (small) {
        const det = document.createElement('details');
        det.className = 'brain-evidence-details';
        const sum = document.createElement('summary'); sum.textContent = 'View Evidence';
        const p = document.createElement('p'); p.textContent = meta.replace(/\s*\|\s*/g, ' · ');
        det.append(sum, p);
        small.replaceWith(det);
      }
    });
  }

  function ensureReplayBox() {
    const pane = $('brainPaneMemory');
    if (!pane || $('brainReplayBox')) return $('brainReplayBox');
    const box = document.createElement('section');
    box.id = 'brainReplayBox';
    box.className = 'brain-memory-card';
    box.innerHTML = '<strong>Memory replay (read-only)</strong><p class="brain-friendly-note" id="brainReplayNote">I can replay a completed paper result as a short, read-only visual recap. This is a visual recap of a paper result — not a recorded shot path and never a real trade.</p><div class="brain-memory-actions" id="brainReplayActions" role="list" aria-label="Completed paper results"></div><div class="brain-replay-stage" id="brainReplayStage" aria-label="Paper result visual recap" hidden><div class="brain-replay-ground"></div><div class="brain-replay-ranger" aria-hidden="true"><span class="brain-replay-label">Ranger</span></div><div class="brain-replay-cow" id="brainReplayCow" aria-hidden="true"><span class="brain-replay-label">Cow</span></div><div class="brain-replay-arrow" aria-hidden="true"></div><div class="brain-replay-result" id="brainReplayResult" hidden></div><div class="brain-replay-caption" id="brainReplayCaption"></div></div>';
    pane.insertBefore(box, pane.firstChild);
    return box;
  }

  let replayTimer = 0;
  function playReplay(mem) {
    const stage = $('brainReplayStage'), cow = $('brainReplayCow'), res = $('brainReplayResult'), cap = $('brainReplayCaption');
    if (!stage || !cow || !res || !cap) return;
    clearTimeout(replayTimer);
    stage.hidden = false;
    stage.classList.remove('playing','hit');
    res.hidden = true; cow.style.opacity = '1'; cow.style.transform = '';
    const market = mem.market || mem.symbol || 'Market';
    const dir = String(mem.direction || mem.contract_type || '').toUpperCase().replace('DIGITOVER','OVER').replace('DIGITUNDER','UNDER');
    const barrier = mem.barrier != null ? mem.barrier : (mem.targetDigit != null ? mem.targetDigit : '?');
    const won = mem.status === 'won';
    const t = mem.updated_at || mem.exitEpoch || mem.opened_at || mem.ts;
    const when = t ? new Date(Number(t) < 2e10 ? Number(t) * 1000 : Number(t)).toLocaleTimeString() : '';
    cap.textContent = `Visual recap of paper outcome · ${market} ${dir} ${barrier}${when ? ' · ' + when : ''} · Virtual only`;
    void stage.offsetWidth;
    stage.classList.add('playing');
    replayTimer = setTimeout(() => {
      stage.classList.add('hit');
      res.hidden = false;
      res.textContent = won ? '✓ Paper Win (Virtual)' : '✗ Paper Loss (Virtual)';
      res.style.borderColor = won ? '#4ade80' : '#f87171';
      cap.textContent += won ? ' — Setup held up favorably.' : ' — Collecting more samples to verify.';
      replayTimer = setTimeout(() => { stage.classList.remove('playing'); }, 1400);
    }, reduce() ? 0 : 900);
  }

  function renderMemoryReplay() {
    ensureReplayBox();
    const actions = $('brainReplayActions'), note = $('brainReplayNote');
    if (!actions) return;
    actions.replaceChildren();
    const memories = paperMemories.filter(m => m && (m.status === 'won' || m.status === 'lost')).slice(0, 6);
    if (!memories.length) {
      if (note) note.textContent = 'I can replay a completed paper result as a short, read-only visual recap once paper outcomes are available here. This is a visual recap of a paper result — not a recorded shot path and never a real trade.';
      return;
    }
    if (note) note.textContent = 'Select a completed paper outcome below to watch an animated visual recap. Visual illustrative playback only.';
    memories.forEach((mem) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'brain-memory-tile' + (mem.status === 'won' ? ' is-win' : ' is-loss');
      b.setAttribute('role', 'listitem');
      const won = mem.status === 'won';
      const dir = String(mem.direction || mem.contract_type || '').toUpperCase().replace('DIGITOVER','OVER').replace('DIGITUNDER','UNDER');
      const market = mem.market || mem.symbol || 'Market';
      const barrier = mem.barrier ?? mem.targetDigit ?? '';
      b.innerHTML = `
        <span class="brain-memory-tile-state">
          <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${won ? '#258f55' : '#d94652'}"></span>
          ${won ? 'WON' : 'LOST'}
        </span>
        <span class="brain-memory-tile-main">${market} ${dir} ${barrier}</span>
        <span class="brain-memory-tile-sub">Tap to replay</span>
      `;
      b.setAttribute('aria-label', `${won ? 'Paper win' : 'Paper loss'}, ${market} ${dir} ${barrier}. Play read-only visual recap.`);
      b.addEventListener('click', () => playReplay(mem));
      actions.appendChild(b);
    });
  }

  async function refreshThinking() {
    if ($('brainPaneThinking')?.hidden === false || ($('rangerBrainPanel') && !$('rangerBrainPanel').hidden)) {
      const report = await fetchReport();
      renderThinking(report);
    }
  }

  function setupOneMenuMobile() {
    const panel = $('rangerBrainPanel');
    if (!panel) return;
    panel.setAttribute('aria-modal', 'false');
  }

  function init() {
    setupOneMenuMobile();
    ensureReplayBox();
    renderMemoryReplay();
    decorateLessons();
    refreshThinking();
    const root = $('rangerBrainPanel');
    if (root) {
      let t = 0;
      new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => { decorateLessons(); }, 80); }).observe(root, { childList: true, subtree: true, characterData: true });
    }
    document.addEventListener('click', (e) => {
      const t = e.target;
      if (t && t.closest && (t.closest('#rangerBrainGlyph') || t.closest('#brainTabThinking') || t.closest('[data-tab="thinking"]'))) {
        setTimeout(refreshThinking, 120);
      }
    }, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
