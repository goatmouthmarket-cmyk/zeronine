/* Keep Auto activity in its drawer on small screens instead of covering play. */
(() => {
  'use strict';
  if (window.__pastureMobileLayoutReady) return;
  const activity = document.getElementById('rangerAutoActivity');
  const menu = document.getElementById('rangerAutoHud');
  if (!activity || !menu || !activity.parentNode) return;
  window.__pastureMobileLayoutReady = true;
  const original = document.createComment('Ranger Auto activity desktop position');
  activity.parentNode.insertBefore(original, activity);
  const mobile = matchMedia('(max-width: 999.98px)');
  function place() {
    if (mobile.matches) {
      const fields = menu.querySelector('.ranger-auto-fields');
      if (activity.parentNode !== menu) menu.insertBefore(activity, fields && fields.parentNode === menu ? fields : null);
    } else if (original.parentNode && (activity.parentNode !== original.parentNode || original.nextSibling !== activity)) {
      original.parentNode.insertBefore(activity, original.nextSibling);
    }
  }
  if (typeof mobile.addEventListener === 'function') mobile.addEventListener('change', place);
  else if (typeof mobile.addListener === 'function') mobile.addListener(place);
  place();
})();
