/* A read-only view of the Brain's actual paper evidence and observed findings. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let active = false, revision = 0;

  const text = (tag, cls, value) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    el.textContent = value;
    return el;
  };
  const date = value => {
    const ms = Number(value);
    if (!Number.isFinite(ms) || ms <= 0) return 'not available';
    const result = new Date(ms < 2e10 ? ms * 1000 : ms);
    return Number.isNaN(result.getTime()) ? 'not available' : result.toLocaleString();
  };
  const percent = value => Number.isFinite(value) ? (value * 100).toFixed(1) + '%' : 'unavailable';
  const localZone = () => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
  };
  const reportQuery = (days, market) => {
    const params = new URLSearchParams({ lookbackDays: String(days), timeZone: localZone() });
    if (market) params.set('market', market);
    return '?' + params.toString();
  };
  const localizeFinding = (value, timeZone) => String(value || '').replace(/\b(\d{1,2}):00 UTC\b/g, (_match, hourText) => {
    const now = new Date();
    const instant = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), Number(hourText) || 0));
    const label = new Intl.DateTimeFormat(undefined, { timeZone: timeZone || localZone(), hour: 'numeric', minute: '2-digit' }).format(instant);
    return label + ' your local time';
  });
  function ensure() {
    const pane = $('brainPaneMemory');
    if (!pane) return null;
    let root = $('brainEvidenceMemory');
    if (!root) {
      root = document.createElement('section');
      root.id = 'brainEvidenceMemory';
      root.className = 'brain-memory-summary';
      root.setAttribute('aria-label', 'Paper evidence and observed findings');
      const scene = pane.querySelector('.brain-card-scene');
      pane.insertBefore(root, scene ? scene.nextSibling : pane.firstChild);
    }
    return root;
  }
  function makeWindow(label, report) {
    const card = document.createElement('article');
    card.className = 'brain-memory-window';
    card.append(text('strong', '', label));
    if (!report) { card.append(text('p', '', 'Evidence temporarily unavailable.')); return card; }
    const count = Math.max(0, Number(report.outcomes) || 0);
    card.append(text('b', '', count + (count === 1 ? ' paper result' : ' paper results')));
    card.append(text('p', '', count ? percent(report.winRate) + ' wins · ' + percent(report.breakeven) + ' break-even' : 'No settled paper evidence in this window.'));
    if (count) card.append(text('small', '', 'Latest settlement: ' + date(report.updatedAt)));
    return card;
  }
  function render(long, short, error, serverHistory) {
    const root = ensure();
    if (!root) return;
    root.replaceChildren();
    root.append(text('h3', '', 'Evidence memory'));
    root.append(text('p', 'brain-memory-updated', error ? 'Could not refresh Supabase paper evidence or memory history.' : 'Shared site practice results · ' + String(long?.market || 'No market yet') + ' · your local time · checked ' + date(long?.generatedAt)));
    const windows = document.createElement('div');
    windows.className = 'brain-memory-windows';
    windows.append(makeWindow('Recent · 7 days', short), makeWindow('Longer view · ' + (Number(long?.lookbackDays) || 30) + ' days', long));
    root.append(windows);
    root.append(text('p', 'brain-memory-caveat', 'These are shared site practice results for this market, not your Deriv account history or a live read of the market. They are a guide to past results, not a promise.'));
    root.append(text('h4', '', 'Current findings'));
    const current = document.createElement('div');
    current.className = 'brain-memory-findings';
    const lessons = Array.isArray(long?.lessons) ? long.lessons.filter(item => item && Number(item.outcomes) > 0 && item.finding) : [];
    if (!lessons.length) current.append(text('p', '', error ? 'Current findings unavailable.' : 'Waiting for settled paper evidence.'));
    for (const lesson of lessons.slice(0, 6)) {
      const card = document.createElement('article');
      card.className = 'brain-memory-finding';
      card.append(text('strong', '', String(lesson.topic || 'Evidence') + ' · ' + (lesson.validity === 'validated' ? 'Checked' : 'Still checking')));
      card.append(text('p', '', lesson.finding));
      card.append(text('small', '', Number(lesson.outcomes) + ' paper results · latest evidence ' + date(long.updatedAt)));
      current.append(card);
    }
    root.append(current);
    root.append(text('h4', '', 'Finding history'));
    root.append(text('p', 'brain-memory-caveat', serverHistory ? 'Recorded in Supabase when a finding is first observed or changes meaning. Times show when it was recorded, not when the pattern originally began.' : 'Supabase history is unavailable. Findings are not saved in this browser as a fallback.'));
    const findings = document.createElement('div');
    findings.className = 'brain-memory-findings';
    const market = String(long?.market || '');
    const rows = (Array.isArray(serverHistory) ? serverHistory : []).filter(item => !market || item.market === market).slice(0, 12);
    if (!rows.length) findings.append(text('p', '', 'No Supabase findings are available yet. Settled paper evidence is needed.'));
    for (const item of rows) {
      const card = document.createElement('article');
      card.className = 'brain-memory-finding';
      card.append(text('strong', '', item.topic + ' · ' + (item.validity === 'validated' ? 'Checked' : 'Still checking')));
      card.append(text('p', '', localizeFinding(item.finding, long?.timeZone)));
      card.append(text('small', '', 'Observed ' + date(item.observedAt || item.recordedAt) + ' · ' + item.outcomes + ' paper results · latest evidence ' + date(item.evidenceAt)));
      findings.append(card);
    }
    root.append(findings);
  }
  async function request(query) {
    const response = await fetch('/api/ranger-brain/status' + query, { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error('Brain report unavailable');
    const body = await response.json();
    if (!body?.report || body.report.mode !== 'paper') throw new Error('Invalid Brain report');
    return { report: body.report, memoryHistory: body.memoryAvailable === true && Array.isArray(body.memoryHistory) ? body.memoryHistory : null };
  }
  async function refresh() {
    if (active || document.hidden) return;
    active = true;
    const sequence = ++revision;
    try {
      const room = typeof lastRoomState === 'undefined' ? null : lastRoomState;
      const selectedMarket = room && typeof room.selected === 'string' ? room.selected : '';
      const result = await request(reportQuery(30, selectedMarket));
      const long = result.report;
      if (sequence !== revision) return;
      
      if (!$('rangerBrainPanel')?.hidden && !$('brainPaneMemory')?.hidden) {
        const market = long.marketSymbol ? '&market=' + encodeURIComponent(long.marketSymbol) : '';
        const short = await request('?lookbackDays=7' + market);
        if (sequence === revision) render(long, short.report, false, result.memoryHistory);
      }
    } catch {
      if (sequence === revision && !$('rangerBrainPanel')?.hidden && !$('brainPaneMemory')?.hidden) render(null, null, true);
    } finally { active = false; }
  }
  function init() {
    ensure();
    const panel = $('rangerBrainPanel'), tab = $('brainTabMemory');
    tab?.addEventListener('click', () => setTimeout(refresh, 0));
    if (panel) new MutationObserver(() => { if (!panel.hidden) setTimeout(refresh, 0); }).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
    document.addEventListener('zeronine:brain-report', () => refresh());
    setInterval(refresh, 15000);
    refresh();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
