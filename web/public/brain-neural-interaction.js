/* Display a saved lesson beside the neural map. Each point is illustrative. */
(() => {
  'use strict';
  const card = document.getElementById('brainGrowthCard');
  const visual = card?.querySelector('.brain-growth-visual');
  const panel = document.getElementById('rangerBrainPanel');
  const detail = document.getElementById('brainNerveDetail');
  const circles = visual ? [...visual.querySelectorAll('.neural-nodes circle')] : [];
  if (!card || !panel || !detail || !circles.length) return;
  let active = null;
  let revision = 0;
  let lessonsCache = [];
  let lookupRevision = 0;
  function updatePoints(insights) {
    lessonsCache = Array.isArray(insights) ? insights : [];
    circles.forEach((point, index) => {
      const lesson = lessonsCache[index];
      point.dataset.connection = lesson ? 'saved' : 'empty';
      const name = lesson ? (lesson.marketName || 'Saved lesson') : 'Empty connection';
      point.setAttribute('aria-label', lesson ? 'Saved lesson: ' + name : 'Empty connection ' + (index + 1));
    });
  }
  const legend = document.createElement('div');
  legend.className = 'brain-nerve-legend';
  legend.innerHTML = '<span><i class="is-saved"></i>Saved lesson</span><span><i class="is-empty"></i>Empty</span>';
  visual.append(legend);
  const styles = document.createElement('style');
  styles.textContent = `
    html body #rangerBrainPanel .neural-nodes circle[data-connection="saved"] { fill:#f7cf55; stroke:#17633d; stroke-width:2; filter:drop-shadow(0 0 4px #83d875); }
    html body #rangerBrainPanel .neural-nodes circle[data-connection="empty"] { fill:#f8f4df; stroke:#93a48b; stroke-width:1.3; filter:none; }
    html body #rangerBrainPanel .neural-nodes circle[data-connection]:hover,
    html body #rangerBrainPanel .neural-nodes circle[data-connection]:focus-visible { stroke:#174c30; stroke-width:2.5; filter:drop-shadow(0 0 6px #63c983); transform:scale(1.8); }
    html body #rangerBrainPanel .neural-nodes circle[data-connection][aria-pressed="true"] { fill:#ffd85a; stroke:#164e30; stroke-width:2.5; filter:drop-shadow(0 0 6px #63c983); }
    .brain-nerve-legend { position:absolute; bottom:4px; left:50%; transform:translateX(-50%); z-index:4; display:flex; gap:10px; align-items:center; justify-content:center; white-space:nowrap; pointer-events:none; font:700 10px/1.2 system-ui,sans-serif; color:#31573b; }
    .brain-nerve-legend span { display:flex; gap:4px; align-items:center; }
    .brain-nerve-legend i { display:block; width:8px; height:8px; border-radius:50%; border:1px solid #789475; background:#f8f4df; }
    .brain-nerve-legend .is-saved { background:#f7cf55; border-color:#17633d; box-shadow:0 0 4px #83d875; }
    @media (max-width:420px){ .brain-nerve-legend { font-size:9px; gap:6px; } }
    @media (prefers-reduced-motion:reduce){html body #rangerBrainPanel .neural-nodes circle[data-connection]{transition:none}}
  `;
  document.head.append(styles);
  async function refreshPoints() {
    const serial = ++lookupRevision;
    try {
      const response = await fetch('/api/ranger-brain/contributions', {credentials:'same-origin',cache:'no-store'});
      if (!response.ok) throw new Error('unavailable');
      const body = await response.json();
      if (serial === lookupRevision) updatePoints(body.insights);
    } catch { if (serial === lookupRevision) updatePoints([]); }
  }
  updatePoints([]);
  document.addEventListener('brain:lessons-updated', event => {
    lookupRevision++;
    updatePoints(event.detail?.insights);
  });
  document.addEventListener('zeronine:brain-report', () => { if (!panel.hidden) void refreshPoints(); });

  function node(tag, className, content) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (content != null) el.textContent = String(content);
    return el;
  }
  function message(title, copy) {
    const header = node('div', 'brain-nerve-heading');
    const mark = node('span', 'brain-nerve-heading-icon', '✦'); mark.setAttribute('aria-hidden', 'true');
    const heading = node('div', 'brain-nerve-heading-copy');
    heading.append(node('span', 'brain-nerve-kicker', 'YOUR CONNECTION'), node('h3', '', title));
    header.append(mark, heading);
    detail.replaceChildren(header, node('p', 'brain-nerve-note', copy));
  }
  function showIntro() {
    detail.replaceChildren();
    const art = node('div', 'brain-nerve-intro-art'); art.setAttribute('aria-hidden', 'true');
    const orbit = node('span', 'brain-nerve-intro-orbit');
    const image = node('img', ''); image.src = '/brain-brand.svg?v=neural2'; image.alt = '';
    art.append(orbit, image, node('span', 'brain-nerve-intro-dot'), node('span', 'brain-nerve-intro-cursor', '↖'));
    const intro = node('div', 'brain-nerve-intro-copy');
    intro.append(node('span', 'brain-nerve-kicker', 'YOUR CONNECTIONS'),
      node('h3', '', 'Explore your Brain'), node('p', '', 'Tap a glowing point to see its lesson.'));
    detail.append(art, intro);
  }
  function setActive(circle) {
    active = circle;
    for (const point of circles) point.setAttribute('aria-pressed', String(point === circle));
  }
  function formatGroup(group, label) {
    const count = Math.max(0, Number(group?.trades) || 0);
    const wins = Math.max(0, Math.min(count, Number(group?.wins) || 0));
    const rate = count ? Math.round(wins / count * 100) : 0;
    const row = node('div', 'brain-nerve-row');
    const caption = node('span', 'brain-nerve-row-label', label);
    const result = node('strong', '', count ? wins + ' / ' + count + ' won' : 'No trades yet');
    row.append(caption, result);
    const track = node('span', 'brain-nerve-track');
    track.setAttribute('aria-hidden', 'true');
    const fill = node('i', ''); fill.style.setProperty('--win-width', rate + '%'); track.append(fill);
    row.append(track);
    return row;
  }
  async function open(circle, index) {
    document.dispatchEvent(new CustomEvent('brain:close-detail', {detail:{source:'neural'}}));
    setActive(circle);
    const serial = ++revision;
    message('Opening connection', 'Finding your lesson…');
    try {
      const response = await fetch('/api/ranger-brain/contributions', { credentials:'same-origin', cache:'no-store' });
      if (!response.ok) throw new Error('unavailable');
      const data = await response.json();
      if (serial !== revision || panel.hidden || active !== circle) return;
      const lessons = Array.isArray(data.insights) ? data.insights : [];
      const lesson = lessons[index];
      if (!lesson) {
        message('New connection', lessons.length ? 'A future lesson can grow here.' : 'Save a lesson to grow this connection.');
        return;
      }
      const direction = lesson.expectedDirection === 'over' ? 'Over ' + lesson.barrier
        : lesson.expectedDirection === 'under' ? 'Under ' + lesson.barrier : 'Your note';
      const title = (lesson.marketName || 'Your lesson') + ' · ' + direction;
      const copy = String(lesson.observation || 'Your saved lesson')
        .replace(/\n\[Trade reference: [^\]]+\]$/, '');
      message(title, copy);
      const evidence = lesson.patternEvidence;
      if (!lesson.confirmedPattern) {
        detail.append(node('small', 'brain-nerve-foot', 'Saved note. Confirm a pattern to track it.'));
      } else if (!evidence) {
        detail.append(node('small', 'brain-nerve-foot', 'Pattern results are unavailable right now.'));
      } else if (evidence.supported === false) {
        detail.append(node('small', 'brain-nerve-foot', 'Not enough recorded prices to check this pattern.'));
      } else {
        const chart = node('div', 'brain-nerve-chart');
        chart.setAttribute('aria-label', 'Recorded trade results');
        chart.append(formatGroup(evidence.matched, 'Pattern seen'), formatGroup(evidence.comparable, 'Other trades'));
        detail.append(chart, node('small', 'brain-nerve-foot', 'Your recorded trades. Past results do not predict the next trade.'));
      }
      const more = node('button', 'brain-nerve-more', 'See lessons →');
      more.type = 'button'; more.addEventListener('click', () => document.getElementById('brainTabMemory')?.click());
      detail.append(more);
    } catch {
      if (serial === revision && !panel.hidden) message('Connection unavailable', 'Connect your account and try again.');
    }
  }
  circles.forEach((circle, index) => {
    circle.setAttribute('role', 'button');
    circle.setAttribute('tabindex', '0');
    circle.setAttribute('aria-label', 'View connection ' + (index + 1));
    circle.setAttribute('aria-pressed', 'false');
    circle.addEventListener('click', event => { event.stopPropagation(); void open(circle, index); });
    circle.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); void open(circle, index); }
    });
  });
  new MutationObserver(() => {
    if (!panel.hidden) { void refreshPoints(); return; }
    revision++; lookupRevision++; setActive(null);
    showIntro();
  }).observe(panel, { attributes:true, attributeFilter:['hidden'] });
})();
