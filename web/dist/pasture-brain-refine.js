(() => {
  if (window.__pastureBrainRefineV2) return;
  window.__pastureBrainRefineV2 = true;
  const $ = (id) => document.getElementById(id);
  const reduce = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const LEARNING_KEY = 'ranger-brain-learning-v1';
  const bridge = () => window.__zeronineBrainBridge || null;

  function pct(v) { return Number.isFinite(v) ? (v * 100).toFixed(1) + '%' : '--'; }
  function plainVerdict(v) {
    if (v === 'favorable') return 'good in practice games';
    if (v === 'unfavorable') return 'not working in practice games';
    if (v === 'mixed') return 'sometimes good, sometimes not';
    return 'not enough practice games yet';
  }
  function friendlyMind(report) {
    if (!report) return 'I can’t read my notes right now.';
    if (report.mind === 'paper_hunting') return 'Looking for a good cow to practise on';
    if (report.mind === 'waiting') return 'Waiting for a better moment';
    if (report.mind === 'offline' || !report.outcomes) return 'Watching and collecting practice games';
    return 'Studying my practice games and learning from them';
  }

  /* ---------- learning log: one entry per settled bet ---------- */
  let learned = [];
  try {
    const saved = JSON.parse(localStorage.getItem(LEARNING_KEY) || '[]');
    if (Array.isArray(saved)) learned = saved.slice(0, 40);
  } catch {}
  const seenTrades = new Set(learned.map((row) => String(row.id)).filter(Boolean));
  let learnCount = 0;

  function saveLearned() {
    try { localStorage.setItem(LEARNING_KEY, JSON.stringify(learned.slice(0, 40))); } catch {}
  }

  function noteLearning(trade) {
    const id = trade && trade.id != null ? String(trade.id) : '';
    if (!id || seenTrades.has(id)) return false;
    seenTrades.add(id);
    const won = String(trade.status).toLowerCase() === 'won';
    const profit = Number(trade.profit);
    learned.unshift({
      id,
      market: trade.market || trade.symbol || 'Market',
      direction: String(trade.direction || trade.contract_type || '').toUpperCase(),
      barrier: trade.barrier ?? trade.targetDigit ?? '',
      status: won ? 'won' : 'lost',
      profit: Number.isFinite(profit) ? profit : null,
      ts: Date.now(),
    });
    learned = learned.slice(0, 40);
    saveLearned();
    learnCount += 1;
    pulseLearned(won);
    return true;
  }

  function pulseLearned(won) {
    const glyph = $('rangerBrainGlyph');
    if (!glyph) return;
    glyph.classList.remove('learned-pop');
    void glyph.offsetWidth;
    glyph.classList.add('learned-pop');
    setTimeout(() => glyph.classList.remove('learned-pop'), 1700);
    let pop = $('brainLearnPop');
    if (!pop) {
      pop = document.createElement('span');
      pop.id = 'brainLearnPop';
      pop.className = 'brain-learn-pop';
      pop.setAttribute('aria-hidden', 'true');
      glyph.appendChild(pop);
    }
    pop.textContent = '+1 learned';
    pop.dataset.win = String(!!won);
    pop.classList.remove('show');
    void pop.offsetWidth;
    pop.classList.add('show');
    clearTimeout(pop._timer);
    pop._timer = setTimeout(() => pop.classList.remove('show'), 2200);
    renderLearnedCards();
  }

  let learnedSig = '';
  function renderLearnedCards(force) {
    const list = $('brainLessons');
    if (!list) return;
    const sig = learned.slice(0, 4).map((row) => row.id + ':' + row.status).join('|');
    if (!force && sig === learnedSig) return;
    learnedSig = sig;
    const box = document.createElement('div');
    box.className = 'brain-learn-strip';
    box.setAttribute('aria-label', 'Newest things the ranger learned from its own bets');
    const newest = learned.slice(0, 4);
    if (!newest.length) {
      box.innerHTML = '<p class="brain-friendly-note">No practice bets yet. Every bet that finishes becomes a lesson here.</p>';
    } else {
      for (const row of newest) {
        const card = document.createElement('article');
        card.className = 'brain-learn-card ' + (row.status === 'won' ? 'is-win' : 'is-loss');
        const state = row.status === 'won' ? 'WORKED' : 'DIDN\'T WORK';
        const money = Number.isFinite(row.profit) ? (row.profit >= 0 ? '+' : '') + row.profit.toFixed(2) : '--';
        card.innerHTML = `<b>${state}</b><span>${row.market} ${row.direction} ${row.barrier}</span><small>${money} · learned from this bet</small>`;
        box.appendChild(card);
      }
    }
    let host = $('brainLearnHost');
    if (!host) {
      host = document.createElement('div');
      host.id = 'brainLearnHost';
      list.parentNode.insertBefore(host, list);
    }
    host.replaceChildren(box);
  }

  /* ---------- report / thinking text ---------- */
  async function fetchReport() {
    try {
      const r = await fetch('/api/ranger-brain/status', { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } });
      if (!r.ok) return null;
      const p = await r.json();
      return p && p.report ? p.report : null;
    } catch { return null; }
  }

  function renderThinking(report) {
    const state = $('brainSuggestionState');
    const why = $('brainSuggestionWhy');
    const ev = $('brainSuggestionEvidence');
    const card = $('brainSuggestionCard');
    if (!state || !why) return;
    if (!report) {
      state.textContent = 'Watching and learning from practice games.';
      why.textContent = 'I will explain a suggestion here when I can read real evidence. A suggestion is not permission to place a trade.';
      if (ev) ev.textContent = 'I compare finished practice results against the break-even mark for the same setup.';
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
    if (best) parts.push(`Best practice hour: ${best.label} — ${plainVerdict(best.verdict)}${Number.isFinite(best.winRate) ? `, ${pct(best.winRate)} wins` : ''} over ${best.outcomes || 0} finished practice games.`);
    if (cur) parts.push(`Right now (${cur.label}): ${plainVerdict(cur.verdict)} from ${cur.outcomes || 0} finished practice games.`);
    if (Number.isFinite(report.winRate) && Number.isFinite(report.breakeven)) parts.push(`Overall practice win rate ${pct(report.winRate)} vs break-even ${pct(report.breakeven)}.`);
    parts.push('This is a practice-game observation, not permission to trade.');
    why.textContent = parts.join(' ');
    if (ev) ev.textContent = `Evidence: ${outcomes} of ${target} finished practice games for ${report.market || 'this market'}.`;
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
      chip.textContent = /validated/.test(lower) ? 'Checked many times' : /provisional/.test(lower) ? 'Still checking' : 'Just started learning';
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
    renderLearnedCards();
  }

  /* ---------- animated card scenes (game assets, drawn) ---------- */
  const scenes = [];
  function drawCowScene(ctx, w, h, t, kind) {
    const grass = ctx.createLinearGradient(0, 0, 0, h);
    grass.addColorStop(0, '#79ad66');
    grass.addColorStop(0.62, '#5f9a54');
    grass.addColorStop(0.62, '#6b5a3d');
    grass.addColorStop(1, '#55462f');
    ctx.fillStyle = grass; ctx.fillRect(0, 0, w, h);
    // fence
    ctx.strokeStyle = 'rgba(246,232,196,.45)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, h * 0.68); ctx.lineTo(w, h * 0.68); ctx.stroke();
    for (let x = 8; x < w; x += 26) { ctx.beginPath(); ctx.moveTo(x, h * 0.68); ctx.lineTo(x, h * 0.6); ctx.stroke(); }
    const bob = reduce() ? 0 : Math.sin(t / 700) * 1.5;
    // cow
    ctx.save();
    ctx.translate(w * (kind === 'learned' ? 0.62 : 0.66), h * 0.6 + bob);
    ctx.fillStyle = '#f0e4ce';
    ctx.beginPath(); ctx.ellipse(0, -6, 20, 12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#765140';
    ctx.beginPath(); ctx.ellipse(-7, -12, 9, 5, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e9ddc6';
    ctx.beginPath(); ctx.ellipse(17, -10, 9, 8, -0.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#b9ac97'; ctx.fillRect(-13, 3, 5, 12); ctx.fillRect(8, 3, 5, 12);
    ctx.fillStyle = '#2a2823'; ctx.beginPath(); ctx.arc(15, -13, 1.4, 0, Math.PI * 2); ctx.arc(20, -13, 1.4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // ranger
    ctx.save();
    ctx.translate(w * 0.17, h * 0.66);
    ctx.fillStyle = '#14362570'; ctx.beginPath(); ctx.ellipse(0, 14, 13, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#393a3d'; ctx.fillRect(-7, 2, 5, 12); ctx.fillRect(2, 2, 5, 12);
    ctx.fillStyle = '#326db1'; ctx.beginPath(); ctx.roundRect(-9, -12, 18, 16, 3); ctx.fill();
    ctx.fillStyle = '#cba17d'; ctx.beginPath(); ctx.arc(0, -19, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4d3729'; ctx.beginPath(); ctx.arc(0, -21, 7, Math.PI, Math.PI * 2); ctx.fill();
    // brain glow above the head
    const glow = 0.35 + (reduce() ? 0 : Math.sin(t / 420) * 0.18);
    ctx.strokeStyle = `rgba(255,225,154,${glow})`; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(0, -31, 6, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    // learning sparks
    if (!reduce()) {
      for (let i = 0; i < 3; i += 1) {
        const p = ((t / 1400) + i / 3) % 1;
        ctx.globalAlpha = 1 - p;
        ctx.fillStyle = '#ffe19a';
        ctx.beginPath(); ctx.arc(w * 0.17 + Math.sin(p * 6) * 4, h * 0.66 - 30 - p * 22, 1.7, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  function mountScenes() {
    const panes = [$('brainPaneMind'), $('brainPaneThinking'), $('brainPaneLearned'), $('brainPaneMemory')].filter(Boolean);
    for (const pane of panes) {
      if (pane.querySelector('.brain-card-scene')) continue;
      const canvas = document.createElement('canvas');
      canvas.className = 'brain-card-scene';
      canvas.setAttribute('aria-hidden', 'true');
      const kind = pane.id === 'brainPaneLearned' ? 'learned' : pane.id === 'brainPaneMemory' ? 'memory' : 'mind';
      pane.insertBefore(canvas, pane.firstChild);
      scenes.push({ canvas, kind });
    }
  }

  function loopScenes(now) {
    for (const scene of scenes) {
      const rect = scene.canvas.getBoundingClientRect();
      const w = Math.max(120, Math.round(rect.width));
      const h = Math.max(56, Math.round(rect.height));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (scene.canvas.width !== w * dpr || scene.canvas.height !== h * dpr) {
        scene.canvas.width = w * dpr; scene.canvas.height = h * dpr;
      }
      const ctx = scene.canvas.getContext('2d');
      if (!ctx) continue;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawCowScene(ctx, w, h, now, scene.kind);
    }
    requestAnimationFrame(loopScenes);
  }

  /* ---------- sniper suggestion: tether + countdown + override info ---------- */
  let overlay = null, card = null, tether = null, snipeTimer = 0, snipeRaf = 0;
  let activeSuggestion = null;

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'brainSnipeOverlay';
    overlay.hidden = true;
    overlay.innerHTML = '<svg class="brain-tether" aria-hidden="true"><defs><linearGradient id="brainTetherGrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffe19a"/><stop offset="1" stop-color="#8ee6a7"/></linearGradient></defs><path id="brainTetherPath" d="" fill="none" stroke="url(#brainTetherGrad)" stroke-width="3" stroke-linecap="round" stroke-dasharray="7 7"/><circle id="brainTetherPulse" r="5" fill="#ffe19a"/></svg><div class="brain-snipe-card" role="status" aria-live="polite"><b id="brainSnipeTitle">Brain pick</b><span id="brainSnipeLine">Scanning the herd…</span><span id="brainSnipeWhy" class="brain-snipe-why"></span><span id="brainSnipeExec" class="brain-snipe-exec"></span><span id="brainSnipeCount" class="brain-snipe-count"></span><i class="brain-snipe-bar"><i id="brainSnipeBarFill"></i></i></div>';
    document.body.appendChild(overlay);
    tether = $('brainTetherPath');
    card = overlay.querySelector('.brain-snipe-card');
    return overlay;
  }

  function placeOverlay() {
    const api = bridge();
    if (!api || !activeSuggestion) return;
    const snap = api.snapshot();
    const target = snap.herd.find((cow) => cow.index === activeSuggestion.cowIndex);
    if (!target) { clearSuggestion(); return; }
    const x1 = snap.head.x, y1 = snap.head.y + 6, x2 = target.sx, y2 = target.sy - 34;
    const mid = Math.max(30, Math.min(120, Math.abs(x2 - x1) * 0.32));
    tether.setAttribute('d', `M ${x1} ${y1} C ${x1 + mid} ${y1 - 46}, ${x2 - mid} ${y2 - 30}, ${x2} ${y2}`);
    const pulse = $('brainTetherPulse');
    if (pulse) { pulse.setAttribute('cx', String(x1)); pulse.setAttribute('cy', String(y1)); }
    card.style.left = Math.max(6, Math.min(innerWidth - 220, target.sx + 26)) + 'px';
    card.style.top = Math.max(6, Math.min(innerHeight - 130, target.sy - 118)) + 'px';
  }

  function renderSuggestion(snipe) {
    const snap = bridge()?.snapshot?.() || {};
    const left = Math.max(0, Math.ceil((snipe.until - performance.now()) / 1000));
    const total = 12;
    const title = $('brainSnipeTitle'), line = $('brainSnipeLine'), why = $('brainSnipeWhy'), exec = $('brainSnipeExec'), count = $('brainSnipeCount'), fill = $('brainSnipeBarFill');
    if (title) title.textContent = `Brain pick · ${snipe.kind} ${snipe.barrier}`;
    if (line) line.textContent = `${snipe.market} · stake ${snipe.stake > 0 ? snipe.stake.toFixed(2) : 'blocked'} · enter in ${Math.max(1, snipe.enterAt - (snap.tickSeq?.[snipe.symbol] ?? snipe.tickSeq))} tick(s)`;
    if (why) why.textContent = `${(snipe.p * 100).toFixed(0)}% confidence · ${(snipe.edge >= 0 ? '+' : '')}${(snipe.edge * 100).toFixed(1)}% edge${snipe.limited ? ' · stake capped by risk limits' : ''}${snipe.reason ? ' · ' + snipe.reason : ''}`;
    if (exec) exec.textContent = 'Kill this cow to confirm the brain\'s stake and tick.';
    if (count) count.textContent = `${left}s left`;
    if (fill) fill.style.width = Math.max(0, Math.min(100, (left / total) * 100)) + '%';
    card?.classList.toggle('is-blocked', !(snipe.stake > 0));
    placeOverlay();
  }

  function clearSuggestion() {
    activeSuggestion = null;
    clearTimeout(snipeTimer);
    cancelAnimationFrame(snipeRaf);
    if (overlay) overlay.hidden = true;
    try { bridge()?.clearSnipe?.(); } catch {}
    const glyph = $('rangerBrainGlyph');
    glyph?.classList.remove('is-sniping');
  }

  function showSuggestion(snipe) {
    if (!snipe) return;
    ensureOverlay();
    const api = bridge();
    const snap = api?.snapshot?.();
    const cow = snap?.herd?.find((row) => row.index === snipe.cowId);
    activeSuggestion = { cowIndex: snipe.cowId, snipe, until: snipe.until };
    if (overlay) overlay.hidden = false;
    $('rangerBrainGlyph')?.classList.add('is-sniping');
    renderSuggestion(snipe);
    const tick = () => {
      if (!activeSuggestion) return;
      const live = bridge()?.activeSnipe?.();
      if (!live) { clearSuggestion(); return; }
      renderSuggestion(live);
      snipeRaf = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(snipeRaf);
    snipeRaf = requestAnimationFrame(tick);
    clearTimeout(snipeTimer);
    snipeTimer = setTimeout(clearSuggestion, Math.max(0, snipe.until - performance.now()));
    try {
      const glyph = $('rangerBrainGlyph');
      glyph?.classList.remove('sniped');
      void glyph?.offsetWidth;
      glyph?.classList.add('sniped');
    } catch {}
  }

  function suggest() {
    const api = bridge();
    const snipe = api?.suggest?.();
    if (!snipe) {
      const glyph = $('rangerBrainGlyph');
      glyph?.classList.remove('no-pick');
      void glyph?.offsetWidth;
      glyph?.classList.add('no-pick');
      return null;
    }
    showSuggestion(snipe);
    return snipe;
  }
  window.__zeronineBrainSuggest = suggest;

  /* ---------- room state: learning + replay ---------- */
  let paperMemories = [];
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.source !== parent) return;
    const m = e.data || {};
    if (m.type !== 'zeronine:room-state') return;
    const s = m.state || {};
    const trades = Array.isArray(s.trades) ? s.trades : [];
    for (const trade of trades) {
      if (!trade || !['won', 'lost'].includes(String(trade.status))) continue;
      noteLearning(trade);
    }
    const fromSim = (s.paperSimulation && Array.isArray(s.paperSimulation.recentTrades)) ? s.paperSimulation.recentTrades : [];
    const fromList = Array.isArray(s.paperTrades) ? s.paperTrades : [];
    const merged = [...fromSim, ...fromList].filter(t => t && (t.status === 'won' || t.status === 'lost'));
    if (merged.length) paperMemories = merged.slice(0, 12);
    renderMemoryReplay();
  });

  function ensureReplayBox() {
    const pane = $('brainPaneMemory');
    if (!pane || $('brainReplayBox')) return $('brainReplayBox');
    const box = document.createElement('section');
    box.id = 'brainReplayBox';
    box.className = 'brain-memory-card';
    box.innerHTML = '<strong>Memory replay (read-only)</strong><p class="brain-friendly-note" id="brainReplayNote">Pick a finished practice result to watch a short, read-only recap. This is a recap of a practice result — never a real trade.</p><div class="brain-memory-actions" id="brainReplayActions" role="list" aria-label="Finished practice results"></div><div class="brain-replay-stage" id="brainReplayStage" aria-label="Practice result visual recap" hidden><div class="brain-replay-ground"></div><div class="brain-replay-ranger" aria-hidden="true"><span class="brain-replay-label">Ranger</span></div><div class="brain-replay-cow" id="brainReplayCow" aria-hidden="true"><span class="brain-replay-label">Cow</span></div><div class="brain-replay-arrow" aria-hidden="true"></div><div class="brain-replay-result" id="brainReplayResult" hidden></div><div class="brain-replay-caption" id="brainReplayCaption"></div></div>';
    pane.insertBefore(box, pane.firstChild);
    return box;
  }

  let replayTimer = 0;
  function playReplay(mem) {
    const stage = $('brainReplayStage'), cow = $('brainReplayCow'), res = $('brainReplayResult'), cap = $('brainReplayCaption');
    if (!stage || !cow || !res || !cap) return;
    clearTimeout(replayTimer);
    stage.hidden = false;
    stage.classList.remove('playing', 'hit');
    res.hidden = true; cow.style.opacity = '1'; cow.style.transform = '';
    const market = mem.market || mem.symbol || 'Market';
    const dir = String(mem.direction || mem.contract_type || '').toUpperCase().replace('DIGITOVER', 'OVER').replace('DIGITUNDER', 'UNDER');
    const barrier = mem.barrier != null ? mem.barrier : (mem.targetDigit != null ? mem.targetDigit : '?');
    const won = mem.status === 'won';
    const t = mem.updated_at || mem.exitEpoch || mem.opened_at || mem.ts;
    const when = t ? new Date(Number(t) < 2e10 ? Number(t) * 1000 : Number(t)).toLocaleString() : 'time unavailable';
    cap.textContent = `Practice recap · ${market} ${dir} ${barrier} · ${when}. Virtual only.`;
    void stage.offsetWidth;
    stage.classList.add('playing');
    replayTimer = setTimeout(() => {
      stage.classList.add('hit');
      res.hidden = false;
      res.textContent = won ? 'Practice win' : 'Practice loss';
      cap.textContent += won ? ' I will keep studying setups like this.' : ' I will keep checking whether this setup holds up.';
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
      if (note) note.textContent = 'Pick a finished practice result to watch a short, read-only recap once practice outcomes exist. Never a real trade.';
      return;
    }
    if (note) note.textContent = 'Pick a finished practice result to watch a short, read-only recap. The scene illustrates the stored result; it never places a trade.';
    memories.forEach((mem) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'brain-memory-tile' + (mem.status === 'won' ? ' is-win' : ' is-loss');
      b.setAttribute('role', 'listitem');
      const won = mem.status === 'won';
      const dir = String(mem.direction || mem.contract_type || '').toUpperCase().replace('DIGITOVER', 'OVER').replace('DIGITUNDER', 'UNDER');
      const market = mem.market || mem.symbol || 'Market';
      const barrier = mem.barrier ?? mem.targetDigit ?? '';
      b.innerHTML = `<span class="brain-memory-tile-state">${won ? 'WIN' : 'LOSS'}</span><span class="brain-memory-tile-main">${market} ${dir} ${barrier}</span><span class="brain-memory-tile-sub">Practice recap</span>`;
      b.setAttribute('aria-label', `${won ? 'Practice win' : 'Practice loss'}, ${market} ${dir} ${barrier}. Play read-only visual recap.`);
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

  /* ---------- brain snipe automation toggle ---------- */
  function wireAutoSnipe() {
    const box = $('rangerBrainAutoSnipe');
    if (!box) return;
    try {
      box.checked = localStorage.getItem('ranger-brain-auto-snipe') === '1';
      bridge()?.setAutoSnipe?.(box.checked);
    } catch {}
    box.addEventListener('change', () => {
      try { localStorage.setItem('ranger-brain-auto-snipe', box.checked ? '1' : '0'); } catch {}
      bridge()?.setAutoSnipe?.(box.checked);
      if (box.checked) {
        $('rangerBrainGlyph')?.classList.add('is-sniping');
      } else {
        $('rangerBrainGlyph')?.classList.remove('is-sniping');
      }
    });
  }

  function init() {
    mountScenes();
    requestAnimationFrame(loopScenes);
    ensureReplayBox();
    renderMemoryReplay();
    decorateLessons();
    refreshThinking();
    wireAutoSnipe();
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
    // A right-click anywhere else on the brain glyph opens the menu; the
    // runtime handles that, so only keep the menu state in sync here.
    const panel = $('rangerBrainPanel');
    if (panel) {
      new MutationObserver(() => {
        const open = !panel.hidden;
        document.body?.classList?.toggle('brain-zoomed', open);
        if (!open) clearSuggestion();
      }).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
