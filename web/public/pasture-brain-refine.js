(() => {
  if (window.__pastureBrainRefineV1) return;
  window.__pastureBrainRefineV1 = true;
  const $ = (id) => document.getElementById(id);
  const reduce = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isMobile = () => window.matchMedia && matchMedia('(max-width: 700px)').matches;

  function pct(v) { return Number.isFinite(v) ? (v * 100).toFixed(1) + '%' : '--'; }
  function plainVerdict(v) {
    if (v === 'favorable') return 'worth watching (paper evidence is in my favor)';
    if (v === 'unfavorable') return 'not performing well in paper tests';
    if (v === 'mixed') return 'still checking — results look mixed';
    return 'I need more practice before calling it';
  }
  function friendlyMind(report) {
    if (!report) return 'I can’t read my notes right now.';
    if (report.mind === 'paper_hunting') return 'Looking for a good opportunity';
    if (report.mind === 'waiting') return 'Waiting for better conditions';
    if (report.mind === 'offline' || !report.outcomes) return 'Watching and collecting experience';
    return 'Studying recent trades and learning from outcomes';
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
    if (!report) {
      state.textContent = 'Watching and learning from paper results.';
      why.textContent = 'I’ll explain a suggestion here when I can read real evidence. Suggestions are paper-research observations, not permission to place trades.';
      if (ev) ev.textContent = 'I compare completed paper outcomes against the break-even mark for the same setup. I only speak up when stored evidence supports it.';
      card?.setAttribute('data-state', 'learning');
      return;
    }
    const best = report.bestHour;
    const cur = report.currentHour;
    const outcomes = Number(report.outcomes) || 0;
    const target = Number(report.evidenceTarget) || 100;
    let label = 'Keep studying';
    if (report.mind === 'paper_hunting' && best && best.verdict === 'favorable') label = 'Worth watching';
    else if (report.mind === 'waiting' || (cur && cur.verdict === 'unfavorable')) label = 'Wait for a better chance';
    else if (!outcomes || outcomes < Math.max(10, target * 0.25)) label = 'Still exploring';
    else if (report.verdict === 'insufficient_evidence' || report.verdict === 'no_separable_edge') label = 'No reliable signal yet';
    state.textContent = label + ' · ' + friendlyMind(report);
    const parts = [];
    if (best) parts.push(`Strongest studied hour (UTC): ${best.label} — ${plainVerdict(best.verdict)}${Number.isFinite(best.winRate) ? `, ${pct(best.winRate)} wins` : ''} over ${best.outcomes || 0} completed paper outcomes.`);
    if (cur) parts.push(`Right now (${cur.label} UTC): ${plainVerdict(cur.verdict)} based on ${cur.outcomes || 0} completed paper outcomes.`);
    if (Number.isFinite(report.winRate) && Number.isFinite(report.breakeven)) parts.push(`Overall paper win rate ${pct(report.winRate)} vs break-even ${pct(report.breakeven)} (${outcomes} completed outcomes).`);
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
      // Add friendly status chip without changing stored finding text.
      const chip = document.createElement('span');
      chip.className = 'brain-lesson-chip';
      const lower = meta.toLowerCase();
      chip.textContent = /validated/.test(lower) ? 'Supported by enough evidence' : /provisional/.test(lower) ? 'Still checking' : 'Still exploring';
      li.insertBefore(chip, small || null);
      if (small) {
        const det = document.createElement('details');
        det.className = 'brain-evidence-details';
        const sum = document.createElement('summary'); sum.textContent = 'How do I know?';
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
    const when = t ? new Date(Number(t) < 2e10 ? Number(t) * 1000 : Number(t)).toLocaleString() : 'time unavailable';
    cap.textContent = `Visual recap of a paper result · ${market} ${dir} ${barrier} · ${when}. Virtual only.`;
    void stage.offsetWidth;
    stage.classList.add('playing');
    replayTimer = setTimeout(() => {
      stage.classList.add('hit');
      res.hidden = false;
      res.textContent = won ? 'Paper win (virtual)' : 'Paper loss (virtual)';
      cap.textContent += won ? ' I’ll keep studying setups like this as evidence grows.' : ' I’ll keep checking whether this setup holds up with more evidence.';
      replayTimer = setTimeout(() => { stage.classList.remove('playing'); }, 1200);
    }, reduce() ? 0 : 900);
  }

  function renderMemoryReplay() {
    ensureReplayBox();
    const actions = $('brainReplayActions'), note = $('brainReplayNote');
    if (!actions) return;
    actions.replaceChildren();
    const memories = paperMemories.filter(m => m && (m.status === 'won' || m.status === 'lost')).slice(0, 5);
    if (!memories.length) {
      if (note) note.textContent = 'I can replay a completed paper result as a short, read-only visual recap once paper outcomes are available here. This is a visual recap of a paper result — not a recorded shot path and never a real trade.';
      return;
    }
    if (note) note.textContent = 'Choose a completed paper result to watch a short, read-only visual recap. The scene illustrates the stored result; it does not reproduce a recorded shot path or place any trade.';
    memories.forEach((mem) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'brain-memory-tile' + (mem.status === 'won' ? ' is-win' : ' is-loss');
      b.setAttribute('role', 'listitem');
      const won = mem.status === 'won';
      const dir = String(mem.direction || mem.contract_type || '').toUpperCase().replace('DIGITOVER','OVER').replace('DIGITUNDER','UNDER');
      const market = mem.market || mem.symbol || 'Market';
      const barrier = mem.barrier ?? mem.targetDigit ?? '';
      b.innerHTML = `<span class="brain-memory-tile-state">${won ? 'WIN' : 'LOSS'}</span><span class="brain-memory-tile-main">${market} ${dir} ${barrier}</span><span class="brain-memory-tile-sub">Paper recap</span>`;
      b.setAttribute('aria-label', `${won ? 'Paper win' : 'Paper loss'}, ${market} ${dir} ${barrier}. Play read-only visual recap.`);
      b.addEventListener('click', () => playReplay(mem));
      actions.appendChild(b);
    });
  }

  async function refreshThinking() {
    if ($('brainPaneThinking')?.hidden === false || $('rangerBrainPanel') && !$('rangerBrainPanel').hidden) {
      const report = await fetchReport();
      renderThinking(report);
    }
  }

  function setupOneMenuMobile() {
    // Keep Brain as a mobile bottom sheet feel; existing coordination is in pasture-ui-refine.js.
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
    // Re-decorate when runtime updates content.
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