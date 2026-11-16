/* Interactive points show account-scoped saved lessons; artwork is illustrative. */
(() => {
  'use strict';
  const card = document.getElementById('brainGrowthCard');
  const visual = card?.querySelector('.brain-growth-visual');
  const panel = document.getElementById('rangerBrainPanel');
  const circles = visual ? [...visual.querySelectorAll('.neural-nodes circle')] : [];
  if (!card || !visual || !panel || !circles.length) return;
  const popup = document.createElement('div');
  popup.className = 'brain-neural-popup';
  popup.hidden = true;
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-label', 'Brain connection details');
  card.append(popup);
  let activeCircle = null;
  let requestId = 0;
  function close(restoreFocus = false) {
    requestId++;
    popup.hidden = true;
    popup.replaceChildren();
    if (restoreFocus) activeCircle?.focus();
    activeCircle = null;
  }
  function item(tag, value) {
    const element = document.createElement(tag);
    element.textContent = String(value ?? '');
    return element;
  }
  function showMessage(title, message) {
    popup.replaceChildren();
    const closeButton = item('button', '×');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Close connection details');
    closeButton.addEventListener('click', () => close(true));
    popup.append(closeButton, item('strong', title), item('p', message));
  }
  async function open(circle, index) {
    if (activeCircle === circle && !popup.hidden) { close(true); return; }
    document.dispatchEvent(new CustomEvent('brain:close-detail', {detail:{source:'neural'}}));
    activeCircle = circle;
    popup.hidden = false;
    showMessage('Connection', 'Loading your lesson…');
    const serial = ++requestId;
    try {
      const response = await fetch('/api/ranger-brain/contributions', {credentials:'same-origin', cache:'no-store'});
      if (!response.ok) throw new Error('unavailable');
      const data = await response.json();
      if (serial !== requestId || popup.hidden) return;
      const lessons = Array.isArray(data.insights) ? data.insights : [];
      const lesson = lessons[index];
      if (!lesson) {
        showMessage('New connection', lessons.length
          ? 'This point will represent a future saved lesson.'
          : 'Save a lesson to start filling your connections.');
        return;
      }
      const setup = [lesson.marketName || 'Market', lesson.expectedDirection === 'over' ? 'Over ' + lesson.barrier : lesson.expectedDirection === 'under' ? 'Under ' + lesson.barrier : 'Observation'].join(' · ');
      showMessage(setup, String(lesson.observation || 'Your saved lesson'));
      const evidence = lesson.patternEvidence;
      const count = Math.max(0, Number(evidence?.matched?.trades) || 0);
      popup.append(item('small', lesson.confirmedPattern ? (count ? 'Recorded pattern matches: ' + count : 'Waiting for recorded pattern matches.') : 'Saved note. A pattern has not been confirmed.'));
    } catch {
      if (serial === requestId && !popup.hidden) showMessage('Connection unavailable', 'Connect your account and try again.');
    }
  }
  circles.forEach((circle, index) => {
    circle.setAttribute('role', 'button');
    circle.setAttribute('tabindex', '0');
    circle.setAttribute('aria-label', 'View connection ' + (index + 1));
    circle.addEventListener('click', event => { event.stopPropagation(); void open(circle, index); });
    circle.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); void open(circle, index); }
    });
  });
  document.addEventListener('pointerdown', event => {
    if (!popup.hidden && !popup.contains(event.target) && !event.target.closest?.('.neural-nodes circle')) close();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !popup.hidden) { event.stopPropagation(); close(true); } }, true);
  document.addEventListener('brain:close-detail', event => { if (event.detail?.source !== 'neural' && !popup.hidden) close(); });
  new MutationObserver(() => { if (panel.hidden && !popup.hidden) close(); }).observe(panel, {attributes:true, attributeFilter:['hidden']});
})();
