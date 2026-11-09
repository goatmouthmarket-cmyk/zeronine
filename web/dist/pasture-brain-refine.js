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
      account: currentAccount(),
      kind: 'trade_review',
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
    // A settled trade is a review, not a new finding. Only a changed lesson
    // from the paper report may claim "New lesson".
    pop.textContent = verdict === 'right' ? 'Trade reviewed · called it' : verdict === 'wrong' ? 'Trade reviewed · missed' : 'Trade reviewed';
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
    pop._timer = setTimeout(() => pop.classList.remove('show'), 2400);
    renderLearnedCards();
    syncOverview();
  }

  let lessonSig = '';
  function lessonSignature() {
    const list = $('brainLessons');
    if (!list) return '';
    return Array.from(list.children).map((li) => (li.textContent || '').trim()).join('|');
  }
  function noteLessonChange(force) {
    const sig = lessonSignature();
    if (!sig || sig === lessonSig) {
      if (force) syncOverview();
      return false;
    }
    const first = !lessonSig;
    lessonSig = sig;
    syncOverview();
    if (!first) {
      const glyph = $('rangerBrainGlyph');
      const pop = glyph && $('brainLearnPop');
      if (pop) {
        pop.textContent = 'New lesson';
        pop.dataset.verdict = '';
        pop.classList.remove('show');
        void pop.offsetWidth;
        pop.classList.add('show');
        clearTimeout(pop._timer);
        pop._timer = setTimeout(() => pop.classList.remove('show'), 2400);
      }
    }
    return true;
  }

  let learnedSig = '';
  function renderLearnedCards(force) {
    const host = $('brainTradeReviewHost') || $('brainLearnHost');
    if (!host) return;
    const account = currentAccount();
    const rows = learned.filter((row) => !account || !row.account || String(row.account) === account).slice(0, 4);
    const sig = rows.map((row) => row.id + ':' + row.status).join('|');
    if (!force && sig === learnedSig) return;
    learnedSig = sig;
    const box = document.createElement('div');
    box.className = 'brain-learn-strip';
    box.setAttribute('aria-label', 'Newest reviewed trades');
    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'brain-friendly-note';
      empty.textContent = 'No reviewed trades yet. Each settled trade is checked here once.';
      box.appendChild(empty);
    } else {
      for (const row of rows) {
        const cardEl = document.createElement('article');
        cardEl.className = 'brain-learn-card ' + (row.status === 'won' ? 'is-win' : 'is-loss');
        const state = document.createElement('b');
        state.textContent = row.status === 'won' ? 'WIN' : 'LOSS';
        cardEl.appendChild(state);
        if (row.verdict === 'right' || row.verdict === 'wrong') {
          const chip = document.createElement('em');
          chip.className = 'brain-call-chip ' + (row.verdict === 'right' ? 'is-right' : 'is-wrong');
          chip.textContent = row.verdict === 'right' ? 'Called it' : 'Missed';
          cardEl.appendChild(chip);
        }
        const name = document.createElement('span');
        name.textContent = [row.market, row.direction, row.barrier].filter((part) => part !== '' && part != null).join(' ');
        cardEl.appendChild(name);
        const money = Number.isFinite(row.profit) ? (row.profit >= 0 ? '+' : '') + row.profit.toFixed(2) : '--';
        const meta = document.createElement('small');
        meta.textContent = money + ' · trade reviewed';
        cardEl.appendChild(meta);
        box.appendChild(cardEl);
      }
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
    // Warm daylight pasture in the same hand as the game art.
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#F8E8C6');
    sky.addColorStop(0.5, '#F1DCAE');
    sky.addColorStop(0.51, '#CFDFA9');
    sky.addColorStop(1, '#8FBF7C');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
    // low sun
    const sunX = w * 0.82, sunY = h * 0.22;
    const halo = ctx.createRadialGradient(sunX, sunY, 2, sunX, sunY, Math.max(30, w * 0.22));
    halo.addColorStop(0, 'rgba(255, 246, 214, .95)');
    halo.addColorStop(1, 'rgba(255, 246, 214, 0)');
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(sunX, sunY, Math.max(30, w * 0.22), 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#F4D287'; ctx.beginPath(); ctx.arc(sunX, sunY, Math.max(8, w * 0.036), 0, Math.PI * 2); ctx.fill();
    // hedge line
    ctx.fillStyle = '#A6CC92';
    ctx.beginPath(); ctx.moveTo(0, h * 0.55);
    for (let x = 0; x <= w; x += 12) ctx.lineTo(x, h * 0.55 - Math.abs(Math.sin(x / 44)) * h * 0.035);
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fill();
    // field
    const field = ctx.createLinearGradient(0, h * 0.6, 0, h);
    field.addColorStop(0, '#8FBF7C');
    field.addColorStop(1, '#6EAD68');
    ctx.fillStyle = field; ctx.fillRect(0, h * 0.6, w, h * 0.4);
    // fence
    ctx.strokeStyle = '#B98B55'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, h * 0.66); ctx.lineTo(w, h * 0.66); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, h * 0.6); ctx.lineTo(w, h * 0.6); ctx.stroke();
    ctx.strokeStyle = '#A7784A'; ctx.lineWidth = 2.6;
    for (let x = 7; x < w; x += 32) { ctx.beginPath(); ctx.moveTo(x, h * 0.575); ctx.lineTo(x, h * 0.715); ctx.stroke(); }
    // grass tufts
    ctx.strokeStyle = 'rgba(33, 88, 58, .38)'; ctx.lineWidth = 1;
    for (let i = 0; i < 18; i += 1) {
      const gx = (((i * 67) % 100) / 100) * w, gy = h * 0.71 + (((i * 29) % 24) / 100) * h;
      ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx + 1.6, gy - 4.5); ctx.stroke();
    }
    const bob = reduce() ? 0 : Math.sin(t / 760) * 1.4;
    if (kind === 'learned') {
      // Collected knowledge: an open field journal with pressed finds.
      const bw = Math.min(w * 0.42, 190), bh = Math.min(h * 0.74, 92);
      const bx = Math.min(w * 0.46, w - bw - 10), by = h * 0.13;
      ctx.save(); ctx.translate(bx, by); ctx.rotate(-0.03);
      ctx.fillStyle = 'rgba(48, 30, 10, .16)'; ctx.beginPath(); ctx.roundRect(4, 5, bw, bh, 6); ctx.fill();
      ctx.fillStyle = '#FFFDF4'; ctx.beginPath(); ctx.roundRect(0, 0, bw, bh, 6); ctx.fill();
      ctx.strokeStyle = 'rgba(90, 67, 38, .3)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.roundRect(0, 0, bw, bh, 6); ctx.stroke();
      ctx.strokeStyle = 'rgba(33, 88, 58, .28)'; ctx.lineWidth = 1;
      for (let line = 0; line < 4; line += 1) {
        const y = 20 + line * ((bh - 30) / 4);
        ctx.beginPath(); ctx.moveTo(14, y); ctx.lineTo(bw - 16, y); ctx.stroke();
      }
      ctx.fillStyle = '#6EAD68';
      for (let line = 0; line < 3; line += 1) { ctx.beginPath(); ctx.arc(9, 20 + line * ((bh - 30) / 4), 2, 0, Math.PI * 2); ctx.fill(); }
      // pressed leaf tucked into the page
      ctx.fillStyle = '#6EAD68';
      ctx.beginPath(); ctx.ellipse(bw - 34, bh - 24, 8, 4.5, -0.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#21583A'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(bw - 41, bh - 19); ctx.lineTo(bw - 27, bh - 29); ctx.stroke();
      ctx.restore();
      // ranger reading at the left
      ctx.save(); ctx.translate(w * 0.15, h * 0.74 + bob);
      ctx.fillStyle = 'rgba(33, 88, 58, .18)'; ctx.beginPath(); ctx.ellipse(0, 5, 12, 3.6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#393a3d'; ctx.fillRect(-6.5, -2, 4.6, 11); ctx.fillRect(2, -2, 4.6, 11);
      ctx.fillStyle = '#21583A'; ctx.beginPath(); ctx.roundRect(-8, -15, 16, 14, 3); ctx.fill();
      ctx.fillStyle = '#D8A87E'; ctx.beginPath(); ctx.arc(0, -21, 6.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#8C6636'; ctx.beginPath(); ctx.arc(0, -23, 6.6, Math.PI, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#B98B55'; ctx.beginPath(); ctx.ellipse(0, -25, 9, 1.8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      return;
    }
    if (kind === 'memory') {
      // A framed recap of a finished paper result.
      const fw = Math.min(w * 0.4, 180), fh = Math.min(h * 0.78, 100);
      const fx = Math.min(w * 0.44, w - fw - 12), fy = h * 0.1;
      ctx.save(); ctx.translate(fx, fy);
      ctx.fillStyle = 'rgba(48, 30, 10, .16)'; ctx.beginPath(); ctx.roundRect(4, 5, fw, fh, 8); ctx.fill();
      ctx.fillStyle = '#FFFDF4'; ctx.beginPath(); ctx.roundRect(0, 0, fw, fh, 8); ctx.fill();
      ctx.strokeStyle = '#B98B55'; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(0, 0, fw, fh, 8); ctx.stroke();
      ctx.save(); ctx.beginPath(); ctx.roundRect(6, 6, fw - 12, fh - 12, 5); ctx.clip();
      ctx.fillStyle = '#CFDFA9'; ctx.fillRect(6, 6, fw - 12, fh - 12);
      ctx.fillStyle = '#8FBF7C'; ctx.fillRect(6, fh * 0.56, fw - 12, fh);
      ctx.strokeStyle = '#B98B55'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(6, fh * 0.64); ctx.lineTo(fw - 6, fh * 0.64); ctx.stroke();
      // cow inside the frame
      ctx.save(); ctx.translate(fw * 0.6, fh * 0.58);
      ctx.fillStyle = '#FFF9E9'; ctx.beginPath(); ctx.ellipse(0, 0, 12, 7.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#B98B55'; ctx.beginPath(); ctx.ellipse(-4, -4, 5.5, 3, -0.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#EADFC5'; ctx.beginPath(); ctx.ellipse(10, -3, 5.4, 4.6, -0.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#393a3d'; ctx.fillRect(-7, 4, 3, 6.5); ctx.fillRect(4, 4, 3, 6.5);
      ctx.restore();
      ctx.restore();
      // replay stamp stays inside the frame's coordinate space
      ctx.fillStyle = 'rgba(33, 88, 58, .92)';
      ctx.beginPath(); ctx.roundRect(fw - 52, fh - 24, 44, 16, 4); ctx.fill();
      ctx.fillStyle = '#FFF9E9'; ctx.font = '700 8px Inter, system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.fillText('REPLAY', fw - 45, fh - 16);
      ctx.restore();
      // ranger watching the old result
      ctx.save(); ctx.translate(w * 0.16, h * 0.75 + bob);
      ctx.fillStyle = '#393a3d'; ctx.fillRect(-6.5, -2, 4.6, 11); ctx.fillRect(2, -2, 4.6, 11);
      ctx.fillStyle = '#21583A'; ctx.beginPath(); ctx.roundRect(-8, -15, 16, 14, 3); ctx.fill();
      ctx.fillStyle = '#D8A87E'; ctx.beginPath(); ctx.arc(0, -21, 6.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#8C6636'; ctx.beginPath(); ctx.arc(0, -23, 6.6, Math.PI, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#B98B55'; ctx.beginPath(); ctx.ellipse(0, -25, 9, 1.8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      return;
    }
    // ---------- observation scene: ranger + cow ----------
    // cow
    ctx.save();
    ctx.translate(w * (kind === 'mind' ? 0.68 : 0.66), h * 0.62 + bob);
    ctx.fillStyle = 'rgba(48, 30, 10, .2)'; ctx.beginPath(); ctx.ellipse(0, 12, 22, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#FFF9E9'; ctx.beginPath(); ctx.ellipse(0, -8, 21, 12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#B98B55'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(0, -8, 21, 12, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#B98B55'; ctx.beginPath(); ctx.ellipse(-7, -14, 9, 5, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#F3E8CF'; ctx.beginPath(); ctx.ellipse(17, -12, 9, 8, -0.2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#B98B55'; ctx.beginPath(); ctx.ellipse(17, -12, 9, 8, -0.2, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#D9C9A6'; ctx.fillRect(-13, 1, 5, 12); ctx.fillRect(8, 1, 5, 12);
    ctx.fillStyle = '#3B2A18'; ctx.beginPath(); ctx.arc(15, -15, 1.5, 0, Math.PI * 2); ctx.arc(20, -15, 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // ranger with a notebook
    ctx.save();
    ctx.translate(w * (kind === 'memory' ? 0.2 : 0.18), h * 0.7 + bob);
    ctx.fillStyle = 'rgba(33, 88, 58, .22)'; ctx.beginPath(); ctx.ellipse(0, 8, 13, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#393a3d'; ctx.fillRect(-7, -1, 5, 12); ctx.fillRect(2, -1, 5, 12);
    ctx.fillStyle = '#21583A'; ctx.beginPath(); ctx.roundRect(-9, -15, 18, 16, 3); ctx.fill();
    ctx.fillStyle = '#D8A87E'; ctx.beginPath(); ctx.arc(0, -22, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#8C6636'; ctx.beginPath(); ctx.arc(0, -24, 7.2, Math.PI, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#B98B55'; ctx.beginPath(); ctx.ellipse(0, -27, 10, 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#B3684D'; ctx.beginPath(); ctx.roundRect(-6, -18, 12, 3, 1.5); ctx.fill();
    // notebook in hand
    ctx.save(); ctx.translate(11, -12); ctx.rotate(-0.22);
    ctx.fillStyle = '#FFFDF4'; ctx.beginPath(); ctx.roundRect(0, 0, 13, 10, 2); ctx.fill();
    ctx.strokeStyle = '#B98B55'; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(0, 0, 13, 10, 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(33, 88, 58, .55)'; ctx.beginPath(); ctx.moveTo(2.5, 3.5); ctx.lineTo(10.5, 3.5); ctx.moveTo(2.5, 6.5); ctx.lineTo(8.5, 6.5); ctx.stroke();
    ctx.restore();
    ctx.restore();
    // soft attention sparks between ranger and cow
    if (!reduce() && kind === 'mind') {
      for (let i = 0; i < 2; i += 1) {
        const p = ((t / 1600) + i / 2) % 1;
        ctx.globalAlpha = (1 - p) * 0.7;
        ctx.fillStyle = '#C9973F';
        ctx.beginPath(); ctx.arc(w * 0.44 + p * w * 0.1, h * 0.5 - Math.sin(p * Math.PI) * 8, 1.8, 0, Math.PI * 2); ctx.fill();
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

  const TAB_LABELS = { mind: 'My Brain', learned: 'Lessons', memory: 'Memories' };
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
    const panes = [$('brainPaneMind'), $('brainPaneLearned'), $('brainPaneMemory')].filter(Boolean);
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
      const rect = scene.canvas.getBoundingClientRect();
      scene.w = Math.max(120, Math.round(rect.width));
      scene.h = Math.max(56, Math.round(rect.height));
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
    overlay.innerHTML = '<svg class="brain-tether" aria-hidden="true"><defs><linearGradient id="brainTetherGrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#C9973F"/><stop offset="1" stop-color="#6EAD68"/></linearGradient></defs><path id="brainTetherPath" d="" fill="none" stroke="url(#brainTetherGrad)" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="6 6"/><circle id="brainTetherPulse" r="4.5"/></svg><div class="brain-snipe-card" role="status" aria-live="polite" data-open="false"><b id="brainSnipeTitle">Brain pick</b><span id="brainSnipeLine">Reading the herd...</span><span id="brainSnipeCount" class="brain-snipe-count">Scanning</span><span id="brainSnipeWhy" class="brain-snipe-why"></span><span id="brainSnipeRecord" class="brain-snipe-record"></span><button type="button" id="brainSnipeDetails" class="brain-snipe-details" aria-expanded="false">Why this cow</button><b class="brain-snipe-why-head">Why this cow</b><ul id="brainSnipeFactors" class="brain-snipe-factors" hidden></ul><span id="brainSnipeExec" class="brain-snipe-exec" hidden></span><i class="brain-snipe-bar"><i id="brainSnipeBarFill"></i></i></div>';
    document.body.appendChild(overlay);
    tether = $('brainTetherPath');
    card = overlay.querySelector('.brain-snipe-card');
    const details = $('brainSnipeDetails');
    if (details) {
      details.addEventListener('click', () => {
        const open = !card || card.dataset.open !== 'true';
        if (card) card.dataset.open = String(open);
        details.setAttribute('aria-expanded', String(open));
        details.textContent = open ? 'Hide reasons' : 'Why this cow';
        const host = $('brainSnipeFactors');
        if (host) host.hidden = false;
      });
    }
    return overlay;
  }

  function placeOverlay() {
    const api = bridge();
    if (!api || !activeSuggestion) return;
    const snap = api.snapshot();
    const target = snap.herd.find((cow) => cow.index === activeSuggestion.cowIndex);
    if (!target) { clearSuggestion(); return; }
    const x1 = snap.head.x, y1 = snap.head.y + 4, x2 = target.sx, y2 = target.sy - 28;
    const mid = Math.max(28, Math.min(110, Math.abs(x2 - x1) * 0.3));
    tether?.setAttribute('d', `M ${x1} ${y1} C ${x1 + mid} ${y1 - 40}, ${x2 - mid} ${y2 - 24}, ${x2} ${y2}`);
    const pulse = $('brainTetherPulse');
    if (pulse) { pulse.setAttribute('cx', String(x1)); pulse.setAttribute('cy', String(y1)); }
    if (!card) return;
    const cardW = card.offsetWidth || 224, cardH = card.offsetHeight || 132;
    const panel = $('rangerBrainPanel');
    const panelRect = panel && !panel.hidden ? panel.getBoundingClientRect() : null;
    // A phone journal is a bottom sheet: keep the whole card in the sky above it.
    const sheet = !!panelRect && panelRect.top > innerHeight * 0.3 && panelRect.width > innerWidth * 0.7;
    if (sheet) {
      const left = Math.max(8, Math.min(innerWidth - cardW - 8, snap.head.x - cardW / 2));
      const top = Math.max(8, panelRect.top - cardH - 10);
      card.style.left = left + 'px';
      card.style.top = top + 'px';
      return;
    }
    // Sit the card beside the ranger's head, clear of the open journal.
    let left = snap.head.x + 30;
    if (left + cardW > innerWidth - 8) left = snap.head.x - cardW - 30;
    if (panelRect && left + cardW > panelRect.left - 10 && left < panelRect.right + 10) {
      if (innerWidth - panelRect.right >= cardW + 24) {
        left = panelRect.right + 12;
      } else if (panelRect.left >= cardW + 24) {
        left = panelRect.left - cardW - 12;
      } else {
        // No room beside the journal: hover it above instead of over the text.
        card.style.left = Math.max(8, Math.min(innerWidth - cardW - 8, snap.head.x - cardW / 2)) + 'px';
        card.style.top = Math.max(8, panelRect.top - cardH - 10) + 'px';
        return;
      }
    }
    card.style.left = Math.max(8, Math.min(innerWidth - cardW - 8, left)) + 'px';
    card.style.top = Math.max(8, Math.min(innerHeight - cardH - 8, snap.head.y - cardH - 22)) + 'px';
  }

  function suggestionReason(snipe) {
    if (snipe.reason) return String(snipe.reason);
    if (snipe.limited) return 'Stake capped by the account risk limits.';
    if (Number(snipe.edge) > 0) return 'Fresh tick and the payout sits ahead of the chance.';
    return 'Paper evidence backs this setup.';
  }
  function renderSuggestion(snipe) {
    const left = Math.max(0, Math.ceil((snipe.until - performance.now()) / 1000));
    const title = $('brainSnipeTitle'), line = $('brainSnipeLine'), meta = $('brainSnipeCount'), why = $('brainSnipeWhy'), record = $('brainSnipeRecord'), fill = $('brainSnipeBarFill'), exec = $('brainSnipeExec');
    if (title) title.textContent = String(snipe.kind || '') + ' ' + String(snipe.barrier ?? '');
    if (line) line.textContent = String(snipe.market || snipe.symbol || 'Market');
    const stake = Number(snipe.stake);
    if (meta) meta.textContent = (stake > 0 ? 'Stake ' + stake.toFixed(2) : 'Stake blocked') + ' · ' + left + 's left';
    if (why) why.textContent = suggestionReason(snipe);
    if (record) {
      const row = snipe.record && typeof snipe.record === 'object' ? snipe.record : null;
      const total = Number(row && row.total) || 0;
      record.dataset.tone = total ? (Number(row.w) >= Number(row.l) ? 'good' : 'bad') : 'new';
      record.textContent = 'Modeled ' + (Number(snipe.p) * 100).toFixed(0) + '% · ' + (total
        ? 'observed ' + row.w + 'W/' + row.l + 'L here'
        : 'no finished games here yet');
    }
    if (exec) { exec.hidden = true; exec.textContent = ''; }
    if (fill) fill.style.width = Math.max(0, Math.min(100, (left / 12) * 100)) + '%';
    card?.classList.toggle('is-blocked', !(stake > 0));
    renderFactors(snipe);
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
    const result = bridge()?.suggest?.();
    runCapture(result);
    return result;
  }

  window.__zeronineBrainSuggest = suggest;

  /* ---------- room state: learning + replay ---------- */
  let paperMemories = [];
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.source !== parent) return;
    const m = e.data || {};
    if (m.type !== 'zeronine:room-state') return;
    syncAccount();
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

  /* ---------- late entry: a game beat instead of an error ---------- */
  const REFLEX_KEY = 'ranger-brain-reflex-v1';
  function reflexRead() {
    try {
      const raw = JSON.parse(localStorage.getItem(REFLEX_KEY) || '{}');
      return { saves: Number(raw.saves) || 0, streak: Number(raw.streak) || 0, best: Number(raw.best) || 0, points: Number(raw.points) || 0 };
    } catch { return { saves: 0, streak: 0, best: 0, points: 0 }; }
  }
  function reflexWrite(state) {
    try { localStorage.setItem(REFLEX_KEY, JSON.stringify(state)); } catch {}
  }
  function reflexGrade(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return { key: 'save', label: 'SAVED' };
    if (ms <= 2500) return { key: 'snap', label: 'SNAP' };
    if (ms <= 5500) return { key: 'quick', label: 'QUICK' };
    if (ms <= 9500) return { key: 'late', label: 'LATE' };
    return { key: 'slow', label: 'TOO SLOW' };
  }
  let reflexEl = null, reflexTimer = 0;
  function ensureReflex() {
    if (reflexEl && reflexEl.isConnected) return reflexEl;
    reflexEl = document.createElement('div');
    reflexEl.className = 'brain-reflex';
    reflexEl.hidden = true;
    reflexEl.setAttribute('role', 'status');
    reflexEl.setAttribute('aria-live', 'polite');
    document.body.appendChild(reflexEl);
    return reflexEl;
  }
  function placeReflex() {
    const chip = reflexEl;
    if (!chip || chip.hidden) return;
    const glyph = $('rangerBrainGlyph');
    const rect = glyph ? glyph.getBoundingClientRect() : null;
    const width = chip.offsetWidth || 250;
    if (rect && rect.width) {
      chip.style.left = Math.max(8, Math.min(innerWidth - width - 8, rect.left + rect.width / 2 - width / 2)) + 'px';
      chip.style.top = Math.max(8, rect.top - (chip.offsetHeight || 92) - 12) + 'px';
      chip.style.bottom = 'auto';
    } else {
      chip.style.left = '12px';
      chip.style.top = 'auto';
      chip.style.bottom = '110px';
    }
  }
  const SHIELD_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.8 13 4v4.2c0 3-2.2 5.2-5 6-2.8-.8-5-3-5-6V4l5-2.2Z"/><path d="m5.8 8 1.6 1.7 2.8-3"/></svg>';
  const CLOCK_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.2"/><path d="M8 4.6V8l2.4 1.6"/></svg>';
  function showReflex(detail) {
    const code = String((detail && detail.code) || 'changed');
    const saved = code !== 'held';
    const grade = reflexGrade(Number(detail && detail.reactionMs));
    const state = reflexRead();
    let gain = 0;
    if (saved) {
      gain = 10 + (grade.key === 'snap' ? 5 : grade.key === 'quick' ? 3 : 0);
      state.saves += 1;
      state.streak += 1;
      state.points += gain;
      state.best = Math.max(state.best, state.streak);
      reflexWrite(state);
    }
    const chip = ensureReflex();
    const title = saved
      ? (code === 'stale' ? 'FEED FLICKERED' : 'COW BOLTED')
      : 'LATE ENTRY';
    const line = saved
      ? 'The setup flipped before your shot landed. Stake kept — that counts.'
      : 'The setup held, so the shot went through. Quicker draws score higher.';
    const score = saved
      ? '<b>+' + gain + '</b> reflex · streak ' + state.streak + ' · best ' + state.best
      : 'Grade ' + grade.label + ' · signal held';
    chip.dataset.grade = grade.key;
    chip.dataset.kind = saved ? 'save' : 'held';
    chip.innerHTML = '<span class="brain-reflex-icon" aria-hidden="true">' + (saved ? SHIELD_SVG : CLOCK_SVG) + '</span><div class="brain-reflex-copy"><b>' + title + '</b><span>' + line + '</span><small>' + score + '</small></div><em class="brain-reflex-grade">' + grade.label + '</em>';
    chip.hidden = false;
    chip.classList.remove('show');
    void chip.offsetWidth;
    chip.classList.add('show');
    placeReflex();
    const glyph = $('rangerBrainGlyph');
    if (glyph) {
      glyph.classList.remove('late-pop');
      void glyph.offsetWidth;
      glyph.classList.add('late-pop');
      setTimeout(() => glyph.classList.remove('late-pop'), 900);
    }
    clearTimeout(reflexTimer);
    reflexTimer = setTimeout(() => { chip.classList.remove('show'); chip.hidden = true; }, saved ? 5200 : 4200);
  }
  window.addEventListener('zeronine:brain-late-entry', (event) => {
    try { showReflex((event && event.detail) || {}); } catch {}
  });
  window.addEventListener('resize', placeReflex, { passive: true });

  /* ---------- capture scan ---------- */
  let scanEl = null, scanNote = null;
  const scanTimers = new Set();
  function scanLater(fn, ms) { const id = setTimeout(() => { scanTimers.delete(id); try { fn(); } catch {} }, ms); scanTimers.add(id); return id; }
  function clearScanTimers() { for (const id of scanTimers) clearTimeout(id); scanTimers.clear(); }
  function ensureScan() {
    if (scanEl && scanEl.isConnected) return scanEl;
    scanEl = document.createElement('div');
    scanEl.className = 'brain-scan';
    scanEl.hidden = true;
    scanEl.setAttribute('aria-hidden', 'true');
    scanEl.innerHTML = '<span class="scan-frame"></span><span class="scan-ring"></span><span class="scan-line"></span><span class="scan-dot"></span><span class="scan-corner tl"></span><span class="scan-corner tr"></span><span class="scan-corner bl"></span><span class="scan-corner br"></span>';
    document.body.appendChild(scanEl);
    scanNote = document.createElement('div');
    scanNote.id = 'brainScanNote';
    scanNote.hidden = true;
    scanNote.setAttribute('role', 'status');
    const title = document.createElement('b');
    const body = document.createElement('span');
    scanNote.append(title, body);
    document.body.appendChild(scanNote);
    return scanEl;
  }
  function glyphPoint() {
    const glyph = $('rangerBrainGlyph');
    const rect = glyph ? glyph.getBoundingClientRect() : null;
    if (rect && rect.width) return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    return { x: innerWidth / 2, y: innerHeight * 0.6 };
  }
  function scanOrigin() {
    const panel = $('rangerBrainPanel');
    const rect = panel && !panel.hidden ? panel.getBoundingClientRect() : null;
    if (!rect) return glyphPoint();
    if (innerWidth > 900) {
      // Sideways journal: sweep the open pasture beside it.
      return { x: Math.min(innerWidth - 70, Math.max(rect.right + 60, innerWidth * 0.68)), y: innerHeight * 0.42 };
    }
    // Phone sheet: sweep the sky above the sheet.
    return { x: innerWidth / 2, y: Math.max(56, Math.min(rect.top - 58, innerHeight * 0.28)) };
  }
  function placeScan(point, size) {
    const el = ensureScan();
    el.style.left = point.x + 'px';
    el.style.top = point.y + 'px';
    if (Number.isFinite(size)) { el.style.width = size + 'px'; el.style.height = size + 'px'; }
    return el;
  }
  function showScanNote(title, text) {
    const el = ensureScan();
    if (!el || !scanNote) return;
    scanNote.querySelector('b').textContent = title;
    scanNote.querySelector('span').textContent = text;
    scanNote.dataset.tone = 'empty';
    scanNote.hidden = false;
    const at = scanOrigin();
    const width = scanNote.offsetWidth || 248;
    scanNote.style.left = Math.max(8, Math.min(innerWidth - width - 8, at.x - width / 2)) + 'px';
    scanNote.style.top = Math.max(8, Math.min(innerHeight - 96, at.y + 26)) + 'px';
    scanNote.classList.remove('show');
    void scanNote.offsetWidth;
    scanNote.classList.add('show');
    scanLater(() => { scanNote.classList.remove('show'); scanNote.hidden = true; }, 5200);
  }
  function hideScan(delay) {
    const el = ensureScan();
    scanLater(() => { el.classList.remove('show'); el.hidden = true; el.dataset.phase = ''; }, delay || 380);
  }
  function runCapture(result) {
    const api = bridge();
    const el = ensureScan();
    clearScanTimers();
    const find = $('brainFindCow');
    if (find) find.dataset.scanning = 'true';
    if (scanNote) { scanNote.classList.remove('show'); scanNote.hidden = true; }
    el.style.width = '56px';
    el.style.height = '56px';
    el.dataset.phase = 'sweep';
    placeScan(scanOrigin());
    el.hidden = false;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    scanLater(() => {
      if (find) delete find.dataset.scanning;
      if (result && result.status === 'target') {
        const snap = api?.snapshot?.() || { herd: [] };
        const target = (snap.herd || []).find((cow) => cow.index === result.cowId);
        if (target) placeScan({ x: target.sx, y: target.sy - 16 }, 104);
        el.dataset.phase = 'lock';
        showSuggestion(result);
        hideScan(1100);
      } else {
        // A fresh scan that finds nothing must not leave the old pick on screen.
        clearSuggestion();
        el.dataset.phase = 'empty';
        showScanNote('No qualifying cow', (result && result.reason) || 'The brain has no defensible pick right now.');
        const glyph = $('rangerBrainGlyph');
        if (glyph) { glyph.classList.remove('no-pick'); void glyph.offsetWidth; glyph.classList.add('no-pick'); }
        hideScan(1200);
      }
    }, reduce() ? 0 : 420);
  }

  /* ---------- overview mirror + account scoping ---------- */
  function syncOverview() {
    const host = $('brainOverviewLessons');
    if (!host) return;
    const list = $('brainLessons');
    const rows = list ? Array.from(list.children).slice(0, 2) : [];
    host.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'brain-overview-empty';
      empty.textContent = 'No validated lesson yet. Finished paper games come first.';
      host.appendChild(empty);
      return;
    }
    for (const row of rows) {
      const item = document.createElement('div');
      item.className = 'brain-overview-lesson';
      const text = document.createElement('b');
      text.textContent = (row.childNodes[0]?.textContent || row.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 150);
      item.appendChild(text);
      const metaEl = row.querySelector('small');
      if (metaEl) {
        const meta = document.createElement('small');
        meta.textContent = (metaEl.textContent || '').split('|').map((part) => part.trim()).slice(0, 2).filter(Boolean).join(' · ');
        if (meta.textContent) item.appendChild(meta);
      }
      host.appendChild(item);
    }
  }
  function currentAccount() {
    try { return String(bridge()?.account?.() ?? ''); } catch { return ''; }
  }
  let learnedAccount = null;
  function syncAccount() {
    const account = currentAccount();
    if (account === learnedAccount) return;
    learnedAccount = account;
    renderLearnedCards(true);
    syncOverview();
  }
  function wireFindCow() {
    $('brainFindCow')?.addEventListener('click', () => { suggest(); });
    $('brainOverviewLessonsButton')?.addEventListener('click', () => $('brainTabLearned')?.click());
  }

  function init() {
    mountScenes();
    wireFindCow();
    syncOverview();
    syncAccount();
    renderLearnedCards(true);
    noteLessonChange(true);
    const lessonsList = $('brainLessons');
    if (lessonsList) new MutationObserver(() => noteLessonChange()).observe(lessonsList, { childList: true, subtree: true, characterData: true });
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
        if (open) { startScenes(true); syncAccount(); noteLessonChange(); syncOverview(); } else clearSuggestion();
      }).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
    }
  }

  function boot() {
    try { init(); } catch (err) { console.warn('Ranger Brain visuals unavailable', err); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
