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
  let lastCall = null;
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

  function verdictFor(trade, won) {
    if (!lastCall || Date.now() - lastCall.at > 10 * 60 * 1000) return null;
    const market = String(trade.market || trade.symbol || '');
    const direction = String(trade.direction || trade.contract_type || '').toUpperCase();
    const barrier = String(trade.barrier ?? trade.targetDigit ?? '');
    const sameMarket = !lastCall.market || market === lastCall.market;
    const sameDirection = !lastCall.kind || direction.includes(lastCall.kind);
    const sameBarrier = lastCall.barrier === '' || barrier === lastCall.barrier;
    return sameMarket && sameDirection && sameBarrier ? (won ? 'right' : 'wrong') : null;
  }

  function noteLearning(trade) {
    const id = trade && trade.id != null ? String(trade.id) : '';
    if (!id || seenTrades.has(id)) return false;
    seenTrades.add(id);
    const won = String(trade.status).toLowerCase() === 'won';
    const profit = Number(trade.profit);
    const verdict = verdictFor(trade, won);
    learned.unshift({
      id,
      market: trade.market || trade.symbol || 'Market',
      direction: String(trade.direction || trade.contract_type || '').toUpperCase(),
      barrier: trade.barrier ?? trade.targetDigit ?? '',
      status: won ? 'won' : 'lost',
      verdict,
      profit: Number.isFinite(profit) ? profit : null,
      ts: Date.now(),
    });
    learned = learned.slice(0, 40);
    saveLearned();
    learnCount += 1;
    pulseLearned(won, verdict);
    return true;
  }

  function pulseLearned(won, verdict) {
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
    pop.textContent = verdict === 'right' ? 'CALLED IT' : verdict === 'wrong' ? 'MISSED · learned' : '+1 learned';
    pop.dataset.verdict = verdict || '';
    pop.dataset.win = String(!!won);
    glyph.classList.remove('called-right', 'called-wrong');
    if (verdict === 'right') glyph.classList.add('called-right');
    if (verdict === 'wrong') glyph.classList.add('called-wrong');
    setTimeout(() => glyph.classList.remove('called-right', 'called-wrong'), 1900);
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
        const call = row.verdict === 'right' ? '<em class="brain-call-chip is-right">I called it</em>' : row.verdict === 'wrong' ? '<em class="brain-call-chip is-wrong">I missed</em>' : '';
        card.innerHTML = `<b>${state}</b>${call}<span>${row.market} ${row.direction} ${row.barrier}</span><small>${money} · learned from this bet</small>`;
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
    if (cur) parts.push(`Right now ${plainVerdict(cur.verdict)}.`);
    else if (best) parts.push(`Best hour ${best.label}: ${plainVerdict(best.verdict)}.`);
    if (Number.isFinite(report.winRate) && Number.isFinite(report.breakeven)) parts.push(`${pct(report.winRate)} wins vs ${pct(report.breakeven)} break-even.`);
    why.textContent = parts.join(' ');
    if (ev) ev.textContent = `${outcomes} of ${target} practice games finished.`;
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
    // Night pasture: indigo sky, moonlit ridge, purple rim light.
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#0B0D14');
    sky.addColorStop(0.55, '#131629');
    sky.addColorStop(0.56, '#1B2340');
    sky.addColorStop(1, '#101426');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
    // stars
    ctx.fillStyle = 'rgba(226,232,240,.8)';
    for (let i = 0; i < 14; i += 1) {
      const sx = (((i * 73) % 100) / 100) * w;
      const sy = (((i * 37) % 44) / 100) * h;
      ctx.globalAlpha = reduce() ? 0.65 : 0.4 + Math.abs(Math.sin(t / 900 + i)) * 0.55;
      ctx.fillRect(sx, sy, 1.4, 1.4);
    }
    ctx.globalAlpha = 1;
    // moon + halo
    const moonX = w * 0.8, moonY = h * 0.2, moonR = Math.max(8, Math.min(14, w * 0.042));
    const halo = ctx.createRadialGradient(moonX, moonY, 1, moonX, moonY, moonR * 3.6);
    halo.addColorStop(0, 'rgba(196,181,253,.45)');
    halo.addColorStop(1, 'rgba(139,92,246,0)');
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(moonX, moonY, moonR * 3.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#EDE9FE'; ctx.beginPath(); ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2); ctx.fill();
    // far ridge
    ctx.fillStyle = '#141B2E';
    ctx.beginPath(); ctx.moveTo(0, h * 0.6);
    for (let x = 0; x <= w; x += 14) ctx.lineTo(x, h * 0.6 - Math.sin((x / Math.max(1, w)) * 5.4) * h * 0.05);
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fill();
    // pasture floor
    const floor = ctx.createLinearGradient(0, h * 0.6, 0, h);
    floor.addColorStop(0, '#1D3A31');
    floor.addColorStop(1, '#0F1B18');
    ctx.fillStyle = floor; ctx.fillRect(0, h * 0.6, w, h * 0.4);
    // fence with rim light
    ctx.strokeStyle = 'rgba(167,139,250,.4)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, h * 0.68); ctx.lineTo(w, h * 0.68); ctx.stroke();
    ctx.strokeStyle = 'rgba(226,232,240,.3)';
    for (let x = 8; x < w; x += 26) { ctx.beginPath(); ctx.moveTo(x, h * 0.68); ctx.lineTo(x, h * 0.58); ctx.stroke(); }
    // ground shadow under the cow
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.beginPath(); ctx.ellipse(w * 0.64, h * 0.785, Math.max(18, w * 0.09), Math.max(3, h * 0.022), 0, 0, Math.PI * 2); ctx.fill();
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
    ctx.strokeStyle = `rgba(167,139,250,${glow})`; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(0, -31, 6, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    // learning sparks
    if (!reduce()) {
      for (let i = 0; i < 3; i += 1) {
        const p = ((t / 1400) + i / 3) % 1;
        ctx.globalAlpha = 1 - p;
        ctx.fillStyle = '#C4B5FD';
        ctx.beginPath(); ctx.arc(w * 0.17 + Math.sin(p * 6) * 4, h * 0.66 - 30 - p * 22, 1.7, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  /* Close-up portrait so the ranger is part of the menu, not the page behind it. */
  function drawPortrait(ctx, size, t) {
    const c = size / 2;
    ctx.clearRect(0, 0, size, size);
    const bg = ctx.createLinearGradient(0, 0, 0, size);
    bg.addColorStop(0, '#151827');
    bg.addColorStop(1, '#0B0D14');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, size, size);
    // shoulders
    ctx.fillStyle = '#2F6FB0';
    ctx.beginPath(); ctx.ellipse(c, size * 1.02, size * 0.42, size * 0.30, 0, Math.PI, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#255B93';
    ctx.beginPath(); ctx.ellipse(c, size * 1.02, size * 0.16, size * 0.20, 0, Math.PI, Math.PI * 2); ctx.fill();
    // neck
    ctx.fillStyle = '#B98A64';
    ctx.fillRect(c - size * 0.07, size * 0.60, size * 0.14, size * 0.14);
    // head
    ctx.fillStyle = '#D8A87E';
    ctx.beginPath(); ctx.arc(c, size * 0.47, size * 0.21, 0, Math.PI * 2); ctx.fill();
    // hair + hat
    ctx.fillStyle = '#3A2A1E';
    ctx.beginPath(); ctx.arc(c, size * 0.44, size * 0.215, Math.PI * 1.02, Math.PI * 1.98); ctx.fill();
    ctx.fillStyle = '#4A3524';
    ctx.beginPath(); ctx.ellipse(c, size * 0.31, size * 0.27, size * 0.055, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(c, size * 0.25, size * 0.15, size * 0.10, 0, Math.PI, Math.PI * 2); ctx.fill();
    // bandana
    ctx.fillStyle = '#C0453C';
    ctx.beginPath();
    ctx.moveTo(c - size * 0.20, size * 0.57);
    ctx.quadraticCurveTo(c, size * 0.67, c + size * 0.20, size * 0.57);
    ctx.lineTo(c + size * 0.16, size * 0.63);
    ctx.quadraticCurveTo(c, size * 0.71, c - size * 0.16, size * 0.63);
    ctx.closePath(); ctx.fill();
    // eyes, with a slow blink
    const blink = reduce() ? 1 : (Math.sin(t / 1600) > 0.985 ? 0.15 : 1);
    ctx.fillStyle = '#241A12';
    for (const dx of [-0.075, 0.075]) {
      ctx.beginPath(); ctx.ellipse(c + size * dx, size * 0.475, size * 0.022, size * 0.028 * blink, 0, 0, Math.PI * 2); ctx.fill();
    }
    // smile
    ctx.strokeStyle = '#8A5B3F'; ctx.lineWidth = Math.max(1, size * 0.014); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(c, size * 0.51, size * 0.07, 0.3, Math.PI - 0.3); ctx.stroke();
    // thinking glow above the hat
    const glow = reduce() ? 0.5 : 0.32 + Math.sin(t / 520) * 0.2;
    ctx.strokeStyle = `rgba(167,139,250,${glow})`; ctx.lineWidth = Math.max(1.2, size * 0.022);
    ctx.beginPath(); ctx.arc(c, size * 0.13, size * 0.075, 0, Math.PI * 2); ctx.stroke();
    // vignette
    const vig = ctx.createRadialGradient(c, size * 0.5, size * 0.2, c, size * 0.5, size * 0.72);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,.5)');
    ctx.fillStyle = vig; ctx.fillRect(0, 0, size, size);
  }

  let portrait = null;
  function mountPortrait() {
    const panel = $('rangerBrainPanel');
    if (!panel || panel.querySelector('.brain-portrait')) return;
    const header = panel.querySelector('header');
    if (!header) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'brain-portrait';
    canvas.setAttribute('aria-hidden', 'true');
    header.insertBefore(canvas, header.firstChild);
    portrait = canvas;
  }

  function paintPortrait(now) {
    if (!portrait) return;
    const size = portrait.clientWidth || 42;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = Math.max(42, Math.round(size * dpr));
    if (portrait.width !== px || portrait.height !== px) { portrait.width = px; portrait.height = px; }
    const ctx = portrait.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawPortrait(ctx, size, now);
  }

  const TAB_LABELS = { mind: 'Brain', thinking: 'Think', learned: 'Learned', memory: 'Memory', settings: 'Setup' };
  function compactTabLabels() {
    const panel = $('rangerBrainPanel');
    if (!panel) return;
    for (const button of panel.querySelectorAll('[data-tab]')) {
      const want = TAB_LABELS[button.dataset.tab];
      if (!want) continue;
      const label = button.querySelector('span:last-child');
      if (!label) continue;
      if (!button.title) button.title = (label.textContent || want).trim();
      if (label.textContent.trim() !== want) label.textContent = want;
    }
  }

  function mountScenes() {
    mountPortrait();
    compactTabLabels();
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

  let sceneRaf = 0, sceneLastPaint = 0, sceneDirty = true;
  const SCENE_FRAME_MS = 50;

  function scenesVisible() {
    const panel = $('rangerBrainPanel');
    return !!panel && !panel.hidden && !document.hidden;
  }

  function paintScenes(now) {
    for (const scene of scenes) {
      if (sceneDirty || !scene.w || !scene.h) {
        const rect = scene.canvas.getBoundingClientRect();
        scene.w = Math.max(120, Math.round(rect.width));
        scene.h = Math.max(56, Math.round(rect.height));
      }
      const w = scene.w, h = scene.h;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (scene.canvas.width !== w * dpr || scene.canvas.height !== h * dpr) {
        scene.canvas.width = w * dpr; scene.canvas.height = h * dpr;
      }
      const ctx = scene.canvas.getContext('2d');
      if (!ctx) continue;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawCowScene(ctx, w, h, now, scene.kind);
    }
    paintPortrait(now);
    sceneDirty = false;
  }

  // The card scenes are decoration: never spend a frame on them while the
  // brain menu is closed or the tab is hidden.
  function loopScenes(now) {
    if (!scenesVisible()) { sceneRaf = 0; return; }
    if (!sceneLastPaint || now - sceneLastPaint >= SCENE_FRAME_MS) {
      sceneLastPaint = now;
      paintScenes(now);
    }
    sceneRaf = requestAnimationFrame(loopScenes);
  }

  function startScenes(force) {
    if (force) sceneDirty = true;
    if (!sceneRaf && scenesVisible()) sceneRaf = requestAnimationFrame(loopScenes);
  }

  window.addEventListener('resize', () => { sceneDirty = true; startScenes(); }, { passive: true });

  /* ---------- sniper suggestion: tether + countdown + override info ---------- */
  let overlay = null, card = null, tether = null, snipeTimer = 0, snipeRaf = 0;
  let activeSuggestion = null;

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'brainSnipeOverlay';
    overlay.hidden = true;
    overlay.innerHTML = '<svg class="brain-tether" aria-hidden="true"><defs><linearGradient id="brainTetherGrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8B5CF6"/><stop offset="1" stop-color="#FF4D91"/></linearGradient></defs><path id="brainTetherPath" d="" fill="none" stroke="url(#brainTetherGrad)" stroke-width="3" stroke-linecap="round" stroke-dasharray="7 7"/><circle id="brainTetherPulse" r="5" fill="#ffe19a"/></svg><div class="brain-snipe-card" role="status" aria-live="polite"><b id="brainSnipeTitle">Brain pick</b><span id="brainSnipeLine">Scanning the herd…</span><span id="brainSnipeWhy" class="brain-snipe-why"></span><b class="brain-snipe-why-head">Why this cow</b><ul id="brainSnipeFactors" class="brain-snipe-factors" aria-label="Reasons the brain picked this cow"></ul><span id="brainSnipeRecord" class="brain-snipe-record"></span><span id="brainSnipeExec" class="brain-snipe-exec"></span><span id="brainSnipeCount" class="brain-snipe-count"></span><i class="brain-snipe-bar"><i id="brainSnipeBarFill"></i></i></div>';
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
    const cardW = card.offsetWidth || 238, cardH = card.offsetHeight || 160;
    card.style.left = Math.max(6, Math.min(innerWidth - cardW - 8, target.sx + 26)) + 'px';
    card.style.top = Math.max(6, Math.min(innerHeight - cardH - 8, target.sy - cardH - 16)) + 'px';
  }

  function renderSuggestion(snipe) {
    const snap = bridge()?.snapshot?.() || {};
    const left = Math.max(0, Math.ceil((snipe.until - performance.now()) / 1000));
    const total = 12;
    const title = $('brainSnipeTitle'), line = $('brainSnipeLine'), why = $('brainSnipeWhy'), exec = $('brainSnipeExec'), count = $('brainSnipeCount'), fill = $('brainSnipeBarFill');
    if (title) title.textContent = `Brain pick · ${snipe.kind} ${snipe.barrier}`;
    if (line) line.textContent = `${snipe.market} · stake ${snipe.stake > 0 ? snipe.stake.toFixed(2) : 'blocked'} · enter in ${Math.max(1, snipe.enterAt - (snap.tickSeq?.[snipe.symbol] ?? snipe.tickSeq))} tick(s)`;
    if (why) why.textContent = `${(snipe.p * 100).toFixed(0)}% confidence · ${(snipe.edge >= 0 ? '+' : '')}${(snipe.edge * 100).toFixed(1)}% edge${snipe.limited ? ' · stake capped by risk limits' : ''}${snipe.reason ? ' · ' + snipe.reason : ''}`;
    renderFactors(snipe);
    const record = snipe.record && typeof snipe.record === 'object' ? snipe.record : null;
    const recordEl = $('brainSnipeRecord');
    if (recordEl) {
      const total = Number(record && record.total) || 0;
      const wins = Number(record && record.w) || 0;
      const losses = Number(record && record.l) || 0;
      recordEl.dataset.tone = total ? (wins >= losses ? 'good' : 'bad') : 'new';
      recordEl.textContent = total
        ? 'My record here: ' + wins + 'W / ' + losses + 'L · ' + Math.round((Number(record.rate) || 0) * 100) + '%'
        : 'First pick on this setup — no record yet';
    }
    if (exec) exec.textContent = 'Kill this cow to confirm the brain\'s stake and tick.';
    if (count) count.textContent = `${left}s left`;
    if (fill) fill.style.width = Math.max(0, Math.min(100, (left / total) * 100)) + '%';
    card?.classList.toggle('is-blocked', !(snipe.stake > 0));
    placeOverlay();
  }

  function renderFactors(snipe) {
    const host = $('brainSnipeFactors');
    if (!host) return;
    const rows = Array.isArray(snipe.factors) ? snipe.factors : [];
    const shown = rows.slice(0, 4);
    const key = shown.map((f) => String(f.key) + ':' + String(f.value)).join('|');
    if (host.dataset.key === key) return;
    host.dataset.key = key;
    host.replaceChildren();
    if (!shown.length) { host.hidden = true; return; }
    host.hidden = false;
    for (const factor of shown) {
      const row = document.createElement('li');
      row.className = 'brain-snipe-factor';
      row.dataset.key = String(factor.key || '');
      if (factor.detail) row.title = String(factor.detail);
      const label = document.createElement('span');
      label.className = 'brain-snipe-factor-label';
      label.textContent = String(factor.label || '');
      const value = document.createElement('b');
      value.textContent = String(factor.value || '');
      row.append(label, value);
      host.appendChild(row);
    }
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
    lastCall = { market: String(snipe.market || ''), kind: String(snipe.kind || '').toUpperCase(), barrier: String(snipe.barrier ?? ''), at: Date.now() };
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
    const scene = pane.querySelector('.brain-card-scene');
    pane.insertBefore(box, scene ? scene.nextSibling : pane.firstChild);
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

  function trimDuplicateNotes() {
    const panel = $('rangerBrainPanel');
    if (!panel) return;
    let seen = false;
    for (const note of panel.querySelectorAll('p')) {
      const text = (note.textContent || '').trim().toLowerCase();
      if (!/not (a )?(permission|trade permission|financial advice)|not permission to trade/.test(text)) continue;
      if (seen) { note.hidden = true; continue; }
      seen = true;
    }
  }

  function hideLearningBubble() {
    const bubble = $('rangerBrainBubble');
    if (!bubble) return;
    const text = (bubble.textContent || '').trim().toLowerCase();
    if (/still learning|collecting paper|not loaded|watching and learning/.test(text)) {
      bubble.hidden = true;
      bubble.dataset.visible = 'false';
    }
  }

  function wakeGlyph() {
    const glyph = $('rangerBrainGlyph');
    if (!glyph) return;
    glyph.classList.add('brain-waking');
    setTimeout(() => glyph.classList.remove('brain-waking'), 2600);
  }

  function showBrainBubble(text) {
    if (!showBrainBubble.timer) showBrainBubble.timer = 0;
    const bubble = $('rangerBrainBubble');
    if (!bubble) return;
    bubble.textContent = String(text);
    bubble.dataset.visible = 'true';
    bubble.hidden = false;
    clearTimeout(showBrainBubble.timer);
    showBrainBubble.timer = setTimeout(() => { bubble.hidden = true; bubble.dataset.visible = 'false'; }, 2600);
  }

  window.addEventListener('zeronine:brain-connection', (event) => {
    const connected = Boolean(event && event.detail && event.detail.connected);
    const glyph = $('rangerBrainGlyph');
    if (glyph) glyph.classList.toggle('is-live', connected);
    if (connected) showBrainBubble('Deriv connected');
    else hideLearningBubble();
  });

  function init() {
    mountScenes();
    compactTabLabels();
    wakeGlyph();
    hideLearningBubble();
    const bubble = $('rangerBrainBubble');
    if (bubble) new MutationObserver(hideLearningBubble).observe(bubble, { childList: true, characterData: true, subtree: true });
    ensureReplayBox();
    renderMemoryReplay();
    decorateLessons();
    refreshThinking();
    wireAutoSnipe();
    trimDuplicateNotes();
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
        if (open) startScenes(true); else clearSuggestion();
      }).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
    }
  }

  function boot() {
    try { init(); } catch (err) { console.warn('Ranger Brain visuals unavailable', err); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
