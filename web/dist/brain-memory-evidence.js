/* A read-only view of the Brain's actual paper evidence and observed findings. */
(() => {
  'use strict';
  const KEY = 'ranger-brain-observed-findings-v1';
  const $ = id => document.getElementById(id);
  let history = [], storageAvailable = true, active = false, revision = 0;
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (Array.isArray(value)) history = value.filter(row => row && typeof row.key === 'string').slice(0, 120);
  } catch { storageAvailable = false; }

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
  // Sample counts and percentages move on every outcome. Record a new finding
  // when its meaning or validation changes, not for a count-only refresh.
  const findingShape = value => String(value || '').replace(/\d+(?:[.,]\d+)?%?/g, '#');

  function saveReports(report, now) {
    const market = String(report.market || 'Unknown market');
    const firstByKey = new Map();
    for (const old of history) if (!firstByKey.has(old.key)) firstByKey.set(old.key, old);
    const added = [];
    for (const lesson of Array.isArray(report.lessons) ? report.lessons : []) {
      if (!lesson || Number(lesson.outcomes) <= 0 || !lesson.id || !lesson.finding) continue;
      const key = JSON.stringify([market, String(lesson.id)]);
      const previous = firstByKey.get(key);
      const finding = String(lesson.finding).slice(0, 1000);
      const validity = lesson.validity === 'validated' ? 'validated' : 'provisional';
      if (previous && findingShape(previous.finding) === findingShape(finding) && previous.validity === validity) continue;
      added.push({ key, market, topic: String(lesson.topic || 'Evidence').slice(0, 80), finding, outcomes: Number(lesson.outcomes), validity, recordedAt: now, evidenceAt: Number(report.updatedAt) || 0 });
    }
    if (!added.length) return;
    history = added.concat(history).slice(0, 120);
    try { localStorage.setItem(KEY, JSON.stringify(history)); } catch { storageAvailable = false; }
  }

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
    root.append(text('p', 'brain-memory-updated', error ? 'Could not refresh the paper evidence. Saved observations remain below.' : 'Paper research · ' + String(long?.market || 'No market yet') + ' · checked ' + date(long?.generatedAt)));
    const windows = document.createElement('div');
    windows.className = 'brain-memory-windows';
    windows.append(makeWindow('Recent · 7 days', short), makeWindow('Longer view · ' + (Number(long?.lookbackDays) || 30) + ' days', long));
    root.append(windows);
    root.append(text('p', 'brain-memory-caveat', 'These windows summarize stored paper results for the same market. They are research, not a guarantee or an account trade.'));
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
    root.append(text('p', 'brain-memory-caveat', serverHistory ? 'Recorded by the server when a finding is first observed or changes meaning. Times show when it was recorded, not when the pattern originally began.' : storageAvailable ? 'Server history unavailable. Findings are recorded on this device while the game is open. Times show observations, not when the pattern originally began.' : 'History storage is unavailable; observations last only while this page stays open.'));
    const findings = document.createElement('div');
    findings.className = 'brain-memory-findings';
    const market = String(long?.market || '');
    const rows = (serverHistory || history).filter(item => !market || item.market === market).slice(0, 12);
    if (!rows.length) findings.append(text('p', '', 'No recorded findings yet. Settled paper evidence is needed.'));
    for (const item of rows) {
      const card = document.createElement('article');
      card.className = 'brain-memory-finding';
      card.append(text('strong', '', item.topic + ' · ' + (item.validity === 'validated' ? 'Checked' : 'Still checking')));
      card.append(text('p', '', item.finding));
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
      const result = await request('?lookbackDays=30');
      const long = result.report;
      if (sequence !== revision) return;
      if (!result.memoryHistory) saveReports(long, Date.now());
      if (!$('rangerBrainPanel')?.hidden && !$('brainPaneMemory')?.hidden) {
        const market = long.market ? '&market=' + encodeURIComponent(long.market) : '';
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
