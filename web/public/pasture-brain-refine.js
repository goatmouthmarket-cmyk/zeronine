(() => {
  if (window.__pastureBrainRefineV1) return;
  window.__pastureBrainRefineV1 = true;
  const $ = (id) => document.getElementById(id);

  // Icon-led tab labels mapped onto existing panes (preserves existing runtime behavior).
  const tabMap = [
    ['brainTabMind', '🧠', 'My Brain', 'What I am doing right now'],
    ['brainTabTraining', '💡', 'What I’m Thinking', 'Current suggestion and why'],
    ['brainTabMemory', '📘', 'What I’ve Learned', 'Lessons and memories'],
    ['brainTabTiming', '🕒', 'Hours', 'Time patterns'],
    ['brainTabSettings', '⚙️', 'Settings', 'Display preferences'],
  ];
  function relabelTabs() {
    for (const [id, icon, label, title] of tabMap) {
      const b = $(id); if (!b || b.dataset.refined === '1') continue;
      b.dataset.refined = '1';
      b.title = title;
      b.replaceChildren();
      const i = document.createElement('span'); i.className = 'brain-tab-icon'; i.setAttribute('aria-hidden','true'); i.textContent = icon;
      const t = document.createElement('span'); t.textContent = label;
      b.append(i, t);
    }
    const sub = document.querySelector('#rangerBrainPanel header small');
    if (sub && !sub.dataset.refined) { sub.dataset.refined = '1'; sub.textContent = 'Paper research only · suggestions are not trade permission'; }
  }

  // Capture paper trade summaries from room state for read-only visual recaps.
  let paperMemories = [];
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.source !== parent) return;
    const m = e.data || {};
    if (m.type !== 'zeronine:room-state') return;
    const s = m.state || {};
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
    box.innerHTML = '<strong>My Memories (visual recap)</strong><p class="brain-friendly-note" id="brainReplayNote">I can replay a completed paper result as a short, read-only scene. This is a visual recap of a paper result — not a recorded shot path and never a real trade.</p><div class="brain-memory-actions" id="brainReplayActions"></div><div class="brain-replay-stage" id="brainReplayStage" aria-label="Paper result visual recap" hidden><div class="brain-replay-ground"></div><div class="brain-replay-ranger" aria-hidden="true">🏹</div><div class="brain-replay-cow" id="brainReplayCow" aria-hidden="true">🐄</div><div class="brain-replay-arrow" aria-hidden="true">➤</div><div class="brain-replay-result" id="brainReplayResult" hidden></div><div class="brain-replay-caption" id="brainReplayCaption"></div></div>';
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
    const dir = String(mem.direction || '').toUpperCase();
    const barrier = mem.barrier != null ? mem.barrier : '?';
    const won = mem.status === 'won';
    const time = mem.updated_at || mem.exitEpoch || mem.opened_at;
    cap.textContent = `Visual recap of a paper result · ${market} ${dir} ${barrier}${time ? ' · ' + new Date(Number(time) < 2e10 ? Number(time)*1000 : Number(time)).toLocaleString() : ''}. No money used.`;
    void stage.offsetWidth;
    stage.classList.add('playing');
    replayTimer = setTimeout(() => {
      stage.classList.add('hit');
      res.hidden = false;
      res.textContent = won ? 'Paper win (virtual)' : 'Paper loss (virtual)';
      cap.textContent += won ? ' I’ll keep studying setups like this as evidence grows.' : ' I’ll keep checking whether this setup holds up with more evidence.';
      replayTimer = setTimeout(() => { stage.classList.remove('playing'); }, 1200);
    }, 900);
  }

  function renderMemoryReplay() {
    ensureReplayBox();
    relabelTabs();
    const actions = $('brainReplayActions'), note = $('brainReplayNote');
    if (!actions) return;
    actions.replaceChildren();
    const memories = paperMemories.filter(m => m.status === 'won' || m.status === 'lost').slice(0, 4);
    if (!memories.length) {
      if (note) note.textContent = 'I can replay a completed paper result as a short, read-only scene once paper outcomes are available here. This is a visual recap of a paper result — not a recorded shot path and never a real trade.';
      return;
    }
    if (note) note.textContent = 'Choose a completed paper result to watch a short, read-only visual recap. The scene illustrates the stored result; it does not reproduce a recorded shot path or place any trade.';
    memories.forEach((mem, idx) => {
      const b = document.createElement('button');
      b.type = 'button';
      const won = mem.status === 'won';
      b.textContent = `${won ? 'Win' : 'Loss'} · ${mem.market || mem.symbol || 'Market'} ${String(mem.direction||'').toUpperCase()} ${mem.barrier ?? ''}`.trim();
      b.addEventListener('click', () => playReplay(mem));
      actions.appendChild(b);
      if (idx === 0 && !actions.dataset.autoshown) { actions.dataset.autoshown = '0'; }
    });
  }

  // Re-apply labels when the Brain panel opens / mutates.
  const init = () => { relabelTabs(); ensureReplayBox(); renderMemoryReplay(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  const obsTarget = $('rangerBrainPanel');
  if (obsTarget) new MutationObserver(() => relabelTabs()).observe(obsTarget, { childList: true, subtree: true });
  document.addEventListener('click', (e) => { if (e.target && e.target.closest && e.target.closest('#rangerBrainGlyph')) setTimeout(init, 60); }, true);
})();