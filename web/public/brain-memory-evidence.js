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
  const localizeFinding = (value, timeZone) => {
    const format = (hour, minute) => new Intl.DateTimeFormat(undefined, { timeZone: timeZone || localZone(), hour: 'numeric', minute: '2-digit' }).format(new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate(), hour, minute)));
    return String(value || '')
      .replace(/\b(\d{1,2}):(\d{2})\s*(AM|PM)\s+UTC\b/gi, (_match, hourText, minuteText, meridiem) => {
        let hour = Number(hourText) % 12;
        if (String(meridiem).toUpperCase() === 'PM') hour += 12;
        return format(hour, Number(minuteText)) + ' your local time';
      })
      .replace(/\b(\d{1,2}):00 UTC\b/g, (_match, hourText) => format(Number(hourText) || 0, 0) + ' your local time');
  };

  function ensure() {
    const slot = $('brainEvidenceSlot');
    if (!slot) return null;
    let root = $('brainEvidenceMemory');
    if (!root) {
      root = document.createElement('section');
      root.id = 'brainEvidenceMemory';
      root.className = 'brain-evidence-compact';
      root.setAttribute('aria-label', 'Shared practice evidence');
      slot.append(root);
    }
    return root;
  }
  function render(report, unused, error, serverHistory) {
    const root = ensure();
    if (!root) return;
    root.replaceChildren();
    const top = document.createElement('div');
    top.className = 'brain-evidence-compact__top';
    top.append(text('strong', '', 'Practice snapshot'));
    top.append(text('small', '', report?.market || 'Selected market'));
    root.append(top);
    if (error || !report) {
      root.append(text('p', '', 'Practice results are temporarily unavailable.'));
      return;
    }
    const count = Math.max(0, Number(report.outcomes) || 0);
    const stats = document.createElement('div');
    stats.className = 'brain-evidence-compact__stats';
    const stat = (value, label) => {
      const el = document.createElement('div');
      el.append(text('b', '', value), text('small', '', label));
      return el;
    };
    stats.append(stat(String(count), 'paper results'), stat(count ? percent(report.winRate) : '—', 'won'), stat(count ? percent(report.breakeven) : '—', 'break-even'));
    root.append(stats);
    const details = document.createElement('details');
    details.className = 'brain-evidence-compact__details';
    details.append(text('summary', '', 'Practice details'));
    details.append(text('p', '', 'Shared site practice over ' + (Number(report.lookbackDays) || 30) + ' days. Past results do not guarantee future outcomes.'));
    const lessons = Array.isArray(report.lessons) ? report.lessons.filter(item => item && Number(item.outcomes) > 0 && item.finding) : [];
    if (lessons[0]) details.append(text('p', '', localizeFinding(lessons[0].finding, report.timeZone)));
    const market = String(report.market || '');
    const rows = (Array.isArray(serverHistory) ? serverHistory : []).filter(item => !market || item.market === market).slice(0, 3);
    if (rows.length) {
      const history = document.createElement('details');
      history.append(text('summary', '', 'Recent findings'));
      for (const item of rows) {
        history.append(text('p', '', localizeFinding(item.finding, report.timeZone)));
      }
      details.append(history);
    }
    root.append(details);
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
        if (sequence === revision) render(long, null, false, result.memoryHistory);
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
